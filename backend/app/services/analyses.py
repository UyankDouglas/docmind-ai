"""Análises documentais assíncronas: criação, execução (worker), consulta, cancelamento e exportação."""

from __future__ import annotations

import json
import time
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.exceptions import (
    AIUnavailableError,
    ConflictError,
    ForbiddenError,
    NotFoundError,
    ValidationAppError,
)
from app.core.logging import get_logger
from app.models import (
    Analysis,
    Conversation,
    Document,
    DocumentChunk,
    DocumentStatus,
    Message,
    MessageRole,
    UsageKind,
    WorkspaceRole,
)
from app.models.base import utcnow
from app.providers.embeddings import get_embedding_provider
from app.providers.llm import LLMProvider, get_llm_provider
from app.providers.tokens import get_token_counter
from app.rag.generation import analysis as engine
from app.rag.generation.analysis import SUMMARY_TYPES, AnalysisCancelledError, EvidenceUnit
from app.rag.retrieval import RetrievalScope, RetrievalService, RetrievedChunk
from app.services.audit import record_audit
from app.services.auth import AuthContext
from app.services.retrieval_settings import get_retrieval_settings
from app.services.usage import enforce_question_limit, record_usage

log = get_logger(__name__)

KINDS = ("summary", "comparison", "topics", "questions")
ACTIVE = ("queued", "running")
_LABELS = "ABCDE"


class AnalysisTooLargeError(ValidationAppError):
    code = "analysis_too_large"


# ----------------------------------------------------------------------------- helpers
def _ready_documents(db: Session, ctx: AuthContext, ids: list[uuid.UUID]) -> list[Document]:
    requested = list(dict.fromkeys(ids))
    docs = list(
        db.scalars(
            select(Document).where(
                Document.workspace_id == ctx.workspace_id,
                Document.deleted_at.is_(None),
                Document.id.in_(requested),
            )
        )
    )
    found = {d.id: d for d in docs}
    if set(requested) - set(found):
        raise NotFoundError("Documento não encontrado.", code="document_not_found")
    ordered = [found[i] for i in requested]
    not_ready = [d.name for d in ordered if d.status != DocumentStatus.READY]
    if not_ready:
        raise ConflictError(
            f"Documento(s) ainda não indexado(s): {', '.join(not_ready)}.",
            code="document_not_ready",
        )
    return ordered


def _total_tokens(db: Session, docs: list[Document]) -> int:
    total = 0
    for d in docs:
        total += int(
            db.scalar(
                select(func.coalesce(func.sum(DocumentChunk.token_count), 0)).where(
                    DocumentChunk.document_id == d.id,
                    DocumentChunk.indexing_version == d.indexing_version,
                )
            )
            or 0
        )
    return total


def _enforce_size(db: Session, docs: list[Document]) -> int:
    total = _total_tokens(db, docs)
    if total > settings.analysis_max_input_tokens:
        raise AnalysisTooLargeError(
            f"Os documentos somam ~{total} tokens; o limite por análise é {settings.analysis_max_input_tokens}."
        )
    return total


def _documents_meta(docs: list[Document], *, labels: bool) -> list[dict[str, Any]]:
    return [
        {
            "id": str(d.id),
            "name": d.name,
            "label": _LABELS[i] if labels else None,
            "version": d.indexing_version,
        }
        for i, d in enumerate(docs)
    ]


