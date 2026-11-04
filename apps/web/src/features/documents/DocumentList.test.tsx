import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    location_type: "page",
    tags: [],
    collection_id: null,
    collection_name: null,
    has_text_layer: true,
    warnings: [],
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

  it("envia filtros e ordenação como query params e mostra tags/coleção/avisos/versão", async () => {
    const fetchMock = mockFetch((url) => {
      if (url.includes("/collections")) return jsonResponse({ items: [{ id: "c1", name: "Contratos", description: null, color: "#8B5CF6", document_count: 1, created_at: "", updated_at: "" }] });
      if (url.includes("/documents/tags")) return jsonResponse({ items: [{ tag: "juridico", count: 1 }] });
      return jsonResponse({
        items: [doc({ id: "d1", tags: ["juridico"], collection_id: "c1", collection_name: "Contratos", indexing_version: 2, warnings: ["2 de 5 páginas sem texto"] })],
        total: 1,
        page: 1,
        page_size: 20,
      });
    });
    renderWithProviders(<DocumentList canManage />);
    const row = (await screen.findAllByTestId("document-row"))[0]!;
    expect(within(row).getByTestId("doc-tag")).toHaveTextContent("#juridico");
    expect(within(row).getByText("Contratos")).toBeInTheDocument();
    expect(within(row).getByTestId("doc-warning")).toBeInTheDocument();
    expect(within(row).getByText(/v2/)).toBeInTheDocument();

    const first = fetchMock.mock.calls.find((c) => String(c[0]).includes("/documents?"));
    expect(String(first?.[0])).toContain("sort=-created_at");

    await userEvent.click(screen.getByLabelText("Filtrar por tipo"));
    await userEvent.click(await screen.findByRole("option", { name: "DOCX" }));
    await waitFor(() => {
      const last = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/documents?")).at(-1);
      expect(decodeURIComponent(String(last?.[0]))).toContain("mime_type=application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    });

    await userEvent.click(screen.getByLabelText("Ordenar por"));
    await userEvent.click(await screen.findByRole("option", { name: "Nome (A–Z)" }));
    await waitFor(() => {
      const last = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/documents?")).at(-1);
      expect(String(last?.[0])).toContain("sort=name");
    });
  });

  it("restringe à coleção da rota e oculta o filtro de coleção", async () => {
    const fetchMock = mockFetch((url) => {
      if (url.includes("/collections")) return jsonResponse({ items: [] });
      if (url.includes("/documents/tags")) return jsonResponse({ items: [] });
      return jsonResponse({ items: [], total: 0, page: 1, page_size: 20 });
    });
    renderWithProviders(<DocumentList canManage collectionId="c9" />);
    expect(await screen.findByText("Esta coleção está vazia")).toBeInTheDocument();
    expect(screen.queryByLabelText("Filtrar por coleção")).not.toBeInTheDocument();
    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("/documents?"));
    expect(String(call?.[0])).toContain("collection_id=c9");
  });
});
