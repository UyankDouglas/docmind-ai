"""Adaptadores para a Google Gemini API (SDK oficial `google-genai`).

- `GeminiEmbeddingProvider`: `models.embed_content` com `task_type` distinto para documentos
  (RETRIEVAL_DOCUMENT) e perguntas (RETRIEVAL_QUERY), `output_dimensionality` fixa e normalização
  L2 (o `gemini-embedding-001` só devolve vetores normalizados em 3072 dimensões).
- `GeminiLLMProvider`: `models.generate_content` / `generate_content_stream` com instruções de
  sistema separadas do histórico (`user` → `user`, `assistant` → `model`), uso real de tokens,
  mapeamento de `finish_reason` e de bloqueios de segurança.
- Erros do SDK são convertidos em `ProviderError` (app.providers.errors); falhas transitórias
  (429, 5xx, timeout, rede) recebem backoff exponencial com jitter, limitado por LLM_MAX_RETRIES.

Nenhuma chave é registrada em log. O SDK é importado sob demanda para que ambientes com
provedor `fake` não precisem dele carregado.
"""

from __future__ import annotations

import functools
import math
import random
import time
from collections.abc import Callable, Iterator
from typing import Any

import httpx

from app.core.config import settings
from app.core.logging import get_logger
from app.providers.embeddings import EmbeddingDimensionError, EmbeddingResult, validate_dimensions
from app.providers.errors import (
    ProviderAuthError,
    ProviderBlockedError,
    ProviderEmptyResponseError,
    ProviderError,
    ProviderInvalidRequestError,
    ProviderModelUnavailableError,
    ProviderQuotaError,
    ProviderTimeoutError,
    ProviderTransientError,
)
from app.providers.llm import LLMMessage, LLMResult

log = get_logger(__name__)

PROVIDER_NAME = "gemini"
TASK_RETRIEVAL_DOCUMENT = "RETRIEVAL_DOCUMENT"
TASK_RETRIEVAL_QUERY = "RETRIEVAL_QUERY"
# Limite documentado da API para `batchEmbedContents`
MAX_TEXTS_PER_REQUEST = 100
# finish_reason que significam bloqueio (resposta não entregue por política do provedor)
_BLOCKING_FINISH_REASONS = {
    "SAFETY",
    "RECITATION",
    "BLOCKLIST",
    "PROHIBITED_CONTENT",
    "SPII",
    "IMAGE_SAFETY",
    "IMAGE_PROHIBITED_CONTENT",
}
_FINISH_REASON_MAP = {"STOP": "stop", "MAX_TOKENS": "length"}

Sleep = Callable[[float], None]


# ---------------------------------------------------------------------------- cliente
def make_client(api_key: str, *, timeout_seconds: float | None = None):
    """Cria o cliente do SDK. As retentativas são feitas por esta camada (SDK com 1 tentativa)."""
    from google import genai
    from google.genai import types

    timeout_ms = int((timeout_seconds or settings.llm_timeout_seconds) * 1000)
    return genai.Client(
        api_key=api_key,
        http_options=types.HttpOptions(
            timeout=timeout_ms,
            retry_options=types.HttpRetryOptions(attempts=1),
        ),
    )


# ---------------------------------------------------------------------------- erros
def map_error(exc: BaseException) -> ProviderError:
    """Converte exceções do SDK/HTTP em `ProviderError` com mensagem segura em pt-BR."""
    if isinstance(exc, ProviderError):
        return exc
    detail = f"{type(exc).__name__}: {str(exc)[:300]}"
    try:
        from google.genai import errors as genai_errors
    except Exception:  # pragma: no cover - SDK ausente
        genai_errors = None  # type: ignore[assignment]

    if genai_errors is not None and isinstance(exc, genai_errors.APIError):
        code = int(getattr(exc, "code", 0) or 0)
        status = str(getattr(exc, "status", "") or "").upper()
        message = str(getattr(exc, "message", "") or "")
        lowered = message.lower()
        if code == 429 or status == "RESOURCE_EXHAUSTED":
            return ProviderQuotaError(detail=detail)
        if (
            code in (401, 403)
            or status in ("UNAUTHENTICATED", "PERMISSION_DENIED")
            or "api key" in lowered
            or "api_key" in lowered
        ):
            return ProviderAuthError(detail=detail)
        if code == 404 or status == "NOT_FOUND":
            return ProviderModelUnavailableError(detail=detail)
        if code in (408, 504) or status == "DEADLINE_EXCEEDED":
            return ProviderTimeoutError(detail=detail)
        if code >= 500 or status in ("UNAVAILABLE", "INTERNAL", "ABORTED"):
            return ProviderTransientError(detail=detail)
        if code == 400 or status in ("INVALID_ARGUMENT", "FAILED_PRECONDITION"):
            return ProviderInvalidRequestError(detail=detail)
        return ProviderError(detail=detail)

    if isinstance(exc, httpx.TimeoutException | TimeoutError):
        return ProviderTimeoutError(detail=detail)
    if isinstance(exc, httpx.TransportError | ConnectionError):
        return ProviderTransientError(detail=detail)
    name = type(exc).__name__
    if name in ("ReadTimeout", "ConnectTimeout", "WriteTimeout", "PoolTimeout"):
        return ProviderTimeoutError(detail=detail)
    if name in ("ConnectError", "RemoteProtocolError", "NetworkError", "ReadError"):
        return ProviderTransientError(detail=detail)
    return ProviderError(detail=detail)


