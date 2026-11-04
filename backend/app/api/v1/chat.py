from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import client_ip, get_current_auth
from app.core.database import get_db
from app.models import Conversation, Document, Message
from app.schemas.chat import (
    CitationOut,
    ConversationCreate,
    ConversationList,
    ConversationOut,
    ConversationSummaryOut,
    ConversationUpdate,
    FeedbackOut,
    FeedbackRequest,
    MessageOut,
    SendMessageRequest,
    SendMessageResponse,
)
from app.services import chat as chat_service
from app.services.auth import AuthContext

router = APIRouter(tags=["chat"])


def _mime_map(db: Session, messages: list[Message]) -> dict:
    ids = {c.document_id for m in messages for c in m.citations if c.document_id}
    if not ids:
        return {}
    rows = db.execute(select(Document.id, Document.mime_type).where(Document.id.in_(ids))).all()
    return {doc_id: mime for doc_id, mime in rows}


def citation_out(c, mimes: dict) -> CitationOut:
    out = CitationOut.model_validate(c)
    out.mime_type = mimes.get(c.document_id) if c.document_id else None
    return out


def message_out(m: Message, mimes: dict | None = None) -> MessageOut:
    mimes = mimes or {}
    return MessageOut(
        id=m.id,
        role=m.role,
        content=m.content,
        created_at=m.created_at,
        status=m.status,
        citations=[citation_out(c, mimes) for c in m.citations],
        model=m.model,
        prompt_tokens=m.prompt_tokens,
        completion_tokens=m.completion_tokens,
        latency_ms=m.latency_ms,
        feedback=FeedbackOut(rating=m.feedback.rating, comment=m.feedback.comment)
        if m.feedback
        else None,
    )


def conversation_out(conv: Conversation, db: Session) -> ConversationOut:
    mimes = _mime_map(db, conv.messages)
    return ConversationOut(
        id=conv.id,
        title=conv.title,
        created_at=conv.created_at,
        updated_at=conv.updated_at,
        message_count=len(conv.messages),
        document_ids=list(conv.document_ids),
        collection_ids=list(conv.collection_ids or []),
        messages=[message_out(m, mimes) for m in conv.messages],
    )


@router.post("/conversations", response_model=ConversationOut, status_code=status.HTTP_201_CREATED)
def create_conversation(
    payload: ConversationCreate,
    ctx: AuthContext = Depends(get_current_auth),
    db: Session = Depends(get_db),
) -> ConversationOut:
    conv = chat_service.create_conversation(
        db,
        ctx,
        title=payload.title,
        document_ids=payload.document_ids,
        collection_ids=payload.collection_ids,
    )
    return conversation_out(chat_service.get_conversation(db, ctx, conv.id), db)


@router.get("/conversations", response_model=ConversationList)
def list_conversations(
    ctx: AuthContext = Depends(get_current_auth), db: Session = Depends(get_db)
) -> ConversationList:
    return ConversationList(
        items=[
            ConversationSummaryOut(
                id=c.id,
                title=c.title,
                created_at=c.created_at,
                updated_at=c.updated_at,
                message_count=n,
                document_ids=list(c.document_ids),
                collection_ids=list(c.collection_ids or []),
            )
            for c, n in chat_service.list_conversations(db, ctx)
        ]
    )


@router.get("/conversations/{conversation_id}", response_model=ConversationOut)
def get_conversation(
    conversation_id: uuid.UUID,
    ctx: AuthContext = Depends(get_current_auth),
    db: Session = Depends(get_db),
) -> ConversationOut:
    return conversation_out(chat_service.get_conversation(db, ctx, conversation_id), db)


@router.patch("/conversations/{conversation_id}", response_model=ConversationOut)
def update_conversation(
    conversation_id: uuid.UUID,
    payload: ConversationUpdate,
    ctx: AuthContext = Depends(get_current_auth),
    db: Session = Depends(get_db),
) -> ConversationOut:
    conv = chat_service.get_conversation(db, ctx, conversation_id)
    chat_service.update_conversation(
        db,
        ctx,
        conv,
        title=payload.title,
        document_ids=payload.document_ids,
        collection_ids=payload.collection_ids,
    )
    return conversation_out(chat_service.get_conversation(db, ctx, conversation_id), db)


@router.delete("/conversations/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_conversation(
    conversation_id: uuid.UUID,
    ctx: AuthContext = Depends(get_current_auth),
    db: Session = Depends(get_db),
) -> Response:
    conv = chat_service.get_conversation(db, ctx, conversation_id)
    chat_service.delete_conversation(db, ctx, conv)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/conversations/{conversation_id}/messages", response_model=SendMessageResponse)
def send_message(
    conversation_id: uuid.UUID,
    payload: SendMessageRequest,
    request: Request,
    ctx: AuthContext = Depends(get_current_auth),
    db: Session = Depends(get_db),
) -> SendMessageResponse:
    conv = chat_service.get_conversation(db, ctx, conversation_id)
    result = chat_service.ask(
        db,
        ctx,
        conv,
        content=payload.content,
        document_ids=payload.document_ids,
        collection_ids=payload.collection_ids,
        ip_address=client_ip(request),
    )
    # Recarrega com citações/feedback
    db.expire_all()
    conv = chat_service.get_conversation(db, ctx, conversation_id)
    by_id = {m.id: m for m in conv.messages}
    mimes = _mime_map(db, conv.messages)
    return SendMessageResponse(
        user_message=message_out(by_id[result.user_message.id], mimes),
        assistant_message=message_out(by_id[result.assistant_message.id], mimes),
    )


@router.post("/messages/{message_id}/feedback", response_model=MessageOut)
def feedback(
    message_id: uuid.UUID,
    payload: FeedbackRequest,
    ctx: AuthContext = Depends(get_current_auth),
    db: Session = Depends(get_db),
) -> MessageOut:
    msg = chat_service.set_feedback(
        db, ctx, message_id, rating=payload.rating, comment=payload.comment
    )
    return message_out(msg, _mime_map(db, [msg]))
