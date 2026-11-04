import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { jsonResponse, mockFetch, renderWithProviders } from "@/test/utils";
import type { WorkspaceSettings } from "@/types/api";
import { RetrievalSettingsCard, toPatch, validateRetrievalForm } from "./RetrievalSettingsCard";

const settings: WorkspaceSettings = {
  external_ai_enabled: true,
  retrieval: { mode: "hybrid", top_k: 8, min_similarity: 0.15, max_context_tokens: 6000, rrf_k: 60 },
};

describe("validateRetrievalForm / toPatch", () => {
  it("rejeita valores fora dos limites do contrato", () => {
    const errors = validateRetrievalForm({
      mode: "hybrid",
      top_k: "31",
      min_similarity: "1.5",
      max_context_tokens: "500",
      rrf_k: "0",
      external_ai_enabled: true,
    });
    expect(Object.keys(errors).sort()).toEqual(["max_context_tokens", "min_similarity", "rrf_k", "top_k"]);
  });

  it("aceita valores válidos e envia só o que mudou", () => {
    const values = { mode: "vector" as const, top_k: "12", min_similarity: "0,2", max_context_tokens: "6000", rrf_k: "60", external_ai_enabled: false };
    expect(validateRetrievalForm(values)).toEqual({});
    expect(toPatch(values, settings)).toEqual({
      external_ai_enabled: false,
      retrieval: { mode: "vector", top_k: 12, min_similarity: 0.2 },
    });
  });
});

describe("RetrievalSettingsCard", () => {
  it("fica somente leitura para não-admin", async () => {
    mockFetch(() => jsonResponse(settings));
    renderWithProviders(<RetrievalSettingsCard isAdmin={false} />);
    const topK = await screen.findByLabelText(/top_k/);
    expect(topK).toBeDisabled();
    expect(screen.getByText(/Somente administradores/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Salvar/ })).not.toBeInTheDocument();
  });

  it("valida limites antes de salvar e envia PATCH quando válido", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch((_url, init) => {
      if (init?.method === "PATCH") {
        const body = JSON.parse(String(init.body)) as { retrieval?: { top_k?: number } };
        return jsonResponse({ ...settings, retrieval: { ...settings.retrieval, top_k: body.retrieval?.top_k ?? 8 } });
      }
      return jsonResponse(settings);
    });
    document.cookie = "docmind_csrf=t";
    renderWithProviders(<RetrievalSettingsCard isAdmin />);
    const topK = await screen.findByLabelText(/top_k/);
    expect(topK).toBeEnabled();

    await user.clear(topK);
    await user.type(topK, "99");
    await user.click(screen.getByRole("button", { name: /Salvar/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Informe um inteiro entre 1 e 30.");
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);

    await user.clear(topK);
    await user.type(topK, "12");
    await user.click(screen.getByRole("button", { name: /Salvar/ }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(true));
    const patchCall = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH")!;
    expect(String(patchCall[0])).toContain("/workspaces/current/settings");
    expect(JSON.parse(String(patchCall[1]?.body))).toEqual({ retrieval: { top_k: 12 } });
  });
});
