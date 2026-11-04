"""Cadastro, login, logout e sessões persistidas no servidor."""

from __future__ import annotations

import re
import secrets
import unicodedata
import uuid
from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.exceptions import ConflictError, UnauthorizedError
from app.core.security import (
    generate_csrf_token,
    generate_session_token,
    hash_password,
    hash_session_token,
    password_needs_rehash,
    verify_password,
)
from app.models import User, UserSession, Workspace, WorkspaceMember, WorkspaceRole
from app.models.base import utcnow
from app.services.audit import record_audit


@dataclass(slots=True)
class AuthContext:
    """Contexto autenticado resolvido a partir do cookie de sessão."""

    user: User
    session: UserSession
    workspace: Workspace
    membership: WorkspaceMember

    @property
    def role(self) -> WorkspaceRole:
        return WorkspaceRole(self.membership.role)

    @property
    def workspace_id(self) -> uuid.UUID:
        return self.workspace.id


@dataclass(slots=True)
class IssuedSession:
    session: UserSession
    raw_token: str
    csrf_token: str


def _slugify(value: str) -> str:
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    value = re.sub(r"[^a-zA-Z0-9]+", "-", value).strip("-").lower()
    return value[:40] or "workspace"


def _unique_slug(db: Session, base: str) -> str:
    slug = base
    while db.scalar(select(Workspace.id).where(Workspace.slug == slug)):
        slug = f"{base}-{secrets.token_hex(3)}"
    return slug


def register_user(
    db: Session,
    *,
    name: str,
    email: str,
    password: str,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> tuple[AuthContext, IssuedSession]:
    email = email.strip().lower()
    if db.scalar(select(User.id).where(User.email == email)):
        raise ConflictError("Já existe uma conta com este e-mail.", code="email_in_use")

    user = User(name=name, email=email, password_hash=hash_password(password))
    db.add(user)
    db.flush()

    workspace = Workspace(
        name=f"Workspace de {name.split()[0]}",
        slug=_unique_slug(db, _slugify(name.split()[0])),
        owner_id=user.id,
        settings={"external_ai_enabled": True},
    )
    db.add(workspace)
    db.flush()
    membership = WorkspaceMember(
        workspace_id=workspace.id, user_id=user.id, role=WorkspaceRole.ADMIN
    )
    db.add(membership)
    db.flush()

    record_audit(
        db,
        action="user.register",
        workspace_id=workspace.id,
        user_id=user.id,
        target_type="user",
        target_id=user.id,
        ip_address=ip_address,
    )
    issued = _issue_session(db, user, workspace, ip_address, user_agent)
    db.commit()
    return AuthContext(user, issued.session, workspace, membership), issued


def login_user(
    db: Session,
    *,
    email: str,
    password: str,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> tuple[AuthContext, IssuedSession]:
    email = email.strip().lower()
    user = db.scalar(select(User).where(User.email == email))
    # Resposta idêntica para e-mail inexistente e senha incorreta
    if not user or not user.is_active or not verify_password(password, user.password_hash):
        record_audit(
            db, action="user.login_failed", workspace_id=None, user_id=None, ip_address=ip_address
        )
        db.commit()
        raise UnauthorizedError("E-mail ou senha inválidos.", code="invalid_credentials")

    if password_needs_rehash(user.password_hash):
        user.password_hash = hash_password(password)

    membership = db.scalar(
        select(WorkspaceMember)
        .where(WorkspaceMember.user_id == user.id)
        .order_by(WorkspaceMember.joined_at.asc())
    )
    if membership is None:
        raise UnauthorizedError("Usuário sem workspace associado.", code="no_workspace")
    workspace = db.get(Workspace, membership.workspace_id)
    assert workspace is not None

    user.last_login_at = utcnow()
    issued = _issue_session(db, user, workspace, ip_address, user_agent)
    record_audit(
        db,
        action="user.login",
        workspace_id=workspace.id,
        user_id=user.id,
        target_type="session",
        target_id=issued.session.id,
        ip_address=ip_address,
    )
    db.commit()
    return AuthContext(user, issued.session, workspace, membership), issued


def _issue_session(
    db: Session,
    user: User,
    workspace: Workspace,
    ip_address: str | None,
    user_agent: str | None,
) -> IssuedSession:
    raw = generate_session_token()
    now = utcnow()
    session = UserSession(
        user_id=user.id,
        workspace_id=workspace.id,
        token_hash=hash_session_token(raw),
        csrf_token=generate_csrf_token(),
        created_at=now,
        expires_at=now + timedelta(hours=settings.session_ttl_hours),
        last_seen_at=now,
        user_agent=(user_agent or "")[:255] or None,
        ip_address=(ip_address or "")[:64] or None,
    )
    db.add(session)
    db.flush()
    return IssuedSession(session=session, raw_token=raw, csrf_token=session.csrf_token)


def resolve_session(db: Session, raw_token: str | None) -> AuthContext | None:
    if not raw_token:
        return None
    session = db.scalar(
        select(UserSession).where(UserSession.token_hash == hash_session_token(raw_token))
    )
    if session is None or session.revoked_at is not None:
        return None
    now = utcnow()
    if session.expires_at <= now:
        return None
    user = db.get(User, session.user_id)
    if user is None or not user.is_active:
        return None
    membership = db.scalar(
        select(WorkspaceMember).where(
            WorkspaceMember.user_id == user.id, WorkspaceMember.workspace_id == session.workspace_id
        )
    )
    if membership is None:
        return None
    workspace = db.get(Workspace, session.workspace_id)
    if workspace is None:
        return None
    # Atualiza last_seen com baixa frequência para evitar escrita a cada requisição
    if (now - session.last_seen_at) > timedelta(minutes=5):
        session.last_seen_at = now
        db.commit()
    return AuthContext(user=user, session=session, workspace=workspace, membership=membership)


def logout_session(db: Session, ctx: AuthContext, ip_address: str | None = None) -> None:
    ctx.session.revoked_at = utcnow()
    record_audit(
        db,
        action="user.logout",
        workspace_id=ctx.workspace.id,
        user_id=ctx.user.id,
        target_type="session",
        target_id=ctx.session.id,
        ip_address=ip_address,
    )
    db.commit()
