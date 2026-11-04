"""Interfaces e tipos do serviço de extração de texto (independente do provedor de IA)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol


class ExtractionError(Exception):
    """Falha de extração apresentável ao usuário (sem conteúdo do documento)."""

    code = "extraction_failed"


class PasswordProtectedError(ExtractionError):
    code = "encrypted_document"


class TooManyPagesError(ExtractionError):
    code = "too_many_pages"


class InvalidDocumentError(ExtractionError):
    code = "invalid_document"


@dataclass(slots=True)
class ExtractedPage:
    """Unidade de localização: página (PDF) ou seção (DOCX/TXT)."""

    number: int  # 1-based
    text: str
    label: str | None = None  # ex.: título da seção para DOCX
    char_count: int = 0

    def __post_init__(self) -> None:
        self.char_count = len(self.text)


@dataclass(slots=True)
class ExtractedDocument:
    pages: list[ExtractedPage]
    page_count: int
    char_count: int
    mime_type: str
    # Metadados básicos (título, autor, produtor) — nunca o conteúdo
    metadata: dict[str, Any] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    # Indica paginação real (PDF) vs. seções lógicas (DOCX/TXT)
    has_real_pages: bool = True

    @property
    def has_sufficient_text(self) -> bool:
        return self.char_count >= 50


class TextExtractor(Protocol):
    mime_types: tuple[str, ...]

    def extract(self, data: bytes, *, max_pages: int | None = None) -> ExtractedDocument: ...


def get_extractor(mime_type: str) -> TextExtractor:
    from app.rag.extraction.pdf import PdfExtractor

    if mime_type == "application/pdf":
        return PdfExtractor()
    raise InvalidDocumentError(f"Nenhum extrator disponível para o tipo {mime_type}.")
