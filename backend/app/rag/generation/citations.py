"""Validação estrutural de citações.

Garante que todo marcador [n] na resposta corresponda a um trecho realmente enviado como contexto.
Marcadores inválidos são removidos do texto. As referências finais são geradas pelo backend a
partir dos metadados dos chunks — nunca pelo modelo.

Limitação (documentada): esta validação é estrutural. Ela não comprova que cada afirmação é
sustentada pelo trecho citado; isso é objeto da avaliação de qualidade (rag/evaluation).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from app.rag.retrieval.service import RetrievedChunk

_CITATION_RE = re.compile(r"\[(\d{1,3})\]")
_CITATION_GROUP_RE = re.compile(r"\[(\d{1,3}(?:\s*,\s*\d{1,3})+)\]")

NO_EVIDENCE_ANSWER = "Não encontrei informações suficientes nos documentos selecionados para responder com segurança."


@dataclass(slots=True)
class CitationValidation:
    text: str
    cited_indices: list[int]  # ordem de primeira aparição, apenas válidos
    invalid_indices: list[int]
    chunks_by_index: dict[int, RetrievedChunk] = field(default_factory=dict)
    looks_like_abstention: bool = False

    @property
    def has_valid_citations(self) -> bool:
        return bool(self.cited_indices)


def _expand_groups(text: str) -> str:
    """Transforma [1, 2] em [1][2] para simplificar a validação."""

    def repl(m: re.Match[str]) -> str:
        return "".join(f"[{n.strip()}]" for n in m.group(1).split(","))

    return _CITATION_GROUP_RE.sub(repl, text)


def validate_citations(answer: str, context_ids: dict[int, RetrievedChunk]) -> CitationValidation:
    text = _expand_groups(answer or "")
    valid: list[int] = []
    invalid: list[int] = []
    for m in _CITATION_RE.finditer(text):
        n = int(m.group(1))
        if n in context_ids:
            if n not in valid:
                valid.append(n)
        elif n not in invalid:
            invalid.append(n)

    if invalid:
        for n in invalid:
            text = re.sub(rf"\s?\[{n}\]", "", text)
        text = re.sub(r"[ \t]{2,}", " ", text).strip()

    looks_like_abstention = _is_abstention(text)
    return CitationValidation(
        text=text,
        cited_indices=valid,
        invalid_indices=invalid,
        chunks_by_index={n: context_ids[n] for n in valid},
        looks_like_abstention=looks_like_abstention,
    )


def _is_abstention(text: str) -> bool:
    lowered = text.lower()
    markers = (
        "não encontrei informações suficientes",
        "não há informações suficientes",
        "não foi possível encontrar",
        "os documentos não contêm",
        "não consta nos documentos",
    )
    return any(m in lowered for m in markers)
