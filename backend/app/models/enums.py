"""Enumerações de domínio (armazenadas como texto no banco para facilitar evolução)."""

from __future__ import annotations

from enum import StrEnum


class WorkspaceRole(StrEnum):
    ADMIN = "admin"
    EDITOR = "editor"
    VIEWER = "viewer"


class DocumentStatus(StrEnum):
    UPLOADED = "uploaded"
    VALIDATING = "validating"
    EXTRACTING = "extracting"
    CHUNKING = "chunking"
    EMBEDDING = "embedding"
    INDEXING = "indexing"
    READY = "ready"
    FAILED = "failed"
    CANCELLED = "cancelled"

    @property
    def is_terminal(self) -> bool:
        return self in {DocumentStatus.READY, DocumentStatus.FAILED, DocumentStatus.CANCELLED}

    @property
    def is_processing(self) -> bool:
        return not self.is_terminal


DOCUMENT_STATUS_LABELS_PT = {
    DocumentStatus.UPLOADED: "Enviado",
    DocumentStatus.VALIDATING: "Validando",
    DocumentStatus.EXTRACTING: "Extraindo texto",
    DocumentStatus.CHUNKING: "Dividindo em trechos",
    DocumentStatus.EMBEDDING: "Gerando embeddings",
    DocumentStatus.INDEXING: "Indexando",
    DocumentStatus.READY: "Pronto",
    DocumentStatus.FAILED: "Falhou",
    DocumentStatus.CANCELLED: "Cancelado",
}


class JobType(StrEnum):
    EXTRACT = "extract"
    CHUNK = "chunk"
    EMBED = "embed"
    INDEX = "index"
    REPROCESS = "reprocess"
    DELETE = "delete"


class JobStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


class MessageRole(StrEnum):
    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"


class MessageStatus(StrEnum):
    OK = "ok"
    NO_EVIDENCE = "no_evidence"
    AI_UNAVAILABLE = "ai_unavailable"
    ERROR = "error"


class UsageKind(StrEnum):
    EMBEDDING = "embedding"
    QUESTION = "question"
    UPLOAD = "upload"
    SEARCH = "search"
