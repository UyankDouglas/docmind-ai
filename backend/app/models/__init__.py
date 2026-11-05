"""Modelos ORM. Importar este pacote registra todas as tabelas na Base."""

from app.models.analysis import Analysis
from app.models.base import Base
from app.models.collection import Collection
from app.models.conversation import Conversation, Feedback, Message, MessageCitation
from app.models.document import (
    Document,
    DocumentChunk,
    DocumentPage,
    DocumentVersion,
    EmbeddingRecord,
    ProcessingJob,
)
from app.models.enums import (
    DocumentStatus,
    JobStatus,
    JobType,
    MessageRole,
    MessageStatus,
    UsageKind,
    WorkspaceRole,
)
from app.models.membership import Invitation, PasswordResetToken
from app.models.search import SearchQuery
from app.models.usage import AuditLog, UsageRecord
from app.models.user import User, UserSession
from app.models.workspace import Workspace, WorkspaceMember

__all__ = [
    "Analysis",
    "AuditLog",
    "Base",
    "Collection",
    "Conversation",
    "Document",
    "DocumentChunk",
    "DocumentPage",
    "DocumentStatus",
    "DocumentVersion",
    "EmbeddingRecord",
    "Feedback",
    "Invitation",
    "JobStatus",
    "JobType",
    "Message",
    "MessageCitation",
    "MessageRole",
    "MessageStatus",
    "PasswordResetToken",
    "ProcessingJob",
    "SearchQuery",
    "UsageKind",
    "UsageRecord",
    "User",
    "UserSession",
    "Workspace",
    "WorkspaceMember",
    "WorkspaceRole",
]
