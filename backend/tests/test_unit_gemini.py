"""Testes unitários dos adaptadores Google Gemini (SDK simulado; sem rede, sem chave real).

Cobrem: tipos de tarefa e dimensão dos embeddings, normalização, lotes, contagem de tokens
(oficial ou estimada), conversão de mensagens, geração, streaming, mapeamento de erros
(429, credencial, modelo, timeout, resposta vazia, bloqueio), retentativas com backoff e a
configuração `ai_configured`.
"""

from __future__ import annotations

import math

import httpx
import pytest
from google.genai import errors as genai_errors
from google.genai import types

from app.core.config import settings
from app.core.exceptions import AIUnavailableError
from app.providers import embeddings as embeddings_module
from app.providers import gemini
from app.providers.errors import (
    ProviderAuthError,
    ProviderBlockedError,
    ProviderEmptyResponseError,
    ProviderInvalidRequestError,
    ProviderModelUnavailableError,
    ProviderQuotaError,
    ProviderTimeoutError,
    ProviderTransientError,
)
from app.providers.gemini import (
    GeminiEmbeddingProvider,
    GeminiLLMProvider,
    backoff_delay,
    convert_messages,
    l2_normalize,
    map_error,
)
from app.providers.llm import LLMMessage, LLMResult, build_llm_provider

DIMS = 8
NOT_A_KEY = "chave-ficticia-de-teste"


# ----------------------------------------------------------------------------- SDK simulado
class StubModels:
    """Imita `client.models` do SDK: respostas em fila (objeto, exceção ou função)."""

    def __init__(self) -> None:
        self.embed_calls: list[tuple[str, list[str], types.EmbedContentConfig]] = []
        self.generate_calls: list[tuple[str, list, types.GenerateContentConfig]] = []
        self.stream_calls: list[tuple[str, list, types.GenerateContentConfig]] = []
        self.embed_queue: list = []
        self.generate_queue: list = []
        self.stream_queue: list = []

    @staticmethod
    def _next(queue: list, *args):
        item = queue.pop(0) if len(queue) > 1 else queue[0]
        if callable(item) and not isinstance(item, BaseException):
            item = item(*args)
        if isinstance(item, BaseException):
            raise item
        return item

    def embed_content(self, *, model, contents, config):
        self.embed_calls.append((model, list(contents), config))
        return self._next(self.embed_queue, list(contents), config)

    def generate_content(self, *, model, contents, config):
        self.generate_calls.append((model, contents, config))
        return self._next(self.generate_queue, contents, config)

    def generate_content_stream(self, *, model, contents, config):
        self.stream_calls.append((model, contents, config))
        item = self._next(self.stream_queue, contents, config)
        return iter(item)


class StubClient:
    def __init__(self) -> None:
        self.models = StubModels()


def embed_response(n: int, *, dims: int = DIMS, token_count: int | None = None):
    embs = []
    for i in range(n):
        values = [2.0 * (i + 1)] + [1.0] * (dims - 1)  # não normalizado de propósito
        stats = (
            types.ContentEmbeddingStatistics(token_count=token_count)
            if token_count is not None
            else None
        )
        embs.append(types.ContentEmbedding(values=values, statistics=stats))
    return types.EmbedContentResponse(embeddings=embs)


def gen_response(
    text: str | None,
    *,
    finish=types.FinishReason.STOP,
    prompt: int = 10,
    candidates_tokens: int = 5,
    thoughts: int = 2,
    block=None,
    usage: bool = True,
):
    candidates = []
    if text is not None:
        content = types.Content(
            role="model", parts=[types.Part.from_text(text=text)] if text != "" else []
        )
        candidates = [types.Candidate(content=content, finish_reason=finish)]
    return types.GenerateContentResponse(
        candidates=candidates,
        usage_metadata=types.GenerateContentResponseUsageMetadata(
            prompt_token_count=prompt,
            candidates_token_count=candidates_tokens,
            thoughts_token_count=thoughts,
        )
        if usage
        else None,
        prompt_feedback=types.GenerateContentResponsePromptFeedback(block_reason=block)
        if block
        else None,
        model_version="gemini-3.5-flash-lite",
    )


