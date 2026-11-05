"""Provedores de embeddings.

Interface única (`EmbeddingProvider`) com três implementações:
- GeminiEmbeddingProvider (`app.providers.gemini`): Google Gemini API, padrão do projeto.
- OpenAIEmbeddingProvider: chamada real à API da OpenAI.
- FakeEmbeddingProvider: determinístico, baseado em *feature hashing* de palavras; usado apenas
  em testes automatizados e em desenvolvimento sem chave. Nunca deve ser apresentado como IA real.
O modelo e a dimensão vêm de variáveis de ambiente (EMBEDDING_MODEL, EMBEDDING_DIMENSIONS).
"""

from __future__ import annotations

import hashlib
import itertools
import math
import re
import time
from dataclasses import dataclass, field
from typing import Protocol

from app.core.config import PROVIDER_KEY_ENV, settings
from app.core.exceptions import AIUnavailableError
from app.core.logging import get_logger

log = get_logger(__name__)


@dataclass(slots=True)
class EmbeddingResult:
    vectors: list[list[float]]
    model: str
    dimensions: int
    prompt_tokens: int
    latency_ms: int
    provider: str
    # Metadados sem conteúdo: task_type, origem da contagem de tokens ("provider" ou
    # "estimated_local"), caracteres faturáveis, número de requisições.
    extra: dict = field(default_factory=dict)


class EmbeddingProvider(Protocol):
    name: str
    model: str
    dimensions: int

    def embed_texts(self, texts: list[str]) -> EmbeddingResult: ...

    def embed_query(self, text: str) -> EmbeddingResult: ...


class EmbeddingDimensionError(RuntimeError):
    pass


def validate_dimensions(vectors: list[list[float]], expected: int) -> None:
    for i, v in enumerate(vectors):
        if len(v) != expected:
            raise EmbeddingDimensionError(
                f"Embedding {i} possui {len(v)} dimensões; esperado {expected}. "
                "Verifique EMBEDDING_MODEL/EMBEDDING_DIMENSIONS e reindexe."
            )


class OpenAIEmbeddingProvider:
    name = "openai"

    def __init__(self, *, api_key: str, model: str, dimensions: int, base_url: str | None = None):
        from openai import OpenAI

        self.model = model
        self.dimensions = dimensions
        self._client = OpenAI(
            api_key=api_key,
            base_url=base_url,
            timeout=settings.llm_timeout_seconds,
            max_retries=settings.llm_max_retries,
        )

    def embed_texts(self, texts: list[str]) -> EmbeddingResult:
        if not texts:
            return EmbeddingResult([], self.model, self.dimensions, 0, 0, self.name)
        started = time.perf_counter()
        # Modelos text-embedding-3 aceitam `dimensions`; outros ignoram ou rejeitam o parâmetro.
        kwargs: dict = {"model": self.model, "input": texts}
        if "text-embedding-3" in self.model:
            kwargs["dimensions"] = self.dimensions
        resp = self._client.embeddings.create(**kwargs)
        vectors = [list(d.embedding) for d in sorted(resp.data, key=lambda d: d.index)]
        validate_dimensions(vectors, self.dimensions)
        usage_tokens = getattr(getattr(resp, "usage", None), "prompt_tokens", 0) or 0
        latency = int((time.perf_counter() - started) * 1000)
        return EmbeddingResult(
            vectors,
            self.model,
            self.dimensions,
            usage_tokens,
            latency,
            self.name,
            extra={"tokens_source": "provider"},
        )

    def embed_query(self, text: str) -> EmbeddingResult:
        return self.embed_texts([text])


_WORD_RE = re.compile(r"[\wÀ-ÿ]+", re.UNICODE)


class FakeEmbeddingProvider:
    """Embedding determinístico por *hashing* de palavras (bag-of-words esparso + bigramas).

    Textos que compartilham vocabulário obtêm maior similaridade cosseno, o que é suficiente
    para testar recuperação, filtros e citações de forma reprodutível e sem rede.
    """

    name = "fake"

    def __init__(self, dimensions: int | None = None, model: str = "fake-hash-v1") -> None:
        self.dimensions = dimensions or settings.embedding_dimensions
        self.model = model

    def _vector(self, text: str) -> list[float]:
        vec = [0.0] * self.dimensions
        words = [w.lower() for w in _WORD_RE.findall(text)]
        words = [w for w in words if len(w) > 2]
        feats = list(words) + [f"{a}_{b}" for a, b in itertools.pairwise(words)]
        for f in feats:
            h = hashlib.blake2b(f.encode("utf-8"), digest_size=8).digest()
            idx = int.from_bytes(h[:4], "little") % self.dimensions
            sign = 1.0 if h[4] % 2 == 0 else -1.0
            vec[idx] += sign
        norm = math.sqrt(sum(x * x for x in vec))
        if norm == 0:
            vec[0] = 1.0
            return vec
        return [x / norm for x in vec]

    def embed_texts(self, texts: list[str]) -> EmbeddingResult:
        started = time.perf_counter()
        vectors = [self._vector(t) for t in texts]
        validate_dimensions(vectors, self.dimensions)
        tokens = sum(max(1, len(t) // 4) for t in texts)
        return EmbeddingResult(
            vectors,
            self.model,
            self.dimensions,
            tokens,
            int((time.perf_counter() - started) * 1000),
            self.name,
            extra={"tokens_source": "estimated_local"},
        )

    def embed_query(self, text: str) -> EmbeddingResult:
        return self.embed_texts([text])


def unconfigured_message(kind: str, provider: str) -> str:
    env_name = PROVIDER_KEY_ENV.get(provider, "a chave do provedor")
    label = "embeddings" if kind == "embedding" else "linguagem"
    flag = "EMBEDDING_PROVIDER" if kind == "embedding" else "LLM_PROVIDER"
    return (
        f"Provedor de {label} não configurado: defina {env_name} "
        f"ou {flag}=fake para desenvolvimento."
    )


def build_embedding_provider() -> EmbeddingProvider:
    """Constrói o provedor configurado (sem cache). Levanta 503 quando falta a chave."""
    provider = settings.embedding_provider
    if provider == "fake":
        return FakeEmbeddingProvider()
    api_key = settings.provider_api_key(provider)
    if not api_key:
        raise AIUnavailableError(unconfigured_message("embedding", provider))
    if provider == "gemini":
        from app.providers.gemini import GeminiEmbeddingProvider

        return GeminiEmbeddingProvider(
            api_key=api_key,
            model=settings.embedding_model,
            dimensions=settings.embedding_dimensions,
        )
    return OpenAIEmbeddingProvider(
        api_key=api_key,
        model=settings.embedding_model,
        dimensions=settings.embedding_dimensions,
        base_url=settings.openai_base_url,
    )


_provider: EmbeddingProvider | None = None


def get_embedding_provider() -> EmbeddingProvider:
    global _provider
    if _provider is None:
        _provider = build_embedding_provider()
    return _provider


def set_embedding_provider(provider: EmbeddingProvider | None) -> None:
    global _provider
    _provider = provider
