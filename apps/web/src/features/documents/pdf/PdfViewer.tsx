import * as React from "react";
import { ChevronLeft, ChevronRight, Loader2, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorState } from "@/components/ErrorState";
import { cn } from "@/lib/utils";
import { documentsApi } from "../api";
import { loadPdf, type PdfDocument } from "./pdfjs";
import { PdfPageView } from "./PdfPageView";
import type { HighlightMatch } from "./highlight";

interface Props {
  documentId: string;
  page: number;
  onPageChange: (page: number) => void;
  highlightText?: string | null;
  onHighlightResult?: (result: HighlightMatch | null) => void;
  className?: string;
  toolbarExtra?: React.ReactNode;
}

const SCALES = [0.6, 0.8, 1, 1.2, 1.5, 2];

export function PdfViewer({ documentId, page, onPageChange, highlightText, onHighlightResult, className, toolbarExtra }: Props) {
  const [reloadKey, setReloadKey] = React.useState(0);
  const loadKey = `${documentId}:${reloadKey}`;
  // Estado de carregamento vinculado à chave; "loading" é derivado (chave diferente = ainda carregando)
  const [load, setLoad] = React.useState<{ key: string; pdf: PdfDocument | null; error: unknown }>({
    key: "",
    pdf: null,
    error: null,
  });
  const loading = load.key !== loadKey;
  const pdf = loading ? null : load.pdf;
  const error = loading ? null : load.error;
  const [scaleIdx, setScaleIdx] = React.useState(2);
  const [pageInput, setPageInput] = React.useState(String(page));
  const [lastPage, setLastPage] = React.useState(page);
  if (lastPage !== page) {
    setLastPage(page);
    setPageInput(String(page));
  }

  React.useEffect(() => {
    const ctrl = new AbortController();
    let doc: PdfDocument | null = null;
    documentsApi
      .downloadArrayBuffer(documentId, ctrl.signal)
      .then((buf) => loadPdf(buf))
      .then((d) => {
        if (ctrl.signal.aborted) {
          void d.loadingTask.destroy();
          return;
        }
        doc = d;
        setLoad({ key: loadKey, pdf: d, error: null });
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return;
        setLoad({ key: loadKey, pdf: null, error: e });
      });
    return () => {
      ctrl.abort();
      void doc?.loadingTask.destroy();
    };
  }, [documentId, loadKey]);

  const numPages = pdf?.numPages ?? 0;
  const clamp = React.useCallback((p: number) => Math.min(Math.max(1, p), Math.max(1, numPages)), [numPages]);

  React.useEffect(() => {
    if (pdf && page > pdf.numPages) onPageChange(pdf.numPages);
  }, [pdf, page, onPageChange]);

  const go = (p: number) => onPageChange(clamp(p));

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    if (e.key === "ArrowRight" || e.key === "PageDown") go(page + 1);
    if (e.key === "ArrowLeft" || e.key === "PageUp") go(page - 1);
  };

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)} onKeyDown={onKeyDown} tabIndex={-1}>
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border bg-card px-2 py-1.5">
        <Button variant="ghost" size="icon-sm" onClick={() => go(page - 1)} disabled={page <= 1 || !pdf} aria-label="Página anterior">
          <ChevronLeft />
        </Button>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number.parseInt(pageInput, 10);
            if (Number.isFinite(n)) go(n);
          }}
          className="flex items-center gap-1 text-sm"
        >
          <Input
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value)}
            inputMode="numeric"
            aria-label="Número da página"
            className="h-7 w-12 px-1 text-center"
          />
          <span className="text-muted-foreground">/ {numPages || "—"}</span>
        </form>
        <Button variant="ghost" size="icon-sm" onClick={() => go(page + 1)} disabled={!pdf || page >= numPages} aria-label="Próxima página">
          <ChevronRight />
        </Button>
        <div className="mx-1 h-5 w-px bg-border" />
        <Button variant="ghost" size="icon-sm" onClick={() => setScaleIdx((i) => Math.max(0, i - 1))} disabled={scaleIdx === 0} aria-label="Diminuir zoom">
          <ZoomOut />
        </Button>
        <span className="w-12 text-center text-xs text-muted-foreground" aria-live="polite">
          {Math.round((SCALES[scaleIdx] ?? 1) * 100)}%
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setScaleIdx((i) => Math.min(SCALES.length - 1, i + 1))}
          disabled={scaleIdx === SCALES.length - 1}
          aria-label="Aumentar zoom"
        >
          <ZoomIn />
        </Button>
        {toolbarExtra ? <div className="ml-auto flex items-center gap-1">{toolbarExtra}</div> : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-muted/40 p-4">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground" role="status">
            <Loader2 className="mr-2 size-4 animate-spin" aria-hidden /> Carregando documento…
          </div>
        ) : error ? (
          <div className="mx-auto max-w-md">
            <ErrorState error={error} onRetry={() => setReloadKey((k) => k + 1)} title="Não foi possível abrir o PDF" />
          </div>
        ) : pdf ? (
          <div className="flex justify-center">
            <PdfPageView
              pdf={pdf}
              pageNumber={clamp(page)}
              scale={SCALES[scaleIdx] ?? 1}
              highlightText={highlightText}
              onHighlightResult={onHighlightResult}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
