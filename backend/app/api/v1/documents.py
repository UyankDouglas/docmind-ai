from __future__ import annotations

import uuid
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile, status
from fastapi.responses import Response, StreamingResponse
from sqlalchemy.orm import Session

from app.api.deps import client_ip, get_current_auth, storage_dep
from app.core.database import get_db
from app.models import Document, DocumentChunk
from app.providers.storage import ObjectStorage
from app.schemas.common import Paginated
from app.schemas.document import (
    ChunkList,
    ChunkOut,
    DocumentOut,
    DocumentStatusOut,
    DocumentTextOut,
    DocumentUpdate,
    DocumentVersionList,
    DocumentVersionOut,
    ProcessingJobOut,
    TagCount,
    TagList,
    TextSectionOut,
)
from app.services import documents as doc_service
from app.services.auth import AuthContext
from app.services.documents import UploadInput
from app.services.locations import location_label

router = APIRouter(tags=["documentos"])


def document_out(doc: Document, collection_name: str | None = None) -> DocumentOut:
    out = DocumentOut.model_validate(doc)
    out.collection_name = collection_name
    return out


def chunk_out(chunk: DocumentChunk, doc: Document) -> ChunkOut:
    return ChunkOut(
        id=chunk.id,
        document_id=chunk.document_id,
        position=chunk.position,
        page_start=chunk.page_start,
        page_end=chunk.page_end,
        section_title=chunk.section_title,
        text=chunk.text,
        token_count=chunk.token_count,
        location_type=doc.location_type,
        location_label=location_label(
            location_type=doc.location_type,
            page_start=chunk.page_start,
            page_end=chunk.page_end,
            section_title=chunk.section_title,
            position=chunk.position,
        ),
    )


@router.post("/documents/upload", response_model=DocumentOut, status_code=status.HTTP_202_ACCEPTED)
def upload(
    request: Request,
    file: UploadFile = File(...),
    collection_id: uuid.UUID | None = Form(default=None),
    tags: str | None = Form(default=None),
    ctx: AuthContext = Depends(get_current_auth),
    db: Session = Depends(get_db),
    storage: ObjectStorage = Depends(storage_dep),
) -> DocumentOut:
    try:
        doc = doc_service.create_upload(
            db,
            storage,
            ctx,
            UploadInput(
                filename=file.filename or "documento",
                content_type=file.content_type,
                stream=file.file,
                collection_id=collection_id,
                tags=[tags] if tags else [],
            ),
            ip_address=client_ip(request),
        )
    finally:
        file.file.close()
    names = doc_service.collection_names(db, ctx, [doc])
    return document_out(doc, names.get(doc.collection_id) if doc.collection_id else None)


