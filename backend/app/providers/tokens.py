"""Contagem de tokens.

Usa tiktoken (cl100k_base) por padrão. Quando o encoder não está disponível,
usa uma aproximação explícita (não trata caracteres como tokens exatos).
"""

from __future__ import annotations

from functools import lru_cache

try:  # pragma: no cover - depende do ambiente
    import tiktoken
except Exception:  # pragma: no cover
    tiktoken = None  # type: ignore[assignment]


@lru_cache(maxsize=4)
def _encoder(name: str = "cl100k_base"):
    if tiktoken is None:
        return None
    try:
        return tiktoken.get_encoding(name)
    except Exception:  # pragma: no cover - sem cache local do encoder
        return None


class TokenCounter:
    def __init__(self, encoding_name: str = "cl100k_base") -> None:
        self._enc = _encoder(encoding_name)
        self.encoding_name = encoding_name if self._enc is not None else "approx-chars/4"

    @property
    def exact(self) -> bool:
        return self._enc is not None

    def count(self, text: str) -> int:
        if not text:
            return 0
        if self._enc is not None:
            return len(self._enc.encode(text, disallowed_special=()))
        # Aproximação conservadora para pt-BR (~3.5 chars/token)
        return max(1, int(len(text) / 3.5))

    def encode(self, text: str) -> list[int]:
        if self._enc is None:
            raise RuntimeError("Encoder de tokens indisponível")
        return self._enc.encode(text, disallowed_special=())

    def decode(self, tokens: list[int]) -> str:
        if self._enc is None:
            raise RuntimeError("Encoder de tokens indisponível")
        return self._enc.decode(tokens)


_default = TokenCounter()


def count_tokens(text: str) -> int:
    return _default.count(text)


def get_token_counter() -> TokenCounter:
    return _default
