"""Configurações de recuperação por workspace (armazenadas em `workspaces.settings["retrieval"]`)."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.exceptions import ForbiddenError, ValidationAppError
from app.models import Workspace, WorkspaceRole
from app.services.audit import record_audit
from app.services.auth import AuthContext

MODES = ("vector", "hybrid")
LIMITS = {
    "top_k": (1, 30),
    "min_similarity": (0.0, 1.0),
    "max_context_tokens": (1000, 12000),
    "rrf_k": (1, 1000),
}


@dataclass(slots=True)
class RetrievalSettings:
    mode: str = "hybrid"
    top_k: int = settings.retrieval_top_k
    min_similarity: float = settings.retrieval_min_similarity
    max_context_tokens: int = settings.max_context_tokens
    rrf_k: int = 60

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def get_retrieval_settings(workspace: Workspace) -> RetrievalSettings:
    raw = (workspace.settings or {}).get("retrieval") or {}
    base = RetrievalSettings()
    merged = {**base.to_dict(), **{k: v for k, v in raw.items() if k in base.to_dict()}}
    try:
        return RetrievalSettings(**merged)
    except TypeError:
        return base


def validate_retrieval_patch(patch: dict[str, Any]) -> dict[str, Any]:
    clean: dict[str, Any] = {}
    for key, value in patch.items():
        if value is None:
            continue
        if key == "mode":
            if value not in MODES:
                raise ValidationAppError("Modo de recuperação inválido (use vector ou hybrid).")
            clean[key] = value
        elif key in LIMITS:
            lo, hi = LIMITS[key]
            value = float(value) if key == "min_similarity" else int(value)
            if not (lo <= value <= hi):
                raise ValidationAppError(f"{key} deve estar entre {lo} e {hi}.")
            clean[key] = value
    return clean


def workspace_llm_model(workspace: Workspace) -> str | None:
    """Modelo escolhido pelo workspace (só se ainda estiver na lista permitida)."""
    chosen = ((workspace.settings or {}).get("ai") or {}).get("llm_model")
    if chosen and chosen in settings.llm_allowed_model_list:
        return chosen
    return None


def workspace_ocr_enabled(workspace: Workspace) -> bool:
    from app.providers.ocr import ocr_available

    return bool(((workspace.settings or {}).get("ai") or {}).get("ocr_enabled")) and ocr_available()


def workspace_settings_out(workspace: Workspace, db: Session | None = None) -> dict[str, Any]:
    from app.core.exceptions import AIUnavailableError
    from app.providers.embeddings import get_embedding_provider
    from app.providers.ocr import ocr_available
    from app.services.limits import get_limits
    from app.services.retention import get_policy
    from app.services.system import current_embedding_model, model_label, provider_label

    ai_raw = (workspace.settings or {}).get("ai") or {}
    # Modelo que a busca vetorial realmente usa (provedor ativo); sem chave, o configurado
    try:
        active = get_embedding_provider()
        embedding_model, dimensions = active.model, active.dimensions
    except AIUnavailableError:
        embedding_model, dimensions = current_embedding_model(), settings.embedding_dimensions
    stale = 0
    if db is not None:
        from app.rag.embeddings.reindex import stale_documents_count

        stale = stale_documents_count(
            db, workspace_id=workspace.id, model=embedding_model, dimensions=dimensions
        )
    return {
        "external_ai_enabled": workspace.external_ai_enabled,
        "retrieval": get_retrieval_settings(workspace).to_dict(),
        "limits": get_limits(workspace).to_dict(),
        "retention": get_policy(workspace).to_dict(),
        "ai": {
            "llm_model": workspace_llm_model(workspace),
            "allowed_llm_models": settings.llm_allowed_model_list,
            "embedding_model": embedding_model,
            "embedding_provider": settings.embedding_provider,
            "embedding_provider_label": provider_label(settings.embedding_provider),
            "embedding_model_label": model_label(embedding_model),
            "stale_embedding_documents": stale,
            "ocr_enabled": bool(ai_raw.get("ocr_enabled")) and ocr_available(),
            "ocr_available": ocr_available(),
        },
    }


def update_workspace_settings(
    db: Session,
    ctx: AuthContext,
    *,
    external_ai_enabled: bool | None,
    retrieval: dict[str, Any] | None,
    limits: dict[str, Any] | None = None,
    retention: dict[str, Any] | None = None,
    ai: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if ctx.role != WorkspaceRole.ADMIN:
        raise ForbiddenError("Somente administradores alteram as configurações do workspace.")
    ws = ctx.workspace
    current = dict(ws.settings or {})
    changes: dict[str, Any] = {}
    if external_ai_enabled is not None:
        current["external_ai_enabled"] = bool(external_ai_enabled)
        changes["external_ai_enabled"] = bool(external_ai_enabled)
    if retrieval:
        clean = validate_retrieval_patch(retrieval)
        current["retrieval"] = {**(current.get("retrieval") or {}), **clean}
        changes["retrieval"] = clean
    if limits:
        from app.services.limits import validate_limits_patch

        clean = validate_limits_patch(limits)
        current["limits"] = {**(current.get("limits") or {}), **clean}
        changes["limits"] = clean
    if retention:
        from app.services.retention import validate_retention_patch

        clean = validate_retention_patch(retention)
        current["retention"] = {**(current.get("retention") or {}), **clean}
        changes["retention"] = clean
    if ai:
        from app.providers.ocr import ocr_available

        ai_current = dict(current.get("ai") or {})
        if "llm_model" in ai:
            model = ai["llm_model"]
            if model is not None and model not in settings.llm_allowed_model_list:
                raise ValidationAppError("Modelo não permitido neste servidor.")
            ai_current["llm_model"] = model
        if "ocr_enabled" in ai:
            if ai["ocr_enabled"] and not ocr_available():
                raise ValidationAppError(
                    "OCR não está disponível neste servidor (ver docs/ocr-evaluation.md)."
                )
            ai_current["ocr_enabled"] = bool(ai["ocr_enabled"])
        current["ai"] = ai_current
        changes["ai"] = ai_current
    ws.settings = current  # reatribuição: JSONB precisa de novo objeto para ser detectado
    record_audit(
        db,
        action="workspace.settings",
        workspace_id=ws.id,
        user_id=ctx.user.id,
        target_type="workspace",
        target_id=ws.id,
        details=changes,
    )
    db.commit()
    db.refresh(ws)
    return workspace_settings_out(ws, db)
