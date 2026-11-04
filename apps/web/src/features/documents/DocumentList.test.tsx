import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { jsonResponse, mockFetch, renderWithProviders } from "@/test/utils";
import type { DocumentItem } from "@/types/api";
import { DocumentList } from "./DocumentList";

function doc(partial: Partial<DocumentItem>): DocumentItem {
  return {
    id: "d1",
    name: "Contrato.pdf",
    original_name: "Contrato.pdf",
    mime_type: "application/pdf",
    size_bytes: 123456,
    sha256: "abc",
    page_count: 12,
    char_count: 10000,
    chunk_count: 20,
    status: "ready",
    error_message: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    processed_at: new Date().toISOString(),
    indexing_version: 1,
    owner: { id: "u1", name: "Ana" },
    ...partial,
  };
}

describe("DocumentList", () => {
  it("mostra skeleton enquanto carrega", () => {
    mockFetch(() => new Promise<Response>(() => {}));
    renderWithProviders(<DocumentList canManage />);
    expect(screen.getByRole("status", { name: "Carregando" })).toBeInTheDocument();
  });

  it("mostra estado vazio quando não há documentos", async () => {
    mockFetch(() => jsonResponse({ items: [], total: 0, page: 1, page_size: 20 }));
    renderWithProviders(<DocumentList canManage />);
    expect(await screen.findByText("Nenhum documento ainda")).toBeInTheDocument();
  });

  it("mostra estado de erro com opção de tentar novamente", async () => {
    mockFetch(() => jsonResponse({ error: { code: "internal", message: "Falha no banco." } }, { status: 500 }));
    renderWithProviders(<DocumentList canManage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Falha no banco.");
    expect(screen.getByRole("button", { name: /tentar novamente/i })).toBeInTheDocument();
  });

  it("lista documentos com badge de status em pt-BR e faz polling do status em processamento", async () => {
    const fetchMock = mockFetch((url) => {
      if (url.includes("/documents/d2/status")) {
        return jsonResponse({ id: "d2", status: "embedding", error_message: null, page_count: 3, chunk_count: 0, processed_at: null, jobs: [] });
      }
      return jsonResponse({
        items: [doc({ id: "d1", status: "ready" }), doc({ id: "d2", name: "Manual.pdf", status: "extracting" }), doc({ id: "d3", name: "Falho.pdf", status: "failed", error_message: "PDF sem texto" })],
        total: 3,
        page: 1,
        page_size: 20,
      });
    });
    renderWithProviders(<DocumentList canManage />);

    const rows = await screen.findAllByTestId("document-row");
    expect(rows).toHaveLength(3);
    expect(within(rows[0]!).getByText("Pronto")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("Falhou")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("PDF sem texto")).toBeInTheDocument();

    // o status ao vivo (embedding) substitui o status da listagem (extracting)
    expect(await within(rows[1]!).findByText("Gerando embeddings")).toBeInTheDocument();
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/documents/d2/status"))).toBe(true);
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/documents/d1/status"))).toBe(false);
  });
});
