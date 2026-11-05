"""Serviço de documentos: upload seguro (PDF/DOCX/TXT), listagem com filtros, metadados (nome, tags,
coleção), download autorizado, reprocessamento, cancelamento cooperativo, versões e exclusão."""

from __future__ import annotations

import hashlib
import io
import secrets
import uuid
import zipfile
from collections.abc import Iterator
from dataclasses import dataclass, field

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.core.config import settings
from app.core.exceptions import (
    ConflictError,
    ForbiddenError,
    NotFoundError,
    PayloadTooLargeError,
    UnsupportedMediaTypeError,
    UsageLimitExceededError,
    ValidationAppError,
)
from app.core.logging import get_logger
from app.models import (
    Collection,
    Document,
    DocumentChunk,
    DocumentPage,
    DocumentStatus,
    DocumentVersion,
    JobStatus,
    JobType,
    ProcessingJob,
    UsageKind,
    WorkspaceRole,
)
from app.models.base import utcnow
from app.providers.storage import ObjectStorage
from app.rag.extraction.base import DOCX_MIME, PDF_MIME, TXT_MIME
from app.services.audit import record_audit
from app.services.auth import AuthContext
from app.services.collections import get_collection
from app.services.limits import enforce_document_limits
from app.services.usage import enforce_upload_limit, record_usage

log = get_logger(__name__)

# extensão -> (mime, extensão interna)
ALLOWED_TYPES: dict[str, tuple[str, str]] = {
    ".pdf": (PDF_MIME, "pdf"),
    ".docx": (DOCX_MIME, "docx"),
    ".txt": (TXT_MIME, "txt"),
}
_WRITE_ROLES = {WorkspaceRole.ADMIN, WorkspaceRole.EDITOR}
_SORT_FIELDS = {
    "created_at": Document.created_at,
    "name": Document.name,
    "size_bytes": Document.size_bytes,
}
MAX_TAGS = 20
MAX_TAG_LEN = 40


@dataclass(slots=True)
class UploadInput:
    filename: str
    content_type: str | None
    stream: io.BufferedIOBase | io.BytesIO
    collection_id: uuid.UUID | None = None
    tags: list[str] = field(default_factory=list)


def _sanitize_filename(name: str) -> str:
    name = name.replace("\\", "/").split("/")[-1].strip()
    name = "".join(ch for ch in name if ch.isprintable() and ch not in '<>:"|?*')
    return name[:255] or "documento"


def normalize_tags(tags: list[str] | None) -> list[str]:
    out: list[str] = []
    for raw in tags or []:
        for part in str(raw).split(","):
            tag = " ".join(part.split()).strip()
            if not tag:
                continue
            if len(tag) > MAX_TAG_LEN:
                raise ValidationAppError(f"Tags devem ter no máximo {MAX_TAG_LEN} caracteres.")
            if tag.lower() not in {t.lower() for t in out}:
                out.append(tag)
    if len(out) > MAX_TAGS:
        raise ValidationAppError(f"Use no máximo {MAX_TAGS} tags por documento.")
    return out


def detect_type(filename: str, data: bytes) -> str:
    """Valida extensão E conteúdo (assinatura). Lança 415 quando não bate."""
    ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in ALLOWED_TYPES:
        raise UnsupportedMediaTypeError("Formato não suportado. Envie um arquivo PDF, DOCX ou TXT.")
    mime, _ = ALLOWED_TYPES[ext]
    head = data[:16]
    if mime == PDF_MIME:
        if not head.startswith(b"%PDF-"):
            raise UnsupportedMediaTypeError(
                "O conteúdo do arquivo não corresponde a um PDF válido."
            )
    elif mime == DOCX_MIME:
        if not head.startswith(b"PK\x03\x04") or not zipfile.is_zipfile(io.BytesIO(data)):
            raise UnsupportedMediaTypeError(
                "O conteúdo do arquivo não corresponde a um DOCX válido."
            )
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as zf:
                names = set(zf.namelist())
        except zipfile.BadZipFile as exc:
            raise UnsupportedMediaTypeError("O arquivo DOCX está corrompido.") from exc
        if "word/document.xml" not in names and "EncryptedPackage" not in names:
            raise UnsupportedMediaTypeError("O arquivo não é um documento Word (.docx).")
    elif mime == TXT_MIME:
        sample = data[:8192]
        if b"\x00" in sample:
            raise UnsupportedMediaTypeError("O arquivo não parece ser texto simples.")
        from app.rag.extraction.txt import decode_text

        text, _enc, _w = decode_text(sample)
        printable = sum(1 for ch in text if ch.isprintable() or ch in "\r\n\t")
        if text and printable / len(text) < 0.9:
            raise UnsupportedMediaTypeError(
                "O arquivo contém dados binários; envie um .txt de texto."
            )
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


