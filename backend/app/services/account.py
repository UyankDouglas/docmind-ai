"""Conta do usuário: recuperação/alteração de senha e sessões ativas."""

from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.exceptions import NotFoundError, UnauthorizedError, ValidationAppError
from app.core.security import hash_password, verify_password
from app.models import PasswordResetToken, User, UserSession
from app.models.base import utcnow
from app.providers.mail import Mail, get_mail_sender
from app.services.audit import record_audit
from app.services.auth import AuthContext


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def request_password_reset(db: Session, *, email: str, ip_address: str | None) -> None:
    """Sempre silencioso: não revela se o e-mail existe."""
    user = db.scalar(
        select(User).where(User.email == email.strip().lower(), User.is_active.is_(True))
    )
    if user is None:
        return
    token = secrets.token_urlsafe(32)
    db.add(
        PasswordResetToken(
            user_id=user.id,
            token_hash=_hash(token),
            created_at=utcnow(),
            expires_at=utcnow() + timedelta(minutes=settings.password_reset_ttl_minutes),
            requested_ip=ip_address,
        )
    )
    url = f"{settings.app_base_url.rstrip('/')}/reset-password?token={token}"
    get_mail_sender().send(
        Mail(
            to=user.email,
            subject="Redefinição de senha — DocMind AI",
            text=(
                f"Olá, {user.name}.\nPara redefinir sua senha acesse: {url}\n"
                f"O link expira em {settings.password_reset_ttl_minutes} minutos. "
                "Se você não solicitou, ignore esta mensagem."
            ),
        )
    )
    record_audit(
        db,
        action="user.password_reset_requested",
        workspace_id=None,
        user_id=user.id,
        ip_address=ip_address,
    )
    db.commit()


def reset_password(db: Session, *, token: str, password: str, ip_address: str | None) -> None:
    rec = db.scalar(select(PasswordResetToken).where(PasswordResetToken.token_hash == _hash(token)))
    if rec is None or rec.used_at is not None or rec.expires_at <= utcnow():
        raise NotFoundError("Link de redefinição inválido ou expirado.", code="reset_token_invalid")
    user = db.get(User, rec.user_id)
    if user is None:
        raise NotFoundError("Link de redefinição inválido ou expirado.", code="reset_token_invalid")
    _validate_password(password)
    user.password_hash = hash_password(password)
    rec.used_at = utcnow()
    _revoke_sessions(db, user.id, keep=None)
    record_audit(
        db, action="user.password_reset", workspace_id=None, user_id=user.id, ip_address=ip_address
    )
    db.commit()


def change_password(
    db: Session,
    ctx: AuthContext,
    *,
    current_password: str,
    new_password: str,
    ip_address: str | None,
) -> None:
    if not verify_password(current_password, ctx.user.password_hash):
        raise UnauthorizedError("Senha atual incorreta.", code="invalid_credentials")
    _validate_password(new_password)
    if new_password == current_password:
        raise ValidationAppError("A nova senha deve ser diferente da atual.")
    ctx.user.password_hash = hash_password(new_password)
    _revoke_sessions(db, ctx.user.id, keep=ctx.session.id)
    record_audit(
        db,
        action="user.password_change",
        workspace_id=ctx.workspace_id,
        user_id=ctx.user.id,
        ip_address=ip_address,
    )
    db.commit()


def _validate_password(password: str) -> None:
    if not (8 <= len(password) <= 128):
        raise ValidationAppError("A senha deve ter entre 8 e 128 caracteres.")


def _revoke_sessions(db: Session, user_id: uuid.UUID, *, keep: uuid.UUID | None) -> int:
    now = utcnow()
    count = 0
    for s in db.scalars(
        select(UserSession).where(UserSession.user_id == user_id, UserSession.revoked_at.is_(None))
    ):
        if keep is not None and s.id == keep:
            continue
        s.revoked_at = now
        count += 1
    return count


def list_sessions(db: Session, ctx: AuthContext) -> list[UserSession]:
    now = utcnow()
    return list(
        db.scalars(
            select(UserSession)
            .where(
                UserSession.user_id == ctx.user.id,
                UserSession.revoked_at.is_(None),
                UserSession.expires_at > now,
            )
            .order_by(UserSession.last_seen_at.desc())
        )
    )


def revoke_session(db: Session, ctx: AuthContext, session_id: uuid.UUID) -> None:
    if session_id == ctx.session.id:
        raise ValidationAppError("Use o logout para encerrar a sessão atual.")
    s = db.scalar(
        select(UserSession).where(UserSession.id == session_id, UserSession.user_id == ctx.user.id)
    )
    if s is None:
        raise NotFoundError("Sessão não encontrada.", code="session_not_found")
    s.revoked_at = utcnow()
    record_audit(
        db,
        action="session.revoke",
        workspace_id=ctx.workspace_id,
        user_id=ctx.user.id,
        target_type="session",
        target_id=s.id,
    )
    db.commit()


def revoke_other_sessions(db: Session, ctx: AuthContext) -> int:
    count = _revoke_sessions(db, ctx.user.id, keep=ctx.session.id)
    record_audit(
        db,
        action="session.revoke_others",
        workspace_id=ctx.workspace_id,
        user_id=ctx.user.id,
        details={"count": count},
    )
    db.commit()
    return count
