"""Chunking próprio, orientado a páginas/seções e parágrafos.

Estratégia (versão `v1`):
1. Cada página é dividida em parágrafos; títulos são detectados heuristicamente.
2. Parágrafos são agrupados até `target_tokens`, nunca ultrapassando `max_tokens`.
3. Parágrafos grandes são divididos por sentenças; sentenças gigantes, por tokens.
4. Sobreposição: as últimas sentenças do chunk anterior (≈ `overlap_tokens`) iniciam o próximo.
5. Cada chunk guarda página inicial/final, título de seção vigente, offsets e hash.

Contagem de tokens via tiktoken (não usa caracteres como tokens).
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field

from app.core.config import settings
from app.providers.tokens import TokenCounter, get_token_counter
from app.rag.extraction.base import ExtractedDocument

_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?;:])\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ0-9“\"(])")
_HEADING_NUMBERED_RE = re.compile(r"^(\d+(\.\d+)*[.)]?|[IVXLC]+[.)]|[A-Z][.)])\s+\S")
_HEADING_KEYWORD_RE = re.compile(
    r"^(cl[áa]usula|cap[íi]tulo|se[çc][ãa]o|artigo|art\.|anexo|t[íi]tulo|parte)\b", re.IGNORECASE
)


@dataclass(slots=True)
class ChunkingConfig:
    target_tokens: int = settings.chunk_target_tokens
    max_tokens: int = settings.chunk_max_tokens
    overlap_tokens: int = settings.chunk_overlap_tokens
    version: str = settings.chunking_version
    # Fecha o chunk na troca de página quando ele já tem >= min_tokens_before_page_break tokens.
    # Mantém citações precisas por página; páginas muito curtas continuam sendo agrupadas.
    respect_pages: bool = settings.chunk_respect_pages
    min_tokens_before_page_break: int = settings.chunk_min_tokens_before_page_break
    # Seções lógicas (DOCX/TXT) são fronteiras semânticas: limiar menor para fechar o chunk.
    min_tokens_before_section_break: int = settings.chunk_min_tokens_before_section_break

    def __post_init__(self) -> None:
        if self.max_tokens < self.target_tokens:
            self.max_tokens = self.target_tokens
        if self.overlap_tokens >= self.target_tokens // 2:
            self.overlap_tokens = self.target_tokens // 4


@dataclass(slots=True)
class _Block:
    text: str
    page: int
    is_heading: bool
    char_start: int
    char_end: int


@dataclass(slots=True)
class ChunkDraft:
    position: int
    text: str
    token_count: int
    page_start: int | None
    page_end: int | None
    section_title: str | None
    char_start: int
    char_end: int
    content_hash: str
    chunking_version: str
    pages: list[int] = field(default_factory=list)


def _is_heading(line: str) -> bool:
    stripped = line.strip()
    if not stripped or len(stripped) > 120:
        return False
    words = stripped.split()
    if len(words) > 14:
        return False
    if stripped.endswith((".", ",", ";")) and not _HEADING_NUMBERED_RE.match(stripped):
        return False
    if _HEADING_KEYWORD_RE.match(stripped):
        return True
    if _HEADING_NUMBERED_RE.match(stripped) and len(words) <= 12:
        return True
    letters = [c for c in stripped if c.isalpha()]
    mostly_upper = bool(letters) and sum(c.isupper() for c in letters) / len(letters) > 0.85
    return mostly_upper and len(words) <= 10


def _blocks_from_document(doc: ExtractedDocument) -> list[_Block]:
    blocks: list[_Block] = []
    offset = 0
    for page in doc.pages:
        for para in page.text.split("\n"):
            para = para.strip()
            if not para:
                continue
            start = offset
            end = start + len(para)
            blocks.append(_Block(para, page.number, _is_heading(para), start, end))
            offset = end + 1
        offset += 1  # separador de página
    return blocks


def _split_sentences(text: str) -> list[str]:
    parts = [p.strip() for p in _SENTENCE_SPLIT_RE.split(text) if p.strip()]
    return parts or [text]


def _split_by_tokens(text: str, max_tokens: int, counter: TokenCounter) -> list[str]:
    if not counter.exact:
        # Sem encoder: divide por palavras usando a aproximação do contador
        words = text.split()
        out, cur = [], []
        for w in words:
            cur.append(w)
            if counter.count(" ".join(cur)) >= max_tokens:
                out.append(" ".join(cur))
                cur = []
        if cur:
            out.append(" ".join(cur))
        return out
    toks = counter.encode(text)
    return [counter.decode(toks[i : i + max_tokens]) for i in range(0, len(toks), max_tokens)]


def _hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


class _Builder:
    def __init__(
        self, cfg: ChunkingConfig, counter: TokenCounter, *, paginated: bool = True
    ) -> None:
        self.cfg = cfg
        self.counter = counter
        self.break_threshold = (
            cfg.min_tokens_before_page_break if paginated else cfg.min_tokens_before_section_break
        )
        self.chunks: list[ChunkDraft] = []
        self.parts: list[tuple[str, int, int, int]] = []  # (texto, página, char_start, char_end)
        self.tokens = 0
        self.section: str | None = None
        self.chunk_section: str | None = None

    def _flush(self) -> None:
        if not self.parts:
            return
        text = "\n".join(p[0] for p in self.parts).strip()
        if not text:
            self.parts, self.tokens = [], 0
            return
        pages = sorted({p[1] for p in self.parts})
        self.chunks.append(
            ChunkDraft(
                position=len(self.chunks),
                text=text,
                token_count=self.counter.count(text),
                page_start=pages[0],
                page_end=pages[-1],
                section_title=self.chunk_section,
                char_start=self.parts[0][2],
                char_end=self.parts[-1][3],
                content_hash=_hash(text),
                chunking_version=self.cfg.version,
                pages=pages,
            )
        )
        # Sobreposição: mantém as últimas partes até ~overlap_tokens
        overlap: list[tuple[str, int, int, int]] = []
        acc = 0
        for part in reversed(self.parts):
            t = self.counter.count(part[0])
            if acc + t > self.cfg.overlap_tokens:
                break
            overlap.insert(0, part)
            acc += t
        self.parts = overlap
        self.tokens = acc
        self.chunk_section = self.section

    def _current_page(self) -> int | None:
        return self.parts[-1][1] if self.parts else None

    def add(self, text: str, page: int, c0: int, c1: int) -> None:
        t = self.counter.count(text)
        if t > self.cfg.max_tokens:
            for piece in _split_by_tokens(text, self.cfg.target_tokens, self.counter):
                self.add(piece, page, c0, c1)
            return
        # Quebra de página: fecha o chunk se ele já tem conteúdo suficiente, para que a
        # citação aponte para uma página específica (sem sobreposição entre páginas).
        if (
            self.cfg.respect_pages
            and self.parts
            and self._current_page() != page
            and self.tokens >= self.break_threshold
        ):
            self._flush()
            self.parts, self.tokens = [], 0
        if self.tokens + t > self.cfg.max_tokens or (
            self.tokens >= self.cfg.target_tokens and self.parts
        ):
            self._flush()
            # Se a sobreposição sozinha já estoura, descarta-a
            if self.tokens + t > self.cfg.max_tokens:
                self.parts, self.tokens = [], 0
        if not self.parts:
            self.chunk_section = self.section
        self.parts.append((text, page, c0, c1))
        self.tokens += t

    def heading(self, text: str, page: int, c0: int, c1: int) -> None:
        # Um título fecha o chunk atual se ele já estiver razoavelmente cheio
        if self.tokens >= self.cfg.target_tokens * 0.6:
            self._flush()
            self.parts, self.tokens = [], 0
        self.section = text[:255]
        # O título da seção do chunk é o vigente quando o chunk começa (definido em add())
        self.add(text, page, c0, c1)

    def finish(self) -> list[ChunkDraft]:
        # Evita chunk final composto só pela sobreposição
        if self.parts and self.chunks:
            last_texts = {p[0] for p in self.parts}
            prev_texts = set(self.chunks[-1].text.split("\n"))
            if last_texts.issubset(prev_texts):
                self.parts = []
        self._flush()
        return self.chunks


def chunk_document(
    doc: ExtractedDocument,
    config: ChunkingConfig | None = None,
    counter: TokenCounter | None = None,
) -> list[ChunkDraft]:
    cfg = config or ChunkingConfig()
    counter = counter or get_token_counter()
    builder = _Builder(cfg, counter, paginated=doc.has_real_pages)
    # Rótulos de seção (DOCX/TXT): a "página" lógica já nasce com título
    labels = {p.number: p.label for p in doc.pages if p.label}
    last_page: int | None = None

    for block in _blocks_from_document(doc):
        if block.page != last_page:
            last_page = block.page
            if block.page in labels and not block.is_heading:
                builder.section = labels[block.page][:255]
        if block.is_heading:
            builder.heading(block.text, block.page, block.char_start, block.char_end)
            continue
        if counter.count(block.text) <= cfg.max_tokens:
            builder.add(block.text, block.page, block.char_start, block.char_end)
            continue
        # Parágrafo grande: por sentenças, agrupando-as em sub-blocos próximos do alvo
        sentences = _split_sentences(block.text)
        buf: list[str] = []
        buf_tokens = 0
        for s in sentences:
            st = counter.count(s)
            if buf and buf_tokens + st > cfg.target_tokens:
                builder.add(" ".join(buf), block.page, block.char_start, block.char_end)
                buf, buf_tokens = [], 0
            buf.append(s)
            buf_tokens += st
        if buf:
            builder.add(" ".join(buf), block.page, block.char_start, block.char_end)

    return builder.finish()
