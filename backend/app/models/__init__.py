"""Modelos ORM. Importar este pacote registra todas as tabelas na Base."""

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
from app.models.search import SearchQuery
from app.models.usage import AuditLog, UsageRecord
from app.models.user import User, UserSession
from app.models.workspace import Workspace, WorkspaceMember

__all__ = [
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
    "JobStatus",
    "JobType",
    "Message",
    "MessageCitation",
    "MessageRole",
    "MessageStatus",
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
