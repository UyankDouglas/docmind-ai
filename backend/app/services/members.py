"""Membros, convites e troca de workspace."""

from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.exceptions import ConflictError, ForbiddenError, NotFoundError, ValidationAppError
from app.models import Invitation, User, UserSession, Workspace, WorkspaceMember, WorkspaceRole
from app.models.base import utcnow
from app.providers.mail import Mail, get_mail_sender
from app.services.audit import record_audit
from app.services.auth import AuthContext

ROLES = {r.value for r in WorkspaceRole}


def _require_admin(ctx: AuthContext) -> None:
    if ctx.role != WorkspaceRole.ADMIN:
        raise ForbiddenError("Somente administradores gerenciam membros e convites.")


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


# ----------------------------------------------------------------------------- workspaces do usuário
def list_memberships(db: Session, ctx: AuthContext) -> list[tuple[Workspace, WorkspaceMember]]:
    rows = db.execute(
        select(Workspace, WorkspaceMember)
        .join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.id)
        .where(WorkspaceMember.user_id == ctx.user.id)
        .order_by(Workspace.name.asc())
    ).all()
    return [(w, m) for w, m in rows]


def switch_workspace(db: Session, ctx: AuthContext, workspace_id: uuid.UUID) -> AuthContext:
    membership = db.scalar(
        select(WorkspaceMember).where(
            WorkspaceMember.user_id == ctx.user.id, WorkspaceMember.workspace_id == workspace_id
        )
    )
    if membership is None:
        raise ForbiddenError("Você não é membro deste workspace.")
    workspace = db.get(Workspace, workspace_id)
    assert workspace is not None
    ctx.session.workspace_id = workspace_id
    record_audit(
        db,
        action="workspace.switch",
        workspace_id=workspace_id,
        user_id=ctx.user.id,
        target_type="session",
        target_id=ctx.session.id,
    )
    db.commit()
    return AuthContext(
        user=ctx.user, session=ctx.session, workspace=workspace, membership=membership
    )


def rename_workspace(db: Session, ctx: AuthContext, name: str) -> Workspace:
    _require_admin(ctx)
    clean = " ".join(name.split()).strip()
    if not (2 <= len(clean) <= 120):
        raise ValidationAppError("O nome do workspace deve ter entre 2 e 120 caracteres.")
    ctx.workspace.name = clean
    record_audit(
        db,
        action="workspace.rename",
        workspace_id=ctx.workspace_id,
        user_id=ctx.user.id,
        target_type="workspace",
        target_id=ctx.workspace_id,
    )
    db.commit()
    db.refresh(ctx.workspace)
    return ctx.workspace


# ----------------------------------------------------------------------------- membros
def _admin_count(db: Session, workspace_id: uuid.UUID) -> int:
    return int(
        db.scalar(
            select(func.count())
            .select_from(WorkspaceMember)
            .where(
                WorkspaceMember.workspace_id == workspace_id,
                WorkspaceMember.role == WorkspaceRole.ADMIN,
            )
        )
        or 0
    )


def _get_member(db: Session, ctx: AuthContext, user_id: uuid.UUID) -> WorkspaceMember:
    m = db.scalar(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == ctx.workspace_id, WorkspaceMember.user_id == user_id
        )
    )
    if m is None:
        raise NotFoundError("Membro não encontrado.", code="member_not_found")
    return m


def update_member_role(
    db: Session, ctx: AuthContext, user_id: uuid.UUID, role: str
) -> WorkspaceMember:
    _require_admin(ctx)
    if role not in ROLES:
        raise ValidationAppError("Papel inválido.")
    m = _get_member(db, ctx, user_id)
    if (
        m.role == WorkspaceRole.ADMIN
        and role != WorkspaceRole.ADMIN
        and _admin_count(db, ctx.workspace_id) <= 1
    ):
        raise ConflictError(
            "O workspace precisa manter pelo menos um administrador.", code="last_admin"
        )
    previous = m.role
    m.role = role
    record_audit(
        db,
        action="member.role",
        workspace_id=ctx.workspace_id,
        user_id=ctx.user.id,
        target_type="user",
        target_id=user_id,
        details={"from": previous, "to": role},
    )
    db.commit()
    db.refresh(m)
    return m


def remove_member(db: Session, ctx: AuthContext, user_id: uuid.UUID) -> None:
    _require_admin(ctx)
    m = _get_member(db, ctx, user_id)
    if m.role == WorkspaceRole.ADMIN and _admin_count(db, ctx.workspace_id) <= 1:
        raise ConflictError(
            "O workspace precisa manter pelo menos um administrador.", code="last_admin"
        )
    # Sessões do usuário apontando para este workspace perdem acesso imediatamente
    now = utcnow()
    for s in db.scalars(
        select(UserSession).where(
            UserSession.user_id == user_id,
            UserSession.workspace_id == ctx.workspace_id,
            UserSession.revoked_at.is_(None),
        )
    ):
        s.revoked_at = now
    db.delete(m)
    record_audit(
        db,
        action="member.remove",
        workspace_id=ctx.workspace_id,
        user_id=ctx.user.id,
        target_type="user",
        target_id=user_id,
    )
    db.commit()