def api_error(code: int, status: str, message: str = "erro simulado"):
    cls = genai_errors.ServerError if code >= 500 else genai_errors.ClientError
    return cls(code, {"error": {"code": code, "status": status, "message": message}})


@pytest.fixture
def sleeps(monkeypatch) -> list[float]:
    monkeypatch.setattr(settings, "llm_max_retries", 2)
    monkeypatch.setattr(settings, "provider_retry_base_seconds", 0.01)
    monkeypatch.setattr(settings, "provider_retry_max_seconds", 0.05)
    return []


def embedder(client: StubClient, sleeps: list[float], **kw) -> GeminiEmbeddingProvider:
    return GeminiEmbeddingProvider(
        api_key=NOT_A_KEY,
        model="gemini-embedding-001",
        dimensions=DIMS,
        client=client,
        sleep=sleeps.append,
        **kw,
    )


def llm(client: StubClient, sleeps: list[float], **kw) -> GeminiLLMProvider:
    kw.setdefault("thinking_level", None)
    kw.setdefault("apply_temperature", False)
    return GeminiLLMProvider(
        api_key=NOT_A_KEY, model="gemini-3.5-flash-lite", client=client, sleep=sleeps.append, **kw
    )


# ----------------------------------------------------------------------------- embeddings
def test_embed_texts_uses_document_task_fixed_dimension_and_normalizes(sleeps):
    client = StubClient()
    client.models.embed_queue = [lambda contents, cfg: embed_response(len(contents))]
    result = embedder(client, sleeps).embed_texts(["trecho um", "trecho dois"])

    assert len(client.models.embed_calls) == 1
    model, contents, config = client.models.embed_calls[0]
    assert model == "gemini-embedding-001"
    assert contents == ["trecho um", "trecho dois"]
    assert config.task_type == "RETRIEVAL_DOCUMENT"
    assert config.output_dimensionality == DIMS
    assert result.dimensions == DIMS and result.model == "gemini-embedding-001"
    assert result.provider == "gemini"
    assert [len(v) for v in result.vectors] == [DIMS, DIMS]
    for v in result.vectors:
        assert math.isclose(math.sqrt(sum(x * x for x in v)), 1.0, rel_tol=1e-9)
    assert result.extra["task_type"] == "RETRIEVAL_DOCUMENT"


def test_embed_query_uses_query_task(sleeps):
    client = StubClient()
    client.models.embed_queue = [lambda contents, cfg: embed_response(len(contents))]
    result = embedder(client, sleeps).embed_query("qual o prazo?")
    assert client.models.embed_calls[0][2].task_type == "RETRIEVAL_QUERY"
    assert len(result.vectors) == 1 and len(result.vectors[0]) == DIMS


def test_embed_splits_batches_at_api_limit(sleeps):
    client = StubClient()
    client.models.embed_queue = [lambda contents, cfg: embed_response(len(contents))]
    result = embedder(client, sleeps).embed_texts([f"t{i}" for i in range(150)])
    sizes = [len(c[1]) for c in client.models.embed_calls]
    assert sizes == [100, 50]
    assert len(result.vectors) == 150 and result.extra["requests"] == 2


def test_embed_token_count_official_when_provider_reports_it(sleeps):
    client = StubClient()
    client.models.embed_queue = [lambda contents, cfg: embed_response(len(contents), token_count=7)]
    result = embedder(client, sleeps).embed_texts(["a", "b", "c"])
    assert result.prompt_tokens == 21
    assert result.extra["tokens_source"] == "provider"


def test_embed_token_count_marked_as_estimate_when_absent(sleeps):
    client = StubClient()
    client.models.embed_queue = [lambda contents, cfg: embed_response(len(contents))]
    result = embedder(client, sleeps).embed_texts(["um texto razoavelmente longo para contar"])
    assert result.prompt_tokens > 0
    assert result.extra["tokens_source"] == "estimated_local"


