"""Reindexação segura de embeddings quando o modelo muda (ex.: OpenAI → Gemini).

Embeddings de modelos diferentes não compartilham o mesmo espaço vetorial, mesmo com 1536
dimensões. A busca vetorial já ignora registros de outro modelo; este módulo encontra os
documentos afetados, faz backup dos vetores atuais e os regenera com o provedor configurado,
substituindo cada registro **no lugar** (a tabela `embedding_records` tem `chunk_id` único).

Garantias:
- Nunca apaga documentos, chunks, conversas ou arquivos.
- Backup em `embedding_records_backup` (criada sob demanda) antes de sobrescrever; `restore_backup`
  devolve os vetores antigos.
- O documento fica `embedding` durante a operação (fora do escopo de busca) e só volta a `ready`
  quando todos os chunks têm embedding do modelo atual; em falha fica `failed` com a causa, sem
  fingir que está pronto. Falhas de quota/credencial interrompem a rodada (nada de martelar a API).
- Nunca roda sozinho na inicialização: é um comando explícito
  (`python -m app.rag.embeddings.reindex`).
"""

from __future__ import annotations

import argparse
import secrets
import sys
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import bindparam, func, select, text
from sqlalchemy.orm import Session

from app.core.logging import get_logger
from app.models import (
    Document,
    DocumentChunk,
    DocumentStatus,
    DocumentVersion,
    EmbeddingRecord,
    JobStatus,
    JobType,
    ProcessingJob,
    UsageKind,
)
from app.models.base import utcnow
from app.providers.embeddings import EmbeddingProvider
from app.providers.errors import (
    ProviderAuthError,
    ProviderEmptyResponseError,
    ProviderError,
    ProviderModelUnavailableError,
    ProviderQuotaError,
)
from app.rag.embeddings.indexer import EmbeddingIndexer
from app.services.usage import record_usage

log = get_logger(__name__)

BACKUP_TABLE = "embedding_records_backup"
REINDEX_FAIL_PREFIX = "Reindexação de embeddings interrompida: "
_STOP_ON = (ProviderQuotaError, ProviderAuthError, ProviderModelUnavailableError)


# ---------------------------------------------------------------------------- diagnóstico
def _missing_current_embedding(model: str, dimensions: int):
    """EXISTS de um chunk da versão ativa sem embedding do modelo/dimensão atuais."""
    current = (
        select(EmbeddingRecord.id)
        .where(
            EmbeddingRecord.chunk_id == DocumentChunk.id,
            EmbeddingRecord.model == model,
            EmbeddingRecord.dimensions == dimensions,
        )
        .exists()
    )
    return (
        select(DocumentChunk.id)
        .where(
            DocumentChunk.document_id == Document.id,
            DocumentChunk.indexing_version == Document.indexing_version,
            ~current,
        )
        .exists()
    )


def stale_document_ids(
    db: Session,
    *,
    model: str,
    dimensions: int,
    workspace_id: uuid.UUID | None = None,
    include_failed: bool = False,
) -> list[uuid.UUID]:
    """Documentos prontos cujos chunks não têm embedding do modelo atual (ordem de criação)."""
    statuses = [DocumentStatus.READY]
    if include_failed:
        statuses.append(DocumentStatus.FAILED)
    stmt = (
        select(Document.id)
        .where(
            Document.deleted_at.is_(None),
            Document.status.in_(statuses),
            _missing_current_embedding(model, dimensions),
        )
        .order_by(Document.created_at)
    )
    if workspace_id is not None:
        stmt = stmt.where(Document.workspace_id == workspace_id)
    return list(db.scalars(stmt))


def stale_documents_count(
    db: Session, *, workspace_id: uuid.UUID, model: str, dimensions: int
) -> int:
    return len(
        stale_document_ids(db, model=model, dimensions=dimensions, workspace_id=workspace_id)
    )


