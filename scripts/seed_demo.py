"""Cria (ou reaproveita) um usuário/workspace de demonstração e envia os documentos fictícios de `samples/`.

Uso:
    cd backend && uv run python ../scripts/seed_demo.py --base http://localhost:8000 \
        --email demo@example.com --password <senha-forte>

No servidor de produção (dentro do contêiner da API, que monta samples/ e scripts/):
    docker compose -f docker-compose.prod.yml exec api python /scripts/seed_demo.py \
        --base http://api:8000 --email demo@seu-dominio --password-stdin

Idempotente: se a conta já existir, faz login; documentos duplicados (mesmo SHA-256) são ignorados.
Os documentos são fictícios — adequados para uma demo pública. A senha nunca é impressa.
"""

from __future__ import annotations

import argparse
import getpass
import sys
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
SAMPLES = [
    ("contrato-prestacao-servicos.pdf", "application/pdf"),
    ("aditivo-contrato-prestacao-servicos.pdf", "application/pdf"),
    ("politica-ferias-com-instrucao-maliciosa.pdf", "application/pdf"),
    (
        "manual-operacao-orbita.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ),
    ("politica-seguranca-vertex.txt", "text/plain"),
]
SESSION_COOKIES = ("docmind_session", "docmind_csrf")


class ApiSession:
    """Cliente com cookies gerenciados manualmente.

    Em produção os cookies saem com o atributo Secure; o cookiejar padrão não os reenviaria numa
    chamada interna em HTTP (http://api:8000). Aqui eles são guardados e reenviados explicitamente.
    """

    def __init__(self, base: str) -> None:
        self._client = httpx.Client(base_url=base, timeout=60)
        self._jar: dict[str, str] = {}

    def request(self, method: str, path: str, **kwargs) -> httpx.Response:
        headers = dict(kwargs.pop("headers", None) or {})
        if self._jar:
            headers["Cookie"] = "; ".join(f"{k}={v}" for k, v in self._jar.items())
        if method != "GET" and "docmind_csrf" in self._jar:
            headers["X-CSRF-Token"] = self._jar["docmind_csrf"]
        resp = self._client.request(method, path, headers=headers, **kwargs)
        for name in SESSION_COOKIES:
            value = resp.cookies.get(name)
            if value:
                self._jar[name] = value
        self._client.cookies.clear()
        return resp

    def get(self, path: str, **kwargs) -> httpx.Response:
        return self.request("GET", path, **kwargs)

    def post(self, path: str, **kwargs) -> httpx.Response:
        return self.request("POST", path, **kwargs)

    def close(self) -> None:
        self._client.close()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:8000")
    ap.add_argument("--email", required=True)
    pw = ap.add_mutually_exclusive_group()
    pw.add_argument(
        "--password", help="evite: fica no histórico do shell; prefira --password-stdin"
    )
    pw.add_argument("--password-stdin", action="store_true", help="lê a senha da entrada padrão")
    ap.add_argument("--name", default="Conta Demo")
    ap.add_argument("--collection", default="Documentos de demonstração")
    args = ap.parse_args()
    if args.password_stdin:
        password = sys.stdin.readline().rstrip("\n")
    else:
        password = args.password or getpass.getpass("Senha da conta de demonstração: ")
    if len(password) < 8:
        print("a senha precisa ter pelo menos 8 caracteres")
        return 1
    api = args.base.rstrip("/") + "/api/v1"

    c = ApiSession(api)
    try:
        c.get("/auth/csrf")
        r = c.post(
            "/auth/register", json={"name": args.name, "email": args.email, "password": password}
        )
        if r.status_code in (403, 409):
            r = c.post("/auth/login", json={"email": args.email, "password": password})
        if r.status_code not in (200, 201):
            print("falha ao autenticar:", r.status_code, r.text[:200])
            return 1
        print("autenticado como", r.json()["email"])

        cols = {col["name"]: col["id"] for col in c.get("/collections").json()["items"]}
        col_id = cols.get(args.collection)
        if not col_id:
            col_id = c.post(
                "/collections", json={"name": args.collection, "color": "#22D3EE"}
            ).json()["id"]
        print("coleção:", args.collection)

        ids = []
        for name, mime in SAMPLES:
            path = ROOT / "samples" / name
            if not path.exists():
                print("amostra ausente (rode scripts/generate_samples.py):", name)
                continue
            for _ in range(12):
                with path.open("rb") as fh:
                    r = c.post(
                        "/documents/upload",
                        files={"file": (name, fh, mime)},
                        data={"collection_id": col_id, "tags": "demo"},
                    )
                # Limite de uploads simultâneos por usuário: espera o processamento e tenta de novo
                busy = r.status_code == 429 and r.json()["error"]["message"].startswith("Aguarde")
                if not busy:
                    break
                time.sleep(5)
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
    finally:
        c.close()
    print("demo pronta")
    return 0


if __name__ == "__main__":
    sys.exit(main())
