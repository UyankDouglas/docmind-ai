"""Políticas de retenção por workspace (conversas, análises, histórico de pesquisas e purga de
documentos excluídos), aplicadas diariamente pelo Celery beat ou sob demanda por um administrador."""

from __future__ import annotations

import uuid
from dataclasses import asdict, dataclass
from datetime import timedelta
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.exceptions import ValidationAppError
from app.core.logging import get_logger
from app.models import Analysis, Conversation, Document, SearchQuery, Workspace
from app.models.base import utcnow
from app.providers.storage import ObjectStorage, get_storage
from app.services.audit import record_audit

log = get_logger(__name__)

RETENTION_KEYS = (
    "conversations_days",
    "analyses_days",
    "search_history_days",
    "deleted_documents_days",
)


@dataclass(slots=True)
class RetentionPolicy:
    conversations_days: int | None = None
    analyses_days: int | None = None
    search_history_days: int | None = None
    deleted_documents_days: int | None = None
    last_run_at: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def get_policy(workspace: Workspace) -> RetentionPolicy:
    raw = (workspace.settings or {}).get("retention") or {}
    return RetentionPolicy(**{k: raw.get(k) for k in (*RETENTION_KEYS, "last_run_at")})


def validate_retention_patch(patch: dict[str, Any]) -> dict[str, Any]:
    clean: dict[str, Any] = {}
    for key in RETENTION_KEYS:
        if key not in patch:
            continue
        value = patch[key]
        if value is None:
            clean[key] = None
            continue
        value = int(value)
        if not (1 <= value <= 3650):
            raise ValidationAppError(
                f"{key} deve estar entre 1 e 3650 dias (ou vazio para não aplicar)."
            )
        clean[key] = value
    return clean


def apply_policy(
    db: Session,
    workspace: Workspace,
    *,
    storage: ObjectStorage | None = None,
    actor_id: uuid.UUID | None = None,
) -> dict[str, int]:
    policy = get_policy(workspace)
    now = utcnow()
    deleted = {"conversations": 0, "analyses": 0, "search_queries": 0, "documents": 0}

    if policy.conversations_days:
        cutoff = now - timedelta(days=policy.conversations_days)
        convs = list(
            db.scalars(
                select(Conversation).where(
                    Conversation.workspace_id == workspace.id, Conversation.updated_at < cutoff
                )
            )
        )
        for c in convs:
            db.delete(c)  # cascade remove mensagens, citações e feedback
        deleted["conversations"] = len(convs)

    if policy.analyses_days:
        cutoff = now - timedelta(days=policy.analyses_days)
        res = db.execute(
            delete(Analysis).where(
                Analysis.workspace_id == workspace.id, Analysis.created_at < cutoff
            )
        )
        deleted["analyses"] = int(res.rowcount or 0)

    if policy.search_history_days:
        cutoff = now - timedelta(days=policy.search_history_days)
        res = db.execute(
            delete(SearchQuery).where(
                SearchQuery.workspace_id == workspace.id, SearchQuery.created_at < cutoff
            )
        )
        deleted["search_queries"] = int(res.rowcount or 0)

    if policy.deleted_documents_days:
        cutoff = now - timedelta(days=policy.deleted_documents_days)
        storage = storage or get_storage()
        docs = list(
            db.scalars(
                select(Document).where(
                    Document.workspace_id == workspace.id,
                    Document.deleted_at.is_not(None),
                    Document.deleted_at < cutoff,
                )
            )
        )
        for d in docs:
            try:
                storage.delete(d.storage_key)
            except Exception as exc:
                log.warning(
                    "retention_storage_delete_failed",
                    document_id=str(d.id),
                    error=type(exc).__name__,
                )
            db.delete(d)  # cascade: chunks, embeddings, páginas, versões, jobs
        deleted["documents"] = len(docs)

    settings_copy = dict(workspace.settings or {})
    settings_copy["retention"] = {
        **(settings_copy.get("retention") or {}),
        "last_run_at": now.isoformat(),
    }
    workspace.settings = settings_copy
    record_audit(
        db,
        action="retention.run",
        workspace_id=workspace.id,
        user_id=actor_id,
        target_type="workspace",
        target_id=workspace.id,
        details=deleted,
    )
    db.commit()
    log.info("retention_applied", workspace_id=str(workspace.id), **deleted)
    return deleted


def apply_all(db: Session) -> dict[str, dict[str, int]]:
    """Aplica as políticas de todos os workspaces que têm alguma regra configurada."""
    results: dict[str, dict[str, int]] = {}
    for ws in db.scalars(select(Workspace)):
        policy = get_policy(ws)
        if any(getattr(policy, k) for k in RETENTION_KEYS):
            results[str(ws.id)] = apply_policy(db, ws)
    return results