def stale_overview(
    db: Session, document_ids: list[uuid.UUID]
) -> list[tuple[uuid.UUID, str, uuid.UUID, str, int, list[str]]]:
    """(id, nome, workspace, status, chunks, modelos de embedding presentes) por documento."""
    if not document_ids:
        return []
    models_sub = (
        select(func.array_agg(func.distinct(EmbeddingRecord.model)))
        .where(EmbeddingRecord.document_id == Document.id)
        .scalar_subquery()
    )
    stmt = select(
        Document.id,
        Document.name,
        Document.workspace_id,
        Document.status,
        Document.chunk_count,
        models_sub,
    ).where(Document.id.in_(document_ids))
    return [
        (row[0], row[1], row[2], row[3], int(row[4] or 0), list(row[5] or []))
        for row in db.execute(stmt).all()
    ]


# ---------------------------------------------------------------------------- backup
def ensure_backup_table(db: Session, dimensions: int) -> None:
    db.execute(
        text(
            f"""
            CREATE TABLE IF NOT EXISTS {BACKUP_TABLE} (
                backup_id text NOT NULL,
                backed_up_at timestamptz NOT NULL,
                id uuid NOT NULL,
                chunk_id uuid NOT NULL,
                document_id uuid NOT NULL,
                workspace_id uuid NOT NULL,
                model varchar(120) NOT NULL,
                dimensions integer NOT NULL,
                embedding vector({int(dimensions)}) NOT NULL,
                indexed_at timestamptz NOT NULL
            )
            """
        )
    )
    db.execute(
        text(
            f"CREATE INDEX IF NOT EXISTS ix_{BACKUP_TABLE}_backup_id ON {BACKUP_TABLE} (backup_id)"
        )
    )


def backup_embeddings(db: Session, document_ids: list[uuid.UUID], dimensions: int) -> str:
    """Copia os vetores atuais dos documentos para a tabela de backup. Devolve o id do backup."""
    backup_id = f"{datetime.now(UTC).strftime('%Y%m%dT%H%M%SZ')}-{secrets.token_hex(3)}"
    ensure_backup_table(db, dimensions)
    if document_ids:
        stmt = text(
            f"""
            INSERT INTO {BACKUP_TABLE}
                (backup_id, backed_up_at, id, chunk_id, document_id, workspace_id, model,
                 dimensions, embedding, indexed_at)
            SELECT :backup_id, now(), id, chunk_id, document_id, workspace_id, model,
                   dimensions, embedding, indexed_at
            FROM embedding_records
            WHERE document_id IN :doc_ids
            """
        ).bindparams(bindparam("doc_ids", expanding=True))
        db.execute(stmt, {"backup_id": backup_id, "doc_ids": list(document_ids)})
    log.info("embeddings_backup_created", backup_id=backup_id, documents=len(document_ids))
    return backup_id


def list_backups(db: Session) -> list[tuple[str, datetime, int, int]]:
    """(backup_id, data, vetores, documentos) — vazio se a tabela ainda não existe."""
    exists = db.scalar(text("SELECT to_regclass(:name)"), {"name": BACKUP_TABLE})
    if not exists:
        return []
    rows = db.execute(
        text(
            f"""
            SELECT backup_id, min(backed_up_at), count(*), count(DISTINCT document_id)
            FROM {BACKUP_TABLE} GROUP BY backup_id ORDER BY min(backed_up_at) DESC
            """
        )
    ).all()
    return [(r[0], r[1], int(r[2]), int(r[3])) for r in rows]


