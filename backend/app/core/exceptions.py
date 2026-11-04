"""Exceções de domínio e handlers padronizados.

Formato de erro: {"error": {"code": str, "message": str, "details": Any | None}}
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.logging import get_logger

log = get_logger(__name__)


class AppError(Exception):
    status_code: int = status.HTTP_400_BAD_REQUEST
    code: str = "bad_request"
    message: str = "Requisição inválida."

    def __init__(
        self,
        message: str | None = None,
        *,
        code: str | None = None,
        status_code: int | None = None,
        details: Any = None,
    ) -> None:
        super().__init__(message or self.message)
        if message:
            self.message = message
        if code:
            self.code = code
        if status_code:
            self.status_code = status_code
        self.details = details

    def to_payload(self) -> dict[str, Any]:
        return {"error": {"code": self.code, "message": self.message, "details": self.details}}


class UnauthorizedError(AppError):
    status_code = status.HTTP_401_UNAUTHORIZED
    code = "unauthorized"
    message = "Autenticação necessária."


class ForbiddenError(AppError):
    status_code = status.HTTP_403_FORBIDDEN
    code = "forbidden"
    message = "Você não tem permissão para esta ação."


class CSRFError(AppError):
    status_code = status.HTTP_403_FORBIDDEN
    code = "csrf_invalid"
    message = "Token CSRF ausente ou inválido."


class NotFoundError(AppError):
    status_code = status.HTTP_404_NOT_FOUND
    code = "not_found"
    message = "Recurso não encontrado."


class ConflictError(AppError):
    status_code = status.HTTP_409_CONFLICT
    code = "conflict"
    message = "Conflito com o estado atual do recurso."


class PayloadTooLargeError(AppError):
    status_code = 413
    code = "payload_too_large"
    message = "Arquivo excede o tamanho máximo permitido."


class UnsupportedMediaTypeError(AppError):
    status_code = status.HTTP_415_UNSUPPORTED_MEDIA_TYPE
    code = "unsupported_media_type"
    message = "Formato de arquivo não suportado."


class RateLimitedError(AppError):
    status_code = status.HTTP_429_TOO_MANY_REQUESTS
    code = "rate_limited"
    message = "Muitas requisições. Tente novamente em instantes."


class UsageLimitExceededError(AppError):
    status_code = status.HTTP_429_TOO_MANY_REQUESTS
    code = "usage_limit_exceeded"
    message = "Limite de uso atingido."


class AIUnavailableError(AppError):
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    code = "ai_unavailable"
    message = "O provedor de IA não está configurado ou está indisponível."


class ValidationAppError(AppError):
    status_code = 422
    code = "validation_error"
    message = "Dados inválidos."


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content=exc.to_payload())

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content={
                "error": {
                    "code": "validation_error",
                    "message": "Dados inválidos.",
                    "details": _sanitize_validation_errors(exc.errors()),
                }
            },
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        code_map = {
            401: "unauthorized",
            403: "forbidden",
            404: "not_found",
            405: "method_not_allowed",
        }
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "error": {
                    "code": code_map.get(exc.status_code, "http_error"),
                    "message": str(exc.detail) if exc.detail else "Erro HTTP.",
                    "details": None,
                }
            },
        )

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception) -> JSONResponse:
        log.exception("unhandled_error", error_type=type(exc).__name__)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={
                "error": {
                    "code": "internal_error",
                    "message": "Erro interno. Tente novamente mais tarde.",
                    "details": None,
                }
            },
        )


_FIELD_MESSAGES_PT = {
    "email": "Informe um e-mail válido.",
    "password": "A senha deve ter entre 8 e 128 caracteres.",
    "name": "Informe um nome com pelo menos 2 caracteres.",
}


def _sanitize_validation_errors(errors: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Remove valores de entrada dos detalhes (podem conter senhas) e traduz mensagens comuns."""
    out = []
    for e in errors:
        loc = list(e.get("loc", []))
        field = str(loc[-1]) if loc else ""
        msg = str(e.get("msg") or "")
        if msg.startswith("Value error, "):
            msg = msg[len("Value error, ") :]
        elif field in _FIELD_MESSAGES_PT:
            msg = _FIELD_MESSAGES_PT[field]
        out.append({"loc": loc, "msg": msg, "type": e.get("type")})
    return out
