"""Visões administrativas: uso agregado por usuário/dia e auditoria consultável/exportável."""

from __future__ import annotations

import csv
import io
import json
import uuid
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.exceptions import ForbiddenError, ValidationAppError
from app.models import AuditLog, Document, UsageKind, UsageRecord, User, WorkspaceRole
from app.models.base import utcnow
from app.services.auth import AuthContext


def require_admin(ctx: AuthContext) -> None:
    if ctx.role != WorkspaceRole.ADMIN:
        raise ForbiddenError("Área restrita a administradores do workspace.")


def usage_report(db: Session, ctx: AuthContext, *, days: int = 30) -> dict[str, Any]:
    require_admin(ctx)
    days = max(1, min(days, 365))
    end = utcnow()
    start = end - timedelta(days=days)
    ws = ctx.workspace_id

    rows = db.execute(
        select(
            UsageRecord.user_id,
            func.count().filter(UsageRecord.kind == UsageKind.QUESTION),
            func.count().filter(UsageRecord.kind == UsageKind.UPLOAD),
            func.coalesce(func.sum(UsageRecord.prompt_tokens), 0),
            func.coalesce(func.sum(UsageRecord.completion_tokens), 0),
            func.sum(UsageRecord.estimated_cost_usd),
            func.count(UsageRecord.estimated_cost_usd),
            func.count(),
        )
        .where(UsageRecord.workspace_id == ws, UsageRecord.created_at >= start)
        .group_by(UsageRecord.user_id)
    ).all()
    user_ids = [r[0] for r in rows if r[0]]
    users = (
        {u.id: u for u in db.scalars(select(User).where(User.id.in_(user_ids)))} if user_ids else {}
    )
    by_user = []
    for uid, q, up, pt, ct, cost_sum, cost_rows, total_rows in rows:
        u = users.get(uid)
        by_user.append(
            {
                "user_id": str(uid) if uid else None,
                "name": u.name if u else "(removido)",
                "email": u.email if u else "",
                "questions": int(q),
                "uploads": int(up),
                "prompt_tokens": int(pt),
                "completion_tokens": int(ct),
                "estimated_cost_usd": float(cost_sum)
                if cost_sum is not None and cost_rows == total_rows
                else None,
            }
        )
    by_user.sort(key=lambda r: -(r["prompt_tokens"] + r["completion_tokens"]))

    day = func.date_trunc("day", UsageRecord.created_at)
    day_rows = db.execute(
        select(
            day,
            func.count().filter(UsageRecord.kind == UsageKind.QUESTION),
            func.coalesce(func.sum(UsageRecord.prompt_tokens), 0),
            func.coalesce(func.sum(UsageRecord.completion_tokens), 0),
        )
        .where(UsageRecord.workspace_id == ws, UsageRecord.created_at >= start)
        .group_by(day)
        .order_by(day)
    ).all()
    by_day = [
        {
            "day": d.date().isoformat(),
            "questions": int(q),
            "prompt_tokens": int(pt),
            "completion_tokens": int(ct),
        }
        for d, q, pt, ct in day_rows
    ]

    totals_row = db.execute(
        select(
            func.count().filter(UsageRecord.kind == UsageKind.QUESTION),
            func.count().filter(UsageRecord.kind == UsageKind.UPLOAD),
            func.coalesce(func.sum(UsageRecord.prompt_tokens), 0),
            func.coalesce(func.sum(UsageRecord.completion_tokens), 0),
            func.sum(UsageRecord.estimated_cost_usd),
            func.count(UsageRecord.estimated_cost_usd),
            func.count(),
        ).where(UsageRecord.workspace_id == ws, UsageRecord.created_at >= start)
    ).one()
    docs_count, storage_bytes = db.execute(
        select(func.count(), func.coalesce(func.sum(Document.size_bytes), 0)).where(
            Document.workspace_id == ws, Document.deleted_at.is_(None)
        )
    ).one()
    q, up, pt, ct, cost_sum, cost_rows, total_rows = totals_row
    return {
        "period_start": start.isoformat(),
        "period_end": end.isoformat(),
        "by_user": by_user,
        "by_day": by_day,
        "totals": {
            "questions": int(q),
            "uploads": int(up),
            "prompt_tokens": int(pt),
            "completion_tokens": int(ct),
            "estimated_cost_usd": float(cost_sum)
            if cost_sum is not None and cost_rows == total_rows and total_rows
            else None,
            "documents": int(docs_count),
            "storage_mb": round(int(storage_bytes) / (1024 * 1024), 2),
        },
    }


