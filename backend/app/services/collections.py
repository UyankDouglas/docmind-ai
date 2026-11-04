"""Coleções: agrupamento de documentos por workspace."""

from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.exceptions import ConflictError, ForbiddenError, NotFoundError
from app.models import Collection, Document, WorkspaceRole
from app.services.audit import record_audit
from app.services.auth import AuthContext

_WRITE_ROLES = {WorkspaceRole.ADMIN, WorkspaceRole.EDITOR}


def _require_write(ctx: AuthContext) -> None:
    if ctx.role not in _WRITE_ROLES:
        raise ForbiddenError("Seu perfil não permite gerenciar coleções.")


def document_counts(db: Session, workspace_id: uuid.UUID) -> dict[uuid.UUID, int]:
    rows = db.execute(
        select(Document.collection_id, func.count(Document.id))
        .where(
            Document.workspace_id == workspace_id,
            Document.deleted_at.is_(None),
            Document.collection_id.is_not(None),
        )
        .group_by(Document.collection_id)
    ).all()
    return {cid: int(n) for cid, n in rows}


def list_collections(db: Session, ctx: AuthContext) -> list[tuple[Collection, int]]:
    counts = document_counts(db, ctx.workspace_id)
    items = db.scalars(
        select(Collection)
        .where(Collection.workspace_id == ctx.workspace_id)
        .order_by(Collection.name.asc())
    )
    return [(c, counts.get(c.id, 0)) for c in items]


def get_collection(db: Session, ctx: AuthContext, collection_id: uuid.UUID) -> Collection:
    col = db.scalar(
        select(Collection).where(
            Collection.id == collection_id, Collection.workspace_id == ctx.workspace_id
        )
    )
    if col is None:
        raise NotFoundError("Coleção não encontrada.", code="collection_not_found")
    return col


def resolve_collection_ids(
    db: Session, ctx: AuthContext, collection_ids: list[uuid.UUID]
) -> list[uuid.UUID]:
    """Valida que todas as coleções pertencem ao workspace; devolve a lista sem duplicatas."""
    if not collection_ids:
        return []
    requested = list(dict.fromkeys(collection_ids))
    allowed = set(
        db.scalars(
            select(Collection.id).where(
                Collection.workspace_id == ctx.workspace_id, Collection.id.in_(requested)
            )
        )
    )
    if set(requested) - allowed:
        raise ForbiddenError("Uma ou mais coleções não pertencem ao seu workspace.")
    return requested


def create_collection(
    db: Session, ctx: AuthContext, *, name: str, description: str | None, color: str | None
) -> Collection:
    _require_write(ctx)
    exists = db.scalar(
        select(Collection.id).where(
            Collection.workspace_id == ctx.workspace_id, func.lower(Collection.name) == name.lower()
        )
    )
    if exists:
        raise ConflictError("Já existe uma coleção com este nome.", code="collection_exists")
    col = Collection(
        workspace_id=ctx.workspace_id,
        created_by=ctx.user.id,
        name=name,
        description=description,
        color=color,
    )
    db.add(col)
    db.flush()
    record_audit(
        db,
        action="collection.create",
        workspace_id=ctx.workspace_id,
        user_id=ctx.user.id,
        target_type="collection",
        target_id=col.id,
    )
    db.commit()
    db.refresh(col)
    return col


def update_collection(
    db: Session,
    ctx: AuthContext,
    col: Collection,
    *,
    name: str | None,
    description: str | None,
    color: str | None,
    fields_set: set[str],
) -> Collection:
    _require_write(ctx)
    if name is not None and name.strip().lower() != col.name.lower():
        dup = db.scalar(
            select(Collection.id).where(
                Collection.workspace_id == ctx.workspace_id,
                func.lower(Collection.name) == name.strip().lower(),
                Collection.id != col.id,
            )
        )
        if dup:
            raise ConflictError("Já existe uma coleção com este nome.", code="collection_exists")
    if name is not None:
        col.name = name.strip()
    if "description" in fields_set:
        col.description = description
    if "color" in fields_set:
        col.color = color
    record_audit(
        db,
        action="collection.update",
        workspace_id=ctx.workspace_id,
        user_id=ctx.user.id,
        target_type="collection",
        target_id=col.id,
    )
    db.commit()
    db.refresh(col)
    return col


def delete_collection(db: Session, ctx: AuthContext, col: Collection) -> None:
    _require_write(ctx)
    # Documentos permanecem; apenas perdem o vínculo (FK ON DELETE SET NULL cuida do restante)
    db.delete(col)
    record_audit(
        db,
        action="collection.delete",
        workspace_id=ctx.workspace_id,
        user_id=ctx.user.id,
        target_type="collection",
        target_id=col.id,
    )
    db.commit()
