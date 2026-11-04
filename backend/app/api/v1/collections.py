from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_auth
from app.core.database import get_db
from app.models import Collection
from app.schemas.collection import CollectionCreate, CollectionList, CollectionOut, CollectionUpdate
from app.services import collections as svc
from app.services.auth import AuthContext

router = APIRouter(prefix="/collections", tags=["coleções"])


def _out(col: Collection, count: int) -> CollectionOut:
    return CollectionOut(
        id=col.id,
        name=col.name,
        description=col.description,
        color=col.color,
        document_count=count,
        created_at=col.created_at,
        updated_at=col.updated_at,
    )


@router.get("", response_model=CollectionList)
def list_collections(
    ctx: AuthContext = Depends(get_current_auth), db: Session = Depends(get_db)
) -> CollectionList:
    return CollectionList(items=[_out(c, n) for c, n in svc.list_collections(db, ctx)])


@router.post("", response_model=CollectionOut, status_code=status.HTTP_201_CREATED)
def create_collection(
    payload: CollectionCreate,
    ctx: AuthContext = Depends(get_current_auth),
    db: Session = Depends(get_db),
) -> CollectionOut:
    col = svc.create_collection(
        db, ctx, name=payload.name, description=payload.description, color=payload.color
    )
    return _out(col, 0)


@router.get("/{collection_id}", response_model=CollectionOut)
def get_collection(
    collection_id: uuid.UUID,
    ctx: AuthContext = Depends(get_current_auth),
    db: Session = Depends(get_db),
) -> CollectionOut:
    col = svc.get_collection(db, ctx, collection_id)
    return _out(col, svc.document_counts(db, ctx.workspace_id).get(col.id, 0))


@router.patch("/{collection_id}", response_model=CollectionOut)
def update_collection(
    collection_id: uuid.UUID,
    payload: CollectionUpdate,
    ctx: AuthContext = Depends(get_current_auth),
    db: Session = Depends(get_db),
) -> CollectionOut:
    col = svc.get_collection(db, ctx, collection_id)
    col = svc.update_collection(
        db,
        ctx,
        col,
        name=payload.name,
        description=payload.description,
        color=payload.color,
        fields_set=set(payload.model_fields_set),
    )
    return _out(col, svc.document_counts(db, ctx.workspace_id).get(col.id, 0))


@router.delete("/{collection_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_collection(
    collection_id: uuid.UUID,
    ctx: AuthContext = Depends(get_current_auth),
    db: Session = Depends(get_db),
) -> Response:
    col = svc.get_collection(db, ctx, collection_id)
    svc.delete_collection(db, ctx, col)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