def backoff_delay(attempt: int, *, rng: Callable[[], float] = random.random) -> float:
    """Exponencial (base * 2^(n-1)) limitado pelo teto, com jitter entre 50% e 100%."""
    base = max(0.0, settings.provider_retry_base_seconds)
    cap = max(base, settings.provider_retry_max_seconds)
    exp = min(cap, base * (2 ** max(0, attempt - 1)))
    return exp * (0.5 + 0.5 * rng())


def call_with_retries[T](
    fn: Callable[[], T],
    *,
    operation: str,
    max_retries: int | None = None,
    sleep: Sleep = time.sleep,
) -> T:
    """Executa `fn`; retenta só erros `retryable`, no máximo LLM_MAX_RETRIES vezes."""
    retries = settings.llm_max_retries if max_retries is None else max_retries
    attempts = max(1, retries + 1)
    for attempt in range(1, attempts + 1):
        try:
            return fn()
        except Exception as exc:
            err = map_error(exc)
            if not err.retryable or attempt >= attempts:
                log.warning(
                    "gemini_call_failed",
                    operation=operation,
                    attempt=attempt,
                    error_code=err.code,
                    retryable=err.retryable,
                    detail=err.detail,
                )
                raise err from exc
            delay = backoff_delay(attempt)
            log.info(
                "gemini_call_retry",
                operation=operation,
                attempt=attempt,
                error_code=err.code,
                delay_s=round(delay, 2),
            )
            sleep(delay)
    raise AssertionError("unreachable")  # pragma: no cover


# ---------------------------------------------------------------------------- embeddings
def l2_normalize(values: list[float]) -> list[float]:
    norm = math.sqrt(sum(v * v for v in values))
    if norm == 0.0 or not math.isfinite(norm):
        raise ProviderEmptyResponseError(detail="embedding com norma zero ou inválida")
    return [v / norm for v in values]


class GeminiEmbeddingProvider:
    name = PROVIDER_NAME

    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        dimensions: int,
        client: Any | None = None,
        sleep: Sleep = time.sleep,
        batch_size: int | None = None,
    ) -> None:
        self.model = model
        self.dimensions = dimensions
        self._client = client or make_client(api_key)
        self._sleep = sleep
        self.batch_size = max(
            1, min(batch_size or settings.gemini_embedding_batch_size, MAX_TEXTS_PER_REQUEST)
        )

    def _embed(self, texts: list[str], task_type: str) -> EmbeddingResult:
        from google.genai import types

        if not texts:
            return EmbeddingResult(
                [], self.model, self.dimensions, 0, 0, self.name, {"task_type": task_type}
            )
        started = time.perf_counter()
        vectors: list[list[float]] = []
        official_tokens = 0
        official_available = True
        billable_chars = 0
        requests = 0
        for i in range(0, len(texts), self.batch_size):
            batch = texts[i : i + self.batch_size]
            config = types.EmbedContentConfig(
                task_type=task_type, output_dimensionality=self.dimensions
            )
            resp = call_with_retries(
                functools.partial(
                    self._client.models.embed_content,
                    model=self.model,
                    contents=batch,
                    config=config,
                ),
                operation="embed_content",
                sleep=self._sleep,
            )
            requests += 1
            embeddings = list(getattr(resp, "embeddings", None) or [])
            if len(embeddings) != len(batch):
                raise ProviderEmptyResponseError(
                    detail=f"{len(embeddings)} embeddings devolvidos para {len(batch)} textos"
                )
            for emb in embeddings:
                values = list(getattr(emb, "values", None) or [])
                if not values:
                    raise ProviderEmptyResponseError(detail="embedding sem valores")
                vectors.append(l2_normalize([float(v) for v in values]))
                stats = getattr(emb, "statistics", None)
                token_count = getattr(stats, "token_count", None) if stats is not None else None
                if token_count is None:
                    official_available = False
                else:
                    official_tokens += int(token_count)
            meta = getattr(resp, "metadata", None)
            chars = getattr(meta, "billable_character_count", None) if meta is not None else None
            if chars:
                billable_chars += int(chars)
        try:
            validate_dimensions(vectors, self.dimensions)
        except EmbeddingDimensionError as exc:
            raise ProviderInvalidRequestError(
                "O provedor devolveu vetores com dimensão diferente da configurada "
                f"(EMBEDDING_DIMENSIONS={self.dimensions}).",
                detail=str(exc),
            ) from exc
        if official_available:
            tokens, tokens_source = official_tokens, "provider"
        else:
            # A Gemini API (não Vertex) não devolve contagem de tokens por texto: estimamos
            # localmente e marcamos a origem para que o uso nunca seja exibido como medida oficial.
            from app.providers.tokens import get_token_counter

            counter = get_token_counter()
            tokens, tokens_source = sum(counter.count(t) for t in texts), "estimated_local"
        latency = int((time.perf_counter() - started) * 1000)
        return EmbeddingResult(
            vectors,
            self.model,
            self.dimensions,
            tokens,
            latency,
            self.name,
            extra={
                "task_type": task_type,
                "tokens_source": tokens_source,
                "billable_characters": billable_chars or None,
                "requests": requests,
            },
        )

    def embed_texts(self, texts: list[str]) -> EmbeddingResult:
        return self._embed(texts, TASK_RETRIEVAL_DOCUMENT)

    def embed_query(self, text: str) -> EmbeddingResult:
        return self._embed([text], TASK_RETRIEVAL_QUERY)


