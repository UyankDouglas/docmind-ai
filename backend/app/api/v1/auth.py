from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy.orm import Session

from app.api.deps import (
    clear_session_cookies,
    client_ip,
    get_current_auth,
    set_session_cookies,
)
from app.core.config import settings
from app.core.database import get_db
from app.core.security import CSRF_COOKIE_NAME, generate_csrf_token
from app.schemas.auth import CSRFResponse, LoginRequest, RegisterRequest, UserMe, WorkspaceSummary
from app.services import auth as auth_service
from app.services.auth import AuthContext
from app.services.rate_limit import enforce_rate_limit

router = APIRouter(prefix="/auth", tags=["auth"])


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


@router.get("/csrf", response_model=CSRFResponse)
def csrf(request: Request, response: Response) -> CSRFResponse:
    """Garante um cookie CSRF para o fluxo de login/cadastro (antes de existir sessão)."""
    token = request.cookies.get(CSRF_COOKIE_NAME) or generate_csrf_token()
    response.set_cookie(
        CSRF_COOKIE_NAME,
        token,
        max_age=settings.session_ttl_hours * 3600,
        httponly=False,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )
    return CSRFResponse(csrf_token=token)


@router.post("/register", response_model=UserMe, status_code=status.HTTP_201_CREATED)
def register(
    payload: RegisterRequest, request: Request, response: Response, db: Session = Depends(get_db)
) -> UserMe:
    ip = client_ip(request)
    enforce_rate_limit("register", ip or "unknown", settings.rate_limit_login_per_minute, 60)
    ctx, issued = auth_service.register_user(
        db,
        name=payload.name,
        email=payload.email,
        password=payload.password,
        ip_address=ip,
        user_agent=request.headers.get("user-agent"),
    )
    set_session_cookies(response, issued.raw_token, issued.csrf_token)
    return _me(ctx)


@router.post("/login", response_model=UserMe)
def login(
    payload: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)
) -> UserMe:
    ip = client_ip(request)
    enforce_rate_limit("login", ip or "unknown", settings.rate_limit_login_per_minute, 60)
    enforce_rate_limit(
        "login_email", payload.email.lower(), settings.rate_limit_login_per_minute, 60
    )
    ctx, issued = auth_service.login_user(
        db,
        email=payload.email,
        password=payload.password,
        ip_address=ip,
        user_agent=request.headers.get("user-agent"),
    )
    set_session_cookies(response, issued.raw_token, issued.csrf_token)
    return _me(ctx)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    request: Request,
    response: Response,
    ctx: AuthContext = Depends(get_current_auth),
    db: Session = Depends(get_db),
) -> Response:
    auth_service.logout_session(db, ctx, ip_address=client_ip(request))
    clear_session_cookies(response)
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.get("/me", response_model=UserMe)
def me(ctx: AuthContext = Depends(get_current_auth)) -> UserMe:
    return _me(ctx)