def test_embed_wrong_dimension_is_an_invalid_request(sleeps):
    client = StubClient()
    client.models.embed_queue = [lambda contents, cfg: embed_response(len(contents), dims=5)]
    with pytest.raises(ProviderInvalidRequestError) as exc:
        embedder(client, sleeps).embed_texts(["x"])
    assert "dimensão" in exc.value.message


def test_embed_mismatched_count_is_empty_response(sleeps):
    client = StubClient()
    client.models.embed_queue = [lambda contents, cfg: embed_response(1)]
    with pytest.raises(ProviderEmptyResponseError):
        embedder(client, sleeps).embed_texts(["x", "y"])


def test_l2_normalize_rejects_zero_vector():
    with pytest.raises(ProviderEmptyResponseError):
        l2_normalize([0.0, 0.0])
    assert l2_normalize([3.0, 4.0]) == [0.6, 0.8]


# ----------------------------------------------------------------------------- erros/retries
def test_quota_error_is_retried_then_raised_as_quota(sleeps):
    client = StubClient()
    client.models.embed_queue = [api_error(429, "RESOURCE_EXHAUSTED", "quota exceeded")]
    with pytest.raises(ProviderQuotaError) as exc:
        embedder(client, sleeps).embed_texts(["x"])
    assert len(client.models.embed_calls) == 3  # 1 + LLM_MAX_RETRIES
    assert len(sleeps) == 2
    assert exc.value.retryable is True
    assert exc.value.status_code == 503 and exc.value.code == "ai_quota_exceeded"
    assert "limite" in exc.value.message.lower()
    assert "quota exceeded" not in exc.value.message  # detalhe do fornecedor fica só no log


def test_transient_server_error_recovers_on_retry(sleeps):
    client = StubClient()
    client.models.embed_queue = [
        api_error(503, "UNAVAILABLE"),
        lambda contents, cfg: embed_response(len(contents)),
    ]
    result = embedder(client, sleeps).embed_texts(["x"])
    assert len(result.vectors) == 1
    assert len(client.models.embed_calls) == 2 and len(sleeps) == 1


@pytest.mark.parametrize(
    "error",
    [
        api_error(400, "INVALID_ARGUMENT", "API key not valid. Please pass a valid API key."),
        api_error(403, "PERMISSION_DENIED", "permission denied"),
        api_error(401, "UNAUTHENTICATED"),
    ],
)
def test_auth_errors_are_not_retried(sleeps, error):
    client = StubClient()
    client.models.embed_queue = [error]
    with pytest.raises(ProviderAuthError) as exc:
        embedder(client, sleeps).embed_texts(["x"])
    assert len(client.models.embed_calls) == 1 and sleeps == []
    assert exc.value.retryable is False


def test_model_not_found_is_not_retried(sleeps):
    client = StubClient()
    client.models.generate_queue = [api_error(404, "NOT_FOUND", "model not found")]
    with pytest.raises(ProviderModelUnavailableError):
        llm(client, sleeps).generate([LLMMessage("user", "oi")], max_tokens=10)
    assert len(client.models.generate_calls) == 1


def test_timeout_is_mapped_and_retried(sleeps):
    client = StubClient()
    client.models.generate_queue = [httpx.ReadTimeout("tempo esgotado")]
    with pytest.raises(ProviderTimeoutError):
        llm(client, sleeps).generate([LLMMessage("user", "oi")], max_tokens=10)
    assert len(client.models.generate_calls) == 3


def test_network_error_maps_to_transient():
    assert isinstance(map_error(httpx.ConnectError("sem rede")), ProviderTransientError)
    assert isinstance(map_error(api_error(500, "INTERNAL")), ProviderTransientError)
    assert isinstance(map_error(api_error(400, "FAILED_PRECONDITION")), ProviderInvalidRequestError)
    assert isinstance(map_error(api_error(504, "DEADLINE_EXCEEDED")), ProviderTimeoutError)


