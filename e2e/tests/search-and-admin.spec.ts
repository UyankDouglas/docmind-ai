import { expect, test } from "@playwright/test";
import { newUser, register, sample, uploadAndWaitReady } from "./helpers";

test.describe("Pesquisa híbrida e administração", () => {
  test("pesquisa híbrida destaca termos exatos e mostra scores", async ({ page }) => {
    await register(page, newUser("pesquisa"));
    await uploadAndWaitReady(page, [sample.politicaTxt]);

    await page.goto("/search");
    await page.getByLabel("Consulta").fill("VPN corporativa");
    await page.getByRole("combobox", { name: "Modo de busca" }).click();
    await page.getByRole("option", { name: "Híbrida", exact: true }).click();
    await page.getByRole("button", { name: "Pesquisar" }).click();

    await expect(page.getByText(/modo híbrida/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("politica-seguranca-vertex.txt").first()).toBeVisible();
    await expect(page.locator("mark").first()).toContainText(/VPN/i);
    await expect(page.getByText(/léxico \d+%/).first()).toBeVisible();
    await expect(page.getByText(/Seç/).first()).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Histórico de pesquisas" })).toContainText("VPN corporativa");
  });

  test("administração abre para o admin com seções e cria convite com link de aceite", async ({ page }) => {
    const user = await register(page, newUser("admin"));
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/members/);
    const nav = page.getByRole("navigation", { name: "Seções da administração" });
    for (const label of ["Membros", "Uso", "Limites e custos", "Retenção", "Provedores de IA", "Auditoria"]) {
      await expect(nav.getByRole("link", { name: label })).toBeVisible();
    }
    await expect(page.getByText(user.email)).toBeVisible();

    await page.getByRole("button", { name: "Convidar" }).click();
    const dialog = page.getByRole("dialog", { name: "Convidar membro" });
    await dialog.getByPlaceholder("pessoa@empresa.com").fill(`convidado-${Date.now()}@example.com`);
    await dialog.getByRole("button", { name: "Enviar convite" }).click();
    const acceptUrl = page.getByLabel("Link de aceite");
    await expect(acceptUrl).toBeVisible();
    await expect(acceptUrl).toHaveValue(/\/invite\/[A-Za-z0-9_-]{20,}/);
    await page.getByRole("button", { name: "Concluir" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("list", { name: "Convites pendentes" })).toContainText("convidado-");

    // Uso e auditoria carregam dados reais
    await nav.getByRole("link", { name: "Uso" }).click();
    await expect(page.getByRole("heading", { name: "Uso do workspace" })).toBeVisible();
    // Sem perguntas/uploads ainda: só os totais aparecem (sem linhas por usuário)
    await expect(page.getByText("Uso por usuário")).toBeVisible({ timeout: 20_000 });
    await nav.getByRole("link", { name: "Auditoria" }).click();
    await expect(page.getByText("invitation.create").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("user.register").first()).toBeVisible();
  });
});
