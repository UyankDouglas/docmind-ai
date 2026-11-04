"""Geração de DOCX e TXT sintéticos para testes (conteúdo fictício e conhecido)."""

from __future__ import annotations

import io


def manual_docx() -> bytes:
    from docx import Document

    d = Document()
    d.core_properties.title = "Manual de Operação Fictício"
    d.add_heading("Manual de Operação do Sistema Fictício Órbita", level=1)
    d.add_paragraph(
        "Este manual sintético descreve procedimentos de um sistema fictício e serve apenas para "
        "demonstração do DocMind AI."
    )
    d.add_heading("1. Backup diário", level=2)
    d.add_paragraph(
        "O backup completo do banco de dados deve ser executado diariamente às 02:00, com retenção de "
        "35 dias. Backups incrementais ocorrem a cada 4 horas."
    )
    d.add_heading("2. Janela de manutenção", level=2)
    d.add_paragraph(
        "A janela de manutenção padrão é aos domingos, das 01:00 às 05:00, com aviso prévio de 72 horas "
        "aos usuários por e-mail."
    )
    table = d.add_table(rows=3, cols=2)
    table.rows[0].cells[0].text = "Severidade"
    table.rows[0].cells[1].text = "Tempo de resposta"
    table.rows[1].cells[0].text = "Crítica"
    table.rows[1].cells[1].text = "15 minutos"
    table.rows[2].cells[0].text = "Alta"
    table.rows[2].cells[1].text = "1 hora"
    d.add_heading("3. Contatos", level=2)
    d.add_paragraph(
        "O plantão técnico fictício atende pelo ramal 4040 e pelo e-mail plantao@orbita.invalid."
    )
    buf = io.BytesIO()
    d.save(buf)
    return buf.getvalue()


def empty_docx() -> bytes:
    from docx import Document

    d = Document()
    buf = io.BytesIO()
    d.save(buf)
    return buf.getvalue()


POLITICA_TXT = """POLÍTICA DE SEGURANÇA DA INFORMAÇÃO - EMPRESA FICTÍCIA VERTEX

1. SENHAS
As senhas devem ter no mínimo 14 caracteres e ser trocadas a cada 180 dias. É proibido reutilizar
as últimas 5 senhas.

2. ACESSO REMOTO
O acesso remoto exige VPN corporativa e autenticação em dois fatores. Sessões ociosas expiram
após 30 minutos.

3. INCIDENTES
Incidentes de segurança devem ser reportados em até 2 horas ao time de resposta pelo canal
#seguranca-incidentes.
"""


def politica_txt(encoding: str = "utf-8") -> bytes:
    return POLITICA_TXT.encode(encoding)


def latin1_txt() -> bytes:
    return "Relatório de manutenção: a válvula nº 7 foi substituída em março.\n\nCusto total: R$ 1.250,00.\n".encode(
        "latin-1"
    )