@router.get("/documents", response_model=Paginated[DocumentOut])
def list_documents(
    q: str | None = Query(default=None, max_length=200),
    status_filter: str | None = Query(default=None, alias="status"),
    collection_id: uuid.UUID | None = Query(default=None),
    tag: str | None = Query(default=None, max_length=40),
    mime_type: str | None = Query(default=None, max_length=120),
    sort: str | None = Query(default=None, max_length=20),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    ctx: AuthContext = Depends(get_current_auth),
    db: Session = Depends(get_db),
) -> Paginated[DocumentOut]:
    items, total = doc_service.list_documents(
        db,
        ctx,
        q=q,
        status=status_filter,
        page=page,
        page_size=page_size,
        collection_id=collection_id,
        tag=tag,
        mime_type=mime_type,
        sort=sort,
    )
    names = doc_service.collection_names(db, ctx, items)
    return Paginated(
        items=[
            document_out(d, names.get(d.collection_id) if d.collection_id else None) for d in items
        ],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/documents/tags", response_model=TagList)
def list_tags(
    ctx: AuthContext = Depends(get_current_auth), db: Session = Depends(get_db)
) -> TagList:
    return TagList(items=[TagCount(tag=t, count=n) for t, n in doc_service.list_tags(db, ctx)])


@router.get("/documents/{document_id}", response_model=DocumentOut)
def get_document(
    document_id: uuid.UUID,
    ctx: AuthContext = Depends(get_current_auth),
    db: Session = Depends(get_db),
) -> DocumentOut:
    doc = doc_service.get_document(db, ctx, document_id)
    names = doc_service.collection_names(db, ctx, [doc])
    return document_out(doc, names.get(doc.collection_id) if doc.collection_id else None)


@router.patch("/documents/{document_id}", response_model=DocumentOut)
def update_document(
    document_id: uuid.UUID,
    payload: DocumentUpdate,
    request: Request,
    ctx: AuthContext = Depends(get_current_auth),
    db: Session = Depends(get_db),
) -> DocumentOut:
    doc = doc_service.get_document(db, ctx, document_id)
    doc = doc_service.update_document(
        db,
        ctx,
        doc,
        name=payload.name,
        tags=payload.tags,
        collection_id=payload.collection_id,
        fields_set=set(payload.model_fields_set),
        ip_address=client_ip(request),
    )
    names = doc_service.collection_names(db, ctx, [doc])
    return document_out(doc, names.get(doc.collection_id) if doc.collection_id else None)


@router.get("/documents/{document_id}/status", response_model=DocumentStatusOut)
def get_status(
    document_id: uuid.UUID,
    ctx: AuthContext = Depends(get_current_auth),
    db: Session = Depends(get_db),
) -> DocumentStatusOut:
    doc = doc_service.get_document(db, ctx, document_id)
    jobs = doc_service.list_jobs(db, doc)
    return DocumentStatusOut(
        id=doc.id,
        status=doc.status,
        error_message=doc.error_message,
        page_count=doc.page_count,
        chunk_count=doc.chunk_count,
        processed_at=doc.processed_at,
        jobs=[ProcessingJobOut.model_validate(j) for j in jobs],
    )


@router.get("/documents/{document_id}/versions", response_model=DocumentVersionList)
def list_versions(
    document_id: uuid.UUID,
    ctx: AuthContext = Depends(get_current_auth),
    db: Session = Depends(get_db),
) -> DocumentVersionList:
    doc = doc_service.get_document(db, ctx, document_id)
    return DocumentVersionList(
        items=[DocumentVersionOut.model_validate(v) for v in doc_service.list_versions(db, doc)]
    )


@router.get("/documents/{document_id}/download")
def download(
    document_id: uuid.UUID,
    ctx: AuthContext = Depends(get_current_auth),
    db: Session = Depends(get_db),
    storage: ObjectStorage = Depends(storage_dep),
) -> StreamingResponse:
    doc = doc_service.get_document(db, ctx, document_id)
    filename = quote(doc.name)
    return StreamingResponse(
        doc_service.stream_download(storage, doc),
        media_type=doc.mime_type,
        headers={
            "Content-Disposition": f"inline; filename*=UTF-8''{filename}",
            "Content-Length": str(doc.size_bytes),
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
        },
    )


@router.get("/documents/{document_id}/chunks", response_model=ChunkList)
def list_chunks(
    document_id: uuid.UUID,
    page: int | None = Query(default=None, ge=1),
    ctx: AuthContext = Depends(get_current_auth),
    db: Session = Depends(get_db),
) -> ChunkList:
    doc = doc_service.get_document(db, ctx, document_id)
    chunks = doc_service.list_chunks(db, ctx, doc, page=page)
    return ChunkList(items=[chunk_out(c, doc) for c in chunks])


@router.get("/documents/{document_id}/text", response_model=DocumentTextOut)
def get_text(
    document_id: uuid.UUID,
    section: int | None = Query(default=None, ge=1),
    ctx: AuthContext = Depends(get_current_auth),
    db: Session = Depends(get_db),
) -> DocumentTextOut:
    doc = doc_service.get_document(db, ctx, document_id)
    pages = doc_service.list_pages(db, ctx, doc, number=section)
    chunks = doc_service.list_chunks(db, ctx, doc)
    sections: list[TextSectionOut] = []
    for page in pages:
        ids = [
            c.id
            for c in chunks
            if c.page_start is not None
            and c.page_end is not None
            and c.page_start <= page.number <= c.page_end
        ]
        default_label = (
            f"Página {page.number}" if doc.location_type == "page" else f"Seção {page.number}"
        )
        sections.append(
            TextSectionOut(
                index=page.number, label=page.label or default_label, text=page.text, chunk_ids=ids
            )
        )
    return DocumentTextOut(document_id=doc.id, location_type=doc.location_type, sections=sections)


@router.get("/chunks/{chunk_id}", response_model=ChunkOut)
def get_chunk(
    chunk_id: uuid.UUID, ctx: AuthContext = Depends(get_current_auth), db: Session = Depends(get_db)
) -> ChunkOut:
    chunk, doc = doc_service.get_chunk(db, ctx, chunk_id)
    return chunk_out(chunk, doc)


@router.post(
    "/documents/{document_id}/reprocess",
    response_model=DocumentOut,
    status_code=status.HTTP_202_ACCEPTED,
)
def reprocess(
    document_id: uuid.UUID,
    request: Request,
    ctx: AuthContext = Depends(get_current_auth),
    db: Session = Depends(get_db),
) -> DocumentOut:
    doc = doc_service.get_document(db, ctx, document_id)
    doc = doc_service.reprocess_document(db, ctx, doc, ip_address=client_ip(request))
    return document_out(doc)


@router.post("/documents/{document_id}/cancel", response_model=DocumentOut)
def cancel(
    document_id: uuid.UUID,
    request: Request,
    ctx: AuthContext = Depends(get_current_auth),
    db: Session = Depends(get_db),
) -> DocumentOut:
    doc = doc_service.get_document(db, ctx, document_id)
    doc = doc_service.cancel_processing(db, ctx, doc, ip_address=client_ip(request))
    return document_out(doc)


@router.delete("/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete(
    document_id: uuid.UUID,
    request: Request,
    ctx: AuthContext = Depends(get_current_auth),
    db: Session = Depends(get_db),
    storage: ObjectStorage = Depends(storage_dep),
) -> Response:
    doc = doc_service.get_document(db, ctx, document_id)
    doc_service.delete_document(db, storage, ctx, doc, ip_address=client_ip(request))
    return Response(status_code=status.HTTP_204_NO_CONTENT)
