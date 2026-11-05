import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/utils";
import type { Analysis } from "@/types/api";
import { AnalysisResultView } from "./AnalysisResultView";

const succeeded: Analysis = {
  id: "an-1",
  kind: "summary",
  summary_type: "obligations",
  status: "succeeded",
  title: "Obrigações e prazos — contrato.pdf",
  document_ids: ["d1"],
  documents: [{ id: "d1", name: "contrato.pdf", label: null }],
  question: null,
  result: {
    content: "## Prazos\n\n- Aviso prévio de 45 dias [1].\n- Pagamento todo dia 10 [2].\n- Marcador sem fonte [9].",
    sources: [
      { index: 1, chunk_id: "c1", document_id: "d1", document_name: "contrato.pdf", document_label: null, location_type: "page", location_label: "Página 4", snippet: "aviso prévio de 45 dias" },
      { index: 2, chunk_id: "c2", document_id: "d1", document_name: "contrato.pdf", document_label: null, location_type: "page", location_label: "Página 2", snippet: "vencimento todo dia 10" },
    ],
    coverage: { chunks_used: 3, chunks_total: 3, tokens_used: 1800, strategy: "hierarchical", parts: 2, complete: true },
    limitations: ["Resumo gerado por um provedor determinístico de testes."],
  },
  error_message: null,
  model: "fake-llm-v1",
  prompt_tokens: 1800,
  completion_tokens: 120,
  latency_ms: 900,
  created_at: "2026-11-05T10:00:00Z",
  started_at: "2026-11-05T10:00:01Z",
  finished_at: "2026-11-05T10:00:03Z",
};

describe("AnalysisResultView", () => {
  it("renderiza conteúdo com marcadores clicáveis, fontes, cobertura e limitações", async () => {
    const onSource = vi.fn();
    renderWithProviders(<AnalysisResultView analysis={succeeded} onSourceClick={onSource} />);
    expect(screen.getByTestId("analysis-content")).toHaveTextContent("Aviso prévio de 45 dias");
    await userEvent.click(screen.getByTestId("analysis-source-chip-1"));
    expect(onSource).toHaveBeenCalledWith(expect.objectContaining({ chunk_id: "c1", location_label: "Página 4" }));
    // marcador sem fonte não vira chip
    expect(screen.queryByTestId("analysis-source-chip-9")).not.toBeInTheDocument();
    expect(screen.getByText("[9]")).toBeInTheDocument();

    const sources = screen.getByTestId("analysis-sources");
    expect(sources).toHaveTextContent("contrato.pdf — Página 4");
    expect(sources).toHaveTextContent("contrato.pdf — Página 2");

    const coverage = screen.getByTestId("analysis-coverage");
    expect(coverage).toHaveTextContent("Hierárquico em 2 partes");
    expect(coverage).toHaveTextContent("Trechos lidos: 3 de 3");
    expect(coverage).toHaveTextContent("Todos os trechos dos documentos foram considerados");
    expect(coverage).toHaveTextContent("provedor determinístico de testes");
    expect(screen.queryByTestId("coverage-incomplete")).not.toBeInTheDocument();
  });

  it("destaca cobertura parcial em análises por recuperação", () => {
    const partial: Analysis = {
      ...succeeded,
      kind: "comparison",
      summary_type: null,
      result: { ...succeeded.result!, coverage: { chunks_used: 8, chunks_total: 40, tokens_used: 5000, strategy: "retrieval", parts: 1, complete: false } },
    };
    renderWithProviders(<AnalysisResultView analysis={partial} />);
    expect(screen.getByTestId("coverage-incomplete")).toHaveTextContent("Cobertura parcial");
    expect(screen.getByTestId("analysis-coverage")).toHaveTextContent("Por recuperação");
    expect(screen.getByTestId("analysis-coverage")).toHaveTextContent("8 de 40");
  });

  it("mostra estado em processamento sem percentual e permite cancelar", async () => {
    const onCancel = vi.fn();
    renderWithProviders(<AnalysisResultView analysis={{ ...succeeded, status: "running", result: null }} onCancel={onCancel} onExport={vi.fn()} />);
    const processing = screen.getByTestId("analysis-processing");
    expect(processing).toHaveTextContent("Analisando o documento");
    expect(processing.textContent).not.toMatch(/%/);
    expect(screen.queryByRole("button", { name: "Exportar análise" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancelar análise" }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("mostra a mensagem de erro do backend quando falha", () => {
    renderWithProviders(<AnalysisResultView analysis={{ ...succeeded, status: "failed", result: null, error_message: "Provedor de IA indisponível." }} />);
    expect(screen.getByTestId("analysis-error")).toHaveTextContent("Provedor de IA indisponível.");
    expect(screen.queryByTestId("analysis-coverage")).not.toBeInTheDocument();
  });

  it("exporta nos dois formatos", async () => {
    const onExport = vi.fn();
    renderWithProviders(<AnalysisResultView analysis={succeeded} onExport={onExport} />);
    await userEvent.click(screen.getByRole("button", { name: "Exportar análise" }));
    await userEvent.click(await screen.findByText("Markdown (.md)"));
    expect(onExport).toHaveBeenCalledWith("md");
  });
});
