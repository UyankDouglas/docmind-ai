"""Fixtures de teste.

- Variáveis de ambiente são definidas ANTES de importar a aplicação (provedores fake, APP_ENV=test).
- Testes de integração usam TEST_DATABASE_URL (PostgreSQL com pgvector). Se o banco não estiver
  acessível, esses testes são pulados com uma mensagem explícita.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import Iterator

import pytest

os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("EMBEDDING_PROVIDER", "fake")
os.environ.setdefault("LLM_PROVIDER", "fake")
os.environ.setdefault("OPENAI_API_KEY", "")
os.environ.setdefault("SECRET_KEY", "test-secret-key-not-for-production")
os.environ.setdefault("CELERY_TASK_ALWAYS_EAGER", "false")
os.environ.setdefault("RATE_LIMIT_LOGIN_PER_MINUTE", "1000")
os.environ.setdefault("COOKIE_SECURE", "false")

TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+psycopg://docmind:docmind@localhost:5432/docmind_test"
)
os.environ["DATABASE_URL"] = TEST_DATABASE_URL

from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.orm import Session, sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app.core import database as database_module  # noqa: E402
from app.models import Base  # noqa: E402
from app.providers.embeddings import FakeEmbeddingProvider, set_embedding_provider  # noqa: E402
from app.providers.llm import FakeLLMProvider, set_llm_provider  # noqa: E402
from app.providers.storage import InMemoryStorage, set_storage  # noqa: E402
from app.services import rate_limit  # noqa: E402


def _db_available(url: str) -> bool:
    try:
        eng = create_engine(url, poolclass=StaticPool, connect_args={"connect_timeout": 3})
        with eng.connect() as conn:
            conn.execute(text("SELECT 1"))
        eng.dispose()
        return True
    except Exception:
        return False


DB_AVAILABLE = _db_available(TEST_DATABASE_URL)
requires_db = pytest.mark.skipif(
    not DB_AVAILABLE,
    reason=f"PostgreSQL de teste indisponível em TEST_DATABASE_URL={TEST_DATABASE_URL}",
)


@pytest.fixture(scope="session")
def engine():
    if not DB_AVAILABLE:
        pytest.skip("banco de testes indisponível")
    # StaticPool: uma única conexão compartilhada (compatível com servidores mono-conexão)
    eng = create_engine(TEST_DATABASE_URL, poolclass=StaticPool, future=True)
    with eng.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    Base.metadata.drop_all(eng)
    Base.metadata.create_all(eng)
    # Redireciona a aplicação para este engine
    database_module.engine.dispose()
    database_module.engine = eng
    database_module.SessionLocal = sessionmaker(
        bind=eng, autoflush=False, expire_on_commit=False, class_=Session
    )
    yield eng
    Base.metadata.drop_all(eng)
    eng.dispose()


@pytest.fixture
def db(engine) -> Iterator[Session]:
    session = database_module.SessionLocal()
    try:
        yield session
    finally:
        session.rollback()
        session.close()


@pytest.fixture(autouse=True)
def _clean_tables(request):
    """Limpa as tabelas após cada teste de integração."""
    yield
    if (
        "engine" not in request.fixturenames
        and "client" not in request.fixturenames
        and "db" not in request.fixturenames
    ):
        return
    if not DB_AVAILABLE:
        return
    eng = database_module.engine
    with eng.begin() as conn:
        for table in reversed(Base.metadata.sorted_tables):
            conn.execute(table.delete())


@pytest.fixture(autouse=True)
def _fake_providers():
    set_embedding_provider(FakeEmbeddingProvider())
    set_llm_provider(FakeLLMProvider())
    set_storage(InMemoryStorage())
    rate_limit.reset_for_tests()
    yield
    set_embedding_provider(None)
    set_llm_provider(None)
    set_storage(None)


@pytest.fixture
def enqueued(monkeypatch) -> list[tuple[uuid.UUID, uuid.UUID]]:
    """Captura jobs enfileirados em vez de chamar o Celery."""
    calls: list[tuple[uuid.UUID, uuid.UUID]] = []
    from app.services import documents as doc_service

    monkeypatch.setattr(doc_service, "_enqueue_processing", lambda d, j: calls.append((d, j)))
    return calls


@pytest.fixture
def client(engine, enqueued):
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app, base_url="http://testserver") as c:
        yield c


def register(
    client,
    *,
    name: str = "Ana Silva",
    email: str = "ana@example.com",
    password: str = "senha-forte-123",
):
    client.get("/api/v1/auth/csrf")
    csrf = client.cookies.get("docmind_csrf")
    resp = client.post(
        "/api/v1/auth/register",
        json={"name": name, "email": email, "password": password},
        headers={"X-CSRF-Token": csrf},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def csrf_headers(client) -> dict[str, str]:
    return {"X-CSRF-Token": client.cookies.get("docmind_csrf", "")}


def run_pending_jobs(enqueued, storage=None):
    """Executa o pipeline para os jobs capturados (simula o worker)."""
    from app.providers.embeddings import get_embedding_provider
    from app.providers.storage import get_storage
    from app.services.processing import DocumentPipeline

    outcomes = []
    while enqueued:
        doc_id, job_id = enqueued.pop(0)
        session = database_module.SessionLocal()
        try:
            pipeline = DocumentPipeline(session, storage or get_storage(), get_embedding_provider())
            outcomes.append(pipeline.run(doc_id, job_id))
        finally:
            session.close()
    return outcomes
