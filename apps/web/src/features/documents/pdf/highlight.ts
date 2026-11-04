/**
 * Localiza o texto de um trecho dentro dos itens do text layer do PDF.js.
 * Só retorna correspondências EXATAS (após normalização de espaços/caixa);
 * nunca aproxima. Quando o chunk inteiro não é encontrado (p.ex. atravessa páginas),
 * tenta localizar o início e o fim do trecho separadamente e informa `partial`.
 */

export interface HighlightMatch {
  /** índices dos itens (spans) do text layer a destacar */
  itemIndexes: number[];
  /** verdadeiro quando apenas parte do trecho foi localizada */
  partial: boolean;
}

export function normalizeText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/­/g, "") // soft hyphen
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

interface Indexed {
  text: string;
  /** para cada posição no texto concatenado, o índice do item de origem */
  owners: Int32Array;
}

function buildIndex(items: readonly string[]): Indexed {
  const parts: string[] = [];
  const ownersArr: number[] = [];
  let out = "";
  for (let i = 0; i < items.length; i++) {
    const raw = items[i] ?? "";
    const norm = normalizeText(raw);
    if (!norm) continue;
    if (out && !out.endsWith(" ")) {
      out += " ";
      ownersArr.push(-1);
    }
    out += norm;
    for (let k = 0; k < norm.length; k++) ownersArr.push(i);
    parts.push(norm);
  }
  return { text: out, owners: Int32Array.from(ownersArr) };
}

function ownersInRange(idx: Indexed, start: number, end: number): number[] {
  const set = new Set<number>();
  for (let p = start; p < end && p < idx.owners.length; p++) {
    const o = idx.owners[p];
    if (o !== undefined && o >= 0) set.add(o);
  }
  return Array.from(set).sort((a, b) => a - b);
}

/** Tenta encontrar `needle` em `idx.text`; retorna [start, end] ou null. */
function locate(idx: Indexed, needle: string): [number, number] | null {
  if (!needle) return null;
  const at = idx.text.indexOf(needle);
  if (at === -1) return null;
  return [at, at + needle.length];
}

export function findChunkInTextItems(chunkText: string, items: readonly string[]): HighlightMatch | null {
  const needle = normalizeText(chunkText);
  if (needle.length < 8 || items.length === 0) return null;
  const idx = buildIndex(items);
  if (!idx.text) return null;

  const full = locate(idx, needle);
  if (full) {
    return { itemIndexes: ownersInRange(idx, full[0], full[1]), partial: false };
  }

  // Tenta início e fim do trecho (mínimo 40 chars para evitar falsos positivos)
  const probeLen = Math.min(160, Math.max(40, Math.floor(needle.length / 3)));
  if (needle.length < 40) return null;
  const head = needle.slice(0, probeLen);
  const tail = needle.slice(-probeLen);
  const headPos = locate(idx, head);
  const tailPos = locate(idx, tail);

  if (headPos && tailPos && tailPos[1] > headPos[0]) {
    // início e fim localizados na mesma página: destaca o intervalo entre eles
    return { itemIndexes: ownersInRange(idx, headPos[0], tailPos[1]), partial: false };
  }
  if (headPos) return { itemIndexes: ownersInRange(idx, headPos[0], headPos[1]), partial: true };
  if (tailPos) return { itemIndexes: ownersInRange(idx, tailPos[0], tailPos[1]), partial: true };
  return null;
}
