"""Status do sistema e dos provedores de IA."""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.providers.redis_client import redis_healthy
from app.providers.storage import get_storage

AI_NOTICE = (
    "Ao fazer perguntas, trechos relevantes dos seus documentos (não os arquivos inteiros) são enviados "
    "ao provedor de IA configurado para gerar a resposta. Não envie dados que não possam ser processados "
    "por terceiros, ou desative o processamento externo nas configurações do workspace."
)
AI_NOTICE_FAKE = (
    "Este ambiente usa um provedor determinístico de testes: nenhuma informação sai do servidor, "
    "mas as respostas não são geradas por um modelo de linguagem real."
)
AI_NOTICE_UNCONFIGURED = (
    "Nenhum provedor de IA está configurado. A geração de respostas está indisponível até que "
    "OPENAI_API_KEY (ou outro provedor) seja definido no servidor."
)


def ai_status(external_enabled: bool = True) -> dict:
    using_fake = settings.embedding_provider == "fake" and settings.llm_provider == "fake"
    configured = settings.ai_configured or using_fake
    if using_fake:
        notice = AI_NOTICE_FAKE
    elif not configured:
        notice = AI_NOTICE_UNCONFIGURED
    else:
        notice = AI_NOTICE
    return {
        "configured": configured,
        "embedding_provider": settings.embedding_provider,
        "llm_provider": settings.llm_provider,
        "embedding_model": settings.embedding_model
        if settings.embedding_provider != "fake"
        else "fake-hash-v1",
        "llm_model": settings.llm_model if settings.llm_provider != "fake" else "fake-llm-v1",
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
