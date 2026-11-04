import pytest

from app.rag.extraction import (
    ExtractedDocument,
    ExtractedPage,
    PasswordProtectedError,
    TooManyPagesError,
    get_extractor,
)
from app.rag.extraction.base import InvalidDocumentError
from app.rag.extraction.normalize import normalize_page_text
from tests.pdf_factory import contrato_pdf, encrypt_pdf, many_pages_pdf, scanned_like_pdf


def test_normalize_joins_hyphenation_and_paragraphs():
    raw = "O contra-\nto vigora por\n24 meses.\n\nCLÁUSULA 2\x00\nTexto com espaços   extras."  # noqa: RUF001
    out = normalize_page_text(raw)
    assert "contrato vigora por 24 meses." in out
    assert "\x00" not in out
    assert "CLÁUSULA 2\nTexto com espaços extras." in out


def test_pdf_extraction_preserves_pages_and_metadata():
    doc = get_extractor("application/pdf").extract(contrato_pdf())
    assert doc.page_count == 5
    assert doc.has_real_pages
    assert doc.metadata.get("title") == "Contrato de Prestação de Serviços"
    assert "45 (quarenta e cinco) dias" in doc.pages[3].text  # página 4
    assert "R$ 48.500,00" in doc.pages[1].text  # página 2
    assert doc.warnings == []
    assert doc.has_sufficient_text


def test_pdf_without_text_signals_ocr():
    doc = get_extractor("application/pdf").extract(scanned_like_pdf())
    assert not doc.has_sufficient_text
    assert any("OCR" in w for w in doc.warnings)


def test_encrypted_pdf_rejected():
    with pytest.raises(PasswordProtectedError):
        get_extractor("application/pdf").extract(encrypt_pdf(contrato_pdf()))


def test_page_limit_enforced():
    with pytest.raises(TooManyPagesError):
        get_extractor("application/pdf").extract(many_pages_pdf(6), max_pages=5)


def test_invalid_pdf_rejected():
    with pytest.raises(InvalidDocumentError):
        get_extractor("application/pdf").extract(b"%PDF-1.7 garbage garbage garbage" * 10)


def test_unknown_mime_rejected():
    with pytest.raises(InvalidDocumentError):
        get_extractor("application/zip")


def test_extracted_document_char_count():
    doc = ExtractedDocument(
        pages=[ExtractedPage(1, "abc"), ExtractedPage(2, "de")],
        page_count=2,
        char_count=5,
        mime_type="application/pdf",
    )
    assert doc.pages[0].char_count == 3
    assert not doc.has_sufficient_text
