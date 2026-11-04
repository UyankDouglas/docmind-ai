from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel


class DocumentOwner(ORMModel):
    id: uuid.UUID
    name: str


class DocumentOut(ORMModel):
    id: uuid.UUID
    name: str
    original_name: str
    mime_type: str
    size_bytes: int
    sha256: str
    page_count: int | None
    char_count: int | None
    chunk_count: int
    status: str
    error_message: str | None
    created_at: datetime
    updated_at: datetime
    processed_at: datetime | None
    indexing_version: int
    owner: DocumentOwner
    # Fase 2
    location_type: str
    tags: list[str]
    collection_id: uuid.UUID | None
    collection_name: str | None = None
    has_text_layer: bool
    warnings: list[str]


class DocumentUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    tags: list[str] | None = Field(default=None, max_length=50)
    collection_id: uuid.UUID | None = None


class ProcessingJobOut(ORMModel):
    id: uuid.UUID
    job_type: str
    status: str
    attempt: int
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    error_message: str | None


class DocumentStatusOut(BaseModel):
    id: uuid.UUID
    status: str
    error_message: str | None
    page_count: int | None
    chunk_count: int
    processed_at: datetime | None
    jobs: list[ProcessingJobOut]


class DocumentVersionOut(ORMModel):
    id: uuid.UUID
    version: int
    status: str
    chunk_count: int
    page_count: int | None
    chunking_version: str | None
    embedding_model: str | None
    created_at: datetime
    processed_at: datetime | None
    error_message: str | None


class DocumentVersionList(BaseModel):
    items: list[DocumentVersionOut]


class ChunkOut(BaseModel):
    id: uuid.UUID
    document_id: uuid.UUID
    position: int
    page_start: int | None
    page_end: int | None
    section_title: str | None
    text: str
    token_count: int
    location_type: str
    location_label: str


class ChunkList(BaseModel):
    items: list[ChunkOut]


class TextSectionOut(BaseModel):
    index: int
    label: str
    text: str
    chunk_ids: list[uuid.UUID]


class DocumentTextOut(BaseModel):
    document_id: uuid.UUID
    location_type: str
    sections: list[TextSectionOut]


class TagCount(BaseModel):
    tag: str
    count: int


class TagList(BaseModel):
    items: list[TagCount]
