"""Provedores de modelo de linguagem.

O modelo recebe apenas: instruções do sistema, evidências delimitadas e a pergunta.
Nenhuma ferramenta de execução é exposta ao modelo.

Implementações: `GeminiLLMProvider` (`app.providers.gemini`, padrão), `OpenAILLMProvider` e
`FakeLLMProvider` (determinístico, só testes). O modelo vem de LLM_MODEL ou da escolha do
workspace dentro de LLM_ALLOWED_MODELS.
"""

from __future__ import annotations

import re
import time
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Protocol

from app.core.config import settings
from app.core.exceptions import AIUnavailableError
from app.core.logging import get_logger

log = get_logger(__name__)


@dataclass(slots=True)
class LLMMessage:
    role: str  # "system" | "user" | "assistant"
    content: str


@dataclass(slots=True)
class LLMResult:
    text: str
    model: str
    prompt_tokens: int
    completion_tokens: int
    latency_ms: int
    provider: str
    finish_reason: str | None = None


class LLMProvider(Protocol):
    name: str
    model: str

    def generate(
        self, messages: list[LLMMessage], *, max_tokens: int, temperature: float = 0.1
    ) -> LLMResult: ...

    def stream(
        self, messages: list[LLMMessage], *, max_tokens: int, temperature: float = 0.1
    ) -> Iterator[str | LLMResult]:
        """Gera deltas de texto (str) e, por último, um LLMResult com o texto completo e o uso."""
        ...


class OpenAILLMProvider:
    name = "openai"

    def __init__(self, *, api_key: str, model: str, base_url: str | None = None) -> None:
        from openai import OpenAI

        self.model = model
        self._client = OpenAI(
            api_key=api_key,
            base_url=base_url,
            timeout=settings.llm_timeout_seconds,
            max_retries=settings.llm_max_retries,
        )

    def generate(
        self, messages: list[LLMMessage], *, max_tokens: int, temperature: float = 0.1
    ) -> LLMResult:
        started = time.perf_counter()
        resp = self._client.chat.completions.create(
            model=self.model,
            messages=[{"role": m.role, "content": m.content} for m in messages],  # type: ignore[misc]
            max_completion_tokens=max_tokens,
            temperature=temperature,
        )
        choice = resp.choices[0]
        text = (choice.message.content or "").strip()
        usage = resp.usage
        return LLMResult(
            text=text,
            model=resp.model or self.model,
            prompt_tokens=getattr(usage, "prompt_tokens", 0) or 0,
            completion_tokens=getattr(usage, "completion_tokens", 0) or 0,
            latency_ms=int((time.perf_counter() - started) * 1000),
            provider=self.name,
            finish_reason=choice.finish_reason,
        )

    def stream(
        self, messages: list[LLMMessage], *, max_tokens: int, temperature: float = 0.1
    ) -> Iterator[str | LLMResult]:
        started = time.perf_counter()
        parts: list[str] = []
        usage = None
        model = self.model
        finish_reason = None
        stream = self._client.chat.completions.create(
            model=self.model,
            messages=[{"role": m.role, "content": m.content} for m in messages],  # type: ignore[misc]
            max_completion_tokens=max_tokens,
            temperature=temperature,
            stream=True,
            stream_options={"include_usage": True},
        )
        try:
            for event in stream:
                delta, usage_ev, model_ev, finish = _parse_stream_event(event)
                if delta:
                    parts.append(delta)
                    yield delta
                if usage_ev is not None:
                    usage = usage_ev
                if model_ev:
                    model = model_ev
                if finish:
                    finish_reason = finish
        finally:
            close = getattr(stream, "close", None)
            if close:
                close()
        yield LLMResult(
            text="".join(parts).strip(),
            model=model,
            prompt_tokens=getattr(usage, "prompt_tokens", 0) or 0,
            completion_tokens=getattr(usage, "completion_tokens", 0) or 0,
            latency_ms=int((time.perf_counter() - started) * 1000),
            provider=self.name,
            finish_reason=finish_reason,
        )


