"""OCR opcional para PDFs digitalizados.

Decisão (ver docs/ocr-evaluation.md): Tesseract via `pytesseract`, desligado por padrão
(`OCR_ENABLED=false`) e só ativável por workspace quando o binário e o idioma estão instalados.
As imagens são extraídas das páginas com pypdf (sem rasterizar o PDF inteiro) e processadas com
limites de tamanho. Texto obtido por OCR é marcado como tal nos metadados do documento.
"""

from __future__ import annotations

import io
import shutil
from dataclasses import dataclass, field
from typing import Protocol

from app.core.config import settings
from app.core.logging import get_logger

log = get_logger(__name__)

_MAX_IMAGE_PIXELS = 40_000_000  # ~40 MP: evita bombas de descompressão
_MAX_IMAGES_PER_PAGE = 4


@dataclass(slots=True)
class OcrPageResult:
    number: int
    text: str
    images_processed: int
    confidence: float | None = None


@dataclass(slots=True)
class OcrResult:
    pages: list[OcrPageResult]
    engine: str
    language: str
    warnings: list[str] = field(default_factory=list)


class OcrProvider(Protocol):
    name: str

    def available(self) -> bool: ...

    def ocr_pdf(self, data: bytes, *, max_pages: int) -> OcrResult: ...


class TesseractOcrProvider:
    name = "tesseract"

    def __init__(self, language: str | None = None) -> None:
        self.language = language or settings.ocr_language

    def available(self) -> bool:
        if not settings.ocr_enabled:
            return False
        try:
            import pytesseract  # noqa: F401
            from PIL import Image  # noqa: F401
        except Exception:
            return False
        cmd = settings.tesseract_cmd or "tesseract"
        return shutil.which(cmd) is not None

    def ocr_pdf(self, data: bytes, *, max_pages: int) -> OcrResult:
        import pytesseract
        from PIL import Image
        from pypdf import PdfReader

        if settings.tesseract_cmd:
            pytesseract.pytesseract.tesseract_cmd = settings.tesseract_cmd
        Image.MAX_IMAGE_PIXELS = _MAX_IMAGE_PIXELS
        reader = PdfReader(io.BytesIO(data), strict=False)
        pages: list[OcrPageResult] = []
        warnings: list[str] = []
        for number, page in enumerate(reader.pages[:max_pages], start=1):
            texts: list[str] = []
            processed = 0
            try:
                images = list(page.images)[:_MAX_IMAGES_PER_PAGE]
            except Exception:
                images = []
            for img in images:
                try:
                    with Image.open(io.BytesIO(img.data)) as im:
                        if im.width * im.height > _MAX_IMAGE_PIXELS:
                            warnings.append(
                                f"Página {number}: imagem ignorada por exceder o tamanho máximo."
                            )
                            continue
                        texts.append(
                            pytesseract.image_to_string(im.convert("L"), lang=self.language)
                        )
                        processed += 1
                except Exception as exc:  # imagem corrompida ou formato não suportado
                    warnings.append(
                        f"Página {number}: falha ao processar imagem ({type(exc).__name__})."
                    )
            pages.append(
                OcrPageResult(
                    number=number, text="\n".join(texts).strip(), images_processed=processed
                )
            )
        return OcrResult(pages=pages, engine=self.name, language=self.language, warnings=warnings)


class FakeOcrProvider:
    """OCR determinístico para testes: devolve o texto configurado por página."""

    name = "fake"

    def __init__(self, texts: dict[int, str] | None = None, *, is_available: bool = True) -> None:
        self.texts = texts or {}
        self._available = is_available
        self.calls = 0

    def available(self) -> bool:
        return self._available

    def ocr_pdf(self, data: bytes, *, max_pages: int) -> OcrResult:
        self.calls += 1
        pages = [
            OcrPageResult(number=n, text=t, images_processed=1)
            for n, t in sorted(self.texts.items())
        ]
        return OcrResult(pages=pages, engine=self.name, language="por")


_provider: OcrProvider | None = None


def get_ocr_provider() -> OcrProvider:
    global _provider
    if _provider is None:
        _provider = TesseractOcrProvider()
    return _provider


def set_ocr_provider(provider: OcrProvider | None) -> None:
    global _provider
    _provider = provider


def ocr_available() -> bool:
    try:
        return get_ocr_provider().available()
    except Exception:
        return False
