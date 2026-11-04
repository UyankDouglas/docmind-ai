"""Configurações centrais da aplicação (carregadas de variáveis de ambiente)."""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import computed_field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


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
    embedding_provider: Literal["openai", "fake"] = "openai"
    llm_provider: Literal["openai", "fake"] = "openai"
    openai_api_key: str | None = None
    openai_base_url: str | None = None
    embedding_model: str = "text-embedding-3-small"
    embedding_dimensions: int = 1536
    llm_model: str = "gpt-4o-mini"
    llm_timeout_seconds: float = 60.0
    llm_max_retries: int = 3
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

    # --- Limites de uso ---
    rate_limit_login_per_minute: int = 10
    rate_limit_questions_per_hour: int = 60
    rate_limit_uploads_per_hour: int = 30

    @field_validator("cors_origins")
    @classmethod
    def _strip_origins(cls, v: str) -> str:
        return ",".join(o.strip() for o in v.split(",") if o.strip())

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
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024

    @computed_field  # type: ignore[prop-decorator]
    @property
    def ai_configured(self) -> bool:
        """Indica se há um provedor real de IA configurado (chave presente)."""
        if self.embedding_provider == "fake" and self.llm_provider == "fake":
            return False
        return bool(self.openai_api_key)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def is_production(self) -> bool:
        return self.app_env == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
