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


def workspace_settings_out(workspace: Workspace) -> dict[str, Any]:
    return {
        "external_ai_enabled": workspace.external_ai_enabled,
        "retrieval": get_retrieval_settings(workspace).to_dict(),
    }


def update_workspace_settings(
    db: Session,
    ctx: AuthContext,
    *,
    external_ai_enabled: bool | None,
    retrieval: dict[str, Any] | None,
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
    return workspace_settings_out(ws)
