import { describe, expect, it, vi, afterEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { jsonResponse, mockFetch, renderWithProviders } from "@/test/utils";
import type { Analysis, DocumentItem } from "@/types/api";
import { ComparePage } from "./ComparePage";

function doc(id: string, name: string): DocumentItem {
  return {
    id,
    name,
    original_name: name,
    mime_type: "application/pdf",
    size_bytes: 1000,
    sha256: "x",
    page_count: 3,
    char_count: 500,
    chunk_count: 2,
    status: "ready",
    error_message: null,
    created_at: "2026-11-05T10:00:00Z",
    updated_at: "2026-11-05T10:00:00Z",
    processed_at: "2026-11-05T10:00:01Z",
    indexing_version: 1,
    owner: { id: "u1", name: "Ana" },
    location_type: "page",
    tags: [],
    collection_id: null,
    collection_name: null,
    has_text_layer: true,
    warnings: [],
  };
}

const comparison: Analysis = {
  id: "cmp-1",
  kind: "comparison",
  summary_type: null,
  status: "succeeded",
  title: "Comparação: contrato-v1.pdf × contrato-v2.pdf",
  document_ids: ["d1", "d2"],
  documents: [
    { id: "d1", name: "contrato-v1.pdf", label: "A" },
    { id: "d2", name: "contrato-v2.pdf", label: "B" },
  ],
  question: "Quais obrigações mudaram?",
  result: {
    content: "## Diferenças\n\n- O prazo mudou de 30 [1] para 45 dias [2].",
    sources: [
      { index: 1, chunk_id: "c1", document_id: "d1", document_name: "contrato-v1.pdf", document_label: "A", location_type: "page", location_label: "Página 4", snippet: "30 dias" },
      { index: 2, chunk_id: "c2", document_id: "d2", document_name: "contrato-v2.pdf", document_label: "B", location_type: "page", location_label: "Página 4", snippet: "45 dias" },
    ],
    coverage: { chunks_used: 6, chunks_total: 20, tokens_used: 3000, strategy: "retrieval", parts: 1, complete: false },
    limitations: ["Comparação baseada nos 3 trechos mais relevantes de cada documento; não é exaustiva."],
  },
  error_message: null,
  model: "fake-llm-v1",
  prompt_tokens: 3000,
  completion_tokens: 200,
  latency_ms: 1200,
  created_at: "2026-11-05T10:00:00Z",
  started_at: null,
  finished_at: "2026-11-05T10:00:05Z",
};

afterEach(() => vi.unstubAllGlobals());

describe("ComparePage", () => {
  it("exige entre 2 e 5 documentos, envia o payload correto e mostra resultado com limitações", async () => {
    const posted: unknown[] = [];
    mockFetch((url, init) => {
      if (url.includes("/documents?") || url.endsWith("/documents")) {
        return jsonResponse({ items: [doc("d1", "contrato-v1.pdf"), doc("d2", "contrato-v2.pdf"), doc("d3", "manual.docx")], total: 3, page: 1, page_size: 200 });
      }
      if (url.includes("/analyses?") && !url.includes("/analyses/")) {
        return jsonResponse({ items: [], total: 0, page: 1, page_size: 20 });
      }
      if (url.endsWith("/documents/compare") && init?.method === "POST") {
        posted.push(JSON.parse(String(init.body)));
        return jsonResponse({ ...comparison, status: "queued", result: null }, { status: 202 });
      }
      if (url.includes("/analyses/cmp-1")) return jsonResponse(comparison);
      if (url.includes("/auth/csrf")) return jsonResponse({ csrf_token: "t" });
      return jsonResponse({ error: { code: "not_found", message: "x" } }, { status: 404 });
    });

    renderWithProviders(<ComparePage />, { route: "/compare" });
    const compareBtn = await screen.findByRole("button", { name: /Comparar/ });
    expect(compareBtn).toBeDisabled();

    await userEvent.click(await screen.findByLabelText("contrato-v1.pdf"));
    expect(compareBtn).toBeDisabled();
    expect(screen.getByText(/Selecione pelo menos 2 documentos/)).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText("contrato-v2.pdf"));
    expect(compareBtn).toBeEnabled();

    await userEvent.click(screen.getByRole("button", { name: "Quais obrigações mudaram?" }));
    await userEvent.click(compareBtn);

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({ document_ids: ["d1", "d2"], question: "Quais obrigações mudaram?" });

    expect(await screen.findByTestId("analysis-content")).toHaveTextContent("O prazo mudou de 30");
    expect(screen.getByTestId("coverage-incomplete")).toBeInTheDocument();
    expect(screen.getByTestId("analysis-coverage")).toHaveTextContent("não é exaustiva");
    // fontes agrupadas por documento com rótulos A/B
    const sources = screen.getByTestId("analysis-sources");
    expect(sources).toHaveTextContent("contrato-v1.pdf");
    expect(sources).toHaveTextContent("contrato-v2.pdf");
    expect(screen.getByLabelText("Documentos comparados")).toHaveTextContent("A");
    expect(screen.getByLabelText("Documentos comparados")).toHaveTextContent("B");
  });
});