def _create(
    db: Session,
    ctx: AuthContext,
    *,
    kind: str,
    docs: list[Document],
    title: str,
    summary_type: str | None = None,
    question: str | None = None,
) -> Analysis:
    if ctx.role == WorkspaceRole.VIEWER and kind == "comparison":
        pass  # visualizadores podem comparar/resumir: só leitura dos documentos autorizados
    enforce_question_limit(db, ctx.user.id)
    _enforce_size(db, docs)
    analysis = Analysis(
        workspace_id=ctx.workspace_id,
        user_id=ctx.user.id,
        kind=kind,
        summary_type=summary_type,
        status="queued",
        title=title[:200],
        document_ids=[d.id for d in docs],
        documents_meta=_documents_meta(docs, labels=kind == "comparison"),
        question=question,
        created_at=utcnow(),
    )
    db.add(analysis)
    db.flush()
    record_usage(
        db,
        workspace_id=ctx.workspace_id,
        user_id=ctx.user.id,
        kind=UsageKind.QUESTION,
        reference_type="analysis",
        reference_id=analysis.id,
        extra={"kind": kind, "summary_type": summary_type, "documents": len(docs)},
    )
    record_audit(
        db,
        action=f"analysis.{kind}",
        workspace_id=ctx.workspace_id,
        user_id=ctx.user.id,
        target_type="analysis",
        target_id=analysis.id,
        details={"documents": [str(d.id) for d in docs], "summary_type": summary_type},
    )
    db.commit()
    _enqueue(analysis.id)
    db.refresh(analysis)
    return analysis


def _enqueue(analysis_id: uuid.UUID) -> None:
    from app.workers.tasks import run_analysis_task

    run_analysis_task.delay(str(analysis_id))


# ----------------------------------------------------------------------------- criação
def create_summary(
    db: Session, ctx: AuthContext, document_id: uuid.UUID, *, summary_type: str
) -> Analysis:
    if summary_type not in SUMMARY_TYPES:
        raise ValidationAppError("Tipo de resumo inválido.")
    (doc,) = _ready_documents(db, ctx, [document_id])
    return _create(
        db,
        ctx,
        kind="summary",
        docs=[doc],
        title=f"{SUMMARY_TYPES[summary_type][0]} — {doc.name}",
        summary_type=summary_type,
    )


def create_topics(db: Session, ctx: AuthContext, document_id: uuid.UUID) -> Analysis:
    (doc,) = _ready_documents(db, ctx, [document_id])
    return _create(db, ctx, kind="topics", docs=[doc], title=f"Tópicos — {doc.name}")


def create_or_reuse_questions(
    db: Session, ctx: AuthContext, document_id: uuid.UUID
) -> tuple[Analysis, bool]:
    (doc,) = _ready_documents(db, ctx, [document_id])
    existing = db.scalar(
        select(Analysis)
        .where(
            Analysis.workspace_id == ctx.workspace_id,
            Analysis.kind == "questions",
            Analysis.document_ids == [doc.id],
            Analysis.status.in_(["succeeded", "queued", "running"]),
        )
        .order_by(Analysis.created_at.desc())
    )
    if existing is not None:
        meta = (existing.documents_meta or [{}])[0]
        if meta.get("version") == doc.indexing_version:
            return existing, False
    return _create(
        db, ctx, kind="questions", docs=[doc], title=f"Perguntas sugeridas — {doc.name}"
    ), True


def create_comparison(
    db: Session, ctx: AuthContext, document_ids: list[uuid.UUID], *, question: str | None
) -> Analysis:
    if not (2 <= len(set(document_ids)) <= settings.analysis_max_documents):
        raise ValidationAppError(
            f"Selecione de 2 a {settings.analysis_max_documents} documentos distintos para comparar."
        )
    docs = _ready_documents(db, ctx, document_ids)
    names = " vs ".join(d.name for d in docs)
    return _create(
        db,
        ctx,
        kind="comparison",
        docs=docs,
        title=f"Comparação — {names}"[:200],
        question=(question or None),
    )


# ----------------------------------------------------------------------------- consulta
def get_analysis(db: Session, ctx: AuthContext, analysis_id: uuid.UUID) -> Analysis:
    a = db.scalar(
        select(Analysis).where(
            Analysis.id == analysis_id, Analysis.workspace_id == ctx.workspace_id
        )
    )
    if a is None:
        raise NotFoundError("Análise não encontrada.", code="analysis_not_found")
    return a


