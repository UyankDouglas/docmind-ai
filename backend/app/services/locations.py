"""Rótulos de localização de trechos, gerados pelo backend a partir dos metadados.

PDF -> "Página 4" / "Páginas 3-4". DOCX/TXT -> "Seção 2 · Título" (sem inventar páginas).
"""

from __future__ import annotations

PDF_MIME = "application/pdf"
EN_DASH = "\u2013"


def location_type_for(mime_type: str | None) -> str:
    return "page" if mime_type == PDF_MIME else "section"


def location_label(
    *,
    location_type: str,
    page_start: int | None,
    page_end: int | None,
    section_title: str | None,
    position: int | None = None,
) -> str:
    if location_type == "page":
        if page_start is None:
            return "Página não identificada"
        if page_end is None or page_end == page_start:
            return f"Página {page_start}"
        return f"Páginas {page_start}{EN_DASH}{page_end}"
    # Seções lógicas (DOCX/TXT): page_start é o índice da seção
    if page_start is not None:
        base = (
            f"Seção {page_start}"
            if page_end in (None, page_start)
            else f"Seções {page_start}{EN_DASH}{page_end}"
        )
        if section_title:
            return f"{base} · {section_title[:80]}"
        return base
    if position is not None:
        return f"Trecho {position + 1}"
    return "Localização não identificada"
