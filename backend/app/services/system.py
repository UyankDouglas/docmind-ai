"""Status do sistema e dos provedores de IA (nomes legíveis, avisos de privacidade, pendências)."""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.providers.redis_client import redis_healthy
from app.providers.storage import get_storage

PROVIDER_LABELS = {
    "gemini": "Google Gemini",
    "openai": "OpenAI",
    "fake": "Provedor determinístico (testes)",
}
MODEL_LABELS = {
    "gemini-3.5-flash-lite": "Gemini 3.5 Flash-Lite",
    "gemini-3.1-flash-lite": "Gemini 3.1 Flash-Lite",
    "gemini-2.5-flash-lite": "Gemini 2.5 Flash-Lite",
    "gemini-2.5-flash": "Gemini 2.5 Flash",
    "gemini-3-flash-preview": "Gemini 3 Flash (preview)",
    "gemini-embedding-001": "Gemini Embedding 001",
    "gemini-embedding-2": "Gemini Embedding 2",
    "text-embedding-3-small": "OpenAI text-embedding-3-small",
    "text-embedding-3-large": "OpenAI text-embedding-3-large",
    "gpt-4o-mini": "GPT-4o mini",
    "gpt-4o": "GPT-4o",
    "gpt-4.1-mini": "GPT-4.1 mini",
    "gpt-4.1": "GPT-4.1",
    "fake-hash-v1": "fake-hash-v1 (determinístico, testes)",
    "fake-llm-v1": "fake-llm-v1 (determinístico, testes)",
}

AI_NOTICE_TEMPLATE = (
    "Ao fazer perguntas, trechos relevantes dos seus documentos (não os arquivos inteiros) são enviados "
    "ao provedor de IA configurado ({provider}) para gerar embeddings e respostas. Não envie dados que não "
    "possam ser processados por terceiros, ou desative o processamento externo nas configurações do workspace."
)
GEMINI_DATA_USE_NOTICE = (
    " No nível gratuito da Gemini API, o Google pode usar o conteúdo enviado para melhorar seus "
    "produtos; no nível pago, não."
)
AI_NOTICE_FAKE = (
    "Este ambiente usa um provedor determinístico de testes: nenhuma informação sai do servidor, "
    "mas as respostas não são geradas por um modelo de linguagem real."
)
AI_NOTICE_UNCONFIGURED_TEMPLATE = (
    "Nenhum provedor de IA está totalmente configurado. A geração de respostas está indisponível até "
    "que {missing} seja definida no servidor (embeddings e geração precisam ambos de chave)."
)
AI_NOTICE_PARTIAL_FAKE_LLM = (
    " Atenção: as respostas vêm de um provedor determinístico de testes, não de um modelo real."
)
AI_NOTICE_PARTIAL_FAKE_EMBEDDING = " Atenção: os embeddings vêm de um provedor determinístico de testes (busca semântica limitada)."


def provider_label(provider: str) -> str:
    return PROVIDER_LABELS.get(provider, provider)


def model_label(model: str) -> str:
    return MODEL_LABELS.get(model, model)


def current_embedding_model() -> str:
    """Nome do modelo que o provedor de embeddings atual grava em `embedding_records.model`."""
    return settings.embedding_model if settings.embedding_provider != "fake" else "fake-hash-v1"


def current_llm_model() -> str:
    return settings.llm_model if settings.llm_provider != "fake" else "fake-llm-v1"


def combined_provider_label() -> str:
    llm, emb = settings.llm_provider, settings.embedding_provider
    if llm == emb:
        return provider_label(llm)
    return f"{provider_label(llm)} (respostas) · {provider_label(emb)} (embeddings)"


def ai_status(external_enabled: bool = True) -> dict:
    using_fake = settings.using_fake_ai
    configured = settings.embedding_configured and settings.llm_configured
    missing = list(settings.missing_ai_configuration)
    if using_fake:
        notice = AI_NOTICE_FAKE
    elif not configured:
        notice = AI_NOTICE_UNCONFIGURED_TEMPLATE.format(missing=" e ".join(missing) or "a chave")
    else:
        real = [p for p in (settings.llm_provider, settings.embedding_provider) if p != "fake"]
        labels = " e ".join(dict.fromkeys(provider_label(p) for p in real))
        notice = AI_NOTICE_TEMPLATE.format(provider=labels)
        if "gemini" in real:
            notice += GEMINI_DATA_USE_NOTICE
        if settings.llm_provider == "fake":
            notice += AI_NOTICE_PARTIAL_FAKE_LLM
        elif settings.embedding_provider == "fake":
            notice += AI_NOTICE_PARTIAL_FAKE_EMBEDDING
    embedding_model = current_embedding_model()
    llm_model = current_llm_model()
    return {
        "configured": configured,
        "embedding_provider": settings.embedding_provider,
        "llm_provider": settings.llm_provider,
        "embedding_model": embedding_model,
        "llm_model": llm_model,
        "provider_label": combined_provider_label(),
        "llm_provider_label": provider_label(settings.llm_provider),
        "embedding_provider_label": provider_label(settings.embedding_provider),
        "llm_model_label": model_label(llm_model),
        "embedding_model_label": model_label(embedding_model),
        "missing_configuration": missing,
        "external_processing": configured and not using_fake and external_enabled,
        "notice": notice,
    }


def health(db: Session) -> dict:
    db_ok = True
    try:
        db.execute(text("SELECT 1"))
    except Exception:
        db_ok = False
    redis_ok = redis_healthy()
    try:
        storage_ok = get_storage().healthcheck()
    except Exception:
        storage_ok = False
    status = "ok" if (db_ok and redis_ok and storage_ok) else "degraded"
    return {
        "status": status,
        "services": {"database": db_ok, "redis": redis_ok, "storage": storage_ok},
        "ai": ai_status(),
    }
