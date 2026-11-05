import * as React from "react";
import { Link } from "react-router";
import { ExternalLink, Info, PanelRightClose, PanelRightOpen, Quote, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { StatusBadge } from "@/components/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ErrorState";
import { documentKind, isPdf, KIND_ICONS, KIND_LABELS, locationLabel } from "@/lib/documents";
import { cn, formatBytes, formatDateTime } from "@/lib/utils";
import { useChunk, useDocument, useDocumentChunks } from "./hooks";
import type { HighlightMatch } from "./pdf/highlight";
import { VersionsPanel } from "./VersionsPanel";
import type { AnalysisSource } from "@/types/api";

const DocumentAnalysesPanel = React.lazy(() =>
  import("@/features/analyses/DocumentAnalysesPanel").then((m) => ({ default: m.DocumentAnalysesPanel })),
);

type AsideTab = "details" | "analyses";

const PdfViewer = React.lazy(() => import("./pdf/PdfViewer").then((m) => ({ default: m.PdfViewer })));
const TextDocumentViewer = React.lazy(() =>
  import("./text/TextDocumentViewer").then((m) => ({ default: m.TextDocumentViewer })),
);

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
  /** mostra a aba "Análises" (resumos, tópicos, perguntas) no painel lateral */
  analyses?: boolean;
  /** aba inicial do painel lateral */
  initialTab?: AsideTab;
}

/**
 * Visualizador de documento: PDF.js para PDF, texto por seções para DOCX/TXT;
 * painel de metadados/trechos/versões à direita. Reutilizado pela página /documents/:id e pelo chat.
 */
