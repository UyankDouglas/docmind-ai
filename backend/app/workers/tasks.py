"""Tarefas Celery de processamento documental."""

from __future__ import annotations

import uuid

from celery import Task

from app.core.database import session_scope
from app.core.logging import configure_logging, get_logger
from app.providers.embeddings import get_embedding_provider
from app.providers.storage import get_storage
from app.services.processing import DocumentPipeline, TransientProcessingError
from app.workers.celery_app import celery_app

log = get_logger(__name__)
configure_logging()

_MAX_RETRIES = 4


@celery_app.task(bind=True, name="documents.process", max_retries=_MAX_RETRIES)
def process_document(self: Task, document_id: str, job_id: str) -> dict:
    """Executa o pipeline completo (extração → chunking → embeddings → indexação)."""
    doc_uuid = uuid.UUID(document_id)
    job_uuid = uuid.UUID(job_id)
    try:
        with session_scope() as db:
            pipeline = DocumentPipeline(db, get_storage(), get_embedding_provider())
            outcome = pipeline.run(doc_uuid, job_uuid)
            return {
                "status": outcome.status.value,
                "chunks": outcome.chunks,
                "pages": outcome.pages,
                "duration_ms": outcome.duration_ms,
                "error": outcome.error,
            }
    except TransientProcessingError as exc:
        # Backoff exponencial: 30s, 60s, 120s, 240s
        countdown = 30 * (2**self.request.retries)
        log.warning(
            "document_processing_retry",
            document_id=document_id,
            attempt=self.request.retries + 1,
            countdown=countdown,
        )
        if self.request.retries >= _MAX_RETRIES:
            _mark_failed(
                doc_uuid, job_uuid, "Falha persistente ao contatar o provedor de embeddings."
            )
            return {"status": "failed", "error": "max_retries"}
        raise self.retry(exc=exc, countdown=countdown) from exc


def _mark_failed(document_id: uuid.UUID, job_id: uuid.UUID, message: str) -> None:
    from app.models import Document, DocumentStatus, JobStatus, ProcessingJob
    from app.models.base import utcnow

    with session_scope() as db:
        doc = db.get(Document, document_id)
        job = db.get(ProcessingJob, job_id)
        if doc is not None:
            doc.status = DocumentStatus.FAILED
            doc.error_message = message
        if job is not None:
            job.status = JobStatus.FAILED
            job.error_message = message
            job.finished_at = utcnow()
