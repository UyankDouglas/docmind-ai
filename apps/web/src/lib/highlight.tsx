import * as React from "react";

/**
 * Renderiza um trecho destacado pelo Full-Text Search permitindo SOMENTE a tag <mark>.
 * Qualquer outro conteúdo é tratado como texto (escapado pelo React). Nenhum `dangerouslySetInnerHTML`.
 */
const MARK_RE = /<mark>([\s\S]*?)<\/mark>/gi;

export function splitHighlight(html: string): Array<{ text: string; marked: boolean }> {
  const parts: Array<{ text: string; marked: boolean }> = [];
  let last = 0;
  for (const m of html.matchAll(MARK_RE)) {
    const start = m.index ?? 0;
    if (start > last) parts.push({ text: decodeEntities(html.slice(last, start)), marked: false });
    parts.push({ text: decodeEntities(m[1] ?? ""), marked: true });
    last = start + m[0].length;
  }
  if (last < html.length) parts.push({ text: decodeEntities(html.slice(last)), marked: false });
  return parts.filter((p) => p.text.length > 0);
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'" };

function decodeEntities(text: string): string {
  // Remove qualquer tag diferente de <mark> (ex.: <script>) e decodifica entidades básicas
  const withoutTags = text.replace(/<\/?(?!mark\b)[a-zA-Z][^>]*>/g, "");
  return withoutTags.replace(/&(amp|lt|gt|quot|#39|apos);/g, (m) => ENTITIES[m] ?? m);
}

export function Highlight({ html, className }: { html: string; className?: string }) {
  const parts = React.useMemo(() => splitHighlight(html), [html]);
  return (
    <span className={className}>
      {parts.map((p, i) =>
        p.marked ? (
          <mark key={i} className="rounded-sm bg-primary/25 px-0.5 text-foreground">
            {p.text}
          </mark>
        ) : (
          <React.Fragment key={i}>{p.text}</React.Fragment>
        ),
      )}
    </span>
  );
}