export function DocumentWorkspace({ documentId, page, onPageChange, chunkId, onChunkChange, embedded = false, headerExtra, className, analyses = false, initialTab = "details" }: Props) {
  const doc = useDocument(documentId);
  const pdf = doc.data ? isPdf(doc.data.mime_type) : true;
  const chunks = useDocumentChunks(documentId, pdf ? page : undefined);
  const activeChunk = useChunk(chunkId);
  const [panelOpen, setPanelOpen] = React.useState(!embedded);
  const [asideTab, setAsideTab] = React.useState<AsideTab>(analyses ? initialTab : "details");
  const openSource = React.useCallback(
    (s: AnalysisSource) => {
      if (s.chunk_id) onChunkChange?.(s.chunk_id);
    },
    [onChunkChange],
  );
  const [highlight, setHighlight] = React.useState<HighlightMatch | null | undefined>(undefined);
  const [textHighlightFound, setTextHighlightFound] = React.useState<boolean | undefined>(undefined);
  const [activeSection, setActiveSection] = React.useState<number | null>(null);

  // PDF: quando um chunk é escolhido e tem página, navega para ela
  React.useEffect(() => {
    if (pdf && activeChunk.data?.page_start && activeChunk.data.page_start !== page) {
      onPageChange(activeChunk.data.page_start);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChunk.data?.id, pdf]);

  const highlightText = pdf && activeChunk.data && activeChunk.data.page_start === page ? activeChunk.data.text : null;
  const kind = documentKind(doc.data?.mime_type);
  const KindIcon = KIND_ICONS[kind];

  if (doc.isError) {
    return (
      <div className="p-6">
        <ErrorState error={doc.error} onRetry={() => void doc.refetch()} title="Documento indisponível" />
      </div>
    );
  }

  const pdfFallbackNote = highlightText && highlight === null;
  const pdfPartialNote = highlightText && highlight?.partial;
  const textFallbackNote = !pdf && chunkId && textHighlightFound === false;

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card px-3">
        <KindIcon className="size-4 shrink-0 text-primary" aria-hidden />
        {doc.isPending ? (
          <Skeleton className="h-4 w-48" />
        ) : (
          <h2 className="min-w-0 flex-1 truncate text-sm font-medium" title={doc.data.name}>
            {doc.data.name}
          </h2>
        )}
        {doc.data ? <Badge variant="muted" className="hidden sm:inline-flex">{KIND_LABELS[kind]}</Badge> : null}
        {doc.data ? <StatusBadge status={doc.data.status} className="hidden sm:inline-flex" /> : null}
        {embedded ? (
          <Button variant="ghost" size="icon-sm" asChild aria-label="Abrir em página própria">
            <Link to={`/documents/${documentId}?${pdf ? `page=${page}` : ""}${chunkId ? `&chunk=${chunkId}` : ""}`}>
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
          <React.Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground" role="status">
                Carregando visualizador…
              </div>
            }
          >
            {doc.isPending ? null : pdf ? (
              <PdfViewer documentId={documentId} page={page} onPageChange={onPageChange} highlightText={highlightText} onHighlightResult={setHighlight} />
            ) : (
              <TextDocumentViewer
                documentId={documentId}
                chunkId={chunkId}
                chunkText={activeChunk.data?.text ?? null}
                onHighlightResult={setTextHighlightFound}
                activeSection={activeSection}
                onSectionChange={(i) => {
                  setActiveSection(i);
                  onChunkChange?.(null);
                }}
              />
            )}
          </React.Suspense>
        </div>

        {panelOpen ? (
          <aside className={cn("flex shrink-0 flex-col overflow-y-auto border-l border-border bg-card", asideTab === "analyses" ? "w-[26rem]" : "w-80")} aria-label={asideTab === "analyses" ? "Análises do documento" : "Detalhes do documento"}>
            {analyses ? (
              <div role="tablist" aria-label="Painel lateral" className="grid shrink-0 grid-cols-2 border-b border-border">
                {(
                  [
                    ["details", "Detalhes"],
                    ["analyses", "Análises"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    role="tab"
                    type="button"
                    aria-selected={asideTab === key}
                    onClick={() => setAsideTab(key)}
                    className={cn("px-3 py-2 text-xs font-medium transition-colors", asideTab === key ? "border-b-2 border-primary text-primary" : "text-muted-foreground hover:text-foreground")}
                  >
                    {label}
                  </button>
                ))}
              </div>
            ) : null}
            {analyses && asideTab === "analyses" ? (
              <React.Suspense fallback={<div className="p-4 text-xs text-muted-foreground">Carregando análises…</div>}>
                <DocumentAnalysesPanel documentId={documentId} documentReady={doc.data?.status === "ready"} onSourceClick={openSource} activeChunkId={chunkId} className="min-h-0 flex-1" />
              </React.Suspense>
            ) : (
              <>
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
                <p className="mb-2 text-xs text-muted-foreground" data-testid="active-chunk-location">
                  {locationLabel(activeChunk.data)}
                </p>
                <blockquote className="max-h-64 overflow-y-auto rounded-lg border-l-2 border-primary bg-primary/5 p-3 text-sm leading-relaxed whitespace-pre-wrap">
                  {activeChunk.data.text}
                </blockquote>
                {pdfFallbackNote || textFallbackNote ? (
                  <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground" data-testid="highlight-fallback">
                    <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    Trecho exibido no painel (não foi possível localizar a posição exata {pdf ? "na página" : "na seção"}).
                  </p>
                ) : pdfPartialNote ? (
                  <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
                    <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    Apenas parte do trecho foi localizada na página; o restante está neste painel.
                  </p>
                ) : null}
              </section>
            ) : null}

            {doc.data?.warnings?.length ? (
              <section className="border-b border-border p-4" aria-label="Avisos da extração">
                <h3 className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-warning">
                  <AlertTriangle className="size-3.5" aria-hidden /> Avisos
                </h3>
                <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                  {doc.data.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
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
                  <dt className="text-muted-foreground">Tipo</dt>
                  <dd>{KIND_LABELS[kind]}</dd>
                  <dt className="text-muted-foreground">Tamanho</dt>
                  <dd>{formatBytes(doc.data.size_bytes)}</dd>
                  <dt className="text-muted-foreground">{doc.data.location_type === "page" ? "Páginas" : "Seções"}</dt>
                  <dd>{doc.data.page_count ?? "—"}</dd>
                  <dt className="text-muted-foreground">Trechos</dt>
                  <dd>{doc.data.chunk_count}</dd>
                  <dt className="text-muted-foreground">Caracteres</dt>
                  <dd>{doc.data.char_count?.toLocaleString("pt-BR") ?? "—"}</dd>
                  <dt className="text-muted-foreground">Coleção</dt>
                  <dd className="truncate">
                    {doc.data.collection_id ? <Link to={`/collections/${doc.data.collection_id}`} className="hover:underline">{doc.data.collection_name}</Link> : "—"}
                  </dd>
                  <dt className="text-muted-foreground">Tags</dt>
                  <dd className="flex flex-wrap gap-1">{doc.data.tags?.length ? doc.data.tags.map((t) => <Badge key={t} variant="muted" className="px-1.5 py-0 text-[10px]">#{t}</Badge>) : "—"}</dd>
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

            <section className="border-b border-border p-4">
              <h3 className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {pdf ? `Trechos da página ${page}` : "Trechos"}
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
                  Nenhum trecho indexado{pdf ? " nesta página" : ""}{doc.data?.status !== "ready" ? " (documento ainda não está pronto)" : ""}.
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
                          Trecho #{c.position + 1} · {locationLabel(c)}
                        </span>
                        <span className="line-clamp-4">{c.text}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <VersionsPanel documentId={documentId} currentVersion={doc.data?.indexing_version} />
            <Separator />
              </>
            )}
          </aside>
        ) : null}
      </div>
    </div>
  );
}
