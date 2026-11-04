"""Extração de arquivos de texto (.txt).

- Detecta o encoding (BOM, UTF-8 estrito, depois charset_normalizer; último recurso cp1252 com
  substituição de bytes inválidos — registrado como aviso).
- Preserva quebras de parágrafo; normaliza espaços e caracteres de controle.
- Seções: linhas que parecem títulos (numeração, caixa alta, Markdown `#`) iniciam uma nova seção;
  sem títulos, o texto é dividido em blocos de ~`_MAX_SECTION_CHARS` caracteres em limites de parágrafo
  para manter referências localizáveis ("Trecho N").
"""

from __future__ import annotations

import codecs
import re

from app.rag.extraction.base import ExtractedDocument, ExtractedPage, InvalidDocumentError
from app.rag.extraction.normalize import normalize_page_text

TXT_MIME = "text/plain"
_MAX_SECTION_CHARS = 6000
_MD_HEADING_RE = re.compile(r"^#{1,6}\s+(.+)$")
_NUMBERED_RE = re.compile(r"^(\d+(\.\d+)*[.)]?)\s+(\S.{0,100})$")
_KEYWORD_RE = re.compile(
    r"^(cl[áa]usula|cap[íi]tulo|se[çc][ãa]o|artigo|anexo|t[íi]tulo|parte)\b", re.IGNORECASE
)
_WESTERN_ENCODINGS = {"utf-8", "cp1252", "latin-1", "iso-8859-1", "iso-8859-15", "utf-16", "ascii"}
_WESTERN_LANGUAGES = {"portuguese", "spanish", "french", "italian", "english", "german", "catalan"}
_BOMS = (
    (codecs.BOM_UTF8, "utf-8-sig"),
    (codecs.BOM_UTF16_LE, "utf-16"),
    (codecs.BOM_UTF16_BE, "utf-16"),
)


def decode_text(data: bytes) -> tuple[str, str, list[str]]:
    """Retorna (texto, encoding, avisos)."""
    warnings: list[str] = []
    for bom, enc in _BOMS:
        if data.startswith(bom):
            return data.decode(enc, errors="replace"), enc, warnings
    try:
        return data.decode("utf-8"), "utf-8", warnings
    except UnicodeDecodeError:
        pass
    try:
        from charset_normalizer import from_bytes

        best = from_bytes(data).best()
    except Exception:  # pragma: no cover - dependência opcional
        best = None
    if best is not None and best.encoding:
        encoding = best.encoding.lower().replace("_", "-")
        language = (getattr(best, "language", "") or "").lower()
        western = encoding in _WESTERN_ENCODINGS or language in _WESTERN_LANGUAGES
        if western:
            return str(best), best.encoding, warnings
        # Textos curtos em português são frequentemente confundidos com encodings do leste
        # europeu; se cp1252 decodifica sem erro, é a aposta mais provável para pt-BR.
        try:
            text = data.decode("cp1252")
        except UnicodeDecodeError:
            return str(best), best.encoding, warnings
        warnings.append(
            f"Encoding detectado por heurística (cp1252; alternativa sugerida: {best.encoding})."
        )
        return text, "cp1252", warnings
    warnings.append(
        "Encoding não identificado com segurança; caracteres inválidos foram substituídos."
    )
    return data.decode("cp1252", errors="replace"), "cp1252", warnings


def _heading_label(line: str) -> str | None:
    s = line.strip()
    if not s or len(s) > 120:
        return None
    m = _MD_HEADING_RE.match(s)
    if m:
        return m.group(1).strip()
    words = s.split()
    if _KEYWORD_RE.match(s) and len(words) <= 14:
        return s
    if _NUMBERED_RE.match(s) and len(words) <= 12 and not s.endswith((".", ",", ";")):
        return s
    letters = [c for c in s if c.isalpha()]
    if letters and len(words) <= 10 and sum(c.isupper() for c in letters) / len(letters) > 0.85:
        return s
    return None


class TxtExtractor:
    mime_types = (TXT_MIME,)

    def extract(self, data: bytes, *, max_pages: int | None = None) -> ExtractedDocument:
        if b"\x00" in data[:4096]:
            raise InvalidDocumentError("O arquivo não parece ser texto (contém bytes nulos).")
        text, encoding, warnings = decode_text(data)
        text = text.replace("\r\n", "\n").replace("\r", "\n")
        lines = text.split("\n")

        sections: list[tuple[str | None, list[str]]] = [(None, [])]
        for line in lines:
            label = _heading_label(line)
            if label:
                sections.append((label, [line.strip()]))
            else:
                sections[-1][1].append(line)
        if len(sections) > 1 and not any(ln.strip() for ln in sections[0][1]):
            sections = sections[1:]

        has_headings = any(lbl for lbl, _ in sections)
        if not has_headings:
            sections = _split_by_size("\n".join(sections[0][1]))
            if len(sections) > 1:
                warnings.append(
                    "O texto não possui títulos identificáveis; as referências usarão blocos numerados."
                )

        pages: list[ExtractedPage] = []
        for label, block_lines in sections:
            normalized = normalize_page_text("\n".join(block_lines))
            if not normalized:
                continue
            pages.append(
                ExtractedPage(
                    number=len(pages) + 1, text=normalized, label=label or f"Bloco {len(pages) + 1}"
                )
            )

        if max_pages and len(pages) > max_pages:
            pages = pages[:max_pages]
            warnings.append(f"O texto foi truncado em {max_pages} seções.")

        total = sum(p.char_count for p in pages)
        return ExtractedDocument(
            pages=pages,
            page_count=len(pages),
            char_count=total,
            mime_type=TXT_MIME,
            metadata={"encoding": encoding},
            warnings=warnings,
            has_real_pages=False,
        )


def _split_by_size(text: str) -> list[tuple[str | None, list[str]]]:
    paragraphs = [p for p in re.split(r"\n\s*\n", text)]
    blocks: list[tuple[str | None, list[str]]] = []
    current: list[str] = []
    size = 0
    for para in paragraphs:
        if current and size + len(para) > _MAX_SECTION_CHARS:
            blocks.append((None, ["\n\n".join(current)]))
            current, size = [], 0
        current.append(para)
        size += len(para)
    if current:
        blocks.append((None, ["\n\n".join(current)]))
    return blocks or [(None, [text])]
