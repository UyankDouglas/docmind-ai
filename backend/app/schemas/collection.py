from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator

_COLOR_RE = r"^#[0-9a-fA-F]{6}$"


class CollectionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=1000)
    color: str | None = Field(default=None, pattern=_COLOR_RE)

    @field_validator("name")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Informe um nome para a coleção.")
        return v


class CollectionUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=1000)
    color: str | None = Field(default=None, pattern=_COLOR_RE)


class CollectionOut(BaseModel):
    id: uuid.UUID
    name: str
    description: str | None
    color: str | None
    document_count: int
    created_at: datetime
    updated_at: datetime


class CollectionList(BaseModel):
    items: list[CollectionOut]