def list_analyses(
    db: Session,
    ctx: AuthContext,
    *,
    document_id: uuid.UUID | None,
    kind: str | None,
    page: int,
    page_size: int,
) -> tuple[list[Analysis], int]:
    base = select(Analysis).where(Analysis.workspace_id == ctx.workspace_id)
    if document_id is not None:
        base = base.where(Analysis.document_ids.any(document_id))
    if kind:
        if kind not in KINDS:
            raise ValidationAppError("Tipo de análise inválido.")
        base = base.where(Analysis.kind == kind)
    total = int(db.scalar(select(func.count()).select_from(base.subquery())) or 0)
    items = list(
        db.scalars(
            base.order_by(Analysis.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    )
    return items, total


def delete_analysis(db: Session, ctx: AuthContext, a: Analysis) -> None:
    if a.user_id != ctx.user.id and ctx.role != WorkspaceRole.ADMIN:
        raise ForbiddenError("Somente o autor ou um administrador pode excluir esta análise.")
    db.delete(a)
    db.commit()


def cancel_analysis(db: Session, ctx: AuthContext, a: Analysis) -> Analysis:
    if a.status not in ACTIVE:
        raise ConflictError("A análise já foi concluída.", code="analysis_finished")
    a.cancel_requested = True
    if a.status == "queued":
        a.status = "cancelled"
        a.finished_at = utcnow()
        a.error_message = "Cancelada pelo usuário."
    db.commit()
    db.refresh(a)
    return a


# ----------------------------------------------------------------------------- execução (worker)
def _units_for_document(
    db: Session, doc: Document, *, label: str | None, start_index: int
) -> list[EvidenceUnit]:
    chunks = db.scalars(
        select(DocumentChunk)
        .where(
            DocumentChunk.document_id == doc.id,
            DocumentChunk.indexing_version == doc.indexing_version,
        )
        .order_by(DocumentChunk.position)
    )
    units = []
    for i, c in enumerate(chunks, start=start_index):
        units.append(EvidenceUnit(index=i, chunk=_to_retrieved(c, doc), document_label=label))
    return units


def _to_retrieved(c: DocumentChunk, doc: Document, score: float = 1.0) -> RetrievedChunk:
    return RetrievedChunk(
        chunk_id=c.id,
        document_id=c.document_id,
        document_name=doc.name,
        text=c.text,
        score=score,
        page_start=c.page_start,
        page_end=c.page_end,
        section_title=c.section_title,
        position=c.position,
        token_count=c.token_count,
        mime_type=doc.mime_type,
    )


def _sources(units: list[EvidenceUnit], cited: list[int]) -> list[dict[str, Any]]:
    by_index = {u.index: u for u in units}
    out = []
    for n in cited:
        u = by_index.get(n)
        if not u:
            continue
        c = u.chunk
        out.append(
            {
                "index": n,
                "chunk_id": str(c.chunk_id),
                "document_id": str(c.document_id),
                "document_name": c.document_name,
                "document_label": u.document_label,
                "location_type": c.location_type,
                "location_label": c.location_label,
                "snippet": " ".join(c.text.split())[:300],
            }
        )
    return out


def run_analysis(
    db: Session, analysis_id: uuid.UUID, *, llm: LLMProvider | None = None
) -> Analysis:
    a = db.get(Analysis, analysis_id)
    if a is None:
        raise NotFoundError("Análise não encontrada.")
    if a.status not in ACTIVE or a.cancel_requested:
        if a.cancel_requested and a.status in ACTIVE:
            a.status, a.finished_at, a.error_message = (
                "cancelled",
                utcnow(),
                "Cancelada pelo usuário.",
            )
            db.commit()
        return a
    a.status = "running"
    a.started_at = utcnow()
    db.commit()
    started = time.perf_counter()

    def cancelled() -> bool:
        db.refresh(a, attribute_names=["cancel_requested"])
        return bool(a.cancel_requested)

    try:
        try:
            llm = llm or get_llm_provider()
        except AIUnavailableError as exc:
            raise AnalysisFailureError(str(exc)) from exc

        docs = list(db.scalars(select(Document).where(Document.id.in_(a.document_ids))))
        docs = sorted(docs, key=lambda d: a.document_ids.index(d.id))
        if any(d.deleted_at is not None or d.status != DocumentStatus.READY for d in docs):
            raise AnalysisFailureError("Um dos documentos foi removido ou não está mais indexado.")
        ws = docs[0].workspace_id
        from app.models import Workspace

        workspace = db.get(Workspace, ws)
        rs = get_retrieval_settings(workspace) if workspace else None
        budget = rs.max_context_tokens if rs else settings.max_context_tokens
        counter = get_token_counter()
        limitations: list[str] = []
        chunks_total = 0

        if a.kind in ("summary", "topics", "questions"):
            doc = docs[0]
            units = _units_for_document(db, doc, label=None, start_index=1)
            chunks_total = len(units)
            if a.kind == "summary":
                out = engine.summarize(
                    units,
                    summary_type=a.summary_type or "general",
                    llm=llm,
                    budget_tokens=budget,
                    max_output_tokens=settings.analysis_max_output_tokens,
                    document_name=doc.name,
                    counter=counter,
                    cancel=cancelled,
                )
            elif a.kind == "topics":
                out = engine.extract_topics(
                    units,
                    llm=llm,
                    budget_tokens=budget,
                    max_output_tokens=settings.analysis_max_output_tokens,
                    document_name=doc.name,
                    counter=counter,
                    cancel=cancelled,
                )
            else:
                out = engine.suggest_questions(
                    units,
                    llm=llm,
                    budget_tokens=budget,
                    document_name=doc.name,
                    counter=counter,
                    cancel=cancelled,
                )
            used_units = (
                units
                if out.strategy != "retrieval"
                else [u for u in units if u.index in set(out.cited_indices)] or units
            )
            chunks_used = (
                len(units)
                if out.strategy in ("single_pass", "hierarchical")
                else min(len(units), len(used_units))
            )
            complete = out.strategy in ("single_pass", "hierarchical")
            if out.strategy == "hierarchical":
                limitations.append(
                    f"Documento longo: resumo produzido em {out.parts} partes e depois consolidado "
                    "(estratégia hierárquica); detalhes de partes individuais podem ter sido condensados."
                )
            if a.kind == "questions":
                complete = out.strategy == "single_pass"
                chunks_used = len(units) if complete else max(1, len(units) // 2)
                if not complete:
                    limitations.append(
                        "Perguntas baseadas em uma amostra de trechos (início, meio e fim)."
                    )
        else:  # comparison
            total_tokens = _total_tokens(db, docs)
            complete = total_tokens <= budget
            units = []
            idx = 1
            if complete:
                for i, d in enumerate(docs):
                    du = _units_for_document(db, d, label=_LABELS[i], start_index=idx)
                    units += du
                    idx += len(du)
                chunks_total = len(units)
                chunks_used = len(units)
            else:
                try:
                    provider = get_embedding_provider()
                except AIUnavailableError as exc:
                    raise AnalysisFailureError(str(exc)) from exc
                retriever = RetrievalService(db, provider)
                query = a.question or engine.COMPARE_DEFAULT_QUESTION
                per_doc = settings.analysis_compare_top_k
                for i, d in enumerate(docs):
                    chunks_total += int(
                        db.scalar(
                            select(func.count())
                            .select_from(DocumentChunk)
                            .where(
                                DocumentChunk.document_id == d.id,
                                DocumentChunk.indexing_version == d.indexing_version,
                            )
                        )
                        or 0
                    )
                    res = retriever.retrieve(
                        query,
                        RetrievalScope(workspace_id=ws, document_ids=[d.id]),
                        mode=rs.mode if rs else "hybrid",
                        top_k=per_doc,
                        min_similarity=0.0,
                        rrf_k=rs.rrf_k if rs else 60,
                    )
                    for c in sorted(res.chunks, key=lambda c: c.position):
                        units.append(EvidenceUnit(index=idx, chunk=c, document_label=_LABELS[i]))
                        idx += 1
                chunks_used = len(units)
                limitations.append(
                    f"Documentos extensos: comparação baseada nos {per_doc} trechos mais relevantes de cada documento "
                    "para a pergunta orientadora; partes não recuperadas não foram comparadas."
                )
            if cancelled():
                raise AnalysisCancelledError()
            out = engine.compare(
                units,
                documents=[(_LABELS[i], d.name) for i, d in enumerate(docs)],
                question=a.question,
                llm=llm,
                max_output_tokens=settings.analysis_max_output_tokens,
                complete=complete,
                cancel=cancelled,
            )

        if out.invalid_indices:
            limitations.append(
                f"{len(out.invalid_indices)} marcador(es) de fonte inválido(s) foram removidos da resposta do modelo."
            )
        if llm.name == "fake":
            limitations.append(
                "Gerado por um provedor determinístico de testes (sem modelo de linguagem real); "
                "o conteúdo serve apenas para validar o fluxo."
            )
        if not out.cited_indices and a.kind != "questions":
            limitations.append(
                "A resposta do modelo não citou trechos; verifique as afirmações no documento."
            )

        a.result = {
            "content": out.content,
            "sources": _sources(units, out.cited_indices),
            "coverage": {
                "chunks_used": chunks_used,
                "chunks_total": chunks_total,
                "tokens_used": out.prompt_tokens,
                "strategy": out.strategy,
                "parts": out.parts,
                "complete": complete,
            },
            "limitations": limitations,
            "topics": out.topics,
            "questions": out.questions,
        }
        a.model = out.model
        a.prompt_tokens = out.prompt_tokens
        a.completion_tokens = out.completion_tokens
        a.latency_ms = int((time.perf_counter() - started) * 1000)
        a.status = "succeeded"
        a.finished_at = utcnow()
        record_usage(
            db,
            workspace_id=a.workspace_id,
            user_id=a.user_id,
            kind=UsageKind.QUESTION,
            provider=llm.name,
            model=out.model,
            prompt_tokens=out.prompt_tokens,
            completion_tokens=out.completion_tokens,
            latency_ms=a.latency_ms,
            reference_type="analysis",
            reference_id=a.id,
            extra={"kind": a.kind, "strategy": out.strategy, "parts": out.parts},
        )
        db.commit()
        log.info(
            "analysis_done",
            analysis_id=str(a.id),
            kind=a.kind,
            strategy=out.strategy,
            parts=out.parts,
        )
    except AnalysisCancelledError:
        db.rollback()
        a.status, a.finished_at, a.error_message = "cancelled", utcnow(), "Cancelada pelo usuário."
        db.commit()
    except AnalysisFailureError as exc:
        db.rollback()
        a.status, a.finished_at, a.error_message = "failed", utcnow(), str(exc)
        db.commit()
    except Exception as exc:
        log.exception(
            "analysis_failed", analysis_id=str(analysis_id), error_type=type(exc).__name__
        )
        db.rollback()
        a.status, a.finished_at = "failed", utcnow()
        a.error_message = "Falha inesperada ao gerar a análise. Tente novamente."
        db.commit()
    return a


class AnalysisFailureError(Exception):
    pass


# ----------------------------------------------------------------------------- exportação
def export_analysis(a: Analysis, fmt: str) -> tuple[bytes, str, str]:
    """Retorna (conteúdo, media type, nome do arquivo)."""
    slug = _slug(a.title)
    if fmt == "json":
        payload = {
            "id": str(a.id),
            "kind": a.kind,
            "summary_type": a.summary_type,
            "title": a.title,
            "status": a.status,
            "documents": a.documents_meta,
            "question": a.question,
            "result": a.result,
            "model": a.model,
            "prompt_tokens": a.prompt_tokens,
            "completion_tokens": a.completion_tokens,
            "created_at": _iso(a.created_at),
            "finished_at": _iso(a.finished_at),
            "exported_at": _iso(utcnow()),
        }
        return (
            json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8"),
            "application/json",
            f"{slug}.json",
        )
    if fmt != "md":
        raise ValidationAppError("Formato inválido (use md ou json).")
    lines = [f"# {a.title}", ""]
    lines.append(f"- Tipo: {a.kind}" + (f" ({a.summary_type})" if a.summary_type else ""))
    lines.append(
        f"- Documentos: {', '.join(d['name'] + (f' [{d["label"]}]' if d.get('label') else '') for d in a.documents_meta)}"
    )
    if a.question:
        lines.append(f"- Pergunta orientadora: {a.question}")
    lines.append(f"- Gerado em: {_iso(a.finished_at or a.created_at)} · Modelo: {a.model or '—'}")
    lines.append("")
    if a.status != "succeeded" or not a.result:
        lines.append(f"_Análise não concluída (status: {a.status}). {a.error_message or ''}_")
    else:
        r = a.result
        lines += [r["content"], "", "## Fontes", ""]
        for s in r["sources"]:
            doc = f"{s['document_name']}" + (
                f" [{s['document_label']}]" if s.get("document_label") else ""
            )
            lines.append(f"- [{s['index']}] {doc} — {s['location_label']}: {s['snippet']}")
        cov = r["coverage"]
        lines += [
            "",
            "## Cobertura e limitações",
            "",
            f"- Estratégia: {cov['strategy']} ({cov['parts']} parte(s)); trechos usados: {cov['chunks_used']}/{cov['chunks_total']}; "
            f"cobertura completa: {'sim' if cov['complete'] else 'não'}",
        ]
        lines += [f"- {lim}" for lim in r.get("limitations", [])]
    lines += [
        "",
        "---",
        "Exportado pelo DocMind AI. As afirmações devem ser conferidas nas fontes indicadas.",
    ]
    return "\n".join(lines).encode("utf-8"), "text/markdown; charset=utf-8", f"{slug}.md"


def export_conversation(db: Session, conv: Conversation, fmt: str) -> tuple[bytes, str, str]:
    slug = _slug(conv.title or "conversa")
    msgs = [m for m in conv.messages if m.role in (MessageRole.USER, MessageRole.ASSISTANT)]
    if fmt == "json":
        payload = {
            "id": str(conv.id),
            "title": conv.title,
            "created_at": _iso(conv.created_at),
            "document_ids": [str(d) for d in conv.document_ids],
            "collection_ids": [str(c) for c in (conv.collection_ids or [])],
            "messages": [
                {
                    "id": str(m.id),
                    "role": m.role,
                    "status": m.status,
                    "content": m.content,
                    "created_at": _iso(m.created_at),
                    "model": m.model,
                    "citations": [
                        {
                            "index": c.index,
                            "document_id": str(c.document_id) if c.document_id else None,
                            "document_name": c.document_name,
                            "location_label": c.location_label,
                            "snippet": c.snippet,
                        }
                        for c in m.citations
                    ],
                }
                for m in msgs
            ],
            "exported_at": _iso(utcnow()),
        }
        return (
            json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8"),
            "application/json",
            f"{slug}.json",
        )
    if fmt != "md":
        raise ValidationAppError("Formato inválido (use md ou json).")
    lines = [f"# {conv.title}", "", f"Conversa iniciada em {_iso(conv.created_at)}", ""]
    for m in msgs:
        who = "Você" if m.role == MessageRole.USER else "DocMind"
        lines += [f"## {who} — {_iso(m.created_at)}", "", m.content, ""]
        if m.citations:
            lines.append("Fontes:")
            lines += [
                f"- [{c.index}] {c.document_name} — {c.location_label}: {c.snippet}"
                for c in m.citations
            ]
            lines.append("")
        if m.role == MessageRole.ASSISTANT and m.status != "ok":
            lines += [f"_Status: {m.status}_", ""]
    lines += [
        "---",
        "Exportado pelo DocMind AI. As afirmações devem ser conferidas nas fontes indicadas.",
    ]
    return "\n".join(lines).encode("utf-8"), "text/markdown; charset=utf-8", f"{slug}.md"


def _slug(text: str) -> str:
    import re
    import unicodedata

    t = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    t = re.sub(r"[^a-zA-Z0-9]+", "-", t).strip("-").lower()
    return (t or "analise")[:60]


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def message_count(db: Session, conv: Conversation) -> int:
    return int(
        db.scalar(
            select(func.count()).select_from(Message).where(Message.conversation_id == conv.id)
        )
        or 0
    )
