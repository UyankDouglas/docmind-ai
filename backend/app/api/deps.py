"""Dependências FastAPI: sessão de banco, autenticação, CSRF e papéis."""

from __future__ import annotations

from collections.abc import Callable

from fastapi import Depends, Request, Response
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.exceptions import CSRFError, ForbiddenError, UnauthorizedError
from app.core.security import (
    CSRF_COOKIE_NAME,
    CSRF_HEADER_NAME,
    SESSION_COOKIE_NAME,
    constant_time_equals,
)
from app.models import WorkspaceRole
from app.providers.storage import ObjectStorage, get_storage
from app.services.auth import AuthContext, resolve_session

_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def client_ip(request: Request) -> str | None:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()[:64]
    return request.client.host if request.client else None


def get_optional_auth(request: Request, db: Session = Depends(get_db)) -> AuthContext | None:
    return resolve_session(db, request.cookies.get(SESSION_COOKIE_NAME))


def get_current_auth(request: Request, db: Session = Depends(get_db)) -> AuthContext:
    ctx = resolve_session(db, request.cookies.get(SESSION_COOKIE_NAME))
    if ctx is None:
        raise UnauthorizedError()
    if request.method not in _SAFE_METHODS:
        _verify_csrf(request, ctx)
    return ctx


def _verify_csrf(request: Request, ctx: AuthContext) -> None:
    header = request.headers.get(CSRF_HEADER_NAME)
    cookie = request.cookies.get(CSRF_COOKIE_NAME)
    # O token precisa bater com o cookie (double submit) E com o valor da sessão no servidor
    if not constant_time_equals(header, cookie) or not constant_time_equals(
        header, ctx.session.csrf_token
    ):
        raise CSRFError()


def require_roles(*roles: WorkspaceRole) -> Callable[[AuthContext], AuthContext]:
    def _dep(ctx: AuthContext = Depends(get_current_auth)) -> AuthContext:
        if ctx.role not in roles:
            raise ForbiddenError()
        return ctx

    return _dep


def storage_dep() -> ObjectStorage:
    return get_storage()


def set_session_cookies(response: Response, raw_token: str, csrf_token: str) -> None:
    max_age = settings.session_ttl_hours * 3600
    response.set_cookie(
        SESSION_COOKIE_NAME,
        raw_token,
        max_age=max_age,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )
    response.set_cookie(
        CSRF_COOKIE_NAME,
        csrf_token,
        max_age=max_age,
        httponly=False,  # precisa ser lido pelo frontend para o header X-CSRF-Token
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )


def clear_session_cookies(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE_NAME, path="/")
    response.delete_cookie(CSRF_COOKIE_NAME, path="/")
