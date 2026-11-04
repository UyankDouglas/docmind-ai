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


class UsageOut(BaseModel):
    questions_last_hour: int
    uploads_last_hour: int
    prompt_tokens_month: int
    completion_tokens_month: int
    estimated_cost_usd_month: float | None
    limits: UsageLimits
