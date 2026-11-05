"""Erros de provedores de IA normalizados (independentes do SDK de cada fornecedor).

Todos herdam de `AppError`, então chegam ao cliente no formato padrão
`{"error": {code, message, details}}` com HTTP 503 e uma mensagem em pt-BR que não expõe
chaves nem detalhes internos. O atributo `retryable` orienta o worker (backoff) e o chat.
"""

from __future__ import annotations

from fastapi import status

from app.core.exceptions import AppError


class ProviderError(AppError):
    """Falha genérica do provedor de IA (não transitória)."""

    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    code = "ai_provider_error"
    message = "O provedor de IA retornou um erro. Tente novamente mais tarde."
    retryable = False

    def __init__(
        self,
        message: str | None = None,
        *,
        detail: str | None = None,
        provider: str = "gemini",
        **kwargs,
    ) -> None:
        super().__init__(message, **kwargs)
        # `detail` vai só para logs (pode conter texto do fornecedor); nunca para o cliente.
        self.detail = detail
        self.provider = provider


class ProviderQuotaError(ProviderError):
    """429 RESOURCE_EXHAUSTED: limite por minuto/dia do projeto ou do nível gratuito."""

    code = "ai_quota_exceeded"
    message = (
        "O limite de uso do provedor de IA foi atingido. "
        "O processamento poderá ser tentado novamente mais tarde."
    )
    retryable = True


class ProviderAuthError(ProviderError):
    code = "ai_auth_failed"
    message = (
        "A chave do provedor de IA é inválida ou não tem permissão para este modelo. "
        "Avise o administrador do servidor."
    )


class ProviderModelUnavailableError(ProviderError):
    code = "ai_model_unavailable"
    message = "O modelo de IA configurado não está disponível para esta conta ou região."


class ProviderInvalidRequestError(ProviderError):
    code = "ai_invalid_request"
    message = "O provedor de IA recusou a requisição."


class ProviderTimeoutError(ProviderError):
    code = "ai_timeout"
    message = "O provedor de IA demorou demais para responder. Tente novamente."
    retryable = True


class ProviderTransientError(ProviderError):
    code = "ai_temporarily_unavailable"
    message = "O provedor de IA está temporariamente indisponível. Tente novamente em instantes."
    retryable = True


class ProviderEmptyResponseError(ProviderError):
    code = "ai_empty_response"
    message = "O provedor de IA retornou uma resposta vazia. Tente novamente."
    retryable = True


class ProviderBlockedError(ProviderError):
    code = "ai_response_blocked"
    message = "A resposta foi bloqueada pelos filtros de segurança do provedor de IA."
