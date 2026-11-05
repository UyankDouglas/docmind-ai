import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { jsonResponse, mockFetch, renderWithProviders } from "@/test/utils";
import { ResetPasswordForm } from "./ResetPasswordForm";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

describe("ResetPasswordForm", () => {
  it("envia o token da URL e a nova senha; mostra sucesso", async () => {
    document.cookie = "docmind_csrf=t; path=/";
    const fetchMock = mockFetch((url, init) => {
      if (url.endsWith("/auth/reset-password") && init?.method === "POST") return new Response(null, { status: 204 });
      return jsonResponse({});
    });
    renderWithProviders(<ResetPasswordForm />, { route: "/reset-password?token=tok-1" });
    await userEvent.type(screen.getByLabelText("Nova senha"), "nova-senha-123");
    await userEvent.type(screen.getByLabelText("Confirmar nova senha"), "nova-senha-123");
    await userEvent.click(screen.getByRole("button", { name: "Redefinir senha" }));
    expect(await screen.findByText(/Senha redefinida/)).toBeInTheDocument();
    const post = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
    expect(JSON.parse(String(post![1]!.body))).toEqual({ token: "tok-1", password: "nova-senha-123" });
  });

  it("valida confirmação e mostra erro de token inválido", async () => {
    document.cookie = "docmind_csrf=t; path=/";
    mockFetch((url, init) => {
      if (url.endsWith("/auth/reset-password") && init?.method === "POST") {
        return jsonResponse({ error: { code: "invalid_token", message: "Token inválido ou expirado." } }, { status: 400 });
      }
      return jsonResponse({});
    });
    renderWithProviders(<ResetPasswordForm />, { route: "/reset-password?token=tok-1" });
    await userEvent.type(screen.getByLabelText("Nova senha"), "nova-senha-123");
    await userEvent.type(screen.getByLabelText("Confirmar nova senha"), "diferente-123");
    await userEvent.click(screen.getByRole("button", { name: "Redefinir senha" }));
    expect(await screen.findByText("As senhas não coincidem.")).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText("Confirmar nova senha"));
    await userEvent.type(screen.getByLabelText("Confirmar nova senha"), "nova-senha-123");
    await userEvent.click(screen.getByRole("button", { name: "Redefinir senha" }));
    await waitFor(() => expect(screen.getByText(/inválido ou expirou/)).toBeInTheDocument());
  });

  it("sem token na URL mostra link para solicitar outro", () => {
    mockFetch(() => jsonResponse({}));
    renderWithProviders(<ResetPasswordForm />, { route: "/reset-password" });
    expect(screen.getByText(/token de redefinição não foi encontrado/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Solicitar um novo link" })).toHaveAttribute("href", "/forgot-password");
  });
});

describe("ForgotPasswordForm", () => {
  it("mostra mensagem neutra após enviar", async () => {
    document.cookie = "docmind_csrf=t; path=/";
    mockFetch((url, init) => {
      if (url.endsWith("/auth/forgot-password") && init?.method === "POST") return new Response(null, { status: 202 });
      return jsonResponse({});
    });
    renderWithProviders(<ForgotPasswordForm />);
    await userEvent.type(screen.getByLabelText("E-mail da conta"), "alguem@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Enviar instruções" }));
    expect(await screen.findByText(/Se existir uma conta com este e-mail/)).toBeInTheDocument();
  });
});
