import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { jsonResponse, mockFetch, renderWithProviders } from "@/test/utils";
import type { DocumentText } from "@/types/api";
import { findTextRange } from "./locate";
import { TextDocumentViewer } from "./TextDocumentViewer";

const text: DocumentText = {
  document_id: "d1",
  location_type: "section",
  sections: [
    { index: 1, label: "Seção 1 · 1. PERÍODO AQUISITIVO", text: "1. PERÍODO AQUISITIVO\nApós cada período de 12 meses de trabalho, o colaborador adquire direito a 30 dias corridos de férias.", chunk_ids: ["ch1"] },
    { index: 2, label: "Seção 2 · 2. SOLICITAÇÃO", text: "2. SOLICITAÇÃO\nAs férias devem ser solicitadas pelo portal interno com antecedência mínima de 30 dias.", chunk_ids: ["ch2"] },
  ],
};

describe("findTextRange", () => {
  it("localiza por substring normalizada e devolve offsets do texto original", () => {
    const hay = "As   férias devem ser\n“solicitadas” pelo portal.";
    const r = findTextRange(hay, 'as férias devem ser "solicitadas"');
    expect(r).not.toBeNull();
    expect(hay.slice(r![0], r![1])).toBe("As   férias devem ser\n“solicitadas”");
  });
  it("não aproxima: texto ausente retorna null", () => {
    expect(findTextRange("texto qualquer de uma seção", "trecho que não existe aqui")).toBeNull();
  });
});

describe("TextDocumentViewer", () => {
  it("renderiza as seções e o índice lateral", async () => {
    mockFetch(() => jsonResponse(text));
    renderWithProviders(<TextDocumentViewer documentId="d1" />);
    expect(await screen.findAllByTestId("text-section")).toHaveLength(2);
    expect(screen.getByRole("navigation", { name: "Seções do documento" })).toHaveTextContent("2. SOLICITAÇÃO");
    expect(screen.getByText(/As referências usam seções, não páginas/)).toBeInTheDocument();
  });

  it("destaca o texto exato do chunk na seção correspondente", async () => {
    mockFetch(() => jsonResponse(text));
    const onResult = vi.fn();
    renderWithProviders(
      <TextDocumentViewer documentId="d1" chunkId="ch2" chunkText="solicitadas pelo portal interno com antecedência mínima de 30 dias" onHighlightResult={onResult} />,
    );
    const mark = await screen.findByTestId("text-highlight");
    expect(mark).toHaveTextContent("solicitadas pelo portal interno com antecedência mínima de 30 dias");
    await waitFor(() => expect(onResult).toHaveBeenLastCalledWith(true));
  });

  it("quando o texto do chunk não é localizado, não destaca e sinaliza fallback", async () => {
    mockFetch(() => jsonResponse(text));
    const onResult = vi.fn();
    renderWithProviders(<TextDocumentViewer documentId="d1" chunkId="ch1" chunkText="texto que não está na seção de forma alguma" onHighlightResult={onResult} />);
    await screen.findAllByTestId("text-section");
    expect(screen.queryByTestId("text-highlight")).not.toBeInTheDocument();
    await waitFor(() => expect(onResult).toHaveBeenLastCalledWith(false));
  });
});
