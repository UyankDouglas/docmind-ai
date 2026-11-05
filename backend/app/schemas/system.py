from __future__ import annotations

from pydantic import BaseModel


class AiStatus(BaseModel):
    configured: bool
    embedding_provider: str
    llm_provider: str
    embedding_model: str
    llm_model: str
    # Nomes legíveis ("Google Gemini", "Gemini 3.5 Flash-Lite", "Gemini Embedding 001")
    provider_label: str
    llm_provider_label: str
    embedding_provider_label: str
    llm_model_label: str
    embedding_model_label: str
    # Variáveis de ambiente que faltam (nomes, nunca valores), ex.: ["GEMINI_API_KEY"]
    missing_configuration: list[str] = []
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
    monthly_token_budget: int | None = None
    monthly_cost_budget_usd: float | None = None
    max_documents: int | None = None
    max_storage_mb: int | None = None


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


class WorkspaceLimitsOut(BaseModel):
    monthly_token_budget: int | None
    monthly_cost_budget_usd: float | None
    max_documents: int | None
    max_storage_mb: int | None


class WorkspaceRetentionOut(BaseModel):
    conversations_days: int | None
    analyses_days: int | None
    search_history_days: int | None
    deleted_documents_days: int | None
    last_run_at: str | None


class WorkspaceAiOut(BaseModel):
    llm_model: str | None
    allowed_llm_models: list[str]
    embedding_model: str
    embedding_provider: str = "fake"
    embedding_provider_label: str = ""
    embedding_model_label: str = ""
    # Documentos prontos cujos embeddings foram gerados por outro modelo (precisam de reindexação)
    stale_embedding_documents: int = 0
    ocr_enabled: bool
    ocr_available: bool


class WorkspaceSettingsOut(BaseModel):
    external_ai_enabled: bool
    retrieval: RetrievalSettingsOut
    limits: WorkspaceLimitsOut
    retention: WorkspaceRetentionOut
    ai: WorkspaceAiOut


class WorkspaceLimitsPatch(BaseModel):
    monthly_token_budget: int | None = None
    monthly_cost_budget_usd: float | None = None
    max_documents: int | None = None
    max_storage_mb: int | None = None


class WorkspaceRetentionPatch(BaseModel):
    conversations_days: int | None = None
    analyses_days: int | None = None
    search_history_days: int | None = None
    deleted_documents_days: int | None = None


class WorkspaceAiPatch(BaseModel):
    llm_model: str | None = None
    ocr_enabled: bool | None = None


class WorkspaceSettingsPatch(BaseModel):
    external_ai_enabled: bool | None = None
    retrieval: RetrievalSettingsPatch | None = None
    limits: WorkspaceLimitsPatch | None = None
    retention: WorkspaceRetentionPatch | None = None
    ai: WorkspaceAiPatch | None = None


class FeedbackSummary(BaseModel):
    positive: int
    negative: int
    total_answers: int


class UsageOut(BaseModel):
    questions_last_hour: int
    uploads_last_hour: int
    prompt_tokens_month: int
    completion_tokens_month: int
    # True quando parte dos tokens do mês foi estimada localmente (provedor sem contagem exata)
    tokens_estimated: bool = False
    estimated_cost_usd_month: float | None
    limits: UsageLimits
    feedback: FeedbackSummary
    tokens_month_total: int = 0
    budget_used_pct: float | None = None
    documents_count: int = 0
    storage_mb: float = 0.0
    blocked: bool = False
    blocked_reason: str | None = None


class InstanceInfo(BaseModel):
    """Configuração pública da instância (sem autenticação)."""

    demo_mode: bool
    registration_enabled: bool
    demo_samples_available: bool
    demo_notice: str | None = None


class DemoSamplesOut(BaseModel):
    collection_id: str | None
    loaded: list[str]
    skipped: list[str]
    stopped_reason: str | None = None
