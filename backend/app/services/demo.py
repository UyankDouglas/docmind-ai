"""Modo demonstração: configuração pública da instância e carga dos documentos fictícios de exemplo.

Os exemplos vêm de DEMO_SAMPLES_DIR (no Compose de produção, a pasta samples/ montada somente leitura) e
passam pelo MESMO pipeline de upload: validação, limites do workspace, teto diário global, deduplicação
por SHA-256 e processamento assíncrono. Nada é copiado entre workspaces.
"""

from __future__ import annotations

import io
import uuid
from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.exceptions import ConflictError, NotFoundError, UsageLimitExceededError
from app.core.logging import get_logger
from app.models import Collection
from app.providers.storage import ObjectStorage
from app.services.auth import AuthContext
from app.services.collections import create_collection
from app.services.documents import UploadInput, create_upload, require_write_role
from app.services.system import GEMINI_DATA_USE_NOTICE

log = get_logger(__name__)

DEMO_COLLECTION = "Documentos de exemplo"
DEMO_COLLECTION_COLOR = "#22D3EE"
# Documentos sintéticos de samples/ (o PDF digitalizado sem texto fica de fora: exige OCR).
DEMO_SAMPLES: tuple[str, ...] = (
    "contrato-prestacao-servicos.pdf",
    "aditivo-contrato-prestacao-servicos.pdf",
    "politica-ferias-com-instrucao-maliciosa.pdf",
    "manual-operacao-orbita.docx",
    "politica-seguranca-vertex.txt",
)
DEMO_NOTICE = (
    "Demonstração pública com documentos fictícios. Não envie documentos reais nem dados pessoais: "
    "o conteúdo é processado por um provedor de IA externo e os dados da demonstração podem ser "
    "apagados a qualquer momento."
)


def available_samples() -> list[Path]:
    base = Path(settings.demo_samples_dir)
    return [base / name for name in DEMO_SAMPLES if (base / name).is_file()]


def instance_info() -> dict:
    """Configuração pública (sem autenticação): o frontend decide aviso e cadastro a partir dela."""
    notice = None
    if settings.demo_mode:
        notice = DEMO_NOTICE
        if "gemini" in (settings.llm_provider, settings.embedding_provider):
            notice += GEMINI_DATA_USE_NOTICE
    return {
        "demo_mode": settings.demo_mode,
        "registration_enabled": settings.registration_enabled,
        "demo_samples_available": settings.demo_mode and bool(available_samples()),
        "demo_notice": notice,
    }


@dataclass(slots=True)
class SamplesResult:
    collection_id: uuid.UUID | None = None
    loaded: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)
    stopped_reason: str | None = None


def _demo_collection(db: Session, ctx: AuthContext) -> Collection:
    existing = db.scalar(
        select(Collection).where(
            Collection.workspace_id == ctx.workspace_id,
            func.lower(Collection.name) == DEMO_COLLECTION.lower(),
        )
    )
    if existing is not None:
        return existing
    return create_collection(
        db,
        ctx,
        name=DEMO_COLLECTION,
        description="Documentos fictícios carregados pela demonstração.",
        color=DEMO_COLLECTION_COLOR,
    )


def load_samples(
    db: Session, storage: ObjectStorage, ctx: AuthContext, *, ip_address: str | None = None
) -> SamplesResult:
    """Envia os documentos de exemplo ao workspace da sessão (idempotente: duplicados são ignorados)."""
    if not settings.demo_mode:
        raise NotFoundError()
    require_write_role(ctx)
    samples = available_samples()
    if not samples:
        raise NotFoundError("Os documentos de exemplo não estão disponíveis neste servidor.")

    result = SamplesResult()
    collection = _demo_collection(db, ctx)
    result.collection_id = collection.id
    for path in samples:
        try:
            create_upload(
                db,
                storage,
                ctx,
                UploadInput(
                    filename=path.name,
                    content_type=None,
                    stream=io.BytesIO(path.read_bytes()),
                    collection_id=collection.id,
                    tags=["exemplo"],
                ),
                ip_address=ip_address,
                # No máximo cinco arquivos pequenos escolhidos pelo servidor, não pelo usuário.
                check_concurrency=False,
            )
            result.loaded.append(path.name)
        except ConflictError:
            db.rollback()
            result.skipped.append(path.name)
        except UsageLimitExceededError as exc:
            db.rollback()
            if not result.loaded and not result.skipped:
                raise
            result.stopped_reason = exc.message
            break
    log.info(
        "demo_samples_loaded",
        workspace_id=str(ctx.workspace_id),
        loaded=len(result.loaded),
        skipped=len(result.skipped),
        stopped=bool(result.stopped_reason),
    )
    return result
