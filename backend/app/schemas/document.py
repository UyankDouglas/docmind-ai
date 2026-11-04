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


class ChunkOut(ORMModel):
    id: uuid.UUID
    document_id: uuid.UUID
    position: int
    page_start: int | None
    page_end: int | None
    section_title: str | None
    text: str
    token_count: int


class ChunkList(BaseModel):
    items: list[ChunkOut]


class DocumentListQuery(BaseModel):
    q: str | None = Field(default=None, max_length=200)
    status: str | None = None
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=20, ge=1, le=100)
