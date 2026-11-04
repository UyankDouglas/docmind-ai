from __future__ import annotations

import uuid
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Query, Request, UploadFile, status
from fastapi.responses import Response, StreamingResponse
from sqlalchemy.orm import Session

from app.api.deps import client_ip, get_current_auth, storage_dep
from app.core.database import get_db
from app.providers.storage import ObjectStorage
from app.schemas.common import Paginated
from app.schemas.document import (
    ChunkList,
    ChunkOut,
    DocumentOut,
    DocumentStatusOut,
    ProcessingJobOut,
)
from app.services import documents as doc_service
from app.services.auth import AuthContext
from app.services.documents import UploadInput

router = APIRouter(tags=["documentos"])


@router.post("/documents/upload", response_model=DocumentOut, status_code=status.HTTP_202_ACCEPTED)
def upload(
    request: Request,
    file: UploadFile = File(...),
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
                filename=file.filename or "documento.pdf",
                content_type=file.content_type,
                stream=file.file,
            ),
            ip_address=client_ip(request),
        )
    finally:
        file.file.close()
    return DocumentOut.model_validate(doc)


@router.get("/documents", response_model=Paginated[DocumentOut])
def list_documents(
    q: str | None = Query(default=None, max_length=200),
    status_filter: str | None = Query(default=None, alias="status"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    ctx: AuthContext = Depends(get_current_auth),
    db: Session = Depends(get_db),
) -> Paginated[DocumentOut]:
    items, total = doc_service.list_documents(
        db, ctx, q=q, status=status_filter, page=page, page_size=page_size
    )
    return Paginated(
        items=[DocumentOut.model_validate(d) for d in items],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/documents/{document_id}", response_model=DocumentOut)
def get_document(
    document_id: uuid.UUID,
    ctx: AuthContext = Depends(get_current_auth),
    db: Session = Depends(get_db),
) -> DocumentOut:
    return DocumentOut.model_validate(doc_service.get_document(db, ctx, document_id))


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
    return ChunkList(items=[ChunkOut.model_validate(c) for c in chunks])


@router.get("/chunks/{chunk_id}", response_model=ChunkOut)
def get_chunk(
    chunk_id: uuid.UUID, ctx: AuthContext = Depends(get_current_auth), db: Session = Depends(get_db)
) -> ChunkOut:
    return ChunkOut.model_validate(doc_service.get_chunk(db, ctx, chunk_id))


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
    return DocumentOut.model_validate(
        doc_service.reprocess_document(db, ctx, doc, ip_address=client_ip(request))
    )


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
