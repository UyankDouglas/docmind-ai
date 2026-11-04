import { BrainCircuit, FileText } from "lucide-react";
import { TypingIndicator } from "@/components/Skeletons";
import type { StreamState } from "./hooks";
import { Markdown } from "./markdown";

/** Balão de rascunho enquanto a resposta chega por streaming. Substituído pela mensagem final em `done`. */
export function StreamingBubble({ state }: { state: StreamState }) {
  const label =
    state.phase === "connecting"
      ? "Enviando pergunta…"
      : state.phase === "retrieving"
        ? "Recuperando trechos…"
        : state.sources.length > 0
          ? `Consultando ${state.sources.length} trecho${state.sources.length === 1 ? "" : "s"}…`
          : "Gerando resposta…";

  return (
    <article className="flex gap-3 animate-slide-up" aria-label="Resposta em andamento" data-testid="streaming-bubble" aria-busy>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-brand text-white" aria-hidden>
        <BrainCircuit className="size-4" />
      </span>
      <div className="min-w-0 max-w-[min(100%,48rem)] space-y-2">
        <div className="rounded-2xl rounded-tl-sm border border-dashed border-primary/40 bg-card px-4 py-3 text-sm">
          {state.draft ? (
            <Markdown content={state.draft} renderCitation={(i, key) => <span key={key} className="text-muted-foreground">[{i}]</span>} />
          ) : null}
          <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
            <TypingIndicator />
            <span aria-live="polite">{label}</span>
          </div>
        </div>
        {state.sources.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5" aria-label="Fontes candidatas">
            {state.sources.map((s) => (
              <li key={s.chunk_id} className="inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-card/60 px-2 py-0.5 text-[11px] text-muted-foreground">
                <span className="font-semibold text-primary">[{s.index}]</span>
                <FileText className="size-3 shrink-0" aria-hidden />
                <span className="truncate">
                  {s.document_name} · {s.location_label}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="px-1 text-[10px] text-muted-foreground">Rascunho: as citações serão validadas ao final.</p>
      </div>
    </article>
  );
}
