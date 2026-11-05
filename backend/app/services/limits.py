"""Limites por workspace: orçamento mensal de tokens/custo, máximo de documentos e armazenamento.

As verificações acontecem ANTES de persistir perguntas, pesquisas, análises ou uploads.
"""

from __future__ import annotations

import uuid
from dataclasses import asdict, dataclass
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.exceptions import UsageLimitExceededError
from app.models import Document, UsageRecord, Workspace
from app.models.base import utcnow

LIMIT_KEYS = ("monthly_token_budget", "monthly_cost_budget_usd", "max_documents", "max_storage_mb")


@dataclass(slots=True)
class WorkspaceLimits:
    monthly_token_budget: int | None = None
    monthly_cost_budget_usd: float | None = None
    max_documents: int | None = None
    max_storage_mb: int | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def get_limits(workspace: Workspace) -> WorkspaceLimits:
    raw = (workspace.settings or {}).get("limits") or {}
    return WorkspaceLimits(**{k: raw.get(k) for k in LIMIT_KEYS})


def validate_limits_patch(patch: dict[str, Any]) -> dict[str, Any]:
    clean: dict[str, Any] = {}
    for key in LIMIT_KEYS:
        if key not in patch:
            continue
        value = patch[key]
        if value is None:
            clean[key] = None
            continue
        value = float(value) if key == "monthly_cost_budget_usd" else int(value)
        if value <= 0:
            raise_invalid(key)
        clean[key] = value
    return clean


def raise_invalid(key: str) -> None:
    from app.core.exceptions import ValidationAppError

    raise ValidationAppError(f"{key} deve ser um número positivo ou vazio (sem limite).")


@dataclass(slots=True)
class BudgetStatus:
    tokens_month_total: int
    cost_month_usd: float | None
    documents_count: int
    storage_mb: float
    blocked: bool
    blocked_reason: str | None
    budget_used_pct: float | None


def budget_status(db: Session, workspace: Workspace) -> BudgetStatus:
    limits = get_limits(workspace)
    now = utcnow()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    prompt, completion, cost_sum, cost_rows, total_rows = db.execute(
        select(
            func.coalesce(func.sum(UsageRecord.prompt_tokens), 0),
            func.coalesce(func.sum(UsageRecord.completion_tokens), 0),
            func.sum(UsageRecord.estimated_cost_usd),
            func.count(UsageRecord.estimated_cost_usd),
            func.count(),
        ).where(UsageRecord.workspace_id == workspace.id, UsageRecord.created_at >= month_start)
    ).one()
    tokens = int(prompt) + int(completion)
    cost = (
        float(cost_sum)
        if cost_sum is not None and cost_rows == total_rows and total_rows > 0
        else None
    )
    docs_count, storage_bytes = db.execute(
        select(func.count(), func.coalesce(func.sum(Document.size_bytes), 0)).where(
            Document.workspace_id == workspace.id, Document.deleted_at.is_(None)
        )
    ).one()
    storage_mb = round(int(storage_bytes) / (1024 * 1024), 2)

    blocked_reason = None
    if limits.monthly_token_budget and tokens >= limits.monthly_token_budget:
        blocked_reason = f"Orçamento mensal de tokens do workspace atingido ({tokens} de {limits.monthly_token_budget})."
    elif (
        limits.monthly_cost_budget_usd
        and cost is not None
        and cost >= limits.monthly_cost_budget_usd
    ):
        blocked_reason = f"Teto mensal de custo atingido (US$ {cost:.2f} de US$ {limits.monthly_cost_budget_usd:.2f})."
    pct = (
        round(100 * tokens / limits.monthly_token_budget, 1)
        if limits.monthly_token_budget
        else None
    )
    return BudgetStatus(
        tokens_month_total=tokens,
        cost_month_usd=cost,
        documents_count=int(docs_count),
        storage_mb=storage_mb,
        blocked=blocked_reason is not None,
        blocked_reason=blocked_reason,
        budget_used_pct=pct,
    )


def enforce_budget(db: Session, workspace: Workspace) -> None:
    """Bloqueia perguntas, pesquisas e análises quando o teto mensal foi atingido."""
    status = budget_status(db, workspace)
    if status.blocked:
        raise UsageLimitExceededError(
            status.blocked_reason or "Limite mensal do workspace atingido."
        )


def enforce_document_limits(db: Session, workspace: Workspace, *, incoming_bytes: int) -> None:
    limits = get_limits(workspace)
    if not (limits.max_documents or limits.max_storage_mb):
        return
    status = budget_status(db, workspace)
    if limits.max_documents and status.documents_count >= limits.max_documents:
        raise UsageLimitExceededError(
            f"Limite de {limits.max_documents} documentos do workspace atingido. Exclua documentos ou peça ao administrador para ampliar."
        )
    if limits.max_storage_mb:
        projected = status.storage_mb + incoming_bytes / (1024 * 1024)
        if projected > limits.max_storage_mb:
            raise UsageLimitExceededError(
                f"Limite de armazenamento de {limits.max_storage_mb} MB do workspace seria excedido."
            )


def workspace_id_of(ctx_or_ws: Any) -> uuid.UUID:
    return ctx_or_ws.id if isinstance(ctx_or_ws, Workspace) else ctx_or_ws.workspace_id
