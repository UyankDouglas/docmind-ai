import * as React from "react";
import { AlertTriangle, BrainCircuit, FileText, Info, SearchX, ThumbsDown, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn, formatDateTime, initials } from "@/lib/utils";
import type { Citation, Message } from "@/types/api";
import { Markdown } from "./markdown";

export interface MessageBubbleProps {
  message: Message;
  userName?: string;
  onCitationClick?: (citation: Citation) => void;
  onFeedback?: (messageId: string, rating: 1 | -1) => void;
  feedbackPending?: boolean;
  activeCitationId?: string | null;
}

export function citationLabel(c: Citation): string {
  if (c.page_start) {
    const pages = c.page_end && c.page_end !== c.page_start ? `Páginas ${c.page_start}–${c.page_end}` : `Página ${c.page_start}`;
    return `${c.document_name} — ${pages}`;
  }
  if (c.section_title) return `${c.document_name} — ${c.section_title}`;
  return c.document_name;
}

export function MessageBubble({ message, userName, onCitationClick, onFeedback, feedbackPending, activeCitationId }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const byIndex = React.useMemo(() => new Map(message.citations.map((c) => [c.index, c])), [message.citations]);

  const renderCitation = React.useCallback(
    (index: number, key: string) => {
      const c = byIndex.get(index);
      if (!c) {
        // marcador sem fonte correspondente: exibe como texto, sem fingir referência válida
        return (
          <span key={key} className="text-muted-foreground">
            [{index}]
          </span>
        );
      }
      return (
        <Tooltip key={key}>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => onCitationClick?.(c)}
              className={cn(
                "mx-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-md border px-1 align-text-top text-[11px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                activeCitationId === c.id
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20",
              )}
              aria-label={`Fonte ${index}: ${citationLabel(c)}`}
              data-testid={`citation-chip-${index}`}
            >
              {index}
            </button>
          </TooltipTrigger>
          <TooltipContent>{citationLabel(c)}</TooltipContent>
        </Tooltip>
      );
    },
    [byIndex, onCitationClick, activeCitationId],
  );

  return (
    <article
      className={cn("flex gap-3 animate-slide-up", isUser && "flex-row-reverse")}
      aria-label={isUser ? "Sua mensagem" : "Resposta do assistente"}
      data-testid={`message-${message.role}`}
    >
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
          isUser ? "bg-secondary text-secondary-foreground" : "bg-gradient-brand text-white",
        )}
        aria-hidden
      >
        {isUser ? initials(userName ?? "Você") : <BrainCircuit className="size-4" />}
      </span>

      <div className={cn("min-w-0 max-w-[min(100%,48rem)] space-y-2", isUser && "items-end")}>
        <div
          className={cn(
            "rounded-2xl px-4 py-3 text-sm",
            isUser ? "rounded-tr-sm bg-primary text-primary-foreground" : "rounded-tl-sm border border-border bg-card",
          )}
        >
          {!isUser && message.status === "no_evidence" ? (
            <div className="mb-2 flex items-start gap-2 rounded-lg bg-warning/10 p-2 text-xs text-foreground" data-testid="no-evidence">
              <SearchX className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
              <span>Sem evidência suficiente nos documentos selecionados.</span>
            </div>
          ) : null}
          {!isUser && message.status === "ai_unavailable" ? (
            <div className="mb-2 flex items-start gap-2 rounded-lg bg-info/10 p-2 text-xs text-foreground" data-testid="ai-unavailable">
              <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
              <span>Geração com IA indisponível: nenhum provedor configurado no servidor.</span>
            </div>
          ) : null}
          {!isUser && message.status === "error" ? (
            <div className="mb-2 flex items-start gap-2 rounded-lg bg-destructive/10 p-2 text-xs text-foreground" data-testid="message-error">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
              <span>Ocorreu um erro ao gerar a resposta.</span>
            </div>
          ) : null}

          {isUser ? (
            <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
          ) : (
            <Markdown content={message.content} renderCitation={renderCitation} />
          )}
        </div>

        {!isUser && message.citations.length > 0 ? (
          <section aria-label="Fontes" className="rounded-xl border border-border bg-card/60 p-3">
            <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Fontes</h4>
            <ul className="space-y-1">
              {message.citations.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => onCitationClick?.(c)}
                    className={cn(
                      "flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-ring",
                      activeCitationId === c.id && "bg-primary/10",
                    )}
                    data-testid={`citation-source-${c.index}`}
                  >
                    <span className="mt-px flex size-4 shrink-0 items-center justify-center rounded bg-primary/15 text-[10px] font-semibold text-primary">
                      {c.index}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1 font-medium">
                        <FileText className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="truncate">{citationLabel(c)}</span>
                      </span>
                      <span className="mt-0.5 line-clamp-2 text-muted-foreground">{c.snippet}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <div className={cn("flex items-center gap-2 px-1 text-[11px] text-muted-foreground", isUser && "justify-end")}>
          <time dateTime={message.created_at}>{formatDateTime(message.created_at)}</time>
          {!isUser && message.model ? <span>· {message.model}</span> : null}
          {!isUser && message.latency_ms != null ? <span>· {(message.latency_ms / 1000).toFixed(1)}s</span> : null}
          {!isUser && onFeedback && message.status !== "ai_unavailable" ? (
            <span className="ml-auto flex items-center gap-0.5" role="group" aria-label="Avaliar resposta">
              <Button
                variant="ghost"
                size="icon-sm"
                className={cn("size-7", message.feedback?.rating === 1 && "text-success")}
                onClick={() => onFeedback(message.id, 1)}
                disabled={feedbackPending}
                aria-pressed={message.feedback?.rating === 1}
                aria-label="Resposta útil"
              >
                <ThumbsUp className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className={cn("size-7", message.feedback?.rating === -1 && "text-destructive")}
                onClick={() => onFeedback(message.id, -1)}
                disabled={feedbackPending}
                aria-pressed={message.feedback?.rating === -1}
                aria-label="Resposta não útil"
              >
                <ThumbsDown className="size-3.5" />
              </Button>
            </span>
          ) : null}
        </div>
      </div>
    </article>
  );
}