# ----------------------------------------------------------------------------- auditoria
def _audit_query(
    ctx: AuthContext,
    *,
    action: str | None,
    user_id: uuid.UUID | None,
    date_from: datetime | None,
    date_to: datetime | None,
):
    stmt = select(AuditLog).where(AuditLog.workspace_id == ctx.workspace_id)
    if action:
        stmt = stmt.where(AuditLog.action.like(f"{action.strip()}%"))
    if user_id:
        stmt = stmt.where(AuditLog.user_id == user_id)
    if date_from:
        stmt = stmt.where(AuditLog.created_at >= date_from)
    if date_to:
        stmt = stmt.where(AuditLog.created_at <= date_to)
    return stmt


def list_audit(
    db: Session,
    ctx: AuthContext,
    *,
    action: str | None,
    user_id: uuid.UUID | None,
    date_from: datetime | None,
    date_to: datetime | None,
    page: int,
    page_size: int,
) -> tuple[list[dict[str, Any]], int]:
    require_admin(ctx)
    stmt = _audit_query(ctx, action=action, user_id=user_id, date_from=date_from, date_to=date_to)
    total = int(db.scalar(select(func.count()).select_from(stmt.subquery())) or 0)
    rows = list(
        db.scalars(
            stmt.order_by(AuditLog.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    )
    return [_entry(db, r) for r in rows], total


def _entry(db: Session, r: AuditLog, cache: dict | None = None) -> dict[str, Any]:
    user = db.get(User, r.user_id) if r.user_id else None
    return {
        "id": r.id,
        "action": r.action,
        "user": {"id": user.id, "name": user.name, "email": user.email} if user else None,
        "target_type": r.target_type,
        "target_id": r.target_id,
        "ip_address": r.ip_address,
        "details": r.details or {},
        "created_at": r.created_at,
    }


def export_audit(
    db: Session,
    ctx: AuthContext,
    *,
    fmt: str,
    action: str | None,
    user_id: uuid.UUID | None,
    date_from: datetime | None,
    date_to: datetime | None,
) -> tuple[bytes, str, str]:
    require_admin(ctx)
    stmt = _audit_query(ctx, action=action, user_id=user_id, date_from=date_from, date_to=date_to)
    rows = [
        _entry(db, r) for r in db.scalars(stmt.order_by(AuditLog.created_at.desc()).limit(10_000))
    ]
    stamp = utcnow().strftime("%Y%m%d-%H%M")
    if fmt == "json":
        return (
            json.dumps(rows, ensure_ascii=False, indent=2, default=str).encode("utf-8"),
            "application/json",
            f"auditoria-{stamp}.json",
        )
    if fmt != "csv":
        raise ValidationAppError("Formato inválido (use csv ou json).")
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(
        [
            "created_at",
            "action",
            "user_email",
            "user_name",
            "target_type",
            "target_id",
            "ip_address",
            "details",
        ]
    )
    for r in rows:
        writer.writerow(
            [
                r["created_at"].isoformat(),
                r["action"],
                r["user"]["email"] if r["user"] else "",
                r["user"]["name"] if r["user"] else "",
                r["target_type"] or "",
                str(r["target_id"]) if r["target_id"] else "",
                r["ip_address"] or "",
                json.dumps(r["details"], ensure_ascii=False, default=str),
            ]
        )
    return (
        ("﻿" + buf.getvalue()).encode("utf-8"),
        "text/csv; charset=utf-8",
        f"auditoria-{stamp}.csv",
    )