def _enforce_concurrent_uploads(db: Session, ctx: AuthContext) -> None:
    processing = {
        DocumentStatus.UPLOADED,
        DocumentStatus.VALIDATING,
        DocumentStatus.EXTRACTING,
        DocumentStatus.CHUNKING,
        DocumentStatus.EMBEDDING,
        DocumentStatus.INDEXING,
    }
    count = int(
        db.scalar(
            select(func.count())
            .select_from(Document)
            .where(
                Document.owner_id == ctx.user.id,
                Document.deleted_at.is_(None),
                Document.status.in_([s.value for s in processing]),
            )
        )
        or 0
    )
    if count >= settings.max_concurrent_uploads_per_user:
        raise UsageLimitExceededError(
            f"Aguarde: no máximo {settings.max_concurrent_uploads_per_user} documentos em processamento por vez."
        )


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
    _enforce_concurrent_uploads(db, ctx)
    collection = get_collection(db, ctx, upload.collection_id) if upload.collection_id else None
    tags = normalize_tags(upload.tags)

    data = read_upload_limited(upload.stream, settings.max_upload_bytes)
    enforce_document_limits(db, ctx.workspace, incoming_bytes=len(data))
    original_name = _sanitize_filename(upload.filename)
    mime = detect_type(original_name, data)
    if len(data) < 16:
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
    storage_key = f"{ctx.workspace_id}/{secrets.token_hex(16)}.{ALLOWED_TYPES['.' + original_name.rsplit('.', 1)[-1].lower()][1]}"
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
        tags=tags,
        collection_id=collection.id if collection else None,
    )
    db.add(document)
    db.flush()
    db.add(
        DocumentVersion(
            document_id=document.id,
            workspace_id=ctx.workspace_id,
            version=1,
            status=DocumentStatus.UPLOADED,
            created_at=utcnow(),
        )
    )
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
        extra={"size_bytes": len(data), "mime_type": mime},
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
    log.info("document_uploaded", document_id=str(document.id), size=len(data), mime=mime)
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


def collection_names(
    db: Session, ctx: AuthContext, documents: list[Document]
) -> dict[uuid.UUID, str]:
    ids = {d.collection_id for d in documents if d.collection_id}
    if not ids:
        return {}
    rows = db.execute(
        select(Collection.id, Collection.name).where(
            Collection.workspace_id == ctx.workspace_id, Collection.id.in_(ids)
        )
    ).all()
    return {cid: name for cid, name in rows}