def _parse_stream_event(event):
    """Extrai (delta, usage, model, finish_reason) de um ChatCompletionChunk."""
    # Chunk bruto (ChatCompletionChunk)
    choices = getattr(event, "choices", None)
    if choices is not None:
        delta = ""
        finish = None
        if choices:
            delta = getattr(getattr(choices[0], "delta", None), "content", None) or ""
            finish = getattr(choices[0], "finish_reason", None)
        return delta, getattr(event, "usage", None), getattr(event, "model", None), finish
    # Evento do helper de streaming
    etype = getattr(event, "type", "")
    if etype == "content.delta":
        return getattr(event, "delta", "") or "", None, None, None
    if etype == "chunk":
        chunk = getattr(event, "chunk", None)
        if chunk is not None:
            return _parse_stream_event(chunk)
    return "", None, None, None


_EVIDENCE_RE = re.compile(r"<trecho id=\"(\d+)\"[^>]*>\n?(.*?)\n?</trecho>", re.DOTALL)


class FakeLLMProvider:
    """LLM determinístico para testes.

    Comportamento: se houver evidências no prompt, responde com o início do primeiro trecho e
    cita `[1]` (e `[2]` quando existir). Se não houver evidências, devolve a mensagem de abstenção.
    Permite também respostas roteirizadas via `scripted`.
    """

    name = "fake"

    def __init__(self, model: str = "fake-llm-v1", scripted: list[str] | None = None) -> None:
        self.model = model
        self.scripted = list(scripted or [])
        self.calls: list[list[LLMMessage]] = []

    def generate(
        self, messages: list[LLMMessage], *, max_tokens: int, temperature: float = 0.1
    ) -> LLMResult:
        self.calls.append(messages)
        started = time.perf_counter()
        if self.scripted:
            text = self.scripted.pop(0)
        else:
            prompt = "\n".join(m.content for m in messages)
            evidences = _EVIDENCE_RE.findall(prompt)
            if not evidences:
                text = (
                    "Não encontrei informações suficientes nos documentos selecionados "
                    "para responder com segurança."
                )
            else:
                first_id, first_text = evidences[0]
                excerpt = " ".join(first_text.split())[:280]
                text = f"Com base nos documentos: {excerpt} [{first_id}]"
                if len(evidences) > 1:
                    text += f" Veja também o trecho relacionado [{evidences[1][0]}]."
        prompt_tokens = sum(len(m.content) // 4 for m in messages)
        return LLMResult(
            text=text,
            model=self.model,
            prompt_tokens=prompt_tokens,
            completion_tokens=max(1, len(text) // 4),
            latency_ms=int((time.perf_counter() - started) * 1000),
            provider=self.name,
            finish_reason="stop",
        )

    def stream(
        self, messages: list[LLMMessage], *, max_tokens: int, temperature: float = 0.1
    ) -> Iterator[str | LLMResult]:
        result = self.generate(messages, max_tokens=max_tokens, temperature=temperature)
        words = result.text.split(" ")
        for i, word in enumerate(words):
            yield word if i == len(words) - 1 else word + " "
        yield result


def build_llm_provider(model: str | None = None) -> LLMProvider:
    """Constrói o provedor configurado para `model` (ou o padrão), sem cache."""
    from app.providers.embeddings import unconfigured_message

    provider = settings.llm_provider
    model = model or settings.llm_model
    if provider == "fake":
        return FakeLLMProvider(
            model=f"fake-{model}" if model != settings.llm_model else "fake-llm-v1"
        )
    api_key = settings.provider_api_key(provider)
    if not api_key:
        raise AIUnavailableError(unconfigured_message("llm", provider))
    if provider == "gemini":
        from app.providers.gemini import GeminiLLMProvider

        return GeminiLLMProvider(api_key=api_key, model=model)
    return OpenAILLMProvider(api_key=api_key, model=model, base_url=settings.openai_base_url)


_provider: LLMProvider | None = None
_by_model: dict[str, LLMProvider] = {}


def get_llm_provider(model: str | None = None) -> LLMProvider:
    """Provedor padrão (cacheado) ou um provedor por modelo alternativo permitido ao workspace.

    Quando um provedor foi injetado com `set_llm_provider` (testes), ele vale para qualquer modelo.
    """
    global _provider
    if model and model != settings.llm_model and _provider is None:
        if model not in _by_model:
            _by_model[model] = build_llm_provider(model)
        return _by_model[model]
    if _provider is None:
        _provider = build_llm_provider()
    return _provider


def set_llm_provider(provider: LLMProvider | None) -> None:
    global _provider
    _provider = provider
    _by_model.clear()
