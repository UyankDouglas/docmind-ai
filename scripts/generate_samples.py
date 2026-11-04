"""Gera os PDFs sintéticos de demonstração em `samples/`.

Uso (a partir da raiz do repositório):
    cd backend && uv run python ../scripts/generate_samples.py

Os documentos são fictícios e contêm fatos conhecidos em páginas específicas,
o que permite verificar se as citações apontam para a página correta.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from tests.pdf_factory import contrato_pdf, politica_pdf, scanned_like_pdf  # noqa: E402


def main() -> None:
    out = ROOT / "samples"
    out.mkdir(exist_ok=True)
    files = {
        "contrato-prestacao-servicos.pdf": contrato_pdf(),
        "politica-ferias-com-instrucao-maliciosa.pdf": politica_pdf(),
        "digitalizado-sem-texto.pdf": scanned_like_pdf(),
    }
    for name, data in files.items():
        (out / name).write_bytes(data)
        print(f"gerado: samples/{name} ({len(data)} bytes)")


if __name__ == "__main__":
    main()
