"""Conversas e geração de respostas com citações verificáveis."""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.core.config import settings
from app.core.exceptions import AIUnavailableError, ForbiddenError, NotFoundError
from app.core.logging import get_logger
from app.models import (
    Conversation,
    Document,
    Feedback,
    Message,
    MessageCitation,
    MessageRole,
    MessageStatus,
    UsageKind,
)
from app.models.base import utcnow
from app.providers.embeddings import get_embedding_provider
from app.providers.llm import LLMMessage, LLMProvider, get_llm_provider
from app.rag.generation import build_context, build_messages, validate_citations
from app.rag.generation.citations import NO_EVIDENCE_ANSWER
from app.rag.retrieval import RetrievalScope, RetrievalService
from app.services.audit import record_audit
from app.services.auth import AuthContext
from app.services.usage import enforce_question_limit, record_usage

log = get_logger(__name__)

AI_UNAVAILABLE_ANSWER = (
    "A geração de respostas com IA está indisponível: nenhum provedor foi configurado neste ambiente. "
    "Você ainda pode usar a pesquisa semântica para localizar trechos relevantes."
)
_HISTORY_TURNS = 3


@dataclass(slots=True)
class AskResult:
    user_message: Message
    assistant_message: Message


# ---------------------------------------------------------------- conversas
def _validate_document_scope(
    db: Session, ctx: AuthContext, document_ids: list[uuid.UUID]
) -> list[uuid.UUID]:
    if not document_ids:
        return []
    requested = list(dict.fromkeys(document_ids))
    allowed = set(
        db.scalars(
            select(Document.id).where(
                Document.workspace_id == ctx.workspace_id,
                Document.deleted_at.is_(None),
                Document.id.in_(requested),
            )
        )
    )
    if set(requested) - allowed:
        raise ForbiddenError("Um ou mais documentos não pertencem ao seu workspace.")
    return requested


def create_conversation(
    db: Session, ctx: AuthContext, *, title: str | None, document_ids: list[uuid.UUID]
) -> Conversation:
    scope = _validate_document_scope(db, ctx, document_ids)
    conv = Conversation(
        workspace_id=ctx.workspace_id,
        user_id=ctx.user.id,
        title=(title or "Nova conversa").strip()[:200],
        document_ids=scope,
    )
    db.add(conv)
    db.commit()
    db.refresh(conv)
    return conv


def get_conversation(db: Session, ctx: AuthContext, conversation_id: uuid.UUID) -> Conversation:
    conv = db.scalar(
        select(Conversation)
        .options(
            selectinload(Conversation.messages).selectinload(Message.citations),
            selectinload(Conversation.messages).selectinload(Message.feedback),
        )
        .where(
            Conversation.id == conversation_id,
            Conversation.workspace_id == ctx.workspace_id,
            Conversation.user_id == ctx.user.id,
            Conversation.deleted_at.is_(None),
        )
    )
    if conv is None:
        raise NotFoundError("Conversa não encontrada.", code="conversation_not_found")
    return conv


def list_conversations(db: Session, ctx: AuthContext) -> list[tuple[Conversation, int]]:
    count_sq = (
        select(Message.conversation_id, func.count(Message.id).label("n"))
        .group_by(Message.conversation_id)
        .subquery()
    )
    rows = db.execute(
        select(Conversation, func.coalesce(count_sq.c.n, 0))
        .outerjoin(count_sq, count_sq.c.conversation_id == Conversation.id)
        .where(
            Conversation.workspace_id == ctx.workspace_id,
            Conversation.user_id == ctx.user.id,
            Conversation.deleted_at.is_(None),
        )
        .order_by(Conversation.updated_at.desc())
        .limit(100)
    ).all()
    return [(c, int(n)) for c, n in rows]


def update_conversation(
    db: Session,
    ctx: AuthContext,
    conv: Conversation,
    *,
    title: str | None,
    document_ids: list[uuid.UUID] | None,
) -> Conversation:
    if title is not None:
        conv.title = title.strip()[:200]
    if document_ids is not None:
        conv.document_ids = _validate_document_scope(db, ctx, document_ids)
    db.commit()
    db.refresh(conv)
    return conv


def delete_conversation(db: Session, ctx: AuthContext, conv: Conversation) -> None:
    conv.deleted_at = utcnow()
    record_audit(
        db,
        action="conversation.delete",
        workspace_id=ctx.workspace_id,
        user_id=ctx.user.id,
        target_type="conversation",
        target_id=conv.id,
    )
    db.commit()


