import * as React from "react";
import { MessageSquareText, Sparkles } from "lucide-react";
import { TypingIndicator } from "@/components/Skeletons";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ErrorState";
import type { Citation, Conversation } from "@/types/api";
import { MessageBubble } from "./MessageBubble";
import { StreamingBubble } from "./StreamingBubble";
import type { StreamState } from "./hooks";

interface Props {
  conversation: Conversation | undefined;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  sending: boolean;
  userName?: string;
  onCitationClick: (c: Citation) => void;
  onFeedback: (messageId: string, rating: 1 | -1) => void;
  feedbackPending?: boolean;
  activeCitationId?: string | null;
  suggestions?: string[];
  onSuggestion?: (text: string) => void;
  /** estado do streaming; quando ativo, mostra o balão de rascunho em vez do indicador genérico */
  stream?: StreamState;
  onExplain?: (messageId: string) => void;
}

export function ChatThread({
  conversation,
  isPending,
  isError,
  error,
  onRetry,
  sending,
  userName,
  onCitationClick,
  onFeedback,
  feedbackPending,
  activeCitationId,
  suggestions = [],
  onSuggestion,
  stream,
  onExplain,
}: Props) {
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const count = conversation?.messages.length ?? 0;
  const streaming = !!stream && stream.phase !== "idle";
  const draftLength = stream?.draft.length ?? 0;

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [count, sending, streaming, draftLength]);

  if (isPending) {
    return (
      <div className="space-y-6 p-6" role="status" aria-label="Carregando conversa">
        <div className="flex justify-end">
          <Skeleton className="h-10 w-1/2 rounded-2xl" />
        </div>
        <div className="flex gap-3">
          <Skeleton className="size-8 rounded-full" />
          <Skeleton className="h-24 w-3/4 rounded-2xl" />
        </div>
      </div>
    );
  }
  if (isError) {
    return (
      <div className="p-6">
        <ErrorState error={error} onRetry={onRetry} title="Não foi possível carregar a conversa" />
      </div>
    );
  }
  if (!conversation) return null;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 sm:p-6" role="log" aria-live="polite" aria-relevant="additions">
      {conversation.messages.length === 0 && !sending && !streaming ? (
        <div className="flex flex-col items-center py-10 text-center animate-fade-in">
          <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-gradient-brand text-white shadow-lg">
            <MessageSquareText className="size-7" aria-hidden />
          </div>
          <h3 className="text-lg font-semibold">Pergunte aos seus documentos</h3>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            As respostas são geradas apenas a partir dos trechos recuperados dos documentos selecionados e trazem
            as fontes com página.
          </p>
          {suggestions.length > 0 ? (
            <ul className="mt-6 grid w-full max-w-lg gap-2 sm:grid-cols-2">
              {suggestions.map((s) => (
                <li key={s}>
                  <button
                    type="button"
                    onClick={() => onSuggestion?.(s)}
                    className="flex w-full items-start gap-2 rounded-xl border border-border bg-card p-3 text-left text-sm transition-colors hover:border-primary/50 hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {conversation.messages.map((m) => (
        <MessageBubble
          key={m.id}
          message={m}
          userName={userName}
          onCitationClick={onCitationClick}
          onFeedback={m.id.startsWith("optimistic-") ? undefined : onFeedback}
          feedbackPending={feedbackPending}
          activeCitationId={activeCitationId}
          onExplain={m.id.startsWith("optimistic-") ? undefined : onExplain}
        />
      ))}

      {streaming && stream ? (
        <StreamingBubble state={stream} />
      ) : sending ? (
        <div className="flex gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-brand text-white" aria-hidden>
            <Sparkles className="size-4" />
          </span>
          <div className="rounded-2xl rounded-tl-sm border border-border bg-card px-4 py-3">
            <TypingIndicator />
            <p className="mt-1 text-[11px] text-muted-foreground">Recuperando trechos e gerando resposta…</p>
          </div>
        </div>
      ) : null}
      <div ref={bottomRef} />
    </div>
  );
}