# ----------------------------------------------------------------------------- convites
def _accept_url(token: str) -> str:
    return f"{settings.app_base_url.rstrip('/')}/invite/{token}"


def create_invitation(
    db: Session, ctx: AuthContext, *, email: str, role: str
) -> tuple[Invitation, str]:
    _require_admin(ctx)
    email = email.strip().lower()
    if role not in ROLES:
        raise ValidationAppError("Papel inválido.")
    existing_user = db.scalar(select(User.id).where(User.email == email))
    if existing_user and db.scalar(
        select(WorkspaceMember.id).where(
            WorkspaceMember.workspace_id == ctx.workspace_id,
            WorkspaceMember.user_id == existing_user,
        )
    ):
        raise ConflictError("Este usuário já é membro do workspace.", code="already_member")
    pending = db.scalar(
        select(Invitation).where(
            Invitation.workspace_id == ctx.workspace_id,
            Invitation.email == email,
            Invitation.status == "pending",
            Invitation.expires_at > utcnow(),
        )
    )
    if pending:
        raise ConflictError(
            "Já existe um convite pendente para este e-mail.", code="invitation_pending"
        )
    token = secrets.token_urlsafe(32)
    inv = Invitation(
        workspace_id=ctx.workspace_id,
        email=email,
        role=role,
        token_hash=_hash(token),
        status="pending",
        invited_by=ctx.user.id,
        created_at=utcnow(),
        expires_at=utcnow() + timedelta(days=settings.invitation_ttl_days),
    )
    db.add(inv)
    db.flush()
    url = _accept_url(token)
    get_mail_sender().send(
        Mail(
            to=email,
            subject=f"Convite para o workspace {ctx.workspace.name} no DocMind AI",
            text=(
                f'{ctx.user.name} convidou você para o workspace "{ctx.workspace.name}" como {role}.\n'
                f"Aceite em: {url}\nO convite expira em {settings.invitation_ttl_days} dias."
            ),
        )
    )
    record_audit(
        db,
        action="invitation.create",
        workspace_id=ctx.workspace_id,
        user_id=ctx.user.id,
        target_type="invitation",
        target_id=inv.id,
        details={"role": role},
    )
    db.commit()
    db.refresh(inv)
    return inv, url


def list_invitations(db: Session, ctx: AuthContext) -> list[Invitation]:
    _require_admin(ctx)
    items = list(
        db.scalars(
            select(Invitation)
            .where(Invitation.workspace_id == ctx.workspace_id)
            .order_by(Invitation.created_at.desc())
            .limit(100)
        )
    )
    now = utcnow()
    for inv in items:
        if inv.status == "pending" and inv.expires_at <= now:
            inv.status = "expired"
    db.commit()
    return items


def revoke_invitation(db: Session, ctx: AuthContext, invitation_id: uuid.UUID) -> None:
    _require_admin(ctx)
    inv = db.scalar(
        select(Invitation).where(
            Invitation.id == invitation_id, Invitation.workspace_id == ctx.workspace_id
        )
    )
    if inv is None:
        raise NotFoundError("Convite não encontrado.", code="invitation_not_found")
    if inv.status == "pending":
        inv.status = "revoked"
    record_audit(
        db,
        action="invitation.revoke",
        workspace_id=ctx.workspace_id,
        user_id=ctx.user.id,
        target_type="invitation",
        target_id=inv.id,
    )
    db.commit()


def get_invitation_by_token(db: Session, token: str) -> tuple[Invitation, Workspace]:
    inv = db.scalar(select(Invitation).where(Invitation.token_hash == _hash(token)))
    if inv is None:
        raise NotFoundError("Convite não encontrado.", code="invitation_not_found")
    if inv.status == "pending" and inv.expires_at <= utcnow():
        inv.status = "expired"
        db.commit()
    workspace = db.get(Workspace, inv.workspace_id)
    assert workspace is not None
    return inv, workspace


def accept_invitation(db: Session, ctx: AuthContext, token: str) -> AuthContext:
    inv, workspace = get_invitation_by_token(db, token)
    if inv.status != "pending":
        raise ConflictError(f"Este convite está {inv.status}.", code=f"invitation_{inv.status}")
    if inv.email != ctx.user.email.lower():
        raise ForbiddenError("Este convite foi emitido para outro e-mail.")
    membership = db.scalar(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace.id, WorkspaceMember.user_id == ctx.user.id
        )
    )
    if membership is None:
        membership = WorkspaceMember(workspace_id=workspace.id, user_id=ctx.user.id, role=inv.role)
        db.add(membership)
    inv.status = "accepted"
    inv.accepted_at = utcnow()
    inv.accepted_by = ctx.user.id
    ctx.session.workspace_id = workspace.id
    record_audit(
        db,
        action="invitation.accept",
        workspace_id=workspace.id,
        user_id=ctx.user.id,
        target_type="invitation",
        target_id=inv.id,
    )
    db.commit()
    db.refresh(membership)
    return AuthContext(
        user=ctx.user, session=ctx.session, workspace=workspace, membership=membership
    )