def test_backoff_delay_is_exponential_with_jitter_and_capped(monkeypatch):
    monkeypatch.setattr(settings, "provider_retry_base_seconds", 1.0)
    monkeypatch.setattr(settings, "provider_retry_max_seconds", 5.0)
    assert backoff_delay(1, rng=lambda: 0.0) == 0.5
    assert backoff_delay(1, rng=lambda: 1.0) == 1.0
    assert backoff_delay(3, rng=lambda: 1.0) == 4.0
    assert backoff_delay(10, rng=lambda: 1.0) == 5.0  # teto


# ----------------------------------------------------------------------------- conversão
def test_convert_messages_separates_system_and_maps_roles():
    system, contents = convert_messages(
        [
            LLMMessage("system", "Regra 1"),
            LLMMessage("system", "Regra 2"),
            LLMMessage("user", "Pergunta anterior"),
            LLMMessage("assistant", "Resposta anterior [1]"),
            LLMMessage("user", 'EVIDÊNCIAS <trecho id="1">texto</trecho>'),
            LLMMessage("user", "Pergunta atual"),
        ]
    )
    assert system == "Regra 1\n\nRegra 2"
    assert [c.role for c in contents] == ["user", "model", "user"]
    assert contents[1].parts[0].text == "Resposta anterior [1]"
    # turnos consecutivos do mesmo papel viram partes do mesmo turno; o documento fica no `user`
    assert [p.text for p in contents[2].parts] == [
        'EVIDÊNCIAS <trecho id="1">texto</trecho>',
        "Pergunta atual",
    ]
    assert "trecho" not in system


def test_convert_messages_requires_user_turn_and_fixes_model_first():
    with pytest.raises(ProviderInvalidRequestError):
        convert_messages([LLMMessage("system", "só sistema")])
    _, contents = convert_messages([LLMMessage("assistant", "oi"), LLMMessage("user", "olá")])
    assert [c.role for c in contents] == ["user", "model", "user"]


# ----------------------------------------------------------------------------- geração
def test_generate_sends_config_and_returns_usage(sleeps):
    client = StubClient()
    client.models.generate_queue = [gen_response("Resposta com fonte [1].")]
    provider = llm(client, sleeps)
    result = provider.generate(
        [LLMMessage("system", "Regras"), LLMMessage("user", "Pergunta")],
        max_tokens=321,
        temperature=0.1,
    )
    model, contents, config = client.models.generate_calls[0]
    assert model == "gemini-3.5-flash-lite"
    assert config.system_instruction == "Regras"
    assert config.max_output_tokens == 321
    assert config.temperature is None  # padrão: não envia (recomendação para Gemini 3)
    assert config.thinking_config is None
    assert [c.role for c in contents] == ["user"]
    assert isinstance(result, LLMResult)
    assert result.text == "Resposta com fonte [1]."
    assert result.prompt_tokens == 10
    assert result.completion_tokens == 7  # candidatos + raciocínio
    assert result.finish_reason == "stop"
    assert result.provider == "gemini" and result.model == "gemini-3.5-flash-lite"


def test_generate_honors_temperature_and_thinking_when_enabled(sleeps):
    client = StubClient()
    client.models.generate_queue = [gen_response("ok")]
    llm(client, sleeps, apply_temperature=True, thinking_level="LOW").generate(
        [LLMMessage("user", "Pergunta")], max_tokens=10, temperature=0.3
    )
    config = client.models.generate_calls[0][2]
    assert config.temperature == 0.3
    assert config.thinking_config.thinking_level == "LOW"


def test_generate_max_tokens_keeps_text_with_length_finish(sleeps):
    client = StubClient()
    client.models.generate_queue = [gen_response("parcial", finish=types.FinishReason.MAX_TOKENS)]
    result = llm(client, sleeps).generate([LLMMessage("user", "p")], max_tokens=5)
    assert result.text == "parcial" and result.finish_reason == "length"