def restore_backup(db: Session, backup_id: str) -> int:
    """Devolve os vetores do backup (upsert por `chunk_id`, só para chunks que ainda existem).

    Documentos marcados como `failed` por uma reindexação interrompida voltam a `ready`, já que
    os embeddings antigos (compatíveis com o provedor anterior) estão de volta.
    """
    exists = db.scalar(text("SELECT to_regclass(:name)"), {"name": BACKUP_TABLE})
    if not exists:
        raise ValueError("Não existe tabela de backup de embeddings neste banco.")
    result = db.execute(
        text(
            f"""
            INSERT INTO embedding_records
                (id, chunk_id, document_id, workspace_id, model, dimensions, embedding, indexed_at)
            SELECT b.id, b.chunk_id, b.document_id, b.workspace_id, b.model, b.dimensions,
                   b.embedding, b.indexed_at
            FROM {BACKUP_TABLE} b
            JOIN document_chunks c ON c.id = b.chunk_id
            WHERE b.backup_id = :backup_id
            ON CONFLICT (chunk_id) DO UPDATE SET
                model = EXCLUDED.model,
                dimensions = EXCLUDED.dimensions,
                embedding = EXCLUDED.embedding,
                indexed_at = EXCLUDED.indexed_at
            """
        ),
        {"backup_id": backup_id},
    )
    restored = int(result.rowcount or 0)
    doc_ids = list(
        db.scalars(
            text(f"SELECT DISTINCT document_id FROM {BACKUP_TABLE} WHERE backup_id = :b"),
            {"b": backup_id},
        )
    )
    for doc in db.scalars(select(Document).where(Document.id.in_(doc_ids))) if doc_ids else []:
        if doc.status == DocumentStatus.FAILED and (doc.error_message or "").startswith(
            REINDEX_FAIL_PREFIX
        ):
            doc.status = DocumentStatus.READY
            doc.error_message = None
    log.info("embeddings_backup_restored", backup_id=backup_id, vectors=restored)
    return restored


# ---------------------------------------------------------------------------- reindexação
@dataclass(slots=True)
class ReindexReport:
    model: str
    dimensions: int
    backup_id: str | None = None
    documents: int = 0
    reindexed: int = 0
    failed: int = 0
    skipped: int = 0
    chunks_embedded: int = 0
    chunks_replaced: int = 0
    prompt_tokens: int = 0
    tokens_source: str = "provider"
    stopped_reason: str | None = None
    errors: list[tuple[str, str]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "model": self.model,
            "dimensions": self.dimensions,
            "backup_id": self.backup_id,
            "documents": self.documents,
            "reindexed": self.reindexed,
            "failed": self.failed,
            "skipped": self.skipped,
            "chunks_embedded": self.chunks_embedded,
            "chunks_replaced": self.chunks_replaced,
            "prompt_tokens": self.prompt_tokens,
            "tokens_source": self.tokens_source,
            "stopped_reason": self.stopped_reason,
            "errors": list(self.errors),
        }


def _chunks_without_current(db: Session, doc: Document, provider: EmbeddingProvider) -> int:
    current = (
        select(EmbeddingRecord.id)
        .where(
            EmbeddingRecord.chunk_id == DocumentChunk.id,
            EmbeddingRecord.model == provider.model,
            EmbeddingRecord.dimensions == provider.dimensions,
        )
        .exists()
    )
    return int(
        db.scalar(
            select(func.count())
            .select_from(DocumentChunk)
            .where(
                DocumentChunk.document_id == doc.id,
                DocumentChunk.indexing_version == doc.indexing_version,
                ~current,
            )
        )
        or 0
    )


def _update_version(db: Session, doc: Document, model: str) -> None:
    version = db.scalar(
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
            chunk_count=doc.chunk_count,
            page_count=doc.page_count,
        )
        db.add(version)
    version.embedding_model = model
    version.status = DocumentStatus.READY
    version.processed_at = utcnow()
    version.error_message = None


