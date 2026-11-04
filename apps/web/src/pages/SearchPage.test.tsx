import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { jsonResponse, mockFetch, renderWithProviders } from "@/test/utils";
import type { SearchHistoryItem, SearchResponse, WorkspaceSettings } from "@/types/api";
import { splitHighlight } from "@/lib/highlight";
import { SearchPage } from "./SearchPage";

const settings: WorkspaceSettings = {
  external_ai_enabled: true,
  retrieval: { mode: "hybrid", top_k: 8, min_similarity: 0.15, max_context_tokens: 6000, rrf_k: 60 },
};

const response: SearchResponse = {
  query: "prazo",
  mode: "hybrid",
  vector_candidates: 5,
  lexical_candidates: 3,
  latency_ms: 21,
  embedding_model: "fake-hash-v1",
  results: [
    {
      chunk_id: "c1",
      document_id: "d1",
      document_name: "Contrato.pdf",
      page_start: 4,
      page_end: 4,
      section_title: null,
      text: "O prazo de aviso prévio é de 45 dias.",
      score: 0.0328,
      vector_score: 0.71,
      lexical_score: 0.4,
      vector_rank: 1,
      lexical_rank: 2,
      highlight: "O <mark>prazo</mark> de aviso <script>alert(1)</script>prévio &amp; multa",
      location_type: "page",
      location_label: "Página 4",
      mime_type: "application/pdf",
    },
  ],
};

const history: SearchHistoryItem[] = [
  { id: "h1", query: "multa por atraso", mode: "vector", result_count: 2, latency_ms: 10, created_at: new Date().toISOString() },
];

describe("splitHighlight", () => {
  it("permite apenas <mark>, remove outras tags e decodifica entidades", () => {
    const parts = splitHighlight("a <mark>b</mark> <b>c</b> &lt;x&gt;");
    expect(parts).toEqual([
      { text: "a ", marked: false },
      { text: "b", marked: true },
      { text: " c <x>", marked: false },
    ]);
  });
});

describe("SearchPage", () => {
  function setup(route = "/search") {
    const calls: Array<{ url: string; body: unknown; method?: string }> = [];
    mockFetch((url, init) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined, method: init?.method });
      if (url.includes("/workspaces/current/settings")) return jsonResponse(settings);
      if (url.includes("/search/history")) return init?.method === "DELETE" ? new Response(null, { status: 204 }) : jsonResponse({ items: history });
      if (url.endsWith("/search")) return jsonResponse(response);
      if (url.includes("/documents")) return jsonResponse({ items: [], total: 0, page: 1, page_size: 100 });
      if (url.includes("/collections")) return jsonResponse({ items: [] });
      return jsonResponse({});
    });
    document.cookie = "docmind_csrf=t";
    return { calls, ...renderWithProviders(<SearchPage />, { route }) };
  }

  it("pesquisa no modo escolhido, mostra scores híbridos, contadores e highlight sanitizado", async () => {
    const user = userEvent.setup();
    const { calls } = setup();
    await user.type(screen.getByLabelText("Consulta"), "prazo");
    await user.click(screen.getByRole("button", { name: "Pesquisar" }));

    expect(await screen.findByTestId("search-summary")).toHaveTextContent("modo híbrida · 5 candidatos vetoriais · 3 léxicos");
    expect(screen.getByTestId("score-details")).toHaveTextContent("vetorial 71% (#1) · léxico 40% (#2)");
    const hl = screen.getByTestId("search-highlight");
    expect(hl.querySelector("mark")).toHaveTextContent("prazo");
    expect(hl.querySelector("script")).toBeNull();
    expect(hl).toHaveTextContent("prévio & multa");
    // modo padrão => não envia `mode`
    const searchCall = calls.find((c) => c.url.endsWith("/search") && c.method === "POST")!;
    expect(searchCall.body).toMatchObject({ query: "prazo", top_k: 10 });
    expect((searchCall.body as Record<string, unknown>).mode).toBeUndefined();
  });

  it("envia mode=vector quando selecionado via URL e repete pesquisa do histórico", async () => {
    const user = userEvent.setup();
    const { calls } = setup("/search?q=prazo&mode=vector");
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/search") && c.method === "POST")).toBe(true));
    const first = calls.find((c) => c.url.endsWith("/search") && c.method === "POST")!;
    expect(first.body).toMatchObject({ query: "prazo", mode: "vector" });

    await user.click(await screen.findByRole("button", { name: /Repetir pesquisa: multa por atraso/ }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.endsWith("/search") && (c.body as { query?: string })?.query === "multa por atraso")).toBe(true),
    );
  });

  it("limpa o histórico após confirmação", async () => {
    const user = userEvent.setup();
    const { calls } = setup();
    await user.click(await screen.findByRole("button", { name: "Limpar histórico de pesquisas" }));
    await user.click(await screen.findByRole("button", { name: "Limpar" }));
    await waitFor(() => expect(calls.some((c) => c.url.includes("/search/history") && c.method === "DELETE")).toBe(true));
  });
});
