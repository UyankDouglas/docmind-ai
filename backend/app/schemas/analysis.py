from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

SummaryType = Literal["general", "executive", "topics", "obligations", "faq", "attention"]


class SummarizeRequest(BaseModel):
    type: SummaryType


class CompareRequest(BaseModel):
    document_ids: list[uuid.UUID] = Field(min_length=2, max_length=5)
    question: str | None = Field(default=None, max_length=500)


class AnalysisDocumentOut(BaseModel):
    id: uuid.UUID
    name: str
    label: str | None


class AnalysisSourceOut(BaseModel):
    index: int
    chunk_id: uuid.UUID | None
    document_id: uuid.UUID | None
    document_name: str
    document_label: str | None
    location_type: str
    location_label: str
    snippet: str


class AnalysisCoverageOut(BaseModel):
    chunks_used: int
    chunks_total: int
    tokens_used: int
    strategy: str
    parts: int
    complete: bool


class AnalysisTopicOut(BaseModel):
    title: str
    description: str
    source_indices: list[int]


class AnalysisResultOut(BaseModel):
    content: str
    sources: list[AnalysisSourceOut]
    coverage: AnalysisCoverageOut
    limitations: list[str]
    topics: list[AnalysisTopicOut] | None = None
    questions: list[str] | None = None


class AnalysisOut(BaseModel):
    id: uuid.UUID
    kind: str
    summary_type: str | None
    status: str
    title: str
    document_ids: list[uuid.UUID]
    documents: list[AnalysisDocumentOut]
    question: str | None
    result: AnalysisResultOut | None
    error_message: str | None
    model: str | None
    prompt_tokens: int | None
    completion_tokens: int | None
    latency_ms: int | None
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None


def analysis_out(a: Any) -> AnalysisOut:
    return AnalysisOut(
        id=a.id,
        kind=a.kind,
        summary_type=a.summary_type,
        status=a.status,
        title=a.title,
        document_ids=list(a.document_ids),
        documents=[AnalysisDocumentOut(**d) for d in (a.documents_meta or [])],
        question=a.question,
        result=AnalysisResultOut(**a.result) if a.result else None,
        error_message=a.error_message,
        model=a.model,
        prompt_tokens=a.prompt_tokens,
        completion_tokens=a.completion_tokens,
        latency_ms=a.latency_ms,
        created_at=a.created_at,
        started_at=a.started_at,
        finished_at=a.finished_at,
    )