# ---------------------------------------------------------------- perguntas
def _recent_history(conv: Conversation) -> list[LLMMessage]:
    msgs = [m for m in conv.messages if m.role in (MessageRole.USER, MessageRole.ASSISTANT)]
    tail = msgs[-(_HISTORY_TURNS * 2) :]
    history: list[LLMMessage] = []
    for m in tail:
        if m.role == MessageRole.ASSISTANT and m.status != MessageStatus.OK:
            continue
        history.append(LLMMessage(m.role, m.content[:1500]))
    return history


def ask(
    db: Session,
    ctx: AuthContext,
    conv: Conversation,
    *,
    content: str,
    document_ids: list[uuid.UUID] | None,
    llm: LLMProvider | None = None,
    ip_address: str | None = None,
) -> AskResult:
    enforce_question_limit(db, ctx.user.id)

    if document_ids is not None:
        conv.document_ids = _validate_document_scope(db, ctx, document_ids)

    user_msg = Message(
        conversation_id=conv.id,
        workspace_id=ctx.workspace_id,
        role=MessageRole.USER,
        content=content,
        status=MessageStatus.OK,
        created_at=utcnow(),
    )
    if conv.title == "Nova conversa" and not conv.messages:
        conv.title = content[:80]
    conv.messages.append(user_msg)
    db.add(user_msg)
    db.flush()

    started = time.perf_counter()
    scope = RetrievalScope(
        workspace_id=ctx.workspace_id,
        document_ids=list(conv.document_ids) if conv.document_ids else None,
    )

    # ---- provedores (sem provedor => resposta honesta de indisponibilidade)
    try:
        embedding_provider = get_embedding_provider()
        llm = llm or get_llm_provider()
    except AIUnavailableError:
        assistant = _store_assistant(
            db,
            conv,
            ctx,
            AI_UNAVAILABLE_ANSWER,
            MessageStatus.AI_UNAVAILABLE,
            [],
            {},
            None,
            started,
        )
        db.commit()
        return AskResult(user_msg, assistant)

    if not ctx.workspace.external_ai_enabled and llm.name != "fake":
        assistant = _store_assistant(
            db,
            conv,
            ctx,
            "O processamento por provedores externos de IA está desativado neste workspace.",
            MessageStatus.AI_UNAVAILABLE,
            [],
            {},
            None,
            started,
        )
        db.commit()
        return AskResult(user_msg, assistant)

    # ---- recuperação
    retrieval = RetrievalService(db, embedding_provider).retrieve(content, scope)
    retrieval_meta = {
        "top_k": retrieval.top_k,
        "min_similarity": retrieval.min_similarity,
        "embedding_model": retrieval.embedding_model,
        "scoped_documents": [str(d) for d in retrieval.scoped_document_ids],
        "retrieved": [
            {"chunk_id": str(c.chunk_id), "document_id": str(c.document_id), "score": c.score}
            for c in retrieval.chunks
        ],
        "retrieval_latency_ms": retrieval.total_latency_ms,
    }
    record_usage(
        db,
        workspace_id=ctx.workspace_id,
        user_id=ctx.user.id,
        kind=UsageKind.EMBEDDING,
        provider=embedding_provider.name,
        model=retrieval.embedding_model,
        prompt_tokens=retrieval.embedding_tokens,
        latency_ms=retrieval.embedding_latency_ms,
        reference_type="message",
        reference_id=user_msg.id,
    )

    if not retrieval.chunks:
        assistant = _store_assistant(
            db,
            conv,
            ctx,
            NO_EVIDENCE_ANSWER,
            MessageStatus.NO_EVIDENCE,
            [],
            retrieval_meta,
            None,
            started,
        )
        record_usage(
            db,
            workspace_id=ctx.workspace_id,
            user_id=ctx.user.id,
            kind=UsageKind.QUESTION,
            provider=llm.name,
            model=None,
            reference_type="message",
            reference_id=assistant.id,
            extra={"skipped_generation": True},
        )
        db.commit()
        return AskResult(user_msg, assistant)

    # ---- contexto + geração
    context = build_context(retrieval.chunks, max_tokens=settings.max_context_tokens)
    messages = build_messages(content, context, history=_recent_history(conv))
    try:
        result = llm.generate(messages, max_tokens=settings.max_output_tokens)
    except Exception as exc:
        log.warning("llm_generation_failed", error_type=type(exc).__name__)
        assistant = _store_assistant(
            db,
            conv,
            ctx,
            "Não foi possível gerar a resposta neste momento (falha no provedor de IA). Tente novamente.",
            MessageStatus.ERROR,
            [],
            retrieval_meta,
            None,
            started,
        )
        db.commit()
        return AskResult(user_msg, assistant)

    validation = validate_citations(result.text, context.ids)
    retrieval_meta["context_tokens"] = context.tokens
    retrieval_meta["context_chunks"] = len(context.chunks)
    retrieval_meta["context_truncated"] = context.truncated
    retrieval_meta["invalid_citations_removed"] = validation.invalid_indices

    if validation.looks_like_abstention and not validation.has_valid_citations:
        status = MessageStatus.NO_EVIDENCE
    else:
        status = MessageStatus.OK

    # Citações: apenas chunks realmente citados; se o modelo respondeu sem citar nada,
    # anexamos como fontes os trechos usados no contexto (até 3) para rastreabilidade.
    cited = [(n, validation.chunks_by_index[n]) for n in validation.cited_indices]
    if not cited and status == MessageStatus.OK:
        cited = [(i, c) for i, c in list(context.ids.items())[:3]]

    assistant = _store_assistant(
        db, conv, ctx, validation.text, status, cited, retrieval_meta, result, started
    )
    record_usage(
        db,
        workspace_id=ctx.workspace_id,
        user_id=ctx.user.id,
        kind=UsageKind.QUESTION,
        provider=result.provider,
        model=result.model,
        prompt_tokens=result.prompt_tokens,
        completion_tokens=result.completion_tokens,
        latency_ms=result.latency_ms,
        reference_type="message",
        reference_id=assistant.id,
    )
    record_audit(
        db,
        action="conversation.ask",
        workspace_id=ctx.workspace_id,
        user_id=ctx.user.id,
        target_type="conversation",
        target_id=conv.id,
        ip_address=ip_address,
        details={"documents": len(retrieval.scoped_document_ids), "citations": len(cited)},
    )
    conv.updated_at = utcnow()
    db.commit()
    db.refresh(assistant)
    return AskResult(user_msg, assistant)