def list_documents(
    db: Session,
    ctx: AuthContext,
    *,
    q: str | None,
    status: str | None,
    page: int,
    page_size: int,
    collection_id: uuid.UUID | None = None,
    tag: str | None = None,
    mime_type: str | None = None,
    sort: str | None = None,
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
    if collection_id is not None:
        base = base.where(Document.collection_id == collection_id)
    if tag:
        base = base.where(Document.tags.any(tag.strip()))
    if mime_type:
        if mime_type not in {m for m, _ in ALLOWED_TYPES.values()}:
            raise ValidationAppError("Tipo de documento inválido.")
        base = base.where(Document.mime_type == mime_type)

    order = Document.created_at.desc()
    if sort:
        desc = sort.startswith("-")
        key = sort.lstrip("-")
        if key not in _SORT_FIELDS:
            raise ValidationAppError("Ordenação inválida.")
        col = _SORT_FIELDS[key]
        order = col.desc() if desc else col.asc()

    total = int(db.scalar(select(func.count()).select_from(base.subquery())) or 0)
    items = list(
        db.scalars(
            base.options(selectinload(Document.owner))
            .order_by(order, Document.id.asc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    )
    return items, total


def list_tags(db: Session, ctx: AuthContext) -> list[tuple[str, int]]:
    tag_col = func.unnest(Document.tags).label("tag")
    sub = (
        select(tag_col)
        .where(Document.workspace_id == ctx.workspace_id, Document.deleted_at.is_(None))
        .subquery()
    )
    rows = db.execute(
        select(sub.c.tag, func.count())
        .group_by(sub.c.tag)
        .order_by(func.count().desc(), sub.c.tag.asc())
    ).all()
    return [(t, int(n)) for t, n in rows]


def update_document(
    db: Session,
    ctx: AuthContext,
    document: Document,
    *,
    name: str | None,
    tags: list[str] | None,
    collection_id: uuid.UUID | None,
    fields_set: set[str],
    ip_address: str | None = None,
) -> Document:
    require_write_role(ctx)
    changes: dict[str, object] = {}
    if name is not None:
        clean = _sanitize_filename(name)
        if not clean.strip():
            raise ValidationAppError("Informe um nome válido.")
        document.name = clean
        changes["name"] = True
    if tags is not None:
        document.tags = normalize_tags(tags)
        changes["tags"] = len(document.tags)
    if "collection_id" in fields_set:
        if collection_id is None:
            document.collection_id = None
        else:
            document.collection_id = get_collection(db, ctx, collection_id).id
        changes["collection_id"] = str(collection_id) if collection_id else None
    record_audit(
        db,
        action="document.update",
        workspace_id=ctx.workspace_id,
        user_id=ctx.user.id,
        target_type="document",
        target_id=document.id,
        ip_address=ip_address,
        details=changes,
    )
    db.commit()
    db.refresh(document)
    return document


def list_jobs(db: Session, document: Document, limit: int = 20) -> list[ProcessingJob]:
    return list(
        db.scalars(
            select(ProcessingJob)
            .where(ProcessingJob.document_id == document.id)
            .order_by(ProcessingJob.created_at.desc())
            .limit(limit)
        )
    )


def list_versions(db: Session, document: Document) -> list[DocumentVersion]:
    return list(
        db.scalars(
            select(DocumentVersion)
            .where(DocumentVersion.document_id == document.id)
            .order_by(DocumentVersion.version.desc())
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


def list_pages(
    db: Session, ctx: AuthContext, document: Document, *, number: int | None = None
) -> list[DocumentPage]:
    stmt = select(DocumentPage).where(
        DocumentPage.document_id == document.id,
        DocumentPage.workspace_id == ctx.workspace_id,
        DocumentPage.indexing_version == document.indexing_version,
    )
    if number is not None:
        stmt = stmt.where(DocumentPage.number == number)
    return list(db.scalars(stmt.order_by(DocumentPage.number)))


def get_chunk(db: Session, ctx: AuthContext, chunk_id: uuid.UUID) -> tuple[DocumentChunk, Document]:
    row = db.execute(
        select(DocumentChunk, Document)
        .join(Document, Document.id == DocumentChunk.document_id)
        .where(
            DocumentChunk.id == chunk_id,
            DocumentChunk.workspace_id == ctx.workspace_id,
            Document.workspace_id == ctx.workspace_id,
            Document.deleted_at.is_(None),
        )
    ).first()
    if row is None:
        raise NotFoundError("Trecho não encontrado.", code="chunk_not_found")
    return row[0], row[1]


def reprocess_document(
    db: Session, ctx: AuthContext, document: Document, *, ip_address: str | None = None
) -> Document:
    require_write_role(ctx)
    if document.status_enum.is_processing and document.status_enum != DocumentStatus.UPLOADED:
        raise ConflictError("O documento já está sendo processado.", code="already_processing")
    for job in list_jobs(db, document):
        if job.status in (JobStatus.QUEUED, JobStatus.RUNNING):
            job.cancel_requested = True
    document.indexing_version += 1
    document.status = DocumentStatus.UPLOADED
    document.error_message = None
    document.processed_at = None
    document.chunk_count = 0
    db.add(
        DocumentVersion(
            document_id=document.id,
            workspace_id=ctx.workspace_id,
            version=document.indexing_version,
            status=DocumentStatus.UPLOADED,
            created_at=utcnow(),
        )
    )
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


def cancel_processing(
    db: Session, ctx: AuthContext, document: Document, *, ip_address: str | None = None
) -> Document:
    """Cancelamento cooperativo: marca os jobs ativos; o worker interrompe na próxima etapa."""
    require_write_role(ctx)
    if not document.status_enum.is_processing:
        raise ConflictError("O documento não está em processamento.", code="not_processing")
    active = [
        j for j in list_jobs(db, document) if j.status in (JobStatus.QUEUED, JobStatus.RUNNING)
    ]
    for job in active:
        job.cancel_requested = True
        if job.status == JobStatus.QUEUED:
            job.status = JobStatus.CANCELLED
            job.finished_at = utcnow()
    # Se nenhum job está rodando (só enfileirados), o documento já pode refletir o cancelamento
    if not any(j.status == JobStatus.RUNNING for j in active):
        document.status = DocumentStatus.CANCELLED
        document.error_message = "Processamento cancelado pelo usuário."
        version = db.scalar(
            select(DocumentVersion).where(
                DocumentVersion.document_id == document.id,
                DocumentVersion.version == document.indexing_version,
            )
        )
        if version is not None:
            version.status = DocumentStatus.CANCELLED
            version.error_message = document.error_message
    record_audit(
        db,
        action="document.cancel",
        workspace_id=ctx.workspace_id,
        user_id=ctx.user.id,
        target_type="document",
        target_id=document.id,
        ip_address=ip_address,
    )
    db.commit()
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

    # Remove chunks, embeddings e texto extraído dos índices ativos imediatamente (cascade no banco)
    db.query(DocumentChunk).filter(DocumentChunk.document_id == document.id).delete(
        synchronize_session=False
    )
    db.query(DocumentPage).filter(DocumentPage.document_id == document.id).delete(
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
