"""Registro e consulta de uso (tokens, perguntas, uploads) e aplicação de limites."""

from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.exceptions import UsageLimitExceededError
from app.models import UsageKind, UsageRecord
from app.models.base import utcnow


def estimate_cost_usd(
    *, kind: UsageKind, prompt_tokens: int, completion_tokens: int = 0
) -> float | None:
    """Estimativa baseada em preços configurados. Sem preço configurado => None (não inventa custo)."""
    if kind == UsageKind.EMBEDDING:
        if settings.price_embedding_per_1m is None:
            return None
        return prompt_tokens / 1_000_000 * settings.price_embedding_per_1m
    if kind == UsageKind.QUESTION:
        if settings.price_llm_input_per_1m is None or settings.price_llm_output_per_1m is None:
            return None
        return (
            prompt_tokens / 1_000_000 * settings.price_llm_input_per_1m
            + completion_tokens / 1_000_000 * settings.price_llm_output_per_1m
        )
    return None


def record_usage(
    db: Session,
    *,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID | None,
    kind: UsageKind,
    provider: str | None = None,
    model: str | None = None,
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
    latency_ms: int | None = None,
    reference_type: str | None = None,
    reference_id: uuid.UUID | None = None,
    extra: dict[str, Any] | None = None,
) -> UsageRecord:
    rec = UsageRecord(
        workspace_id=workspace_id,
        user_id=user_id,
        kind=kind,
        provider=provider,
        model=model,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        estimated_cost_usd=estimate_cost_usd(
            kind=kind, prompt_tokens=prompt_tokens, completion_tokens=completion_tokens
        ),
        latency_ms=latency_ms,
        reference_type=reference_type,
        reference_id=reference_id,
        extra=extra or {},
        created_at=utcnow(),
    )
    db.add(rec)
    return rec


def _count_last_hour(db: Session, user_id: uuid.UUID, kind: UsageKind) -> int:
    since = utcnow() - timedelta(hours=1)
    return int(
        db.scalar(
            select(func.count())
            .select_from(UsageRecord)
            .where(
                UsageRecord.user_id == user_id,
                UsageRecord.kind == kind,
                UsageRecord.created_at >= since,
            )
        )
        or 0
    )


def enforce_question_limit(db: Session, user_id: uuid.UUID) -> None:
    if _count_last_hour(db, user_id, UsageKind.QUESTION) >= settings.rate_limit_questions_per_hour:
        raise UsageLimitExceededError(
            f"Limite de {settings.rate_limit_questions_per_hour} perguntas por hora atingido."
        )


def enforce_upload_limit(db: Session, user_id: uuid.UUID) -> None:
    if _count_last_hour(db, user_id, UsageKind.UPLOAD) >= settings.rate_limit_uploads_per_hour:
        raise UsageLimitExceededError(
            f"Limite de {settings.rate_limit_uploads_per_hour} uploads por hora atingido."
        )


def usage_summary(db: Session, workspace_id: uuid.UUID, user_id: uuid.UUID) -> dict[str, Any]:
    now = utcnow()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    row = db.execute(
        select(
            func.coalesce(func.sum(UsageRecord.prompt_tokens), 0),
            func.coalesce(func.sum(UsageRecord.completion_tokens), 0),
            func.sum(UsageRecord.estimated_cost_usd),
            func.count(UsageRecord.estimated_cost_usd),
            func.count(),
        ).where(UsageRecord.workspace_id == workspace_id, UsageRecord.created_at >= month_start)
    ).one()
    prompt_tokens, completion_tokens, cost_sum, cost_rows, total_rows = row
    # Só informa custo se TODAS as linhas do mês tiverem estimativa; caso contrário, None.
    cost = (
        float(cost_sum)
        if cost_sum is not None and cost_rows == total_rows and total_rows > 0
        else None
    )
    from app.models import Conversation, Feedback, Message, MessageRole

    fb = db.execute(
        select(
            func.count(Feedback.id).filter(Feedback.rating > 0),
            func.count(Feedback.id).filter(Feedback.rating < 0),
        )
        .select_from(Feedback)
        .join(Message, Message.id == Feedback.message_id)
        .where(Message.workspace_id == workspace_id)
    ).one()
    total_answers = int(
        db.scalar(
            select(func.count())
            .select_from(Message)
            .join(Conversation, Conversation.id == Message.conversation_id)
            .where(
                Message.workspace_id == workspace_id,
                Message.role == MessageRole.ASSISTANT,
                Conversation.deleted_at.is_(None),
            )
        )
        or 0
    )
    return {
        "feedback": {
            "positive": int(fb[0] or 0),
            "negative": int(fb[1] or 0),
            "total_answers": total_answers,
        },
        "questions_last_hour": _count_last_hour(db, user_id, UsageKind.QUESTION),
        "uploads_last_hour": _count_last_hour(db, user_id, UsageKind.UPLOAD),
        "prompt_tokens_month": int(prompt_tokens),
        "completion_tokens_month": int(completion_tokens),
        "estimated_cost_usd_month": cost,
        "limits": {
            "questions_per_hour": settings.rate_limit_questions_per_hour,
            "uploads_per_hour": settings.rate_limit_uploads_per_hour,
            "max_upload_mb": settings.max_upload_mb,
            "max_pdf_pages": settings.max_pdf_pages,
        },
    }
