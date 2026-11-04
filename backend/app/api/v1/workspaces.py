from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_auth
from app.core.database import get_db
from app.models import WorkspaceMember
from app.schemas.system import WorkspaceSettingsOut, WorkspaceSettingsPatch
from app.schemas.workspace import MemberList, MemberOut, WorkspaceOut
from app.schemas.workspace import WorkspaceSettingsOut as WsSummary
from app.services import retrieval_settings as rs_service
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
        settings=WsSummary(external_ai_enabled=ws.external_ai_enabled),
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


@router.get("/current/settings", response_model=WorkspaceSettingsOut)
def get_settings(ctx: AuthContext = Depends(get_current_auth)) -> dict:
    return rs_service.workspace_settings_out(ctx.workspace)


@router.patch("/current/settings", response_model=WorkspaceSettingsOut)
def patch_settings(
    payload: WorkspaceSettingsPatch,
    ctx: AuthContext = Depends(get_current_auth),
    db: Session = Depends(get_db),
) -> dict:
    retrieval = payload.retrieval.model_dump(exclude_none=True) if payload.retrieval else None
    return rs_service.update_workspace_settings(
        db, ctx, external_ai_enabled=payload.external_ai_enabled, retrieval=retrieval
    )
