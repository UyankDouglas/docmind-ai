import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";
import { jsonResponse, mockFetch, renderWithProviders } from "@/test/utils";
import { LoginForm } from "./LoginForm";

const me = {
  id: "u1",
  name: "Ana Silva",
  email: "ana@exemplo.com",
  created_at: "2026-01-01T00:00:00Z",
  workspace: { id: "w1", name: "Workspace de Ana", slug: "ana", role: "admin" },
};

function setup() {
  document.cookie = "docmind_csrf=csrf; path=/";
  return renderWithProviders(
    <Routes>
      <Route path="/login" element={<LoginForm />} />
      <Route path="/" element={<h1>Dashboard</h1>} />
    </Routes>,
    { route: "/login" },
  );
}

describe("LoginForm", () => {
  it("valida campos obrigatórios antes de enviar", async () => {
    const fetchMock = mockFetch(() => jsonResponse(me));
    setup();
    await userEvent.click(screen.getByRole("button", { name: /entrar/i }));
    expect(await screen.findByText("Informe um e-mail válido.")).toBeInTheDocument();
    expect(screen.getByText("Informe sua senha.")).toBeInTheDocument();
    // Só a configuração pública da instância é consultada; o login não é enviado
    expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith("/auth/login"))).toBe(false);
  });

  it("oculta o link de cadastro quando a instância não aceita novos cadastros", async () => {
    mockFetch((url) =>
      url.endsWith("/instance")
        ? jsonResponse({ demo_mode: true, registration_enabled: false, demo_samples_available: false, demo_notice: null })
        : jsonResponse({}, { status: 404 }),
    );
    setup();
    await waitFor(() => expect(screen.queryByRole("link", { name: "Criar conta" })).not.toBeInTheDocument());
  });

  it("mostra o link de cadastro por padrão", async () => {
    mockFetch((url) =>
      url.endsWith("/instance")
        ? jsonResponse({ demo_mode: false, registration_enabled: true, demo_samples_available: false, demo_notice: null })
        : jsonResponse({}, { status: 404 }),
    );
    setup();
    expect(await screen.findByRole("link", { name: "Criar conta" })).toBeInTheDocument();
  });

  it("envia credenciais e redireciona ao autenticar", async () => {
    const fetchMock = mockFetch((url) => {
      if (url.endsWith("/auth/login")) return jsonResponse(me);
      return jsonResponse({}, { status: 404 });
    });
    setup();
    await userEvent.type(screen.getByLabelText("E-mail"), "ana@exemplo.com");
    await userEvent.type(screen.getByLabelText("Senha"), "segredo123");
    await userEvent.click(screen.getByRole("button", { name: /entrar/i }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument());
    const call = fetchMock.mock.calls.find((c) => String(c[0]).endsWith("/auth/login"));
    expect(call).toBeDefined();
    expect(JSON.parse(String(call![1]?.body))).toEqual({ email: "ana@exemplo.com", password: "segredo123" });
  });

  it("mostra mensagem de credenciais inválidas em 401", async () => {
    mockFetch(() => jsonResponse({ error: { code: "unauthorized", message: "Credenciais inválidas." } }, { status: 401 }));
    setup();
    await userEvent.type(screen.getByLabelText("E-mail"), "ana@exemplo.com");
    await userEvent.type(screen.getByLabelText("Senha"), "errada");
    await userEvent.click(screen.getByRole("button", { name: /entrar/i }));
    expect(await screen.findByText("E-mail ou senha incorretos.")).toBeInTheDocument();
  });
});
