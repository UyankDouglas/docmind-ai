"""Smoke test de ponta a ponta contra uma instância em execução do DocMind AI.

Fluxo: csrf → cadastro de usuário temporário → upload de samples/contrato-prestacao-servicos.pdf →
polling do status até `ready`/`failed` → pergunta no chat → impressão da resposta e das citações →
pergunta sem resposta (deve abster-se).

Uso:
    cd backend && uv run python ../scripts/smoke_test.py [--base http://localhost:8000]
Sai com código 1 se qualquer etapa falhar.
"""

from __future__ import annotations

import argparse
import secrets
import sys
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
SAMPLE = ROOT / "samples" / "contrato-prestacao-servicos.pdf"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://localhost:8000")
    parser.add_argument("--timeout", type=int, default=180, help="segundos aguardando o processamento")
    args = parser.parse_args()
    api = args.base.rstrip("/") + "/api/v1"

    with httpx.Client(base_url=api, timeout=60) as c:
        health = c.get("/health").json()
        print("health:", health["status"], health["services"], "| ia:", health["ai"]["llm_provider"])

        c.get("/auth/csrf")
        headers = {"X-CSRF-Token": c.cookies.get("docmind_csrf", "")}
        email = f"smoke-{secrets.token_hex(4)}@example.com"
        r = c.post(
            "/auth/register",
            json={"name": "Smoke Test", "email": email, "password": "Smoke-" + secrets.token_hex(6)},
            headers=headers,
        )
        _check(r, 201, "register")
        headers = {"X-CSRF-Token": c.cookies.get("docmind_csrf", "")}
        print("usuário criado:", email)

        with SAMPLE.open("rb") as fh:
            r = c.post("/documents/upload", files={"file": (SAMPLE.name, fh, "application/pdf")}, headers=headers)
        _check(r, 202, "upload")
        doc_id = r.json()["id"]
        print("documento:", doc_id, "status:", r.json()["status"])

        started = time.time()
        status = None
        seen: list[str] = []
        while time.time() - started < args.timeout:
            s = c.get(f"/documents/{doc_id}/status").json()
            status = s["status"]
            if not seen or seen[-1] != status:
                seen.append(status)
                print(f"  [{time.time() - started:5.1f}s] {status}")
            if status in ("ready", "failed", "cancelled"):
                break
            time.sleep(1.5)
        if status != "ready":
            print("FALHA: documento não ficou pronto:", s.get("error_message"))
            return 1
        print("pronto:", s["page_count"], "páginas,", s["chunk_count"], "trechos")

        r = c.post("/conversations", json={}, headers=headers)
        _check(r, 201, "conversa")
        conv = r.json()["id"]
        r = c.post(
            f"/conversations/{conv}/messages",
            json={"content": "Qual é o prazo de aviso prévio para cancelamento do contrato?"},
            headers=headers,
        )
        _check(r, 200, "pergunta")
        a = r.json()["assistant_message"]
        print("resposta:", a["status"], "| modelo:", a["model"], "|", a["content"][:160].replace("\n", " "))
        for cit in a["citations"]:
            pages = f"p. {cit['page_start']}" + (f"–{cit['page_end']}" if cit["page_end"] != cit["page_start"] else "")
            print(f"  [{cit['index']}] {cit['document_name']} — {pages}: {cit['snippet'][:80]}…")
        if a["status"] == "ok" and not a["citations"]:
            print("FALHA: resposta sem citações")
            return 1

        r = c.post(
            f"/conversations/{conv}/messages",
            json={"content": "Qual é a capital da Mongólia?"},
            headers=headers,
        )
        _check(r, 200, "pergunta sem resposta")
        a2 = r.json()["assistant_message"]
        print("sem evidência:", a2["status"], "| citações:", len(a2["citations"]))
        if a2["status"] not in ("no_evidence", "ok"):
            print("FALHA: status inesperado")
            return 1

        # Fase 2: DOCX e TXT com citações por seção
        for name, mime, question, expected in (
            ("manual-operacao-orbita.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
             "O backup completo do banco de dados deve ser executado diariamente com qual retenção de dias?", "35"),
            ("politica-seguranca-vertex.txt", "text/plain",
             "As senhas devem ter no mínimo quantos caracteres e ser trocadas a cada quantos dias?", "14"),
        ):
            path = ROOT / "samples" / name
            if not path.exists():
                print(f"(amostra {name} ausente; execute scripts/generate_samples.py)")
                continue
            with path.open("rb") as fh:
                r = c.post("/documents/upload", files={"file": (name, fh, mime)}, headers=headers)
            _check(r, 202, f"upload {name}")
            did = r.json()["id"]
            t0 = time.time()
            while time.time() - t0 < args.timeout:
                st = c.get(f"/documents/{did}/status").json()
                if st["status"] in ("ready", "failed", "cancelled"):
                    break
                time.sleep(1.5)
            if st["status"] != "ready":
                print(f"FALHA: {name} -> {st['status']}: {st.get('error_message')}")
                return 1
            r = c.post(f"/conversations/{conv}/messages", json={"content": question, "document_ids": [did]}, headers=headers)
            _check(r, 200, f"pergunta {name}")
            a3 = r.json()["assistant_message"]
            labels = [cit["location_label"] for cit in a3["citations"]]
            print(f"{name}: {st['page_count']} seções, resposta {a3['status']}, fontes: {labels}")
            if a3["status"] == "ok" and (not labels or any("Página" in lbl for lbl in labels)):
                print("FALHA: citação de DOCX/TXT deveria usar seção, não página")
                return 1
            if a3["status"] == "ok" and expected not in a3["content"]:
                print(f"(aviso) resposta não menciona '{expected}' — esperado apenas com LLM real)")

        r = c.get(f"/documents/{doc_id}/download")
        _check(r, 200, "download")
        print("download:", len(r.content), "bytes,", r.headers.get("content-type"))
    print("SMOKE TEST OK")
    return 0


def _check(r: httpx.Response, expected: int, step: str) -> None:
    if r.status_code != expected:
        print(f"FALHA em {step}: HTTP {r.status_code} {r.text[:300]}")
        sys.exit(1)


if __name__ == "__main__":
    sys.exit(main())
