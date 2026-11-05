"""Pipeline de processamento de documentos (executado pelo worker Celery).

Etapas e estados persistidos:
validating → extracting → chunking → embedding → indexing → ready | failed | cancelled

Cada etapa grava o status no banco para que o frontend mostre o estado real.
Cancelamento cooperativo: verificado entre etapas via ProcessingJob.cancel_requested.
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.logging import get_logger
from app.models import (
    Document,
    DocumentChunk,
    DocumentPage,
    DocumentStatus,
    DocumentVersion,
    JobStatus,
    ProcessingJob,
    UsageKind,
)
from app.models.base import utcnow
from app.providers.embeddings import EmbeddingProvider
from app.providers.storage import ObjectStorage
from app.rag.chunking import chunk_document
from app.rag.embeddings import EmbeddingIndexer
from app.rag.extraction import ExtractionError, get_extractor
from app.services.usage import record_usage

log = get_logger(__name__)


class TransientProcessingError(Exception):
    """Erro transitório (rede/provedor) — o worker pode tentar novamente com backoff."""


class ProcessingCancelledError(Exception):
    pass


@dataclass(slots=True)
class PipelineOutcome:
    status: DocumentStatus
    chunks: int
    pages: int | None
    duration_ms: int
    error: str | None = None


class DocumentPipeline:
    def __init__(
        self, db: Session, storage: ObjectStorage, embedding_provider: EmbeddingProvider
    ) -> None:
        self.db = db
        self.storage = storage
        self.provider = embedding_provider

    # ------------------------------------------------------------ helpers
    def _set_status(self, doc: Document, status: DocumentStatus) -> None:
        doc.status = status
        self.db.commit()

    def _try_ocr(self, doc: Document, data: bytes, extracted):
        """OCR opcional para PDFs sem camada de texto, quando habilitado no workspace e disponível."""
        from app.models import Workspace
        from app.providers.ocr import get_ocr_provider
        from app.rag.extraction.base import ExtractedPage
        from app.rag.extraction.normalize import normalize_page_text
        from app.services.retrieval_settings import workspace_ocr_enabled

        workspace = self.db.get(Workspace, doc.workspace_id)
        if workspace is None or not workspace_ocr_enabled(workspace):
            return extracted
        provider = get_ocr_provider()
        try:
            result = provider.ocr_pdf(data, max_pages=settings.max_pdf_pages)
        except Exception as exc:
            log.warning("ocr_failed", document_id=str(doc.id), error_type=type(exc).__name__)
            extracted.warnings.append("OCR falhou; o documento foi tratado como sem texto.")
            return extracted
        ocr_text = {p.number: normalize_page_text(p.text) for p in result.pages}
        pages = []
        for page in extracted.pages:
            text = page.text if len(page.text) >= 20 else ocr_text.get(page.number, "")
            pages.append(ExtractedPage(number=page.number, text=text, label=page.label))
        extracted.pages = pages
        extracted.char_count = sum(p.char_count for p in pages)
        extracted.metadata = {
            **extracted.metadata,
            "ocr_engine": result.engine,
            "ocr_language": result.language,
        }
        extracted.warnings = (
            [w for w in extracted.warnings if "OCR" not in w]
            + ["Texto obtido por OCR (reconhecimento óptico): pode conter erros de leitura."]
            + result.warnings
        )
        return extracted

    def _update_version(self, doc: Document, **fields) -> None:
        version = self.db.scalar(
            select(DocumentVersion).where(
                DocumentVersion.document_id == doc.id,
                DocumentVersion.version == doc.indexing_version,
            )
        )
        if version is None:
            version = DocumentVersion(
                document_id=doc.id,
                workspace_id=doc.workspace_id,
                version=doc.indexing_version,
                created_at=utcnow(),
            )
            self.db.add(version)
        for key, value in fields.items():
            setattr(version, key, value)

    def _check_cancel(self, job: ProcessingJob, doc: Document) -> None:
        self.db.refresh(job)
        self.db.refresh(doc)
        if job.cancel_requested or doc.deleted_at is not None:
            raise ProcessingCancelledError()

    # ------------------------------------------------------------ pipeline
    def run(self, document_id: uuid.UUID, job_id: uuid.UUID) -> PipelineOutcome:
        started = time.perf_counter()
        doc = self.db.get(Document, document_id)
        job = self.db.get(ProcessingJob, job_id)
        if doc is None or job is None:
            log.warning(
                "pipeline_missing_entities", document_id=str(document_id), job_id=str(job_id)
            )
            return PipelineOutcome(
                DocumentStatus.FAILED, 0, None, 0, "Documento ou job inexistente"
            )

        if job.status in (JobStatus.SUCCEEDED, JobStatus.CANCELLED):
            # Idempotência: execução repetida de um job concluído não refaz o trabalho
            return PipelineOutcome(doc.status_enum, doc.chunk_count, doc.page_count, 0)

        job.status = JobStatus.RUNNING
        job.attempt += 1
        job.started_at = job.started_at or utcnow()
        self.db.commit()

        try:
            self._check_cancel(job, doc)
            self._set_status(doc, DocumentStatus.VALIDATING)
            if not self.storage.exists(doc.storage_key):
                raise ExtractionError("Arquivo não encontrado no armazenamento.")

            # ---- extração
            self._check_cancel(job, doc)
            self._set_status(doc, DocumentStatus.EXTRACTING)
            data = self.storage.get_bytes(doc.storage_key)
            extractor = get_extractor(doc.mime_type)
            extracted = extractor.extract(data, max_pages=settings.max_pdf_pages)
            doc.page_count = extracted.page_count
            doc.char_count = extracted.char_count
            doc.extraction_meta = {
                **{k: v for k, v in extracted.metadata.items()},
                "warnings": extracted.warnings,
                "has_real_pages": extracted.has_real_pages,
            }
            self.db.commit()
            if not extracted.has_sufficient_text and doc.mime_type == "application/pdf":
                extracted = self._try_ocr(doc, data, extracted)
            if not extracted.has_sufficient_text:
                if doc.mime_type == "application/pdf":
                    raise ExtractionError(
                        "O documento não contém texto extraível (provável digitalização). "
                        "OCR ainda não está disponível nesta versão."
                    )
                raise ExtractionError("O documento não contém texto suficiente para indexação.")

            # Texto por página/seção (visualizador de texto e busca textual futura)
            self.db.execute(
                delete(DocumentPage).where(
                    DocumentPage.document_id == doc.id,
                    DocumentPage.indexing_version == doc.indexing_version,
                )
            )
            for page in extracted.pages:
                self.db.add(
                    DocumentPage(
                        document_id=doc.id,
                        workspace_id=doc.workspace_id,
                        indexing_version=doc.indexing_version,
                        number=page.number,
                        label=(page.label or None) and page.label[:255],
                        text=page.text,
                        char_count=page.char_count,
                    )
                )
            self.db.commit()

            # ---- chunking
            self._check_cancel(job, doc)
            self._set_status(doc, DocumentStatus.CHUNKING)
            drafts = chunk_document(extracted)
            if not drafts:
                raise ExtractionError("Não foi possível gerar trechos a partir do texto extraído.")
            # Remove chunks da versão atual (reexecução idempotente) e grava os novos
            self.db.execute(
                delete(DocumentChunk).where(
                    DocumentChunk.document_id == doc.id,
                    DocumentChunk.indexing_version == doc.indexing_version,
                )
            )
            now = utcnow()
            for d in drafts:
                self.db.add(
                    DocumentChunk(
                        document_id=doc.id,
                        workspace_id=doc.workspace_id,
                        indexing_version=doc.indexing_version,
                        position=d.position,
                        text=d.text,
                        token_count=d.token_count,
                        char_start=d.char_start,
                        char_end=d.char_end,
                        page_start=d.page_start,
                        page_end=d.page_end,
                        section_title=d.section_title,
                        content_hash=d.content_hash,
                        chunking_version=d.chunking_version,
                        created_at=now,
                    )
                )
            self.db.commit()

            # ---- embeddings
            self._check_cancel(job, doc)
            self._set_status(doc, DocumentStatus.EMBEDDING)
            indexer = EmbeddingIndexer(
                self.db, self.provider, expected_dimensions=settings.embedding_dimensions
            )
            try:
                stats = indexer.index_document_chunks(
                    doc.id,
                    doc.workspace_id,
                    should_cancel=lambda: _cancel_flag(self.db, job.id),
                )
            except Exception as exc:
                if _is_transient(exc):
                    raise TransientProcessingError(str(type(exc).__name__)) from exc
                raise
            self.db.commit()
            self._check_cancel(job, doc)

            # ---- indexação (consolidação)
            self._set_status(doc, DocumentStatus.INDEXING)
            # Remove chunks/embeddings de versões anteriores somente após a nova versão existir
            self.db.execute(
                delete(DocumentChunk).where(
                    DocumentChunk.document_id == doc.id,
                    DocumentChunk.indexing_version != doc.indexing_version,
                )
            )
            self.db.execute(
                delete(DocumentPage).where(
                    DocumentPage.document_id == doc.id,
                    DocumentPage.indexing_version != doc.indexing_version,
                )
            )
            doc.chunk_count = int(
                self.db.scalar(
                    select(func.count())
                    .select_from(DocumentChunk)
                    .where(
                        DocumentChunk.document_id == doc.id,
                        DocumentChunk.indexing_version == doc.indexing_version,
                    )
                )
                or 0
            )
            doc.processed_at = utcnow()
            doc.error_message = None
            doc.status = DocumentStatus.READY
            self._update_version(
                doc,
                status=DocumentStatus.READY,
                chunk_count=doc.chunk_count,
                page_count=extracted.page_count,
                chunking_version=drafts[0].chunking_version if drafts else None,
                embedding_model=self.provider.model,
                processed_at=doc.processed_at,
            )
            job.status = JobStatus.SUCCEEDED
            job.finished_at = utcnow()
            duration_ms = int((time.perf_counter() - started) * 1000)
            job.metrics = {
                "pages": extracted.page_count,
                "chars": extracted.char_count,
                "chunks": len(drafts),
                "embedded": stats.chunks_embedded,
                "embedding_tokens": stats.prompt_tokens,
                "duration_ms": duration_ms,
                "warnings": len(extracted.warnings),
            }
            record_usage(
                self.db,
                workspace_id=doc.workspace_id,
                user_id=doc.owner_id,
                kind=UsageKind.EMBEDDING,
                provider=self.provider.name,
                model=self.provider.model,
                prompt_tokens=stats.prompt_tokens,
                latency_ms=stats.latency_ms,
                reference_type="document",
                reference_id=doc.id,
                extra={"chunks": stats.chunks_embedded},
            )
            self.db.commit()
            log.info("document_ready", document_id=str(doc.id), chunks=len(drafts), ms=duration_ms)
            return PipelineOutcome(
                DocumentStatus.READY, len(drafts), extracted.page_count, duration_ms
            )

        except ProcessingCancelledError:
            self.db.rollback()
            job.status = JobStatus.CANCELLED
            job.finished_at = utcnow()
            if doc.deleted_at is None:
                doc.status = DocumentStatus.CANCELLED
                doc.error_message = "Processamento cancelado."
                self._update_version(
                    doc, status=DocumentStatus.CANCELLED, error_message=doc.error_message
                )
            self.db.commit()
            return PipelineOutcome(DocumentStatus.CANCELLED, 0, doc.page_count, 0)

        except TransientProcessingError:
            self.db.rollback()
            job.status = JobStatus.QUEUED  # será retentado pelo worker
            self.db.commit()
            raise

        except ExtractionError as exc:
            return self._fail(doc, job, str(exc), started, code=exc.code)

        except Exception as exc:
            log.exception(
                "pipeline_failed", document_id=str(document_id), error_type=type(exc).__name__
            )
            return self._fail(
                doc,
                job,
                "Falha inesperada no processamento. Tente reprocessar.",
                started,
                code="internal",
            )

    def _fail(
        self, doc: Document, job: ProcessingJob, message: str, started: float, *, code: str
    ) -> PipelineOutcome:
        self.db.rollback()
        doc.status = DocumentStatus.FAILED
        doc.error_message = message
        self._update_version(doc, status=DocumentStatus.FAILED, error_message=message)
        job.status = JobStatus.FAILED
        job.error_message = message
        job.finished_at = utcnow()
        job.metrics = {**(job.metrics or {}), "error_code": code}
        self.db.commit()
        return PipelineOutcome(
            DocumentStatus.FAILED,
            0,
            doc.page_count,
            int((time.perf_counter() - started) * 1000),
            message,
        )


def _cancel_flag(db: Session, job_id: uuid.UUID) -> bool:
    return bool(db.scalar(select(ProcessingJob.cancel_requested).where(ProcessingJob.id == job_id)))


def _is_transient(exc: Exception) -> bool:
    name = type(exc).__name__
    transient_names = {
        "APIConnectionError",
        "APITimeoutError",
        "RateLimitError",
        "InternalServerError",
        "ConnectionError",
        "TimeoutError",
        "ReadTimeout",
        "ConnectTimeout",
    }
    if name in transient_names:
        return True
    status = getattr(exc, "status_code", None)
    return isinstance(status, int) and (status == 429 or status >= 500)
