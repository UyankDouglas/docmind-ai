"""Configurações centrais da aplicação (carregadas de variáveis de ambiente)."""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import computed_field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ProviderName = Literal["openai", "gemini", "fake"]

# Modelos padrão por provedor (sobrescritos por EMBEDDING_MODEL / LLM_MODEL).
DEFAULT_EMBEDDING_MODELS: dict[str, str] = {
    "gemini": "gemini-embedding-001",
    "openai": "text-embedding-3-small",
    "fake": "fake-hash-v1",
}
DEFAULT_LLM_MODELS: dict[str, str] = {
    "gemini": "gemini-3.5-flash-lite",
    "openai": "gpt-4o-mini",
    "fake": "fake-llm-v1",
}
# Variável de ambiente que guarda a chave de cada provedor real.
PROVIDER_KEY_ENV: dict[str, str] = {"gemini": "GEMINI_API_KEY", "openai": "OPENAI_API_KEY"}
GEMINI_THINKING_LEVELS = ("MINIMAL", "LOW", "MEDIUM", "HIGH")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # --- Aplicação ---
    app_env: Literal["development", "test", "production"] = "development"
    app_name: str = "DocMind AI"
    secret_key: str = "change-me-please-generate-a-random-64-hex-string"
    cors_origins: str = "http://localhost:5173"
    cookie_secure: bool = False
    session_ttl_hours: int = 72
    log_level: str = "INFO"

    # --- Banco ---
    postgres_user: str = "docmind"
    postgres_password: str = "docmind"
    postgres_db: str = "docmind"
    postgres_host: str = "localhost"
    postgres_port: int = 5432
    database_url: str | None = None
    # Pool de conexões. Para o PGlite local (uma conexão por vez) use DB_POOL_SIZE=1 e DB_MAX_OVERFLOW=0.
    db_pool_size: int = 5
    db_max_overflow: int = 10

    # --- Redis / Celery ---
    redis_url: str = "redis://localhost:6379/0"
    celery_broker_url: str = "redis://localhost:6379/1"
    celery_result_backend: str = "redis://localhost:6379/2"
    celery_task_always_eager: bool = False

    # --- Armazenamento ---
    # "minio" (padrão), "local" (disco, apenas desenvolvimento sem MinIO) ou "memory" (testes)
    storage_backend: Literal["minio", "local", "memory"] = "minio"
    local_storage_dir: str = "./data/storage"
    minio_endpoint: str = "localhost:9000"
    minio_root_user: str = "docmind"
    minio_root_password: str = "docmind-minio-secret"
    minio_bucket: str = "docmind-documents"
    minio_secure: bool = False

    # --- IA ---
    # "gemini" (Google Gemini API, padrão), "openai" ou "fake" (determinístico, só testes/dev)
    embedding_provider: ProviderName = "gemini"
    llm_provider: ProviderName = "gemini"
    gemini_api_key: str | None = None
    openai_api_key: str | None = None
    openai_base_url: str | None = None
    # Vazio => padrão do provedor (ver DEFAULT_*_MODELS)
    embedding_model: str = ""
    embedding_dimensions: int = 1536
    llm_model: str = ""
    llm_timeout_seconds: float = 60.0
    llm_max_retries: int = 3
    # Backoff exponencial com jitter entre tentativas (segundos)
    provider_retry_base_seconds: float = 1.0
    provider_retry_max_seconds: float = 20.0
    # Gemini: nível de raciocínio (MINIMAL/LOW/MEDIUM/HIGH; vazio = padrão do modelo) e se a
    # temperatura pedida pela aplicação deve ser enviada (a Google recomenda manter o padrão
    # nos modelos Gemini 3; por isso o padrão aqui é não enviar).
    gemini_thinking_level: str | None = None
    gemini_apply_temperature: bool = False
    gemini_embedding_batch_size: int = 100
    # Preços opcionais (USD por 1M tokens) para estimativa de custo. Sem valor => custo não estimado.
    price_embedding_per_1m: float | None = None
    price_llm_input_per_1m: float | None = None
    price_llm_output_per_1m: float | None = None

    # --- Limites de upload ---
    max_upload_mb: int = 20
    max_pdf_pages: int = 200
    max_concurrent_uploads_per_user: int = 3

    # --- RAG ---
    chunk_target_tokens: int = 700
    chunk_max_tokens: int = 900
    chunk_overlap_tokens: int = 100
    chunking_version: str = "v1"
    chunk_respect_pages: bool = True
    chunk_min_tokens_before_page_break: int = 200
    chunk_min_tokens_before_section_break: int = 80
    retrieval_top_k: int = 8
    retrieval_min_similarity: float = 0.15
    max_context_tokens: int = 6000
    max_output_tokens: int = 800
    max_question_chars: int = 2000
    # --- Conta, e-mail e convites ---
    app_base_url: str = "http://localhost:5173"
    password_reset_ttl_minutes: int = 30
    invitation_ttl_days: int = 7
    mail_host: str | None = None
    mail_port: int = 587
    mail_username: str | None = None
    mail_password: str | None = None
    mail_from: str = "DocMind AI <no-reply@docmind.local>"
    mail_use_tls: bool = True
    # --- Provedores: modelos permitidos para escolha por workspace (vazio = só o padrão) ---
    llm_allowed_models: str = ""
    # --- OCR opcional (Tesseract) ---
    ocr_enabled: bool = False
    ocr_language: str = "por"
    tesseract_cmd: str | None = None
    # --- Retenção ---
    retention_run_hour_utc: int = 3
    # --- Análises (resumos, comparações, tópicos) ---
    analysis_max_input_tokens: int = 120_000
    analysis_max_output_tokens: int = 1500
    analysis_compare_top_k: int = 6
    analysis_max_documents: int = 5

    # --- Limites de uso ---
    rate_limit_login_per_minute: int = 10
    rate_limit_questions_per_hour: int = 60
    rate_limit_uploads_per_hour: int = 30

    @field_validator("cors_origins")
    @classmethod
    def _strip_origins(cls, v: str) -> str:
        return ",".join(o.strip() for o in v.split(",") if o.strip())

    @field_validator("gemini_thinking_level", mode="before")
    @classmethod
    def _normalize_thinking_level(cls, v: str | None) -> str | None:
        if v is None:
            return None
        value = str(v).strip().upper()
        if not value:
            return None
        if value not in GEMINI_THINKING_LEVELS:
            raise ValueError(
                f"GEMINI_THINKING_LEVEL inválido: {value}. Use {', '.join(GEMINI_THINKING_LEVELS)}."
            )
        return value

    @field_validator("gemini_api_key", "openai_api_key", mode="before")
    @classmethod
    def _blank_key_is_none(cls, v: str | None) -> str | None:
        if v is None:
            return None
        value = str(v).strip()
        return value or None

    @model_validator(mode="after")
    def _default_models_per_provider(self) -> Settings:
        if not self.embedding_model.strip():
            self.embedding_model = DEFAULT_EMBEDDING_MODELS[self.embedding_provider]
        if not self.llm_model.strip():
            self.llm_model = DEFAULT_LLM_MODELS[self.llm_provider]
        return self

    @computed_field  # type: ignore[prop-decorator]
    @property
    def cors_origin_list(self) -> list[str]:
        return self.cors_origins.split(",") if self.cors_origins else []

    @computed_field  # type: ignore[prop-decorator]
    @property
    def sqlalchemy_database_url(self) -> str:
        if self.database_url:
            url = self.database_url
            if url.startswith("postgresql://"):
                url = url.replace("postgresql://", "postgresql+psycopg://", 1)
            return url
        return (
            f"postgresql+psycopg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    @computed_field  # type: ignore[prop-decorator]
    @property
    def llm_allowed_model_list(self) -> list[str]:
        models = [m.strip() for m in self.llm_allowed_models.split(",") if m.strip()]
        if self.llm_model not in models:
            models.insert(0, self.llm_model)
        return models

    @computed_field  # type: ignore[prop-decorator]
    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024

    # ------------------------------------------------------------------ provedores de IA
    def provider_api_key(self, provider: str) -> str | None:
        if provider == "gemini":
            return self.gemini_api_key
        if provider == "openai":
            return self.openai_api_key
        return None

    def provider_configured(self, provider: str) -> bool:
        """`fake` está sempre disponível; provedores reais exigem a própria chave."""
        if provider == "fake":
            return True
        return bool(self.provider_api_key(provider))

    @computed_field  # type: ignore[prop-decorator]
    @property
    def embedding_configured(self) -> bool:
        return self.provider_configured(self.embedding_provider)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def llm_configured(self) -> bool:
        return self.provider_configured(self.llm_provider)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def using_fake_ai(self) -> bool:
        return self.embedding_provider == "fake" and self.llm_provider == "fake"

    @computed_field  # type: ignore[prop-decorator]
    @property
    def ai_configured(self) -> bool:
        """Há IA real pronta para uso: ambos os provedores selecionados têm a chave de que precisam.

        Falso quando os dois são `fake` (não é IA real) e quando falta a chave de qualquer um dos
        dois provedores obrigatórios (embeddings e geração) — nunca "meio configurado".
        """
        if self.using_fake_ai:
            return False
        return self.embedding_configured and self.llm_configured

    @computed_field  # type: ignore[prop-decorator]
    @property
    def missing_ai_configuration(self) -> list[str]:
        """Nomes das variáveis de ambiente que faltam (sem valores)."""
        missing: list[str] = []
        for provider in (self.embedding_provider, self.llm_provider):
            env_name = PROVIDER_KEY_ENV.get(provider)
            if env_name and not self.provider_configured(provider) and env_name not in missing:
                missing.append(env_name)
        return missing

    @computed_field  # type: ignore[prop-decorator]
    @property
    def is_production(self) -> bool:
        return self.app_env == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
