from __future__ import annotations

import uuid
from datetime import datetime
from urllib.parse import quote

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.api.deps import get_current_auth
from app.core.database import get_db
from app.schemas.admin import AdminUsageOut, AuditEntryOut, InvitationPublicOut
from app.schemas.auth import UserMe, WorkspaceSummary
from app.schemas.common import Paginated
from app.services import admin as admin_service
from app.services import members as members_service
from app.services.auth import AuthContext

router = APIRouter(tags=["administração"])


@router.get("/admin/usage", response_model=AdminUsageOut)
def admin_usage(
    days: int = Query(default=30, ge=1, le=365),
    ctx: AuthContext = Depends(get_current_auth),
    db: Session = Depends(get_db),
) -> dict:
    return admin_service.usage_report(db, ctx, days=days)


@router.get("/audit", response_model=Paginated[AuditEntryOut])
def audit(
    action: str | None = Query(default=None, max_length=60),
    user_id: uuid.UUID | None = Query(default=None),
    date_from: datetime | None = Query(default=None, alias="from"),
    date_to: datetime | None = Query(default=None, alias="to"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    ctx: AuthContext = Depends(get_current_auth),
    db: Session = Depends(get_db),
) -> Paginated[AuditEntryOut]:
    items, total = admin_service.list_audit(
        db,
        ctx,
        action=action,
        user_id=user_id,
        date_from=date_from,
        date_to=date_to,
        page=page,
        page_size=page_size,
    )
    return Paginated(
        items=[AuditEntryOut(**i) for i in items], total=total, page=page, page_size=page_size
    )


@router.get("/audit/export")
def audit_export(
    format: str = Query(default="csv", pattern="^(csv|json)$"),
    action: str | None = Query(default=None, max_length=60),
    user_id: uuid.UUID | None = Query(default=None),
    date_from: datetime | None = Query(default=None, alias="from"),
    date_to: datetime | None = Query(default=None, alias="to"),
    ctx: AuthContext = Depends(get_current_auth),
    db: Session = Depends(get_db),
) -> Response:
    content, media, filename = admin_service.export_audit(
        db, ctx, fmt=format, action=action, user_id=user_id, date_from=date_from, date_to=date_to
    )
    return Response(
        content=content,
        media_type=media,
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}",
            "Cache-Control": "private, no-store",
        },
    )


# ----------------------------------------------------------------------------- convites (acesso pelo token)
def _mask_email(email: str) -> str:
    """Página pública do convite: não expõe o e-mail completo a quem só tem o link."""
    local, _, domain = email.partition("@")
    shown = local[:2] if len(local) > 2 else local[:1]
    return f"{shown}{'*' * max(2, len(local) - len(shown))}@{domain}"


@router.get("/invitations/{token}", response_model=InvitationPublicOut)
def invitation_public(token: str, db: Session = Depends(get_db)) -> InvitationPublicOut:
    inv, workspace = members_service.get_invitation_by_token(db, token)
    return InvitationPublicOut(
        workspace_name=workspace.name,
        email=_mask_email(inv.email),
        role=inv.role,
        expires_at=inv.expires_at,
        status=inv.status,
    )


@router.post("/invitations/{token}/accept", response_model=UserMe)
def invitation_accept(
    token: str, ctx: AuthContext = Depends(get_current_auth), db: Session = Depends(get_db)
) -> UserMe:
    new_ctx = members_service.accept_invitation(db, ctx, token)
    return UserMe(
        id=new_ctx.user.id,
        name=new_ctx.user.name,
        email=new_ctx.user.email,
        created_at=new_ctx.user.created_at,
        workspace=WorkspaceSummary(
            id=new_ctx.workspace.id,
            name=new_ctx.workspace.name,
            slug=new_ctx.workspace.slug,
            role=new_ctx.membership.role,
        ),
    )
