import { expect, test } from "@playwright/test";
import { login, logout, newUser, register } from "./helpers";

test.describe("Autenticação", () => {
  test("cadastro leva ao dashboard com o workspace pessoal", async ({ page }) => {
    const user = await register(page, newUser("cadastro"));
    await expect(page.getByRole("heading", { name: `Olá, ${user.name.split(" ")[0]}` })).toBeVisible();
    await expect(page.getByRole("link", { name: "Documentos", exact: true })).toBeVisible();
    // Sessão persistida no servidor: recarregar mantém o usuário autenticado
    await page.reload();
    await expect(page.getByRole("heading", { name: /Olá, / })).toBeVisible();
  });

  test("logout e login novamente", async ({ page }) => {
    const user = await register(page, newUser("login"));
    await logout(page);
    await page.goto("/documents");
    await expect(page).toHaveURL(/\/login/);
    await login(page, user);
    await expect(page.getByRole("heading", { name: /Olá, / })).toBeVisible();
  });

  test("credenciais inválidas mostram erro sem revelar detalhes", async ({ page }) => {
    const user = await register(page, newUser("erro"));
    await logout(page);
    await page.goto("/login");
    await page.getByLabel("E-mail").fill(user.email);
    await page.getByLabel("Senha", { exact: true }).fill("senha-errada-123");
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.getByText("E-mail ou senha incorretos.")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });
});
