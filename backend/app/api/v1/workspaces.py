from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import client_ip, get_current_auth
from app.core.database import get_db
from app.models import User, WorkspaceMember
from app.schemas.admin import (
    InvitationCreate,
    InvitationList,
    InvitationOut,
    InvitedBy,
    MemberRoleUpdate,
    RetentionRunOut,
    SwitchWorkspaceRequest,
    WorkspaceMembershipList,
    WorkspaceMembershipOut,
    WorkspaceRename,
)
from app.schemas.auth import UserMe, WorkspaceSummary
from app.schemas.system import WorkspaceSettingsOut, WorkspaceSettingsPatch
from app.schemas.workspace import MemberList, MemberOut, WorkspaceOut
from app.schemas.workspace import WorkspaceSettingsOut as WsSummary
from app.services import members as members_service
from app.services import retention as retention_service
from app.services import retrieval_settings as rs_service
from app.services.admin import require_admin
from app.services.auth import AuthContext

router = APIRouter(prefix="/workspaces", tags=["workspaces"])


def _workspace_out(ctx: AuthContext) -> WorkspaceOut:
    ws = ctx.workspace
    return WorkspaceOut(
        id=ws.id,
        name=ws.name,
        slug=ws.slug,
        role=ctx.membership.role,
        created_at=ws.created_at,
        settings=WsSummary(external_ai_enabled=ws.external_ai_enabled),
    )


def _me(ctx: AuthContext) -> UserMe:
    return UserMe(
        id=ctx.user.id,
        name=ctx.user.name,
        email=ctx.user.email,
        created_at=ctx.user.created_at,
        workspace=WorkspaceSummary(
            id=ctx.workspace.id,
            name=ctx.workspace.name,
            slug=ctx.workspace.slug,
            role=ctx.membership.role,
        ),
    )


def _member_out(m: WorkspaceMember, user: User) -> MemberOut:
    return MemberOut(
        user_id=m.user_id, name=user.name, email=user.email, role=m.role, joined_at=m.joined_at
    )


def _invitation_out(db: Session, inv, accept_url: str | None = None) -> InvitationOut:
    inviter = db.get(User, inv.invited_by) if inv.invited_by else None
    return InvitationOut(
        id=inv.id,
        email=inv.email,
        role=inv.role,
        status=inv.status,
        invited_by=InvitedBy(id=inviter.id, name=inviter.name) if inviter else None,
        created_at=inv.created_at,
        expires_at=inv.expires_at,
        accepted_at=inv.accepted_at,
        accept_url=accept_url,
    )


# ----------------------------------------------------------------------------- workspaces do usuário
@router.get("", response_model=WorkspaceMembershipList)
def list_workspaces(
    ctx: AuthContext = Depends(get_current_auth), db: Session = Depends(get_db)
) -> WorkspaceMembershipList:
    return WorkspaceMembershipList(
        items=[
            WorkspaceMembershipOut(
                id=w.id, name=w.name, slug=w.slug, role=m.role, is_current=w.id == ctx.workspace_id
            )
            for w, m in members_service.list_memberships(db, ctx)
        ]
    )


@router.post("/switch", response_model=UserMe)
def switch_workspace(
    payload: SwitchWorkspaceRequest,
    ctx: AuthContext = Depends(get_current_auth),
    db: Session = Depends(get_db),
) -> UserMe:
    return _me(members_service.switch_workspace(db, ctx, payload.workspace_id))


@router.get("/current", response_model=WorkspaceOut)
def current(ctx: AuthContext = Depends(get_current_auth)) -> WorkspaceOut:
    return _workspace_out(ctx)


@router.patch("/current", response_model=WorkspaceOut)
def rename_workspace(
    payload: WorkspaceRename,
    ctx: AuthContext = Depends(get_current_auth),
    db: Session = Depends(get_db),
) -> WorkspaceOut:
    members_service.rename_workspace(db, ctx, payload.name)
    return _workspace_out(ctx)


# ----------------------------------------------------------------------------- membros
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
    return MemberList(items=[_member_out(m, m.user) for m in rows])


@router.patch("/current/members/{user_id}", response_model=MemberOut)
def update_member(
    user_id: uuid.UUID,
    payload: MemberRoleUpdate,
    ctx: AuthContext = Depends(get_current_auth),
    db: Session = Depends(get_db),
) -> MemberOut:
    m = members_service.update_member_role(db, ctx, user_id, payload.role)
    user = db.get(User, user_id)
    assert user is not None
    return _member_out(m, user)


@router.delete("/current/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_member(
    user_id: uuid.UUID, ctx: AuthContext = Depends(get_current_auth), db: Session = Depends(get_db)
) -> Response:
    members_service.remove_member(db, ctx, user_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ----------------------------------------------------------------------------- convites
@router.get("/current/invitations", response_model=InvitationList)
def list_invitations(
    ctx: AuthContext = Depends(get_current_auth), db: Session = Depends(get_db)
) -> InvitationList:
    return InvitationList(
        items=[_invitation_out(db, i) for i in members_service.list_invitations(db, ctx)]
    )


@router.post(
    "/current/invitations", response_model=InvitationOut, status_code=status.HTTP_201_CREATED
)
def create_invitation(
    payload: InvitationCreate,
    ctx: AuthContext = Depends(get_current_auth),
    db: Session = Depends(get_db),
) -> InvitationOut:
    inv, url = members_service.create_invitation(db, ctx, email=payload.email, role=payload.role)
    return _invitation_out(db, inv, accept_url=url)


@router.delete("/current/invitations/{invitation_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_invitation(
    invitation_id: uuid.UUID,
    ctx: AuthContext = Depends(get_current_auth),
    db: Session = Depends(get_db),
) -> Response:
    members_service.revoke_invitation(db, ctx, invitation_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ----------------------------------------------------------------------------- configurações e retenção
@router.get("/current/settings", response_model=WorkspaceSettingsOut)
def get_settings(
    ctx: AuthContext = Depends(get_current_auth), db: Session = Depends(get_db)
) -> dict:
    return rs_service.workspace_settings_out(ctx.workspace, db)


@router.patch("/current/settings", response_model=WorkspaceSettingsOut)
def patch_settings(
    payload: WorkspaceSettingsPatch,
    ctx: AuthContext = Depends(get_current_auth),
    db: Session = Depends(get_db),
) -> dict:
    return rs_service.update_workspace_settings(
        db,
        ctx,
        external_ai_enabled=payload.external_ai_enabled,
        retrieval=payload.retrieval.model_dump(exclude_none=True) if payload.retrieval else None,
        limits=payload.limits.model_dump(exclude_unset=True) if payload.limits else None,
        retention=payload.retention.model_dump(exclude_unset=True) if payload.retention else None,
        ai=payload.ai.model_dump(exclude_unset=True) if payload.ai else None,
    )


@router.post("/current/retention/run", response_model=RetentionRunOut)
def run_retention(
    request: Request, ctx: AuthContext = Depends(get_current_auth), db: Session = Depends(get_db)
) -> RetentionRunOut:
    require_admin(ctx)
    _ = client_ip(request)
    return RetentionRunOut(
        deleted=retention_service.apply_policy(db, ctx.workspace, actor_id=ctx.user.id)
    )