# ---------------------------------------------------------------------------- LLM
def convert_messages(messages: list[LLMMessage]) -> tuple[str | None, list[Any]]:
    """Separa instruções de sistema do histórico e converte papéis para o formato do SDK.

    `system` → `system_instruction` (concatenadas); `user` → role "user"; `assistant` → role
    "model". Mensagens consecutivas do mesmo papel viram partes de um mesmo turno. O conteúdo
    de documentos continua dentro da mensagem do usuário (nunca vira instrução de sistema).
    """
    from google.genai import types

    system_parts = [m.content for m in messages if m.role == "system" and m.content.strip()]
    contents: list[Any] = []
    for m in messages:
        if m.role == "system":
            continue
        if m.role not in ("user", "assistant"):
            raise ProviderInvalidRequestError(detail=f"papel desconhecido: {m.role}")
        role = "model" if m.role == "assistant" else "user"
        part = types.Part.from_text(text=m.content)
        if contents and contents[-1].role == role:
            contents[-1].parts.append(part)
        else:
            contents.append(types.Content(role=role, parts=[part]))
    if not contents:
        raise ProviderInvalidRequestError(detail="nenhuma mensagem de usuário para enviar")
    if contents[0].role != "user":
        # A API exige que a conversa comece pelo usuário; históricos malformados ganham um
        # turno neutro em vez de serem reordenados silenciosamente.
        contents.insert(
            0,
            types.Content(role="user", parts=[types.Part.from_text(text="(início da conversa)")]),
        )
    return ("\n\n".join(system_parts) or None, contents)


def _candidate(resp: Any) -> Any | None:
    candidates = getattr(resp, "candidates", None) or []
    return candidates[0] if candidates else None


def _response_text(resp: Any) -> str:
    cand = _candidate(resp)
    if cand is None:
        return ""
    content = getattr(cand, "content", None)
    parts = getattr(content, "parts", None) or []
    return "".join(
        p.text for p in parts if getattr(p, "text", None) and not getattr(p, "thought", False)
    )


def _finish_reason(resp: Any) -> str | None:
    cand = _candidate(resp)
    reason = getattr(cand, "finish_reason", None) if cand is not None else None
    if reason is None:
        return None
    name = getattr(reason, "name", None) or str(reason)
    return name.upper()


def _block_reason(resp: Any) -> str | None:
    feedback = getattr(resp, "prompt_feedback", None)
    reason = getattr(feedback, "block_reason", None) if feedback is not None else None
    if reason is None:
        return None
    name = getattr(reason, "name", None) or str(reason)
    return name.upper() if name and name != "BLOCKED_REASON_UNSPECIFIED" else None


def _usage(resp: Any) -> tuple[int, int, int]:
    usage = getattr(resp, "usage_metadata", None)
    if usage is None:
        return 0, 0, 0
    prompt = int(getattr(usage, "prompt_token_count", 0) or 0)
    candidates = int(getattr(usage, "candidates_token_count", 0) or 0)
    thoughts = int(getattr(usage, "thoughts_token_count", 0) or 0)
    return prompt, candidates, thoughts


def _public_finish_reason(raw: str | None) -> str | None:
    if raw is None:
        return None
    return _FINISH_REASON_MAP.get(raw, raw.lower())


