"""Extração de PDFs textuais com pypdf.

Regras:
- Preserva o vínculo texto ↔ número de página.
- Rejeita PDFs criptografados sem suporte.
- Aplica limite de páginas antes de percorrer o conteúdo.
- Detecta páginas sem texto (prováveis digitalizações) e sinaliza necessidade de OCR
  em vez de fingir que o texto foi extraído.
- Nunca segue links, executa JavaScript ou abre anexos do PDF.
"""

from __future__ import annotations

import io
import re
from typing import Any

from pypdf import PdfReader
from pypdf.errors import PdfReadError

from app.core.config import settings
from app.rag.extraction.base import (
    ExtractedDocument,
    ExtractedPage,
    InvalidDocumentError,
    PasswordProtectedError,
    TooManyPagesError,
)
from app.rag.extraction.normalize import normalize_page_text

_MIN_CHARS_PER_TEXT_PAGE = 20


class PdfExtractor:
    mime_types = ("application/pdf",)

    def extract(self, data: bytes, *, max_pages: int | None = None) -> ExtractedDocument:
        max_pages = max_pages or settings.max_pdf_pages
        try:
            reader = PdfReader(io.BytesIO(data), strict=False)
        except PdfReadError as exc:
            raise InvalidDocumentError("O arquivo PDF está corrompido ou é inválido.") from exc
        except Exception as exc:  # pypdf pode lançar exceções diversas em arquivos malformados
            raise InvalidDocumentError("Não foi possível ler o arquivo PDF.") from exc

        if reader.is_encrypted:
            # Tentamos apenas senha vazia (PDFs "protegidos" sem senha de abertura)
            try:
                if reader.decrypt("") == 0:
                    raise PasswordProtectedError(
                        "O PDF está protegido por senha. Envie uma versão sem criptografia."
                    )
            except PasswordProtectedError:
                raise
            except Exception as exc:
                raise PasswordProtectedError(
                    "O PDF está criptografado com um método não suportado."
                ) from exc

        try:
            page_count = len(reader.pages)
        except Exception as exc:
            raise InvalidDocumentError("Não foi possível contar as páginas do PDF.") from exc

        if page_count == 0:
            raise InvalidDocumentError("O PDF não possui páginas.")
        if page_count > max_pages:
            raise TooManyPagesError(f"O PDF possui {page_count} páginas; o limite é {max_pages}.")

        pages: list[ExtractedPage] = []
        empty_pages = 0
        for idx, page in enumerate(reader.pages, start=1):
            try:
                raw = page.extract_text() or ""
            except Exception:
                raw = ""
            text = normalize_page_text(raw)
            if len(text) < _MIN_CHARS_PER_TEXT_PAGE:
                empty_pages += 1
            pages.append(ExtractedPage(number=idx, text=text))

        warnings: list[str] = []
        total_chars = sum(p.char_count for p in pages)
        if empty_pages == page_count:
            warnings.append(
                "Nenhum texto extraível foi encontrado. O documento parece ser digitalizado "
                "(imagem); será necessário OCR, que ainda não está disponível."
            )
        elif empty_pages > 0:
            warnings.append(
                f"{empty_pages} de {page_count} páginas não possuem texto extraível "
                "(possíveis imagens/digitalizações). Essas páginas não serão consultáveis."
            )

        return ExtractedDocument(
            pages=pages,
            page_count=page_count,
            char_count=total_chars,
            mime_type="application/pdf",
            metadata=_safe_metadata(reader),
            warnings=warnings,
            has_real_pages=True,
        )


def _safe_metadata(reader: PdfReader) -> dict[str, Any]:
    """Extrai metadados básicos e os sanitiza (strings curtas, sem binários)."""
    out: dict[str, Any] = {}
    try:
        meta = reader.metadata
    except Exception:
        return out
    if not meta:
        return out
    for key, attr in (
        ("title", "title"),
        ("author", "author"),
        ("producer", "producer"),
        ("creator", "creator"),
    ):
        try:
            val = getattr(meta, attr)
        except Exception:
            val = None
        if isinstance(val, str):
            val = re.sub(r"[\x00-\x1f\x7f]", "", val).strip()
            if val:
                out[key] = val[:200]
    return out