def reindex_documents(
    db: Session,
    provider: EmbeddingProvider,
    document_ids: list[uuid.UUID],
    *,
    backup: bool = True,
    on_document=None,
) -> ReindexReport:
    """Regenera os embeddings dos documentos informados com `provider`, um documento por transação."""
    report = ReindexReport(
        model=provider.model, dimensions=provider.dimensions, documents=len(document_ids)
    )
    if not document_ids:
        return report
    if backup:
        report.backup_id = backup_embeddings(db, document_ids, provider.dimensions)
        db.commit()

    for doc_id in document_ids:
        doc = db.get(Document, doc_id)
        if doc is None or doc.deleted_at is not None:
            report.skipped += 1
            continue
        job = ProcessingJob(
            document_id=doc.id,
            workspace_id=doc.workspace_id,
            job_type=JobType.EMBED,
            status=JobStatus.RUNNING,
            attempt=1,
            created_at=utcnow(),
            started_at=utcnow(),
            metrics={"reindex": True, "target_model": provider.model},
        )
        db.add(job)
        doc.status = DocumentStatus.EMBEDDING
        doc.error_message = None
        db.commit()
        job_id = job.id
        try:
            indexer = EmbeddingIndexer(db, provider, expected_dimensions=provider.dimensions)
            stats = indexer.index_document_chunks(doc.id, doc.workspace_id)
            remaining = _chunks_without_current(db, doc, provider)
            if remaining:
                raise ProviderEmptyResponseError(
                    detail=f"{remaining} chunk(s) continuam sem embedding do modelo atual"
                )
            doc.status = DocumentStatus.READY
            doc.processed_at = utcnow()
            doc.error_message = None
            _update_version(db, doc, provider.model)
            job.status = JobStatus.SUCCEEDED
            job.finished_at = utcnow()
            job.metrics = {
                **(job.metrics or {}),
                "chunks": stats.chunks_total,
                "embedded": stats.chunks_embedded,
                "replaced": stats.chunks_replaced,
                "embedding_tokens": stats.prompt_tokens,
                "tokens_source": stats.tokens_source,
                "duration_ms": stats.latency_ms,
            }
            record_usage(
                db,
                workspace_id=doc.workspace_id,
                user_id=doc.owner_id,
                kind=UsageKind.EMBEDDING,
                provider=provider.name,
                model=provider.model,
                prompt_tokens=stats.prompt_tokens,
                latency_ms=stats.latency_ms,
                reference_type="document",
                reference_id=doc.id,
                extra={
                    "chunks": stats.chunks_embedded,
                    "reindex": True,
                    "tokens_source": stats.tokens_source,
                },
            )
            db.commit()
            report.reindexed += 1
            report.chunks_embedded += stats.chunks_embedded
            report.chunks_replaced += stats.chunks_replaced
            report.prompt_tokens += stats.prompt_tokens
            if stats.tokens_source != "provider":
                report.tokens_source = stats.tokens_source
            log.info(
                "document_reindexed",
                document_id=str(doc.id),
                chunks=stats.chunks_total,
                replaced=stats.chunks_replaced,
            )
            if on_document:
                on_document(doc, None)
        except Exception as exc:
            db.rollback()  # descarta vetores parciais: os antigos continuam no banco
            err = exc if isinstance(exc, ProviderError) else None
            reason = err.message if err else "erro inesperado durante a geração dos embeddings."
            message = (
                f"{REINDEX_FAIL_PREFIX}{reason} Os trechos e o arquivo foram preservados; "
                "execute a reindexação novamente."
            )
            doc = db.get(Document, doc_id)
            job = db.get(ProcessingJob, job_id)
            if doc is not None:
                doc.status = DocumentStatus.FAILED
                doc.error_message = message
            if job is not None:
                job.status = JobStatus.FAILED
                job.error_message = message
                job.finished_at = utcnow()
                job.metrics = {**(job.metrics or {}), "error_code": err.code if err else "internal"}
            db.commit()
            report.failed += 1
            report.errors.append((str(doc_id), err.code if err else type(exc).__name__))
            log.warning(
                "document_reindex_failed",
                document_id=str(doc_id),
                error_code=err.code if err else type(exc).__name__,
            )
            if on_document:
                on_document(doc, err or exc)
            if isinstance(err, _STOP_ON):
                report.stopped_reason = err.code
                break
    return report


