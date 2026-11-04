from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_auth
from app.core.database import get_db
from app.models import WorkspaceMember
from app.schemas.workspace import MemberList, MemberOut, WorkspaceOut, WorkspaceSettingsOut
from app.services.auth import AuthContext

router = APIRouter(prefix="/workspaces", tags=["workspaces"])


@router.get("/current", response_model=WorkspaceOut)
def current(ctx: AuthContext = Depends(get_current_auth)) -> WorkspaceOut:
    ws = ctx.workspace
    return WorkspaceOut(
        id=ws.id,
        name=ws.name,
        slug=ws.slug,
        role=ctx.membership.role,
        created_at=ws.created_at,
        settings=WorkspaceSettingsOut(external_ai_enabled=ws.external_ai_enabled),
    )


@router.get("/current/members", response_model=MemberList)
def members(
    ctx: AuthContext = Depends(get_current_auth), db: Session = Depends(get_db)
) -> MemberList:
    rows = db.scalars(
        select(WorkspaceMember)
        .options(selectinload(WorkspaceMember.user))
        .where(WorkspaceMember.workspace_id == ctx.workspace_id)
        .order_by(WorkspaceMember.joined_at.asc())
    )
    return MemberList(
        items=[
            MemberOut(
                user_id=m.user_id,
                name=m.user.name,
                email=m.user.email,
                role=m.role,
                joined_at=m.joined_at,
            )
            for m in rows
        ]
    )