def test_generate_empty_response_raises(sleeps):
    client = StubClient()
    client.models.generate_queue = [gen_response("")]
    with pytest.raises(ProviderEmptyResponseError):
        llm(client, sleeps).generate([LLMMessage("user", "p")], max_tokens=5)


def test_generate_blocked_prompt_and_blocked_candidate(sleeps):
    client = StubClient()
    client.models.generate_queue = [gen_response(None, block=types.BlockedReason.SAFETY)]
    with pytest.raises(ProviderBlockedError):
        llm(client, sleeps).generate([LLMMessage("user", "p")], max_tokens=5)
    client.models.generate_queue = [gen_response("", finish=types.FinishReason.SAFETY)]
    with pytest.raises(ProviderBlockedError):
        llm(client, sleeps).generate([LLMMessage("user", "p")], max_tokens=5)


def test_generate_quota_after_retries(sleeps):
    client = StubClient()
    client.models.generate_queue = [api_error(429, "RESOURCE_EXHAUSTED")]
    with pytest.raises(ProviderQuotaError):
        llm(client, sleeps).generate([LLMMessage("user", "p")], max_tokens=5)
    assert len(client.models.generate_calls) == 3


# ----------------------------------------------------------------------------- streaming
def test_stream_yields_real_deltas_then_result(sleeps):
    client = StubClient()
    chunks = [
        gen_response("Olá ", usage=False),
        gen_response("mundo ", usage=False),
        gen_response("[1]", prompt=12, candidates_tokens=6, thoughts=1),
    ]
    client.models.stream_queue = [chunks]
    events = list(llm(client, sleeps).stream([LLMMessage("user", "p")], max_tokens=50))
    assert events[:-1] == ["Olá ", "mundo ", "[1]"]
    final = events[-1]
    assert isinstance(final, LLMResult)
    assert final.text == "Olá mundo [1]"
    assert final.prompt_tokens == 12 and final.completion_tokens == 7
    assert final.finish_reason == "stop"
    assert client.models.stream_calls[0][2].max_output_tokens == 50


def test_stream_retries_when_opening_fails(sleeps):
    client = StubClient()
    client.models.stream_queue = [api_error(503, "UNAVAILABLE"), [gen_response("ok")]]
    events = list(llm(client, sleeps).stream([LLMMessage("user", "p")], max_tokens=5))
    assert events[0] == "ok" and isinstance(events[-1], LLMResult)
    assert len(client.models.stream_calls) == 2 and len(sleeps) == 1


def test_stream_error_after_first_delta_is_mapped_not_retried(sleeps):
    def broken(contents, config):
        yield gen_response("começo ", usage=False)
        raise api_error(429, "RESOURCE_EXHAUSTED")

    client = StubClient()
    client.models.stream_queue = [broken]
    received = []
    with pytest.raises(ProviderQuotaError):
        for item in llm(client, sleeps).stream([LLMMessage("user", "p")], max_tokens=5):
            received.append(item)
    assert received == ["começo "]
    assert len(client.models.stream_calls) == 1


def test_stream_without_text_is_empty_or_blocked(sleeps):
    client = StubClient()
    client.models.stream_queue = [[gen_response("", finish=types.FinishReason.STOP)]]
    with pytest.raises(ProviderEmptyResponseError):
        list(llm(client, sleeps).stream([LLMMessage("user", "p")], max_tokens=5))


# ----------------------------------------------------------------------------- citações
def test_citations_from_gemini_output_are_validated_structurally():
    import uuid

    from app.rag.generation import validate_citations
    from app.rag.retrieval.service import RetrievedChunk

    chunk = RetrievedChunk(
        chunk_id=uuid.uuid4(),
        document_id=uuid.uuid4(),
        document_name="contrato.pdf",
        text="O prazo é de 45 dias.",
        score=0.9,
        page_start=4,
        page_end=4,
        section_title=None,
        position=0,
        token_count=8,
    )
    validation = validate_citations("O prazo é de 45 dias [1]. Veja também [7] e [12].", {1: chunk})
    assert validation.cited_indices == [1]
    assert sorted(validation.invalid_indices) == [7, 12]
    assert "[7]" not in validation.text and "[12]" not in validation.text


