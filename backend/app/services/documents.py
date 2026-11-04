"""Serviço de documentos: upload seguro, listagem, download autorizado, reprocessamento e exclusão."""

from __future__ import annotations

import hashlib
import io
import secrets
import uuid
from collections.abc import Iterator
from dataclasses import dataclass

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.core.config import settings
from app.core.exceptions import (
    ConflictError,
    ForbiddenError,
    NotFoundError,
    PayloadTooLargeError,
    UnsupportedMediaTypeError,
    ValidationAppError,
)
from app.core.logging import get_logger
from app.models import (
    Document,
    DocumentChunk,
    DocumentStatus,
    JobStatus,
    JobType,
    ProcessingJob,
    UsageKind,
    WorkspaceRole,
)
from app.models.base import utcnow
from app.providers.storage import ObjectStorage
from app.services.audit import record_audit
from app.services.auth import AuthContext
from app.services.usage import enforce_upload_limit, record_usage

log = get_logger(__name__)

ALLOWED_TYPES: dict[str, tuple[str, bytes]] = {
    # extensão -> (mime, assinatura mágica)
    ".pdf": ("application/pdf", b"%PDF-"),
}
_WRITE_ROLES = {WorkspaceRole.ADMIN, WorkspaceRole.EDITOR}


@dataclass(slots=True)
class UploadInput:
    filename: str
    content_type: str | None
    stream: io.BufferedIOBase | io.BytesIO


def _sanitize_filename(name: str) -> str:
    name = name.replace("\\", "/").split("/")[-1].strip()
    name = "".join(ch for ch in name if ch.isprintable() and ch not in '<>:"|?*')
    return name[:255] or "documento.pdf"


def _detect_type(filename: str, head: bytes) -> str:
    ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in ALLOWED_TYPES:
        raise UnsupportedMediaTypeError("Formato não suportado nesta versão. Envie um arquivo PDF.")
    mime, magic = ALLOWED_TYPES[ext]
    if not head.startswith(magic):
        raise UnsupportedMediaTypeError("O conteúdo do arquivo não corresponde a um PDF válido.")
    return mime


def require_write_role(ctx: AuthContext) -> None:
    if ctx.role not in _WRITE_ROLES:
        raise ForbiddenError("Seu perfil não permite enviar ou alterar documentos.")


def read_upload_limited(stream, limit: int) -> bytes:
    """Lê no máximo `limit` bytes; se houver mais, rejeita sem carregar tudo em memória."""
    buf = bytearray()
    while True:
        block = stream.read(1024 * 256)
        if not block:
            break
        buf.extend(block)
        if len(buf) > limit:
            raise PayloadTooLargeError(f"O arquivo excede o limite de {settings.max_upload_mb} MB.")
    return bytes(buf)


def create_upload(
    db: Session,
    storage: ObjectStorage,
    ctx: AuthContext,
    upload: UploadInput,
    *,
    ip_address: str | None = None,
) -> Document:
    require_write_role(ctx)
    enforce_upload_limit(db, ctx.user.id)

    data = read_upload_limited(upload.stream, settings.max_upload_bytes)
    original_name = _sanitize_filename(upload.filename)
    mime = _detect_type(original_name, data[:16])
    if len(data) < 64:
        raise ValidationAppError("Arquivo vazio ou inválido.")
    sha256 = hashlib.sha256(data).hexdigest()

    duplicate = db.scalar(
        select(Document).where(
            Document.workspace_id == ctx.workspace_id,
            Document.sha256 == sha256,
            Document.deleted_at.is_(None),
        )
    )
    if duplicate is not None:
        raise ConflictError(
            f'Este arquivo já foi enviado como "{duplicate.name}".',
            code="duplicate_document",
            details={"document_id": str(duplicate.id)},
        )

    # Nome interno aleatório; o nome original fica apenas no banco
    storage_key = f"{ctx.workspace_id}/{secrets.token_hex(16)}.pdf"
    storage.put(storage_key, io.BytesIO(data), len(data), mime)

    document = Document(
        workspace_id=ctx.workspace_id,
        owner_id=ctx.user.id,
        name=original_name,
        original_name=original_name,
        mime_type=mime,
        size_bytes=len(data),
        sha256=sha256,
        storage_key=storage_key,
        status=DocumentStatus.UPLOADED,
    )
    db.add(document)
    db.flush()

    job = ProcessingJob(
        document_id=document.id,
        workspace_id=ctx.workspace_id,
        job_type=JobType.EXTRACT,
        status=JobStatus.QUEUED,
        created_at=utcnow(),
    )
    db.add(job)
    record_usage(
        db,
        workspace_id=ctx.workspace_id,
        user_id=ctx.user.id,
        kind=UsageKind.UPLOAD,
        reference_type="document",
        reference_id=document.id,
        extra={"size_bytes": len(data)},
    )
    record_audit(
        db,
        action="document.upload",
        workspace_id=ctx.workspace_id,
        user_id=ctx.user.id,
        target_type="document",
        target_id=document.id,
        ip_address=ip_address,
        details={"size_bytes": len(data), "mime_type": mime},
    )
    db.commit()
    # Enfileira após o commit e antes de reabrir transação: em modo eager (Celery no mesmo
    # processo) a tarefa precisa obter uma conexão do pool.
    _enqueue_processing(document.id, job.id)
    db.refresh(document)
    log.info("document_uploaded", document_id=str(document.id), size=len(data))
    return document


def _enqueue_processing(document_id: uuid.UUID, job_id: uuid.UUID) -> None:
    from app.workers.tasks import process_document

    process_document.delay(str(document_id), str(job_id))


