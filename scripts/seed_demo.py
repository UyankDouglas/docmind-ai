"""Cria (ou reaproveita) um usuário/workspace de demonstração e envia os documentos fictícios de `samples/`.

Uso:
    cd backend && uv run python ../scripts/seed_demo.py --base http://localhost:8000 \
        --email demo@example.com --password <senha-forte>

Idempotente: se a conta já existir, faz login; documentos duplicados (mesmo SHA-256) são ignorados.
Os documentos são fictícios — adequados para uma demo pública.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
SAMPLES = [
    ("contrato-prestacao-servicos.pdf", "application/pdf"),
    ("aditivo-contrato-prestacao-servicos.pdf", "application/pdf"),
    ("politica-ferias-com-instrucao-maliciosa.pdf", "application/pdf"),
    ("manual-operacao-orbita.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    ("politica-seguranca-vertex.txt", "text/plain"),
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:8000")
    ap.add_argument("--email", required=True)
    ap.add_argument("--password", required=True)
    ap.add_argument("--name", default="Conta Demo")
    ap.add_argument("--collection", default="Documentos de demonstração")
    args = ap.parse_args()
    api = args.base.rstrip("/") + "/api/v1"

    with httpx.Client(base_url=api, timeout=60) as c:
        c.get("/auth/csrf")
        h = {"X-CSRF-Token": c.cookies.get("docmind_csrf", "")}
        r = c.post("/auth/register", json={"name": args.name, "email": args.email, "password": args.password}, headers=h)
        if r.status_code == 409:
            r = c.post("/auth/login", json={"email": args.email, "password": args.password}, headers=h)
        if r.status_code not in (200, 201):
            print("falha ao autenticar:", r.status_code, r.text[:200])
            return 1
        h = {"X-CSRF-Token": c.cookies.get("docmind_csrf", "")}
        print("autenticado como", r.json()["email"])

        cols = {col["name"]: col["id"] for col in c.get("/collections").json()["items"]}
        col_id = cols.get(args.collection)
        if not col_id:
            col_id = c.post("/collections", json={"name": args.collection, "color": "#22D3EE"}, headers=h).json()["id"]
        print("coleção:", args.collection)

        ids = []
        for name, mime in SAMPLES:
            path = ROOT / "samples" / name
            if not path.exists():
                print("amostra ausente (rode scripts/generate_samples.py):", name)
                continue
            with path.open("rb") as fh:
                r = c.post("/documents/upload", files={"file": (name, fh, mime)}, data={"collection_id": col_id, "tags": "demo"}, headers=h)
            if r.status_code == 202:
                ids.append(r.json()["id"])
                print("enviado:", name)
            elif r.status_code == 409:
                print("já existia:", name)
            else:
                print("falha:", name, r.status_code, r.text[:160])

        t0 = time.time()
        while ids and time.time() - t0 < 300:
            statuses = {i: c.get(f"/documents/{i}/status").json()["status"] for i in ids}
            if all(s in ("ready", "failed", "cancelled") for s in statuses.values()):
                break
            time.sleep(2)
        for i in ids:
            s = c.get(f"/documents/{i}/status").json()
            print(f"  {i[:8]} -> {s['status']} ({s['chunk_count']} trechos)")
    print("demo pronta")
    return 0


if __name__ == "__main__":
    sys.exit(main())