# ----------------------------------------------------------------------------- configuração
def test_ai_configured_requires_key_of_each_selected_provider(monkeypatch):
    monkeypatch.setattr(settings, "embedding_provider", "gemini")
    monkeypatch.setattr(settings, "llm_provider", "gemini")
    monkeypatch.setattr(settings, "gemini_api_key", None)
    monkeypatch.setattr(settings, "openai_api_key", None)
    assert settings.ai_configured is False
    assert settings.missing_ai_configuration == ["GEMINI_API_KEY"]

    monkeypatch.setattr(settings, "gemini_api_key", NOT_A_KEY)
    assert settings.ai_configured is True
    assert settings.missing_ai_configuration == []

    # só um dos dois provedores obrigatórios com chave => não está configurado
    monkeypatch.setattr(settings, "llm_provider", "openai")
    assert settings.ai_configured is False
    assert settings.missing_ai_configuration == ["OPENAI_API_KEY"]

    monkeypatch.setattr(settings, "embedding_provider", "fake")
    monkeypatch.setattr(settings, "llm_provider", "fake")
    assert settings.ai_configured is False and settings.using_fake_ai is True
    assert settings.missing_ai_configuration == []


def test_factories_build_gemini_providers_and_report_missing_key(monkeypatch):
    monkeypatch.setattr(settings, "embedding_provider", "gemini")
    monkeypatch.setattr(settings, "llm_provider", "gemini")
    monkeypatch.setattr(settings, "embedding_model", "gemini-embedding-001")
    monkeypatch.setattr(settings, "llm_model", "gemini-3.5-flash-lite")
    monkeypatch.setattr(settings, "gemini_api_key", None)
    with pytest.raises(AIUnavailableError) as exc:
        embeddings_module.build_embedding_provider()
    assert "GEMINI_API_KEY" in exc.value.message
    with pytest.raises(AIUnavailableError) as exc:
        build_llm_provider()
    assert "GEMINI_API_KEY" in exc.value.message

    monkeypatch.setattr(settings, "gemini_api_key", NOT_A_KEY)
    monkeypatch.setattr(gemini, "make_client", lambda api_key, **kw: StubClient())
    emb = embeddings_module.build_embedding_provider()
    assert isinstance(emb, GeminiEmbeddingProvider)
    assert emb.model == "gemini-embedding-001" and emb.dimensions == settings.embedding_dimensions
    chat = build_llm_provider()
    assert isinstance(chat, GeminiLLMProvider) and chat.model == "gemini-3.5-flash-lite"
    alt = build_llm_provider("gemini-3.1-flash-lite")
    assert alt.model == "gemini-3.1-flash-lite"


def test_ai_status_labels_and_notice_for_gemini(monkeypatch):
    from app.services.system import ai_status

    monkeypatch.setattr(settings, "embedding_provider", "gemini")
    monkeypatch.setattr(settings, "llm_provider", "gemini")
    monkeypatch.setattr(settings, "embedding_model", "gemini-embedding-001")
    monkeypatch.setattr(settings, "llm_model", "gemini-3.5-flash-lite")
    monkeypatch.setattr(settings, "gemini_api_key", NOT_A_KEY)
    status = ai_status()
    assert status["configured"] is True
    assert status["provider_label"] == "Google Gemini"
    assert status["llm_model_label"] == "Gemini 3.5 Flash-Lite"
    assert status["embedding_model_label"] == "Gemini Embedding 001"
    assert "Google Gemini" in status["notice"] and "nível gratuito" in status["notice"]
    assert NOT_A_KEY not in str(status)

    monkeypatch.setattr(settings, "gemini_api_key", None)
    status = ai_status()
    assert status["configured"] is False
    assert status["missing_configuration"] == ["GEMINI_API_KEY"]
    assert "GEMINI_API_KEY" in status["notice"] and "OPENAI" not in status["notice"]