def get_document(db: Session, ctx: AuthContext, document_id: uuid.UUID) -> Document:
    """Carrega um documento do workspace da sessão; 404 para qualquer outro (não vaza existência)."""
    doc = db.scalar(
        select(Document)
        .options(selectinload(Document.owner))
        .where(
            Document.id == document_id,
            Document.workspace_id == ctx.workspace_id,
            Document.deleted_at.is_(None),
        )
    )
    if doc is None:
        raise NotFoundError("Documento não encontrado.", code="document_not_found")
    return doc


def list_documents(
    db: Session,
    ctx: AuthContext,
    *,
    q: str | None,
    status: str | None,
    page: int,
    page_size: int,
) -> tuple[list[Document], int]:
    base = select(Document).where(
        Document.workspace_id == ctx.workspace_id, Document.deleted_at.is_(None)
    )
    if q:
        like = f"%{q.strip()}%"
        base = base.where(or_(Document.name.ilike(like), Document.original_name.ilike(like)))
    if status:
        try:
            base = base.where(Document.status == DocumentStatus(status))
        except ValueError as exc:
            raise ValidationAppError("Status inválido.") from exc
    total = int(db.scalar(select(func.count()).select_from(base.subquery())) or 0)
    items = list(
        db.scalars(
            base.options(selectinload(Document.owner))
            .order_by(Document.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    )
    return items, total


def list_jobs(db: Session, document: Document, limit: int = 20) -> list[ProcessingJob]:
    return list(
        db.scalars(
            select(ProcessingJob)
            .where(ProcessingJob.document_id == document.id)
            .order_by(ProcessingJob.created_at.desc())
            .limit(limit)
        )
    )


def stream_download(storage: ObjectStorage, document: Document) -> Iterator[bytes]:
    return storage.get_stream(document.storage_key)


def list_chunks(
    db: Session, ctx: AuthContext, document: Document, *, page: int | None = None
) -> list[DocumentChunk]:
    stmt = select(DocumentChunk).where(
        DocumentChunk.document_id == document.id,
        DocumentChunk.workspace_id == ctx.workspace_id,
        DocumentChunk.indexing_version == document.indexing_version,
    )
    if page is not None:
        stmt = stmt.where(DocumentChunk.page_start <= page, DocumentChunk.page_end >= page)
    return list(db.scalars(stmt.order_by(DocumentChunk.position)))


def get_chunk(db: Session, ctx: AuthContext, chunk_id: uuid.UUID) -> DocumentChunk:
    chunk = db.scalar(
        select(DocumentChunk)
        .join(Document, Document.id == DocumentChunk.document_id)
        .where(
            DocumentChunk.id == chunk_id,
            DocumentChunk.workspace_id == ctx.workspace_id,
            Document.workspace_id == ctx.workspace_id,
            Document.deleted_at.is_(None),
        )
    )
    if chunk is None:
        raise NotFoundError("Trecho não encontrado.", code="chunk_not_found")
    return chunk


def reprocess_document(
    db: Session, ctx: AuthContext, document: Document, *, ip_address: str | None = None
) -> Document:
    require_write_role(ctx)
    if document.status_enum.is_processing and document.status_enum != DocumentStatus.UPLOADED:
        raise ConflictError("O documento já está sendo processado.", code="already_processing")
    # Cancela cooperativamente jobs pendentes anteriores
    for job in list_jobs(db, document):
        if job.status in (JobStatus.QUEUED, JobStatus.RUNNING):
            job.cancel_requested = True
    document.indexing_version += 1
    document.status = DocumentStatus.UPLOADED
    document.error_message = None
    document.processed_at = None
    document.chunk_count = 0
    job = ProcessingJob(
        document_id=document.id,
        workspace_id=ctx.workspace_id,
        job_type=JobType.REPROCESS,
        status=JobStatus.QUEUED,
        created_at=utcnow(),
    )
    db.add(job)
    record_audit(
        db,
        action="document.reprocess",
        workspace_id=ctx.workspace_id,
        user_id=ctx.user.id,
        target_type="document",
        target_id=document.id,
        ip_address=ip_address,
        details={"indexing_version": document.indexing_version},
    )
    db.commit()
    _enqueue_processing(document.id, job.id)
    db.refresh(document)
    return document


def delete_document(
    db: Session,
    storage: ObjectStorage,
    ctx: AuthContext,
    document: Document,
    *,
    ip_address: str | None = None,
) -> None:
    if ctx.role == WorkspaceRole.VIEWER:
        raise ForbiddenError("Seu perfil não permite excluir documentos.")
    if ctx.role == WorkspaceRole.EDITOR and document.owner_id != ctx.user.id:
        raise ForbiddenError("Editores só podem excluir os próprios documentos.")

    for job in list_jobs(db, document):
        if job.status in (JobStatus.QUEUED, JobStatus.RUNNING):
            job.cancel_requested = True

    # Remove chunks e embeddings dos índices ativos imediatamente (cascade no banco)
    db.query(DocumentChunk).filter(DocumentChunk.document_id == document.id).delete(
        synchronize_session=False
    )
    document.chunk_count = 0
    document.status = DocumentStatus.CANCELLED
    document.deleted_at = utcnow()
    record_audit(
        db,
        action="document.delete",
        workspace_id=ctx.workspace_id,
        user_id=ctx.user.id,
        target_type="document",
        target_id=document.id,
        ip_address=ip_address,
    )
    db.commit()
    try:
        storage.delete(document.storage_key)
    except Exception as exc:  # o registro já está marcado; limpeza pode ser repetida depois
        log.warning("storage_delete_failed", document_id=str(document.id), error=type(exc).__name__)
