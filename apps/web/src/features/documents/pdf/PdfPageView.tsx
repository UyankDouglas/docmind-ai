import * as React from "react";
import { TextLayer } from "pdfjs-dist";
import type { PdfDocument } from "./pdfjs";
import { findChunkInTextItems, type HighlightMatch } from "./highlight";

interface Props {
  pdf: PdfDocument;
  pageNumber: number;
  scale: number;
  /** texto do trecho a destacar (se houver) */
  highlightText?: string | null;
  onHighlightResult?: (result: HighlightMatch | null) => void;
  className?: string;
}

/**
 * Renderiza uma página do PDF em canvas + text layer.
 * O text layer permite seleção de texto e o destaque exato de trechos.
 */
export function PdfPageView({ pdf, pageNumber, scale, highlightText, onHighlightResult, className }: Props) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const textRef = React.useRef<HTMLDivElement>(null);
  const [size, setSize] = React.useState<{ w: number; h: number } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const onHighlightRef = React.useRef(onHighlightResult);
  React.useEffect(() => {
    onHighlightRef.current = onHighlightResult;
  }, [onHighlightResult]);

  React.useEffect(() => {
    let cancelled = false;
    let renderTask: { cancel: () => void } | null = null;

    (async () => {
      try {
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;
        setError(null);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        const textContainer = textRef.current;
        if (!canvas || !textContainer) return;

        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        setSize({ w: Math.floor(viewport.width), h: Math.floor(viewport.height) });

        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const task = page.render({ canvas, canvasContext: ctx, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
        renderTask = task;
        await task.promise;
        if (cancelled) return;

        // Text layer
        textContainer.replaceChildren();
        textContainer.style.setProperty("--scale-factor", String(scale));
        const textContent = await page.getTextContent();
        if (cancelled) return;
        const layer = new TextLayer({ textContentSource: textContent, container: textContainer, viewport });
        await layer.render();
        if (cancelled) return;

        if (highlightText) {
          const match = findChunkInTextItems(highlightText, layer.textContentItemsStr);
          if (match) {
            const divs = layer.textDivs;
            for (const i of match.itemIndexes) divs[i]?.classList.add("pdf-highlight");
            const first = divs[match.itemIndexes[0] ?? -1];
            first?.scrollIntoView({ block: "center", behavior: "smooth" });
          }
          onHighlightRef.current?.(match);
        } else {
          onHighlightRef.current?.(null);
        }
      } catch (e) {
        if (cancelled) return;
        const name = (e as { name?: string })?.name;
        if (name === "RenderingCancelledException") return;
        setError("Não foi possível renderizar esta página.");
      }
    })();

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [pdf, pageNumber, scale, highlightText]);

  return (
    <div
      className={className}
      style={size ? { width: size.w, height: size.h } : undefined}
      data-page-number={pageNumber}
      aria-label={`Página ${pageNumber}`}
    >
      <div className="relative shadow-lg ring-1 ring-black/10" style={size ? { width: size.w, height: size.h } : undefined}>
        <canvas ref={canvasRef} className="block bg-white" />
        <div ref={textRef} className="pdf-text-layer" />
        {error ? (
          <div className="absolute inset-0 flex items-center justify-center bg-card/80 text-sm text-destructive">{error}</div>
        ) : null}
      </div>
    </div>
  );
}
