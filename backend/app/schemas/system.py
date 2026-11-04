from __future__ import annotations

from pydantic import BaseModel


class AiStatus(BaseModel):
    configured: bool
    embedding_provider: str
    llm_provider: str
    embedding_model: str
    llm_model: str
    external_processing: bool
    notice: str


class ServicesHealth(BaseModel):
    database: bool
    redis: bool
    storage: bool


class HealthOut(BaseModel):
    status: str
    services: ServicesHealth
    ai: AiStatus


class UsageLimits(BaseModel):
    questions_per_hour: int
    uploads_per_hour: int
    max_upload_mb: int
    max_pdf_pages: int


class RetrievalSettingsOut(BaseModel):
    mode: str
    top_k: int
    min_similarity: float
    max_context_tokens: int
    rrf_k: int


class RetrievalSettingsPatch(BaseModel):
    mode: str | None = None
    top_k: int | None = None
    min_similarity: float | None = None
    max_context_tokens: int | None = None
    rrf_k: int | None = None


class WorkspaceSettingsOut(BaseModel):
    external_ai_enabled: bool
    retrieval: RetrievalSettingsOut


class WorkspaceSettingsPatch(BaseModel):
    external_ai_enabled: bool | None = None
    retrieval: RetrievalSettingsPatch | None = None


class FeedbackSummary(BaseModel):
    positive: int
    negative: int
    total_answers: int


class UsageOut(BaseModel):
    questions_last_hour: int
    uploads_last_hour: int
    prompt_tokens_month: int
    completion_tokens_month: int
    estimated_cost_usd_month: float | None
    limits: UsageLimits
    feedback: FeedbackSummary