# ---------------------------------------------------------------------------- CLI
def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m app.rag.embeddings.reindex",
        description=(
            "Reindexa embeddings gerados por outro modelo usando o provedor configurado "
            "(EMBEDDING_PROVIDER/EMBEDDING_MODEL). Faz backup antes de sobrescrever."
        ),
    )
    parser.add_argument("--workspace", help="limita a um workspace (UUID)")
    parser.add_argument("--limit", type=int, help="máximo de documentos nesta rodada")
    parser.add_argument("--dry-run", action="store_true", help="só lista os documentos afetados")
    parser.add_argument("--yes", action="store_true", help="não pede confirmação")
    parser.add_argument("--no-backup", action="store_true", help="não copia os vetores atuais")
    parser.add_argument(
        "--include-failed",
        action="store_true",
        help="inclui documentos `failed` (ex.: interrompidos por quota na rodada anterior)",
    )
    parser.add_argument("--restore", metavar="BACKUP_ID", help="restaura os vetores de um backup")
    parser.add_argument("--list-backups", action="store_true")
    args = parser.parse_args(argv)

    from app.core.database import session_scope

    if args.list_backups:
        with session_scope() as db:
            rows = list_backups(db)
        if not rows:
            print("Nenhum backup de embeddings encontrado.")
        for backup_id, when, vectors, docs in rows:
            print(f"{backup_id}  {when:%Y-%m-%d %H:%M UTC}  vetores={vectors}  documentos={docs}")
        return 0

    if args.restore:
        with session_scope() as db:
            restored = restore_backup(db, args.restore)
        print(f"Backup {args.restore}: {restored} vetor(es) restaurado(s).")
        return 0

    from app.core.config import settings
    from app.providers.embeddings import get_embedding_provider

    provider = get_embedding_provider()
    workspace_id = uuid.UUID(args.workspace) if args.workspace else None
    with session_scope() as db:
        ids = stale_document_ids(
            db,
            model=provider.model,
            dimensions=provider.dimensions,
            workspace_id=workspace_id,
            include_failed=args.include_failed,
        )
        if args.limit:
            ids = ids[: args.limit]
        overview = stale_overview(db, ids)

    print(
        f"Provedor: {provider.name} · modelo: {provider.model} · dimensões: {provider.dimensions}"
        f" (EMBEDDING_PROVIDER={settings.embedding_provider})"
    )
    if not ids:
        print("Nenhum documento com embeddings de outro modelo. Nada a fazer.")
        return 0
    print(f"{len(ids)} documento(s) com embeddings incompatíveis:")
    for doc_id, name, ws, status, chunks, models in overview:
        print(
            f"  - {doc_id}  {name!r}  workspace={ws}  status={status}  chunks={chunks}  modelos={models}"
        )
    if args.dry_run:
        return 0
    if not args.yes:
        answer = input("Regenerar os embeddings desses documentos agora? [s/N] ").strip().lower()
        if answer not in ("s", "sim", "y", "yes"):
            print("Cancelado.")
            return 0

    def _progress(doc, err):
        if err is None:
            print(f"  ok     {doc.id}  {doc.name!r}")
        else:
            code = getattr(err, "code", type(err).__name__)
            print(f"  FALHA  {doc.id if doc else '?'}  ({code})", file=sys.stderr)

    with session_scope() as db:
        report = reindex_documents(
            db, provider, ids, backup=not args.no_backup, on_document=_progress
        )
    print(
        f"Concluído: {report.reindexed} reindexado(s), {report.failed} falha(s), "
        f"{report.skipped} ignorado(s); chunks={report.chunks_embedded} "
        f"(substituídos={report.chunks_replaced}); tokens={report.prompt_tokens} "
        f"[{report.tokens_source}]; backup={report.backup_id or '—'}"
    )
    if report.stopped_reason:
        print(
            f"Rodada interrompida por {report.stopped_reason}: os documentos restantes não foram "
            "alterados. Tente novamente mais tarde (--include-failed para retomar os que falharam).",
            file=sys.stderr,
        )
        return 2
    return 1 if report.failed else 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
