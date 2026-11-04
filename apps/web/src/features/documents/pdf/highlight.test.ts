import { describe, expect, it } from "vitest";
import { findChunkInTextItems, normalizeText } from "./highlight";

const items = [
  "CLÁUSULA 8 – RESCISÃO",
  "O presente contrato poderá ser rescindido por qualquer das partes,",
  "mediante comunicação prévia por escrito com antecedência mínima de",
  "30 (trinta) dias, sem ônus para a parte denunciante.",
  "CLÁUSULA 9 – FORO",
];

describe("normalizeText", () => {
  it("colapsa espaços, remove soft hyphen e normaliza aspas", () => {
    expect(normalizeText("  A­B  “c”  ")).toBe('ab "c"');
  });
});

describe("findChunkInTextItems", () => {
  it("localiza o trecho completo e devolve os spans exatos", () => {
    const chunk =
      "O presente contrato poderá ser rescindido por qualquer das partes, mediante comunicação prévia por escrito com antecedência mínima de 30 (trinta) dias, sem ônus para a parte denunciante.";
    const m = findChunkInTextItems(chunk, items);
    expect(m).not.toBeNull();
    expect(m!.partial).toBe(false);
    expect(m!.itemIndexes).toEqual([1, 2, 3]);
  });

  it("retorna null quando o texto não existe na página (sem destaque aproximado)", () => {
    const m = findChunkInTextItems("Cláusula de confidencialidade com vigência de cinco anos após o término do contrato.", items);
    expect(m).toBeNull();
  });

  it("marca como parcial quando só o início do trecho está na página", () => {
    const chunk =
      "mediante comunicação prévia por escrito com antecedência mínima de 30 (trinta) dias, sem ônus para a parte denunciante. CLÁUSULA 9 – FORO Fica eleito o foro da comarca de São Paulo para dirimir quaisquer dúvidas oriundas deste instrumento, com renúncia a qualquer outro.";
    const m = findChunkInTextItems(chunk, items);
    expect(m).not.toBeNull();
    expect(m!.partial).toBe(true);
    expect(m!.itemIndexes[0]).toBe(2);
  });
});
