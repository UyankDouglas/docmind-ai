"""Provedores de modelo de linguagem.

O modelo recebe apenas: instruções do sistema, evidências delimitadas e a pergunta.
Nenhuma ferramenta de execução é exposta ao modelo.
"""

from __future__ import annotations

import re
import time
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


_provider: LLMProvider | None = None


def get_llm_provider() -> LLMProvider:
    global _provider
    if _provider is not None:
        return _provider
    if settings.llm_provider == "fake":
        _provider = FakeLLMProvider()
    else:
        if not settings.openai_api_key:
            raise AIUnavailableError(
                "Provedor de linguagem não configurado: defina OPENAI_API_KEY "
                "ou LLM_PROVIDER=fake para desenvolvimento."
            )
        _provider = OpenAILLMProvider(
            api_key=settings.openai_api_key,
            model=settings.llm_model,
            base_url=settings.openai_base_url,
        )
    return _provider


def set_llm_provider(provider: LLMProvider | None) -> None:
    global _provider
    _provider = provider