def _store_assistant(
    db, conv, ctx, text, status, cited, retrieval_meta, result, started
) -> Message:
    msg = Message(
        conversation_id=conv.id,
        workspace_id=ctx.workspace_id,
        role=MessageRole.ASSISTANT,
        content=text,
        status=status,
        model=result.model if result else None,
        prompt_tokens=result.prompt_tokens if result else None,
        completion_tokens=result.completion_tokens if result else None,
        latency_ms=int((time.perf_counter() - started) * 1000),
        retrieval_meta=retrieval_meta,
        created_at=utcnow(),
    )
    conv.messages.append(msg)
    db.add(msg)
    db.flush()
    for n, chunk in cited:
        db.add(
            MessageCitation(
                message_id=msg.id,
                index=n,
                chunk_id=chunk.chunk_id,
                document_id=chunk.document_id,
                document_name=chunk.document_name,
                page_start=chunk.page_start,
                page_end=chunk.page_end,
                section_title=chunk.section_title,
                snippet=_snippet(chunk.text),
                score=chunk.score,
            )
        )
    db.flush()
    conv.updated_at = utcnow()
    return msg


def _snippet(text: str, limit: int = 300) -> str:
    text = " ".join(text.split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


# ---------------------------------------------------------------- feedback
def set_feedback(
    db: Session, ctx: AuthContext, message_id: uuid.UUID, *, rating: int, comment: str | None
) -> Message:
    msg = db.scalar(
        select(Message)
        .join(Conversation, Conversation.id == Message.conversation_id)
        .options(selectinload(Message.citations), selectinload(Message.feedback))
        .where(
            Message.id == message_id,
            Message.workspace_id == ctx.workspace_id,
            Conversation.user_id == ctx.user.id,
            Conversation.deleted_at.is_(None),
        )
    )
    if msg is None:
        raise NotFoundError("Mensagem não encontrada.", code="message_not_found")
    if msg.role != MessageRole.ASSISTANT:
        raise ForbiddenError("Só é possível avaliar respostas do assistente.")
    if msg.feedback is None:
        msg.feedback = Feedback(
            message_id=msg.id,
            user_id=ctx.user.id,
            rating=rating,
            comment=comment,
            created_at=utcnow(),
        )
    else:
        msg.feedback.rating = rating
        msg.feedback.comment = comment
    db.commit()
    db.refresh(msg)
    return msg
