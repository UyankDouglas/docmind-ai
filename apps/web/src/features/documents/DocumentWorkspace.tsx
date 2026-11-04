import * as React from "react";
import { Link } from "react-router";
import { ExternalLink, FileText, Info, PanelRightClose, PanelRightOpen, Quote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { StatusBadge } from "@/components/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ErrorState";
import { cn, formatBytes, formatDateTime } from "@/lib/utils";
import { useChunk, useDocument, useDocumentChunks } from "./hooks";
import type { HighlightMatch } from "./pdf/highlight";

const PdfViewer = React.lazy(() => import("./pdf/PdfViewer").then((m) => ({ default: m.PdfViewer })));

interface Props {
  documentId: string;
  page: number;
  onPageChange: (page: number) => void;
  chunkId?: string | null;
  onChunkChange?: (chunkId: string | null) => void;
  /** quando usado como painel lateral do chat */
  embedded?: boolean;
  headerExtra?: React.ReactNode;
  className?: string;
}

/**
 * Visualizador de documento: PDF à esquerda, painel de metadados/trechos à direita.
 * Reutilizado pela página /documents/:id e pelo painel lateral do chat.
 */
export function DocumentWorkspace({ documentId, page, onPageChange, chunkId, onChunkChange, embedded = false, headerExtra, className }: Props) {
  const doc = useDocument(documentId);
  const chunks = useDocumentChunks(documentId, page);
  const activeChunk = useChunk(chunkId);
  const [panelOpen, setPanelOpen] = React.useState(!embedded);
  const [highlight, setHighlight] = React.useState<HighlightMatch | null | undefined>(undefined);

  // Quando um chunk é escolhido e tem página, navega para ela
  React.useEffect(() => {
    if (activeChunk.data?.page_start && activeChunk.data.page_start !== page) {
      onPageChange(activeChunk.data.page_start);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChunk.data?.id]);

  const highlightText = activeChunk.data && activeChunk.data.page_start === page ? activeChunk.data.text : null;

  if (doc.isError) {
    return (
      <div className="p-6">
        <ErrorState error={doc.error} onRetry={() => void doc.refetch()} title="Documento indisponível" />
      </div>
    );
  }

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card px-3">
        <FileText className="size-4 shrink-0 text-primary" aria-hidden />
        {doc.isPending ? (
          <Skeleton className="h-4 w-48" />
        ) : (
          <h2 className="min-w-0 flex-1 truncate text-sm font-medium" title={doc.data.name}>
            {doc.data.name}
          </h2>
        )}
        {doc.data ? <StatusBadge status={doc.data.status} className="hidden sm:inline-flex" /> : null}
        {embedded ? (
          <Button variant="ghost" size="icon-sm" asChild aria-label="Abrir em página própria">
            <Link to={`/documents/${documentId}?page=${page}${chunkId ? `&chunk=${chunkId}` : ""}`}>
              <ExternalLink />
            </Link>
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setPanelOpen((v) => !v)}
          aria-label={panelOpen ? "Ocultar painel de detalhes" : "Mostrar painel de detalhes"}
          aria-pressed={panelOpen}
        >
          {panelOpen ? <PanelRightClose /> : <PanelRightOpen />}
        </Button>
        {headerExtra}
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          {doc.data && doc.data.mime_type !== "application/pdf" ? (
            <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
              Visualização disponível apenas para PDF nesta fase.
            </div>
          ) : (
            <React.Suspense
              fallback={
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground" role="status">
                  Carregando visualizador…
                </div>
              }
            >
              <PdfViewer
                documentId={documentId}
                page={page}
                onPageChange={onPageChange}
                highlightText={highlightText}
                onHighlightResult={setHighlight}
              />
            </React.Suspense>
          )}
        </div>

        {panelOpen ? (
          <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-border bg-card" aria-label="Detalhes do documento">
            {activeChunk.data ? (
              <section className="border-b border-border p-4">
                <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <Quote className="size-3.5" aria-hidden /> Trecho citado
                  {onChunkChange ? (
                    <button type="button" onClick={() => onChunkChange(null)} className="ml-auto text-xs normal-case text-primary hover:underline">
                      Limpar
                    </button>
                  ) : null}
                </div>
                <p className="mb-2 text-xs text-muted-foreground">
                  {activeChunk.data.page_start ? `Página ${activeChunk.data.page_start}` : "Posição textual"}
                  {activeChunk.data.section_title ? ` · ${activeChunk.data.section_title}` : ""}
                </p>
                <blockquote className="max-h-64 overflow-y-auto rounded-lg border-l-2 border-primary bg-primary/5 p-3 text-sm leading-relaxed whitespace-pre-wrap">
                  {activeChunk.data.text}
                </blockquote>
                {highlightText && highlight === null ? (
                  <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground" data-testid="highlight-fallback">
                    <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    Trecho exibido no painel (não foi possível localizar a posição exata na página).
                  </p>
                ) : highlightText && highlight?.partial ? (
                  <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
                    <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    Apenas parte do trecho foi localizada na página; o restante está neste painel.
                  </p>
                ) : null}
              </section>
            ) : null}

            <section className="border-b border-border p-4">
              <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Metadados</h3>
              {doc.isPending ? (
                <div className="space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              ) : (
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
                  <dt className="text-muted-foreground">Arquivo</dt>
                  <dd className="truncate" title={doc.data.original_name}>{doc.data.original_name}</dd>
                  <dt className="text-muted-foreground">Tamanho</dt>
                  <dd>{formatBytes(doc.data.size_bytes)}</dd>
                  <dt className="text-muted-foreground">Páginas</dt>
                  <dd>{doc.data.page_count ?? "—"}</dd>
                  <dt className="text-muted-foreground">Trechos</dt>
                  <dd>{doc.data.chunk_count}</dd>
                  <dt className="text-muted-foreground">Caracteres</dt>
                  <dd>{doc.data.char_count?.toLocaleString("pt-BR") ?? "—"}</dd>
                  <dt className="text-muted-foreground">Enviado</dt>
                  <dd>{formatDateTime(doc.data.created_at)}</dd>
                  <dt className="text-muted-foreground">Processado</dt>
                  <dd>{formatDateTime(doc.data.processed_at)}</dd>
                  <dt className="text-muted-foreground">Versão</dt>
                  <dd>v{doc.data.indexing_version}</dd>
                  <dt className="text-muted-foreground">SHA-256</dt>
                  <dd className="truncate font-mono" title={doc.data.sha256}>{doc.data.sha256.slice(0, 16)}…</dd>
                </dl>
              )}
            </section>

            <section className="p-4">
              <h3 className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Trechos da página {page}
                {chunks.data ? <Badge variant="muted">{chunks.data.length}</Badge> : null}
              </h3>
              {chunks.isPending ? (
                <div className="space-y-2">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : chunks.isError ? (
                <p className="text-xs text-muted-foreground">Não foi possível carregar os trechos.</p>
              ) : chunks.data.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Nenhum trecho indexado nesta página{doc.data?.status !== "ready" ? " (documento ainda não está pronto)" : ""}.
                </p>
              ) : (
                <ul className="space-y-2">
                  {chunks.data.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => onChunkChange?.(c.id)}
                        className={cn(
                          "w-full rounded-lg border p-2.5 text-left text-xs leading-relaxed transition-colors hover:border-primary/50 hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-ring",
                          c.id === chunkId ? "border-primary bg-primary/10" : "border-border",
                        )}
                        aria-pressed={c.id === chunkId}
                      >
                        <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          Trecho #{c.position + 1}
                          {c.section_title ? ` · ${c.section_title}` : ""}
                        </span>
                        <span className="line-clamp-4">{c.text}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <Separator />
          </aside>
        ) : null}
      </div>
    </div>
  );
}
