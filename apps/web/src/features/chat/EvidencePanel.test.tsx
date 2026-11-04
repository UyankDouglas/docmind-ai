import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/utils";
import type { RetrievalEvidence } from "@/types/api";
import { EvidenceDetails } from "./EvidencePanel";

const evidence: RetrievalEvidence = {
  message_id: "a1",
  mode: "hybrid",
  params: { top_k: 8, min_similarity: 0.15, max_context_tokens: 6000, embedding_model: "fake-hash-v1" },
  scoped_document_ids: ["d1"],
  candidates: [
    { chunk_id: "c1", document_id: "d1", document_name: "Contrato.pdf", location_label: "Página 4", score: 0.9, vector_score: 0.8, lexical_score: 0.5, in_context: true, cited: true, citation_index: 1, snippet: "prazo de 45 dias" },
    { chunk_id: "c2", document_id: "d1", document_name: "Contrato.pdf", location_label: "Página 2", score: 0.6, vector_score: 0.6, lexical_score: null, in_context: true, cited: false, citation_index: null, snippet: "valor mensal" },
    { chunk_id: "c3", document_id: "d1", document_name: "Contrato.pdf", location_label: "Página 5", score: 0.2, vector_score: null, lexical_score: 0.2, in_context: false, cited: false, citation_index: null, snippet: "foro" },
  ],
  context_tokens: 812,
  context_truncated: false,
  invalid_citations_removed: [7],
  latency: { retrieval_ms: 42, generation_ms: 900 },
  usage: { prompt_tokens: 1200, completion_tokens: 80, model: "fake-llm-v1" },
};

describe("EvidenceDetails", () => {
  it("marca candidatos citados, no contexto e não enviados, com resumo e parâmetros", () => {
    renderWithProviders(<EvidenceDetails evidence={evidence} />);
    expect(screen.getByText("Híbrida (vetorial + léxica)")).toBeInTheDocument();
    expect(screen.getByText(/top_k 8 · limiar 0.15/)).toBeInTheDocument();
    expect(screen.getAllByTestId("evidence-candidate-cited")).toHaveLength(1);
    expect(screen.getAllByTestId("evidence-candidate-context")).toHaveLength(1);
    expect(screen.getAllByTestId("evidence-candidate")).toHaveLength(1);
    expect(screen.getByText(/Citada \[1\]/)).toBeInTheDocument();
    expect(screen.getByText("No contexto")).toBeInTheDocument();
    expect(screen.getByText("Não enviada")).toBeInTheDocument();
    const summary = screen.getByTestId("evidence-summary");
    expect(summary).toHaveTextContent("3 trechos recuperados");
    expect(summary).toHaveTextContent("2 enviados ao modelo");
    expect(summary).toHaveTextContent("1 citado");
    expect(summary).toHaveTextContent("[7]");
    expect(screen.getByText(/recuperação 42 ms · geração 900 ms/)).toBeInTheDocument();
    expect(screen.getByText(/fake-llm-v1 · 1200 \+ 80 tokens/)).toBeInTheDocument();
  });

  it("links dos candidatos apontam para o visualizador na localização", () => {
    renderWithProviders(<EvidenceDetails evidence={evidence} />);
    const link = screen.getAllByRole("link", { name: "Contrato.pdf" })[0]!;
    expect(link).toHaveAttribute("href", "/documents/d1?chunk=c1");
  });

  it("explica abstenção quando não há candidatos", () => {
    renderWithProviders(<EvidenceDetails evidence={{ ...evidence, candidates: [], invalid_citations_removed: [] }} />);
    expect(screen.getByText(/Nenhum trecho ultrapassou o limiar/)).toBeInTheDocument();
  });
});
