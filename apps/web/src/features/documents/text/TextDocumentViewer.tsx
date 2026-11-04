import * as React from "react";
import { AlignLeft, Info } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ErrorState";
import { cn } from "@/lib/utils";
import type { TextSection } from "@/types/api";
import { useDocumentText } from "../hooks";
import { findTextRange } from "./locate";

interface Props {
  documentId: string;
  /** trecho ativo: usado para rolar até a seção e destacar o texto exato */
  chunkId?: string | null;
  chunkText?: string | null;
  /** informa se o destaque exato foi possível (true), não (false) ou não se aplica (undefined) */
  onHighlightResult?: (found: boolean | undefined) => void;
  /** seção selecionada manualmente pelo índice lateral */
  activeSection?: number | null;
  onSectionChange?: (index: number) => void;
  className?: string;
}

/**
 * Visualizador de DOCX/TXT: renderiza o texto extraído por seção (não o arquivo original),
 * com índice lateral e destaque exato do trecho quando localizado por substring normalizada.
 */
export function TextDocumentViewer({ documentId, chunkId, chunkText, onHighlightResult, activeSection, onSectionChange, className }: Props) {
  const text = useDocumentText(documentId);
  const sectionRefs = React.useRef(new Map<number, HTMLElement>());
  const highlightRef = React.useRef<HTMLElement | null>(null);

  const targetSection = React.useMemo(() => {
    if (!text.data) return null;
    if (chunkId) {
      const s = text.data.sections.find((sec) => sec.chunk_ids.includes(chunkId));
      if (s) return s.index;
    }
    return activeSection ?? null;
  }, [text.data, chunkId, activeSection]);

  // Rola até a seção alvo / destaque
  React.useEffect(() => {
    const el = highlightRef.current ?? (targetSection != null ? sectionRefs.current.get(targetSection) : null);
    el?.scrollIntoView({ behavior: "smooth", block: highlightRef.current ? "center" : "start" });
  }, [targetSection, chunkId, text.data]);

  // Resultado do destaque (somente quando há chunk ativo)
  const highlightFound = React.useMemo(() => {
    if (!text.data || !chunkId || !chunkText) return undefined;
    const section = text.data.sections.find((s) => s.chunk_ids.includes(chunkId));
    if (!section) return false;
    return findTextRange(section.text, chunkText) !== null;
  }, [text.data, chunkId, chunkText]);

  React.useEffect(() => {
    onHighlightResult?.(highlightFound);
  }, [highlightFound, onHighlightResult]);

  if (text.isPending) {
    return (
      <div className={cn("space-y-3 p-6", className)} role="status" aria-label="Carregando texto do documento">
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-4/5" />
      </div>
    );
  }
  if (text.isError) {
    return (
      <div className="p-6">
        <ErrorState error={text.error} onRetry={() => void text.refetch()} title="Não foi possível carregar o texto" />
      </div>
    );
  }
  const sections = text.data.sections;
  if (sections.length === 0) {
    return <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">Nenhum texto extraído para este documento.</div>;
  }

  return (
    <div className={cn("flex h-full min-h-0", className)} data-testid="text-viewer">
      <nav aria-label="Seções do documento" className="hidden w-56 shrink-0 overflow-y-auto border-r border-border bg-card/60 p-2 md:block">
        <p className="px-2 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Seções</p>
        <ul className="space-y-0.5">
          {sections.map((s) => (
            <li key={s.index}>
              <button
                type="button"
                onClick={() => onSectionChange?.(s.index)}
                aria-current={targetSection === s.index ? "true" : undefined}
                className={cn(
                  "w-full truncate rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-ring",
                  targetSection === s.index ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground",
                )}
                title={s.label}
              >
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto bg-background">
        <article className="mx-auto max-w-3xl px-6 py-8">
          <p className="mb-6 flex items-center gap-2 text-xs text-muted-foreground">
            <Info className="size-3.5" aria-hidden /> Texto extraído do arquivo (a formatação original não é reproduzida). As referências usam seções, não páginas.
          </p>
          {sections.map((s) => (
            <SectionBlock
              key={s.index}
              section={s}
              active={targetSection === s.index}
              highlightText={chunkId && s.chunk_ids.includes(chunkId) ? (chunkText ?? null) : null}
              refCallback={(el) => {
                if (el) sectionRefs.current.set(s.index, el);
                else sectionRefs.current.delete(s.index);
              }}
              highlightRef={highlightRef}
            />
          ))}
        </article>
      </div>
    </div>
  );
}

function SectionBlock({
  section,
  active,
  highlightText,
  refCallback,
  highlightRef,
}: {
  section: TextSection;
  active: boolean;
  highlightText: string | null;
  refCallback: (el: HTMLElement | null) => void;
  highlightRef: React.MutableRefObject<HTMLElement | null>;
}) {
  const range = highlightText ? findTextRange(section.text, highlightText) : null;
  const paragraphs = React.useMemo(() => splitWithRange(section.text, range), [section.text, range]);

  return (
    <section ref={refCallback} id={`section-${section.index}`} aria-label={section.label} className={cn("mb-8 scroll-mt-6 rounded-xl border p-5 transition-colors", active ? "border-primary/40 bg-primary/5" : "border-transparent")} data-testid="text-section">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
        <AlignLeft className="size-4 text-primary" aria-hidden /> {section.label}
      </h2>
      <div className="space-y-3 text-[15px] leading-7 text-foreground/90">
        {paragraphs.map((p, i) => (
          <p key={i} className="whitespace-pre-wrap">
            {p.map((part, j) =>
              part.highlight ? (
                <mark
                  key={j}
                  ref={(el) => {
                    if (el && !highlightRef.current) highlightRef.current = el;
                  }}
                  className="rounded bg-primary/25 px-0.5 text-foreground"
                  data-testid="text-highlight"
                >
                  {part.text}
                </mark>
              ) : (
                <React.Fragment key={j}>{part.text}</React.Fragment>
              ),
            )}
          </p>
        ))}
      </div>
    </section>
  );
}

interface Part {
  text: string;
  highlight: boolean;
}

/** Divide o texto em parágrafos preservando o intervalo de destaque (em offsets do texto original). */
function splitWithRange(text: string, range: [number, number] | null): Part[][] {
  const paragraphs: Part[][] = [];
  let offset = 0;
  for (const para of text.split(/\n{2,}|\n/)) {
    const start = offset;
    const end = start + para.length;
    offset = end + 1;
    if (!para.trim()) continue;
    if (!range || range[1] <= start || range[0] >= end) {
      paragraphs.push([{ text: para, highlight: false }]);
      continue;
    }
    const hs = Math.max(range[0], start) - start;
    const he = Math.min(range[1], end) - start;
    const parts: Part[] = [];
    if (hs > 0) parts.push({ text: para.slice(0, hs), highlight: false });
    parts.push({ text: para.slice(hs, he), highlight: true });
    if (he < para.length) parts.push({ text: para.slice(he), highlight: false });
    paragraphs.push(parts);
  }
  return paragraphs;
}
