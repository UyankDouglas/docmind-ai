"""Extração de DOCX com python-docx.

DOCX não possui paginação fixa (depende do renderizador). A unidade de localização é a **seção
lógica**: cada título (estilo Heading/Título) inicia uma nova seção; o texto anterior ao primeiro
título fica na seção "Início". Parágrafos e tabelas são percorridos na ordem do corpo do documento
(ordem aproximada de leitura). Tabelas viram linhas com células separadas por " | ".

Nunca executamos macros, campos, OLE ou links incorporados: apenas lemos o XML de texto.
"""

from __future__ import annotations

import io
import re
import zipfile
from typing import Any

from app.rag.extraction.base import (
    ExtractedDocument,
    ExtractedPage,
    InvalidDocumentError,
    PasswordProtectedError,
    TooManyPagesError,
)
from app.rag.extraction.normalize import normalize_page_text

_HEADING_STYLE_RE = re.compile(r"^(heading|título|titulo|title)\s*(\d+)?$", re.IGNORECASE)
_MAX_SECTIONS_DEFAULT = 500
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


def _is_heading(paragraph) -> tuple[bool, int]:
    try:
        name = (paragraph.style.name or "").strip()
    except Exception:
        return False, 0
    m = _HEADING_STYLE_RE.match(name)
    if not m:
        return False, 0
    level = int(m.group(2)) if m.group(2) else 1
    return True, level


class DocxExtractor:
    mime_types = (DOCX_MIME,)

    def extract(self, data: bytes, *, max_pages: int | None = None) -> ExtractedDocument:
        max_sections = max_pages or _MAX_SECTIONS_DEFAULT
        if not zipfile.is_zipfile(io.BytesIO(data)):
            raise InvalidDocumentError("O arquivo não é um DOCX válido.")
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as zf:
                names = set(zf.namelist())
        except zipfile.BadZipFile as exc:
            raise InvalidDocumentError("O arquivo DOCX está corrompido.") from exc
        if "EncryptedPackage" in names or "EncryptionInfo" in names:
            raise PasswordProtectedError(
                "O DOCX está protegido por senha. Envie uma versão sem criptografia."
            )
        if "word/document.xml" not in names:
            raise InvalidDocumentError("O arquivo não contém um documento Word válido.")

        try:
            from docx import Document as DocxDocument
            from docx.oxml.ns import qn
            from docx.table import Table
            from docx.text.paragraph import Paragraph

            document = DocxDocument(io.BytesIO(data))
        except Exception as exc:
            raise InvalidDocumentError("Não foi possível ler o arquivo DOCX.") from exc

        sections: list[tuple[str, list[str]]] = [("Início", [])]
        body = document.element.body
        for child in body.iterchildren():
            if child.tag == qn("w:p"):
                paragraph = Paragraph(child, document)
                text = paragraph.text.strip()
                if not text:
                    continue
                is_heading, _level = _is_heading(paragraph)
                if is_heading:
                    if len(sections) >= max_sections:
                        raise TooManyPagesError(
                            f"O documento possui mais de {max_sections} seções; o limite foi excedido."
                        )
                    sections.append((text[:200], [text]))
                else:
                    sections[-1][1].append(text)
            elif child.tag == qn("w:tbl"):
                table = Table(child, document)
                for row in table.rows:
                    cells = []
                    seen: set[int] = set()
                    for cell in row.cells:
                        # células mescladas repetem o mesmo objeto
                        if id(cell._tc) in seen:
                            continue
                        seen.add(id(cell._tc))
                        cells.append(" ".join(cell.text.split()))
                    line = " | ".join(c for c in cells if c)
                    if line:
                        sections[-1][1].append(line)

        # Remove a seção "Início" se estiver vazia e houver títulos
        if len(sections) > 1 and not sections[0][1]:
            sections = sections[1:]

        pages: list[ExtractedPage] = []
        for idx, (label, paras) in enumerate(sections, start=1):
            text = normalize_page_text("\n".join(paras))
            pages.append(ExtractedPage(number=idx, text=text, label=label))

        total = sum(p.char_count for p in pages)
        warnings: list[str] = []
        if total < 50:
            warnings.append(
                "Nenhum texto foi encontrado no documento (pode conter apenas imagens ou objetos incorporados)."
            )
        if any(p.label == "Início" for p in pages) and len(pages) == 1:
            warnings.append(
                "O documento não possui títulos com estilo de cabeçalho; as referências usarão a posição do trecho."
            )

        return ExtractedDocument(
            pages=pages,
            page_count=len(pages),
            char_count=total,
            mime_type=DOCX_MIME,
            metadata=_safe_metadata(document),
            warnings=warnings,
            has_real_pages=False,
        )


def _safe_metadata(document) -> dict[str, Any]:
    out: dict[str, Any] = {}
    try:
        cp = document.core_properties
    except Exception:
        return out
    for key in ("title", "author", "subject"):
        val = getattr(cp, key, None)
        if isinstance(val, str):
            val = re.sub(r"[\x00-\x1f\x7f]", "", val).strip()
            if val:
                out[key] = val[:200]
    return out
