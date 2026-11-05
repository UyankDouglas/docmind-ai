import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";
import { jsonResponse, mockFetch, renderWithProviders } from "@/test/utils";
import type { InvitationPublic, UserMe } from "@/types/api";
import { InvitePage } from "./InvitePage";

const invite: InvitationPublic = {
  workspace_name: "Jurídico",
  email: "convidado@example.com",
  role: "editor",
  expires_at: "2027-01-01T00:00:00Z",
  status: "pending",
};
const me: UserMe = {
  id: "u1",
  name: "Convidado",
  email: "convidado@example.com",
  created_at: "2026-01-01T00:00:00Z",
  workspace: { id: "w1", name: "Pessoal", slug: "pessoal", role: "admin" },
};

function render(route = "/invite/tok123") {
  return renderWithProviders(
    <Routes>
      <Route path="/invite/:token" element={<InvitePage />} />
      <Route path="/" element={<p>Início</p>} />
    </Routes>,
    { route },
  );
}

describe("InvitePage", () => {
  it("não logado: mostra o convite e links de entrar/criar conta com retorno", async () => {
    mockFetch((url) => {
      if (url.includes("/auth/me")) return jsonResponse({ error: { code: "unauthorized", message: "x" } }, { status: 401 });
      if (url.includes("/invitations/tok123")) return jsonResponse(invite);
      return jsonResponse({});
    });
    render();
    expect(await screen.findByText("Jurídico")).toBeInTheDocument();
    expect(screen.getByText("convidado@example.com")).toBeInTheDocument();
    const login = screen.getByRole("link", { name: /Entrar/ });
    expect(login).toHaveAttribute("href", "/login?next=%2Finvite%2Ftok123");
    const register = screen.getByRole("link", { name: /Criar conta/ });
    expect(register.getAttribute("href")).toContain("/register?next=%2Finvite%2Ftok123");
    expect(register.getAttribute("href")).toContain("email=convidado%40example.com");
  });

  it("logado com o e-mail convidado: aceita e navega para o início", async () => {
    document.cookie = "docmind_csrf=t; path=/";
    const fetchMock = mockFetch((url, init) => {
      if (url.includes("/auth/me")) return jsonResponse(me);
      if (url.endsWith("/invitations/tok123/accept") && init?.method === "POST") {
        return jsonResponse({ ...me, workspace: { id: "w2", name: "Jurídico", slug: "juridico", role: "editor" } });
      }
      if (url.includes("/invitations/tok123")) return jsonResponse(invite);
      return jsonResponse({});
    });
    render();
    await userEvent.click(await screen.findByRole("button", { name: /Aceitar convite/ }));
    await waitFor(() => expect(screen.getByText("Início")).toBeInTheDocument());
    expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith("/invitations/tok123/accept"))).toBe(true);
  });

  it("logado com outro e-mail: bloqueia o aceite", async () => {
    mockFetch((url) => {
      if (url.includes("/auth/me")) return jsonResponse({ ...me, email: "outra@example.com" });
      if (url.includes("/invitations/tok123")) return jsonResponse(invite);
      return jsonResponse({});
    });
    render();
    expect(await screen.findByText(/o convite é para/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Aceitar convite/ })).not.toBeInTheDocument();
  });

  it("convite expirado ou inexistente mostra erro", async () => {
    mockFetch((url) => {
      if (url.includes("/auth/me")) return jsonResponse(me);
      if (url.includes("/invitations/tok123")) return jsonResponse({ ...invite, status: "expired" });
      return jsonResponse({});
    });
    render();
    expect(await screen.findByText(/Este convite expirou/)).toBeInTheDocument();

    mockFetch((url) => {
      if (url.includes("/auth/me")) return jsonResponse(me);
      return jsonResponse({ error: { code: "not_found", message: "x" } }, { status: 404 });
    });
    render("/invite/outro");
    expect(await screen.findByText(/Convite não encontrado/)).toBeInTheDocument();
  });
});
