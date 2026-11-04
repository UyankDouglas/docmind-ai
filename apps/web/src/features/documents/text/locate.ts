/**
 * Localiza o texto de um trecho dentro do texto de uma seção, tolerando diferenças de
 * espaçamento/caixa/aspas, e devolve o intervalo [start, end) em offsets do texto ORIGINAL.
 * Só correspondências exatas (após normalização) são aceitas; nunca aproxima.
 */

function normChar(ch: string): string {
  if (/\s/.test(ch)) return " ";
  if (ch === "‘" || ch === "’") return "'";
  if (ch === "“" || ch === "”") return '"';
  if (ch === "­") return "";
  return ch.toLowerCase();
}

interface Normalized {
  text: string;
  /** offset original de cada caractere normalizado */
  map: number[];
}

function normalizeWithMap(src: string): Normalized {
  const text: string[] = [];
  const map: number[] = [];
  let lastSpace = true;
  for (let i = 0; i < src.length; i++) {
    const c = normChar(src[i]!);
    if (!c) continue;
    if (c === " ") {
      if (lastSpace) continue;
      lastSpace = true;
    } else {
      lastSpace = false;
    }
    text.push(c);
    map.push(i);
  }
  while (text.length && text[text.length - 1] === " ") {
    text.pop();
    map.pop();
  }
  return { text: text.join(""), map };
}

export function findTextRange(haystack: string, needle: string): [number, number] | null {
  const h = normalizeWithMap(haystack);
  const n = normalizeWithMap(needle).text.trim();
  if (n.length < 8) return null;
  const at = h.text.indexOf(n);
  if (at === -1) return null;
  const start = h.map[at];
  const endIdx = h.map[at + n.length - 1];
  if (start === undefined || endIdx === undefined) return null;
  return [start, endIdx + 1];
}
