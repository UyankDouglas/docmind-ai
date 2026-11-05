import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { jsonResponse, mockFetch, renderWithProviders } from "@/test/utils";
import type { WorkspaceSettingsFull } from "@/types/api";
import { LimitsForm, limitsPatch, parseLimits } from "./LimitsForm";
import { RetentionForm, parseRetention } from "./RetentionForm";

export const fullSettings: WorkspaceSettingsFull = {
  external_ai_enabled: true,
  retrieval: { mode: "hybrid", top_k: 8, min_similarity: 0.15, max_context_tokens: 6000, rrf_k: 60 },
  limits: { monthly_token_budget: 100000, monthly_cost_budget_usd: null, max_documents: null, max_storage_mb: 512 },
  retention: { conversations_days: 90, analyses_days: null, search_history_days: 30, deleted_documents_days: 7, last_run_at: "2026-11-04T03:15:00Z" },
  ai: {
    llm_model: null,
    allowed_llm_models: ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"],
    embedding_model: "gemini-embedding-001",
    embedding_provider: "gemini",
    embedding_provider_label: "Google Gemini",
    embedding_model_label: "Gemini Embedding 001",
    stale_embedding_documents: 0,
    ocr_enabled: false,
    ocr_available: false,
  },
};

describe("parseLimits / parseRetention", () => {
  it("campo vazio vira null e valores inválidos geram erro", () => {
    const { values, errors } = parseLimits({ monthly_token_budget: "", monthly_cost_budget_usd: "12,5", max_documents: "-1", max_storage_mb: "10.5" });
    expect(values.monthly_token_budget).toBeNull();
    expect(values.monthly_cost_budget_usd).toBe(12.5);
    expect(errors.max_documents).toBeDefined();
    expect(errors.max_storage_mb).toBeDefined();
    expect(limitsPatch({ ...fullSettings.limits, max_storage_mb: null }, fullSettings.limits)).toEqual({ max_storage_mb: null });

    const r = parseRetention({ conversations_days: "", analyses_days: "0", search_history_days: "30", deleted_documents_days: "4000" });
    expect(r.values.conversations_days).toBeNull();
    expect(r.values.search_history_days).toBe(30);
    expect(r.errors.analyses_days).toBeDefined();
    expect(r.errors.deleted_documents_days).toBeDefined();
  });
});

describe("LimitsForm", () => {
  it("envia só os campos alterados e trata vazio como sem limite", async () => {
    document.cookie = "docmind_csrf=t; path=/";
    const fetchMock = mockFetch((url, init) => {
      if (url.endsWith("/workspaces/current/settings") && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body)) as { limits: Record<string, number | null> };
        return jsonResponse({ ...fullSettings, limits: { ...fullSettings.limits, ...body.limits } });
      }
      if (url.endsWith("/workspaces/current/settings")) return jsonResponse(fullSettings);
      return jsonResponse({});
    });
    renderWithProviders(<LimitsForm />);
    const budget = await screen.findByLabelText("Orçamento mensal de tokens");
    expect(budget).toHaveValue(100000);
    await userEvent.clear(budget);
    const docs = screen.getByLabelText("Máximo de documentos");
    await userEvent.type(docs, "50");
    await userEvent.click(screen.getByRole("button", { name: /Salvar limites/ }));
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[1]?.method === "PATCH")).toBe(true));
    const patch = fetchMock.mock.calls.find((c) => c[1]?.method === "PATCH");
    expect(JSON.parse(String(patch![1]!.body))).toEqual({ limits: { monthly_token_budget: null, max_documents: 50 } });
  });

  it("valida valores negativos sem chamar a API", async () => {
    document.cookie = "docmind_csrf=t; path=/";
    const fetchMock = mockFetch(() => jsonResponse(fullSettings));
    renderWithProviders(<LimitsForm />);
    const docs = await screen.findByLabelText("Máximo de documentos");
    await userEvent.type(docs, "-3");
    await userEvent.click(screen.getByRole("button", { name: /Salvar limites/ }));
    expect(await screen.findByText(/inteiro ≥ 0/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some((c) => c[1]?.method === "PATCH")).toBe(false);
  });
});

describe("RetentionForm", () => {
  it("salva a política e executa agora mostrando o resultado", async () => {
    document.cookie = "docmind_csrf=t; path=/";
    const fetchMock = mockFetch((url, init) => {
      if (url.endsWith("/workspaces/current/retention/run") && init?.method === "POST") {
        return jsonResponse({ deleted: { conversations: 3, analyses: 0, search_queries: 12, documents: 1 } });
      }
      if (url.endsWith("/workspaces/current/settings") && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body)) as { retention: Record<string, number | null> };
        return jsonResponse({ ...fullSettings, retention: { ...fullSettings.retention, ...body.retention } });
      }
      if (url.endsWith("/workspaces/current/settings")) return jsonResponse(fullSettings);
      return jsonResponse({});
    });
    renderWithProviders(<RetentionForm />);
    const analyses = await screen.findByLabelText("Análises (dias)");
    expect(analyses).toHaveValue(null);
    await userEvent.type(analyses, "60");
    await userEvent.click(screen.getByRole("button", { name: /Salvar política/ }));
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[1]?.method === "PATCH")).toBe(true));
    expect(JSON.parse(String(fetchMock.mock.calls.find((c) => c[1]?.method === "PATCH")![1]!.body))).toEqual({ retention: { analyses_days: 60 } });

    await userEvent.click(screen.getByRole("button", { name: /Executar agora/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Executar retenção" }));
    expect(await screen.findByTestId("retention-result")).toHaveTextContent("3 conversa(s)");
    expect(screen.getByTestId("retention-result")).toHaveTextContent("12 pesquisa(s)");
  });
});
