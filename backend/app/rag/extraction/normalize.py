"""Normalização de texto extraído.

Objetivos:
- Remover caracteres de controle e normalizar Unicode (NFC).
- Corrigir hifenização de fim de linha comum em PDFs ("contra-\\nto" → "contrato").
- Reconstituir parágrafos: o pypdf emite uma quebra por linha visual; linhas que continuam a
  frase são unidas, enquanto fins de parágrafo, títulos e itens de lista preservam a quebra.
"""

from __future__ import annotations

import re
import unicodedata

_CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_HYPHEN_BREAK_RE = re.compile(r"(\w)-\n(\w)")
_MULTI_SPACE_RE = re.compile("[ \\t\\u00a0]+")
_MULTI_NEWLINE_RE = re.compile(r"\n{3,}")
_SENTENCE_END = (".", "!", "?", ":", ";")
_LIST_OR_HEADING_START_RE = re.compile(
    r"^(\d+(\.\d+)*[.)]\s|[a-zA-Z][.)]\s|[-\u2022*\u2013]\s|cl[\u00e1a]usula\b|cap[\u00edi]tulo\b|se[\u00e7c][\u00e3a]o\b"
    r"|artigo\b|art\.\s|anexo\b)",
    re.IGNORECASE,
)


def _looks_like_heading(line: str) -> bool:
    stripped = line.strip()
    if not stripped or len(stripped) > 120:
        return False
    letters = [c for c in stripped if c.isalpha()]
    words = len(stripped.split())
    if letters and sum(c.isupper() for c in letters) / len(letters) > 0.85 and words <= 12:
        return True
    return bool(_LIST_OR_HEADING_START_RE.match(stripped)) and words <= 14


def _reflow(lines: list[str]) -> str:
    """Une linhas que continuam o mesmo parágrafo; mantém quebras estruturais."""
    non_empty = [ln for ln in lines if ln.strip()]
    if not non_empty:
        return ""
    typical = sorted(len(ln) for ln in non_empty)[len(non_empty) // 2]  # mediana
    out: list[str] = []
    buffer = ""
    for i, raw in enumerate(lines):
        line = raw.strip()
        if not line:
            if buffer:
                out.append(buffer)
                buffer = ""
            if out and out[-1] != "":
                out.append("")
            continue
        buffer = f"{buffer} {line}" if buffer else line
        nxt = lines[i + 1].strip() if i + 1 < len(lines) else ""
        ends_sentence = line.endswith(_SENTENCE_END)
        short_line = len(line) < max(20, int(typical * 0.6))
        breaks = (
            not nxt
            or ends_sentence
            or short_line
            or _looks_like_heading(line)
            or _looks_like_heading(nxt)
        )
        if breaks:
            out.append(buffer)
            buffer = ""
    if buffer:
        out.append(buffer)
    text = "\n".join(out)
    return _MULTI_NEWLINE_RE.sub("\n\n", text).strip()


def normalize_page_text(text: str) -> str:
    if not text:
        return ""
    text = unicodedata.normalize("NFC", text)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = _CONTROL_RE.sub("", text)
    text = _HYPHEN_BREAK_RE.sub(r"\1\2", text)
    text = _MULTI_SPACE_RE.sub(" ", text)
    return _reflow(text.split("\n"))
