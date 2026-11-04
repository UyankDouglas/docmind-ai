import pytest

from app.rag.extraction import get_extractor
from app.rag.extraction.base import DOCX_MIME, TXT_MIME, InvalidDocumentError
from app.rag.extraction.txt import decode_text
from app.services.documents import detect_type
from tests.doc_factory import empty_docx, latin1_txt, manual_docx, politica_txt


def test_docx_sections_follow_headings_and_include_tables():
    doc = get_extractor(DOCX_MIME).extract(manual_docx())
    assert not doc.has_real_pages
    assert doc.metadata.get("title") == "Manual de Operação Fictício"
    labels = [p.label for p in doc.pages]
    assert labels[0].startswith("Manual de Operação")
    assert any(lbl.startswith("1. Backup") for lbl in labels)
    backup = next(p for p in doc.pages if p.label.startswith("1. Backup"))
    assert "35 dias" in backup.text
    janela = next(p for p in doc.pages if p.label.startswith("2. Janela"))
    assert "Crítica | 15 minutos" in janela.text  # tabela convertida em linhas
    assert doc.has_sufficient_text and doc.warnings == []


def test_docx_without_text_is_flagged():
    doc = get_extractor(DOCX_MIME).extract(empty_docx())
    assert not doc.has_sufficient_text
    assert doc.warnings


def test_docx_invalid_bytes_rejected():
    with pytest.raises(InvalidDocumentError):
        get_extractor(DOCX_MIME).extract(b"PK\x03\x04 not really a zip")


def test_txt_sections_from_headings_and_encoding():
    doc = get_extractor(TXT_MIME).extract(politica_txt())
    assert not doc.has_real_pages
    assert doc.metadata["encoding"] == "utf-8"
    labels = [p.label for p in doc.pages]
    assert any("SENHAS" in lbl for lbl in labels)
    senhas = next(p for p in doc.pages if "SENHAS" in p.label)
    assert "14 caracteres" in senhas.text and "180 dias" in senhas.text


def test_txt_latin1_is_decoded():
    text, enc, _warnings = decode_text(latin1_txt())
    assert "válvula" in text and "nº 7" in text
    assert enc.lower().replace("-", "") in {"latin1", "cp1252", "iso88591", "cp1250", "cp1254"}
    doc = get_extractor(TXT_MIME).extract(latin1_txt())
    assert doc.pages and "válvula" in doc.pages[0].text


def test_txt_with_bom_and_binary():
    doc = get_extractor(TXT_MIME).extract(b"\xef\xbb\xbf" + politica_txt())
    assert doc.metadata["encoding"] == "utf-8-sig"
    with pytest.raises(InvalidDocumentError):
        get_extractor(TXT_MIME).extract(b"abc\x00def" * 20)


def test_detect_type_validates_signature_per_extension():
    assert detect_type("manual.docx", manual_docx()) == DOCX_MIME
    assert detect_type("notas.txt", politica_txt()) == TXT_MIME
    from app.core.exceptions import UnsupportedMediaTypeError

    with pytest.raises(UnsupportedMediaTypeError):
        detect_type("falso.docx", b"%PDF-1.4 ....")
    with pytest.raises(UnsupportedMediaTypeError):
        detect_type("falso.txt", bytes(range(256)) * 8)
    with pytest.raises(UnsupportedMediaTypeError):
        detect_type("planilha.xlsx", manual_docx())
