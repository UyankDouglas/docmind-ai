import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { jsonResponse, mockFetch, renderWithProviders } from "@/test/utils";
import type { UsageFull, UserMe } from "@/types/api";
import { UsageBlockBanner } from "./UsageBlockBanner";

const usage: UsageFull = {
  questions_last_hour: 0,
  uploads_last_hour: 0,
  prompt_tokens_month: 100,
  completion_tokens_month: 50,
  estimated_cost_usd_month: null,
  limits: { questions_per_hour: 60, uploads_per_hour: 30, max_upload_mb: 20, max_pdf_pages: 200, monthly_token_budget: 150, monthly_cost_budget_usd: null, max_documents: null, max_storage_mb: null },
  feedback: { positive: 0, negative: 0, total_answers: 0 },
  tokens_month_total: 150,
  budget_used_pct: 100,
  documents_count: 2,
  storage_mb: 0.1,
  blocked: true,
  blocked_reason: "O orçamento mensal de 150 tokens foi atingido.",
};
const me: UserMe = { id: "u1", name: "Ana", email: "a@example.com", created_at: "2026-01-01T00:00:00Z", workspace: { id: "w1", name: "W", slug: "w", role: "viewer" } };

describe("UsageBlockBanner", () => {
  it("mostra o motivo do bloqueio e orienta não-admins", async () => {
    mockFetch((url) => (url.includes("/auth/me") ? jsonResponse(me) : jsonResponse(usage)));
    renderWithProviders(<UsageBlockBanner />);
    expect(await screen.findByTestId("usage-block-banner")).toHaveTextContent("O orçamento mensal de 150 tokens foi atingido.");
    expect(screen.getByText(/Fale com um administrador/)).toBeInTheDocument();
  });

  it("admins recebem link para os limites; sem bloqueio nada é renderizado", async () => {
    const admin: UserMe = { ...me, workspace: { ...me.workspace, role: "admin" } };
    mockFetch((url) => (url.includes("/auth/me") ? jsonResponse(admin) : jsonResponse(usage)));
    renderWithProviders(<UsageBlockBanner />);
    expect(await screen.findByRole("link", { name: /Limites e custos/ })).toHaveAttribute("href", "/admin/limits");

    mockFetch((url) => (url.includes("/auth/me") ? jsonResponse(me) : jsonResponse({ ...usage, blocked: false, blocked_reason: null })));
    renderWithProviders(<UsageBlockBanner />);
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryAllByTestId("usage-block-banner")).toHaveLength(1);
  });
});
