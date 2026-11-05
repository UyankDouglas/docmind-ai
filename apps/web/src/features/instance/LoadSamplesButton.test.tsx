import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { jsonResponse, mockFetch, renderWithProviders } from "@/test/utils";
import { LoadSamplesButton } from "./LoadSamplesButton";

const instance = { demo_mode: true, registration_enabled: true, demo_samples_available: true, demo_notice: "Demo" };
const me = (role: string) => ({
  id: "u1",
  name: "Ana Silva",
  email: "ana@exemplo.com",
  created_at: "2026-01-01T00:00:00Z",
  workspace: { id: "w1", name: "Workspace de Ana", slug: "ana", role },
});

function handler(role: string, samples: unknown = { collection_id: "c1", loaded: ["a.pdf", "b.pdf"], skipped: [], stopped_reason: null }) {
  return (url: string) => {
    if (url.endsWith("/instance")) return jsonResponse(instance);
    if (url.endsWith("/auth/me")) return jsonResponse(me(role));
    if (url.endsWith("/demo/samples")) return jsonResponse(samples, { status: 202 });
    return jsonResponse({}, { status: 404 });
  };
}

describe("LoadSamplesButton", () => {
  it("envia os exemplos e confirma quantos foram carregados", async () => {
    document.cookie = "docmind_csrf=csrf; path=/";
    const fetchMock = mockFetch(handler("admin"));
    renderWithProviders(<LoadSamplesButton />);
    await userEvent.click(await screen.findByRole("button", { name: /carregar documentos de exemplo/i }));
    expect(await screen.findByText("2 documento(s) de exemplo enviados")).toBeInTheDocument();
    const call = fetchMock.mock.calls.find((c) => String(c[0]).endsWith("/demo/samples"));
    expect(call?.[1]?.method).toBe("POST");
  });

  it("informa quando os exemplos já estavam no workspace", async () => {
    document.cookie = "docmind_csrf=csrf; path=/";
    mockFetch(handler("editor", { collection_id: "c1", loaded: [], skipped: ["a.pdf"], stopped_reason: null }));
    renderWithProviders(<LoadSamplesButton />);
    await userEvent.click(await screen.findByRole("button", { name: /carregar documentos de exemplo/i }));
    expect(await screen.findByText("Os documentos de exemplo já estão no workspace")).toBeInTheDocument();
  });

  it("não aparece para leitores", async () => {
    const fetchMock = mockFetch(handler("viewer"));
    renderWithProviders(<LoadSamplesButton />);
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith("/auth/me"))).toBe(true));
    expect(screen.queryByRole("button", { name: /carregar documentos/i })).not.toBeInTheDocument();
  });
});
