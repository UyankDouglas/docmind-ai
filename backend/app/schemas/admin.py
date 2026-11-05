from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, EmailStr, Field

Role = Literal["admin", "editor", "viewer"]


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str = Field(min_length=10, max_length=200)
    password: str = Field(min_length=8, max_length=128)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


class SessionInfoOut(BaseModel):
    id: uuid.UUID
    created_at: datetime
    last_seen_at: datetime
    user_agent: str | None
    ip_address: str | None
    is_current: bool


class SessionList(BaseModel):
    items: list[SessionInfoOut]


class WorkspaceMembershipOut(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    role: str
    is_current: bool


class WorkspaceMembershipList(BaseModel):
    items: list[WorkspaceMembershipOut]


class SwitchWorkspaceRequest(BaseModel):
    workspace_id: uuid.UUID


class WorkspaceRename(BaseModel):
    name: str = Field(min_length=2, max_length=120)


class MemberRoleUpdate(BaseModel):
    role: Role


class InvitationCreate(BaseModel):
    email: EmailStr
    role: Role = "viewer"


class InvitedBy(BaseModel):
    id: uuid.UUID
    name: str


class InvitationOut(BaseModel):
    id: uuid.UUID
    email: str
    role: str
    status: str
    invited_by: InvitedBy | None
    created_at: datetime
    expires_at: datetime
    accepted_at: datetime | None
    accept_url: str | None = None


class InvitationList(BaseModel):
    items: list[InvitationOut]


class InvitationPublicOut(BaseModel):
    workspace_name: str
    email: str
    role: str
    expires_at: datetime
    status: str


class AuditUser(BaseModel):
    id: uuid.UUID
    name: str
    email: str


class AuditEntryOut(BaseModel):
    id: uuid.UUID
    action: str
    user: AuditUser | None
    target_type: str | None
    target_id: uuid.UUID | None
    ip_address: str | None
    details: dict[str, Any]
    created_at: datetime


class AdminUsageUser(BaseModel):
    user_id: uuid.UUID | None
    name: str
    email: str
    questions: int
    uploads: int
    prompt_tokens: int
    completion_tokens: int
    estimated_cost_usd: float | None


class AdminUsageDay(BaseModel):
    day: str
    questions: int
    prompt_tokens: int
    completion_tokens: int


class AdminUsageTotals(BaseModel):
    questions: int
    uploads: int
    prompt_tokens: int
    completion_tokens: int
    estimated_cost_usd: float | None
    documents: int
    storage_mb: float


class AdminUsageOut(BaseModel):
    period_start: str
    period_end: str
    by_user: list[AdminUsageUser]
    by_day: list[AdminUsageDay]
    totals: AdminUsageTotals


class RetentionRunOut(BaseModel):
    deleted: dict[str, int]
