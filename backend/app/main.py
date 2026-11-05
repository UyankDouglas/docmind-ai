"""Ponto de entrada da API DocMind AI."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1 import api_router
from app.core.config import settings
from app.core.exceptions import register_exception_handlers
from app.core.logging import configure_logging, get_logger

log = get_logger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    configure_logging()
    if settings.is_production and settings.secret_key.startswith("change-me"):
        raise RuntimeError(
            "SECRET_KEY padrão não pode ser usada em produção. Gere uma chave aleatória."
        )
    if settings.is_production and not settings.cookie_secure:
        log.warning("cookie_secure_disabled_in_production")
    log.info(
        "startup",
        env=settings.app_env,
        embedding_provider=settings.embedding_provider,
        llm_provider=settings.llm_provider,
        ai_configured=settings.ai_configured,
    )
    yield
    log.info("shutdown")


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        description="API de inteligência documental com RAG, citações verificáveis e isolamento por workspace.",
        docs_url="/api/docs" if not settings.is_production else None,
        redoc_url=None,
        openapi_url="/api/openapi.json" if not settings.is_production else None,
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "X-CSRF-Token", "X-Requested-With"],
    )

    @app.middleware("http")
    async def security_headers(request: Request, call_next):  # type: ignore[no-untyped-def]
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault("Cache-Control", "no-store")
        return response

    @app.middleware("http")
    async def limit_body(request: Request, call_next):  # type: ignore[no-untyped-def]
        # Defesa adicional ao limite de upload (o serviço também valida o tamanho real)
        length = request.headers.get("content-length")
        if length and length.isdigit() and int(length) > settings.max_upload_bytes + 1024 * 1024:
            return JSONResponse(
                status_code=413,
                content={
                    "error": {
                        "code": "payload_too_large",
                        "message": f"O arquivo excede o limite de {settings.max_upload_mb} MB.",
                        "details": None,
                    }
                },
            )
        return await call_next(request)

    register_exception_handlers(app)
    app.include_router(api_router)
    return app


app = create_app()
