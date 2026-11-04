from app.providers.tokens import get_token_counter
from app.rag.chunking import ChunkingConfig, chunk_document
from app.rag.extraction import ExtractedDocument, ExtractedPage, get_extractor
from tests.pdf_factory import contrato_pdf


def _doc(pages: list[str]) -> ExtractedDocument:
    ps = [ExtractedPage(i + 1, t) for i, t in enumerate(pages)]
    return ExtractedDocument(ps, len(ps), sum(p.char_count for p in ps), "application/pdf")


def test_chunks_respect_max_tokens_and_keep_page_links():
    counter = get_token_counter()
    long_para = " ".join(
        f"Frase número {i} sobre obrigações contratuais e prazos." for i in range(120)
    )
    doc = _doc([long_para, "Segunda página com conteúdo curto.", long_para])
    cfg = ChunkingConfig(target_tokens=150, max_tokens=200, overlap_tokens=30)
    chunks = chunk_document(doc, cfg)
    assert len(chunks) > 3
    for c in chunks:
        assert counter.count(c.text) <= cfg.max_tokens
        assert c.page_start is not None and c.page_end is not None
        assert c.page_start <= c.page_end
        assert c.content_hash and c.chunking_version == cfg.version
    assert [c.position for c in chunks] == list(range(len(chunks)))
    assert chunks[0].page_start == 1
    assert chunks[-1].page_end == 3


def test_overlap_repeats_tail_of_previous_chunk():
    sentences = [f"Sentença {i} descreve um ponto específico do acordo." for i in range(60)]
    doc = _doc(["\n".join(sentences)])
    cfg = ChunkingConfig(target_tokens=120, max_tokens=160, overlap_tokens=40)
    chunks = chunk_document(doc, cfg)
    assert len(chunks) >= 3
    first_lines = chunks[0].text.split("\n")
    second_lines = chunks[1].text.split("\n")
    assert second_lines[0] in first_lines  # sobreposição
    assert second_lines[0] != first_lines[0]


def test_headings_become_section_titles():
    doc = _doc(
        [
            "CLÁUSULA 6 - RESCISÃO E CANCELAMENTO\nQualquer das partes poderá rescindir com aviso prévio de 45 dias."
        ]
    )
    chunks = chunk_document(
        doc, ChunkingConfig(target_tokens=200, max_tokens=300, overlap_tokens=20)
    )
    assert len(chunks) == 1
    assert chunks[0].section_title and chunks[0].section_title.startswith("CLÁUSULA 6")


def test_real_pdf_chunks_point_to_correct_pages():
    extracted = get_extractor("application/pdf").extract(contrato_pdf())
    chunks = chunk_document(
        extracted, ChunkingConfig(target_tokens=200, max_tokens=300, overlap_tokens=30)
    )
    cancel = [c for c in chunks if "45 (quarenta e cinco) dias" in c.text]
    assert cancel, "trecho sobre cancelamento deveria existir"
    assert all(c.page_start <= 4 <= c.page_end for c in cancel)
    assert all(c.token_count > 0 for c in chunks)


def test_empty_document_yields_no_chunks():
    assert chunk_document(_doc(["", "   "])) == []
