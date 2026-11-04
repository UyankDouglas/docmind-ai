from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.core.config import settings
from app.schemas.common import ORMModel


class CitationOut(ORMModel):
    id: uuid.UUID
    index: int
    chunk_id: uuid.UUID | None
    document_id: uuid.UUID | None
    document_name: str
    page_start: int | None
    page_end: int | None
    section_title: str | None
    snippet: str


class FeedbackOut(BaseModel):
    rating: int
    comment: str | None


class MessageOut(BaseModel):
    id: uuid.UUID
    role: str
    content: str
    created_at: datetime
    status: str
    citations: list[CitationOut]
    model: str | None
    prompt_tokens: int | None
    completion_tokens: int | None
    latency_ms: int | None
    feedback: FeedbackOut | None


class ConversationSummaryOut(BaseModel):
    id: uuid.UUID
    title: str
    created_at: datetime
    updated_at: datetime
    message_count: int
    document_ids: list[uuid.UUID]


class ConversationOut(ConversationSummaryOut):
    messages: list[MessageOut]


class ConversationList(BaseModel):
    items: list[ConversationSummaryOut]


class ConversationCreate(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    document_ids: list[uuid.UUID] = Field(default_factory=list, max_length=50)


class ConversationUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    document_ids: list[uuid.UUID] | None = Field(default=None, max_length=50)


class SendMessageRequest(BaseModel):
    content: str = Field(min_length=1)
    document_ids: list[uuid.UUID] | None = Field(default=None, max_length=50)

    @field_validator("content")
    @classmethod
    def _limit_content(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("A pergunta não pode estar vazia.")
        if len(v) > settings.max_question_chars:
            raise ValueError(
                f"A pergunta excede o limite de {settings.max_question_chars} caracteres."
            )
        return v


class SendMessageResponse(BaseModel):
    user_message: MessageOut
    assistant_message: MessageOut


class FeedbackRequest(BaseModel):
    rating: Literal[1, -1]
    comment: str | None = Field(default=None, max_length=1000)


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=1000)
    document_ids: list[uuid.UUID] | None = Field(default=None, max_length=50)
    top_k: int | None = Field(default=None, ge=1, le=30)


class SearchResultOut(BaseModel):
    chunk_id: uuid.UUID
    document_id: uuid.UUID
    document_name: str
    page_start: int | None
    page_end: int | None
    section_title: str | None
    text: str
    score: float


class SearchResponse(BaseModel):
    query: str
    results: list[SearchResultOut]
    latency_ms: int
    embedding_model: str
