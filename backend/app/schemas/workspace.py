from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel


class WorkspaceSettingsOut(BaseModel):
    external_ai_enabled: bool


class WorkspaceOut(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    role: str
    created_at: datetime
    settings: WorkspaceSettingsOut


class MemberOut(BaseModel):
    user_id: uuid.UUID
    name: str
    email: str
    role: str
    joined_at: datetime


class MemberList(BaseModel):
    items: list[MemberOut]
