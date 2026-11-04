import { Link } from "react-router";
import { CheckCircle2, Cpu, FlaskConical, Layers, Timer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ErrorState";
import { viewerHref } from "@/lib/documents";
import { cn } from "@/lib/utils";
import type { EvidenceCandidate, RetrievalEvidence } from "@/types/api";
import { useRetrievalEvidence } from "./hooks";

export const MODE_LABELS = { hybrid: "Híbrida (vetorial + léxica)", vector: "Vetorial" } as const;

function pct(v: number | null): string {
  return v == null ? "—" : `${Math.round(v * 100)}%`;
}

export function CandidateRow({ c }: { c: EvidenceCandidate }) {
  const width = Math.max(2, Math.min(100, Math.round(c.score * 100)));
  return (
    <li
      className={cn(
        "rounded-lg border p-3 text-xs",
        c.cited ? "border-primary/50 bg-primary/5" : c.in_context ? "border-border bg-card" : "border-dashed border-border/70 bg-transparent opacity-80",
      )}
      data-testid={`evidence-candidate${c.cited ? "-cited" : c.in_context ? "-context" : ""}`}
    >
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        {c.cited ? (
          <Badge variant="purple">
            <CheckCircle2 className="mr-1 size-3" aria-hidden /> Citada [{c.citation_index}]
          </Badge>
        ) : c.in_context ? (
          <Badge variant="muted">No contexto</Badge>
        ) : (
          <Badge variant="outline">Não enviada</Badge>
        )}
        <Link
          to={viewerHref({ document_id: c.document_id, chunk_id: c.chunk_id })}
          className="min-w-0 truncate font-medium hover:underline"
        >
          {c.document_name}
        </Link>
        <span className="text-muted-foreground">· {c.location_label}</span>
      </div>
      <div className="mb-1 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div className="h-full rounded-full bg-gradient-brand" style={{ width: `${width}%` }} />
        </div>
        <span className="w-10 text-right tabular-nums" aria-label={`Score ${pct(c.score)}`}>
          {pct(c.score)}
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground">
        vetorial {pct(c.vector_score)} · léxico {pct(c.lexical_score)}
      </p>
      <p className="mt-1 line-clamp-2 text-muted-foreground">{c.snippet}</p>
    </li>
  );
}

export function EvidenceDetails({ evidence }: { evidence: RetrievalEvidence }) {
  const inContext = evidence.candidates.filter((c) => c.in_context).length;
  const cited = evidence.candidates.filter((c) => c.cited).length;
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
        <div>
          <dt className="flex items-center gap-1 text-muted-foreground">
            <Layers className="size-3" aria-hidden /> Modo
          </dt>
          <dd className="font-medium">{MODE_LABELS[evidence.mode]}</dd>
        </div>
        <div>
          <dt className="flex items-center gap-1 text-muted-foreground">
            <FlaskConical className="size-3" aria-hidden /> Parâmetros
          </dt>
          <dd className="font-medium">
            top_k {evidence.params.top_k} · limiar {evidence.params.min_similarity}
          </dd>
        </div>
        <div>
          <dt className="flex items-center gap-1 text-muted-foreground">
            <Timer className="size-3" aria-hidden /> Latência
          </dt>
          <dd className="font-medium">
            recuperação {evidence.latency.retrieval_ms} ms
            {evidence.latency.generation_ms != null ? ` · geração ${evidence.latency.generation_ms} ms` : ""}
          </dd>
        </div>
        <div>
          <dt className="flex items-center gap-1 text-muted-foreground">
            <Cpu className="size-3" aria-hidden /> Modelo
          </dt>
          <dd className="font-medium">
            {evidence.usage.model ?? "—"}
            {evidence.usage.prompt_tokens != null ? ` · ${evidence.usage.prompt_tokens} + ${evidence.usage.completion_tokens ?? 0} tokens` : ""}
          </dd>
        </div>
      </dl>

      <p className="text-xs text-muted-foreground" data-testid="evidence-summary">
        {evidence.candidates.length} trecho{evidence.candidates.length === 1 ? "" : "s"} recuperado
        {evidence.candidates.length === 1 ? "" : "s"} · {inContext} enviado{inContext === 1 ? "" : "s"} ao modelo (
        {evidence.context_tokens} tokens{evidence.context_truncated ? ", contexto truncado" : ""}) · {cited} citado
        {cited === 1 ? "" : "s"} · embeddings {evidence.params.embedding_model}
        {evidence.invalid_citations_removed.length > 0
          ? ` · ${evidence.invalid_citations_removed.length} marcador(es) inválido(s) removido(s): ${evidence.invalid_citations_removed.map((n) => `[${n}]`).join(" ")}`
          : ""}
      </p>

      {evidence.candidates.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
          Nenhum trecho ultrapassou o limiar de similaridade; a resposta foi uma abstenção.
        </p>
      ) : (
        <ol className="space-y-2" aria-label="Trechos candidatos">
          {evidence.candidates.map((c) => (
            <CandidateRow key={c.chunk_id} c={c} />
          ))}
        </ol>
      )}
    </div>
  );
}

export function EvidenceDialog({ messageId, onOpenChange }: { messageId: string | null; onOpenChange: (open: boolean) => void }) {
  const { data, isPending, isError, error, refetch } = useRetrievalEvidence(messageId);
  return (
    <Dialog open={!!messageId} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Como esta resposta foi gerada</DialogTitle>
          <DialogDescription>
            Trechos recuperados, quais foram enviados ao modelo e quais foram citados. Os scores vêm da busca, não do modelo.
          </DialogDescription>
        </DialogHeader>
        {!messageId ? null : isPending ? (
          <div className="space-y-2" role="status" aria-label="Carregando evidências">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} title="Não foi possível carregar as evidências" />
        ) : data ? (
          <EvidenceDetails evidence={data} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
