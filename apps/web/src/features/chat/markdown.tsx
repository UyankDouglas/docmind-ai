import * as React from "react";

/**
 * Renderizador leve de markdown para respostas do assistente.
 * Suporta: parágrafos, títulos (#, ##, ###), listas (-, *, 1.), negrito (**x**),
 * itálico (*x*), código inline (`x`), blocos de código (```), e marcadores de
 * citação [n] (renderizados via `renderCitation`). Não interpreta HTML.
 */

export interface MarkdownProps {
  content: string;
  renderCitation?: (index: number, key: string) => React.ReactNode;
  className?: string;
}

const CITATION_RE = /\[(\d{1,3})\]/g;

function renderInline(text: string, renderCitation: MarkdownProps["renderCitation"], keyPrefix: string): React.ReactNode[] {
  // tokens: código inline, negrito, itálico, citação
  const nodes: React.ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)|(\[\d{1,3}\])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyPrefix}-${i++}`;
    if (tok.startsWith("`")) {
      nodes.push(
        <code key={key} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (tok.startsWith("**")) {
      nodes.push(<strong key={key}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("*")) {
      nodes.push(<em key={key}>{tok.slice(1, -1)}</em>);
    } else {
      const idx = Number.parseInt(tok.slice(1, -1), 10);
      nodes.push(renderCitation ? renderCitation(idx, key) : <span key={key}>{tok}</span>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

type Block =
  | { type: "p"; text: string }
  | { type: "h"; level: 1 | 2 | 3; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "code"; text: string };

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.trim().startsWith("```")) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? "").trim().startsWith("```")) {
        buf.push(lines[i] ?? "");
        i++;
      }
      i++;
      blocks.push({ type: "code", text: buf.join("\n") });
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push({ type: "h", level: h[1]!.length as 1 | 2 | 3, text: h[2] ?? "" });
      i++;
      continue;
    }
    if (/^\s*[-*•]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").replace(/^\s*[-*•]\s+/, ""));
        i++;
      }
      blocks.push({ type: "ul", items });
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").replace(/^\s*\d+[.)]\s+/, ""));
        i++;
      }
      blocks.push({ type: "ol", items });
      continue;
    }
    const buf: string[] = [];
    while (i < lines.length && (lines[i] ?? "").trim() && !/^(#{1,3})\s|^\s*[-*•]\s+|^\s*\d+[.)]\s+|^\s*```/.test(lines[i] ?? "")) {
      buf.push(lines[i] ?? "");
      i++;
    }
    blocks.push({ type: "p", text: buf.join("\n") });
  }
  return blocks;
}

export function Markdown({ content, renderCitation, className }: MarkdownProps) {
  const blocks = React.useMemo(() => parseBlocks(content), [content]);
  return (
    <div className={className}>
      {blocks.map((b, bi) => {
        const key = `b${bi}`;
        switch (b.type) {
          case "h": {
            const Tag = (`h${b.level + 2}` as "h3" | "h4" | "h5");
            return (
              <Tag key={key} className="mt-3 mb-1 font-semibold first:mt-0">
                {renderInline(b.text, renderCitation, key)}
              </Tag>
            );
          }
          case "ul":
            return (
              <ul key={key} className="my-2 list-disc space-y-1 pl-5">
                {b.items.map((it, ii) => (
                  <li key={ii}>{renderInline(it, renderCitation, `${key}-${ii}`)}</li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={key} className="my-2 list-decimal space-y-1 pl-5">
                {b.items.map((it, ii) => (
                  <li key={ii}>{renderInline(it, renderCitation, `${key}-${ii}`)}</li>
                ))}
              </ol>
            );
          case "code":
            return (
              <pre key={key} className="my-2 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">
                {b.text}
              </pre>
            );
          default:
            return (
              <p key={key} className="my-1.5 whitespace-pre-wrap leading-relaxed first:mt-0 last:mb-0">
                {renderInline(b.text, renderCitation, key)}
              </p>
            );
        }
      })}
    </div>
  );
}

export function extractCitationIndexes(content: string): number[] {
  const set = new Set<number>();
  for (const m of content.matchAll(CITATION_RE)) set.add(Number.parseInt(m[1]!, 10));
  return Array.from(set).sort((a, b) => a - b);
}