def _raise_for_empty(text: str, finish: str | None, block: str | None) -> None:
    if text.strip():
        return
    if block or (finish in _BLOCKING_FINISH_REASONS):
        raise ProviderBlockedError(detail=f"block_reason={block} finish_reason={finish}")
    if finish == "MAX_TOKENS":
        raise ProviderEmptyResponseError(
            detail="MAX_TOKENS sem texto (limite consumido pelo raciocínio do modelo?)"
        )
    raise ProviderEmptyResponseError(detail=f"finish_reason={finish}")


class GeminiLLMProvider:
    name = PROVIDER_NAME

    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        client: Any | None = None,
        sleep: Sleep = time.sleep,
        thinking_level: str | None = None,
        apply_temperature: bool | None = None,
    ) -> None:
        self.model = model
        self._client = client or make_client(api_key)
        self._sleep = sleep
        self.thinking_level = (
            settings.gemini_thinking_level if thinking_level is None else thinking_level
        )
        self.apply_temperature = (
            settings.gemini_apply_temperature if apply_temperature is None else apply_temperature
        )

    def _prepare(self, messages: list[LLMMessage], max_tokens: int, temperature: float):
        from google.genai import types

        system, contents = convert_messages(messages)
        kwargs: dict[str, Any] = {"max_output_tokens": max_tokens}
        if system:
            kwargs["system_instruction"] = system
        if self.apply_temperature:
            kwargs["temperature"] = temperature
        if self.thinking_level:
            kwargs["thinking_config"] = types.ThinkingConfig(thinking_level=self.thinking_level)
        return contents, types.GenerateContentConfig(**kwargs)

    def generate(
        self, messages: list[LLMMessage], *, max_tokens: int, temperature: float = 0.1
    ) -> LLMResult:
        started = time.perf_counter()
        contents, config = self._prepare(messages, max_tokens, temperature)
        resp = call_with_retries(
            lambda: self._client.models.generate_content(
                model=self.model, contents=contents, config=config
            ),
            operation="generate_content",
            sleep=self._sleep,
        )
        text = _response_text(resp)
        finish = _finish_reason(resp)
        _raise_for_empty(text, finish, _block_reason(resp))
        prompt, candidates, thoughts = _usage(resp)
        return LLMResult(
            text=text.strip(),
            model=getattr(resp, "model_version", None) or self.model,
            prompt_tokens=prompt,
            completion_tokens=candidates + thoughts,
            latency_ms=int((time.perf_counter() - started) * 1000),
            provider=self.name,
            finish_reason=_public_finish_reason(finish),
        )

    def stream(
        self, messages: list[LLMMessage], *, max_tokens: int, temperature: float = 0.1
    ) -> Iterator[str | LLMResult]:
        started = time.perf_counter()
        contents, config = self._prepare(messages, max_tokens, temperature)

        def _open():
            # O SDK só envia a requisição ao iterar: incluímos o primeiro fragmento na
            # tentativa para que erros de abertura (429, 5xx) também recebam backoff.
            iterator = iter(
                self._client.models.generate_content_stream(
                    model=self.model, contents=contents, config=config
                )
            )
            return iterator, next(iterator, None)

        iterator, first = call_with_retries(
            _open, operation="generate_content_stream", sleep=self._sleep
        )
        parts: list[str] = []
        usage = (0, 0, 0)
        finish: str | None = None
        block: str | None = None
        model = self.model

        def _consume(chunk: Any) -> str:
            nonlocal usage, finish, block, model
            block = block or _block_reason(chunk)
            delta = _response_text(chunk)
            if getattr(chunk, "usage_metadata", None) is not None:
                usage = _usage(chunk)
            reason = _finish_reason(chunk)
            if reason:
                finish = reason
            version = getattr(chunk, "model_version", None)
            if version:
                model = version
            return delta

        try:
            if first is not None:
                delta = _consume(first)
                if delta:
                    parts.append(delta)
                    yield delta
                for chunk in iterator:
                    delta = _consume(chunk)
                    if delta:
                        parts.append(delta)
                        yield delta
        except Exception as exc:
            # Depois do primeiro fragmento não há como reiniciar o stream sem duplicar texto.
            raise map_error(exc) from exc
        text = "".join(parts)
        _raise_for_empty(text, finish, block)
        prompt, candidates, thoughts = usage
        yield LLMResult(
            text=text.strip(),
            model=model,
            prompt_tokens=prompt,
            completion_tokens=candidates + thoughts,
            latency_ms=int((time.perf_counter() - started) * 1000),
            provider=self.name,
            finish_reason=_public_finish_reason(finish),
        )


# ---------------------------------------------------------------------------- diagnóstico
def list_models(client: Any) -> list[tuple[str, list[str]]]:
    """Nomes e ações suportadas dos modelos visíveis para a chave (sem imprimir a chave)."""
    out: list[tuple[str, list[str]]] = []
    for model in client.models.list():
        name = str(getattr(model, "name", "") or "")
        actions = [str(a) for a in (getattr(model, "supported_actions", None) or [])]
        out.append((name, actions))
    return out
