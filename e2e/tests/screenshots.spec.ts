/**
 * Gera as screenshots da documentação (docs/screenshots) a partir de dados reais da stack.
 * Execute com: pnpm screenshots   (projeto "screenshots", 1440×900, tema escuro)
 */
import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { askInNewChat, newUser, register, sample, uploadAndWaitReady } from "./helpers";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, "..", "..", "docs", "screenshots");

function shot(name: string) {
  return path.join(OUT, name);
}

test.describe("Screenshots da documentação", () => {
  test.setTimeout(240_000);

  test("gera as capturas das telas principais", async ({ page }) => {
    mkdirSync(OUT, { recursive: true });

    // 01 — login
    await page.goto("/login");
    await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible();
    await page.screenshot({ path: shot("01-login.png") });

    // Setup: conta "Demonstração" + documentos de exemplo + coleção
    const user = newUser("demo");
    user.name = "Marina Demonstração";
    await register(page, user);
    await uploadAndWaitReady(page, [sample.contratoPdf, sample.manualDocx, sample.politicaTxt]);
    await page.getByRole("button", { name: "Nova coleção" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByPlaceholder("Ex.: Contratos 2026").fill("Operações de TI");
    await dialog.getByRole("radio", { name: "Cor #22D3EE" }).click();
    await dialog.getByRole("button", { name: "Criar coleção" }).click();
    await expect(page.getByRole("navigation", { name: "Lista de coleções" })).toContainText("Operações de TI");

    // 03 — biblioteca
    await page.goto("/documents");
    await expect(page.getByRole("row", { name: /contrato-prestacao-servicos\.pdf/ })).toBeVisible();
    await page.screenshot({ path: shot("03-biblioteca.png") });

    // 04 — visualizador PDF
    await page.getByRole("link", { name: /contrato-prestacao-servicos\.pdf/ }).first().click();
    await expect(page).toHaveURL(/\/documents\/[0-9a-f-]{36}/);
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => page.locator("canvas").first().evaluate((c) => (c as HTMLCanvasElement).width), { timeout: 30_000 }).toBeGreaterThan(0);
    await page.screenshot({ path: shot("04-visualizador-pdf.png") });

    // 05 — chat com citações (fonte aberta lado a lado) e 07 — evidências
    const answer = await askInNewChat(page, "Qual é o prazo de aviso prévio para cancelamento do contrato?");
    await answer.getByRole("button", { name: /^Fonte 1:/ }).click();
    const viewer = page.getByRole("complementary", { name: "Documento citado" });
    await expect(viewer.locator("canvas").first()).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => viewer.locator("canvas").first().evaluate((c) => (c as HTMLCanvasElement).width), { timeout: 30_000 }).toBeGreaterThan(0);
    await page.screenshot({ path: shot("05-chat-citacoes.png") });
    await page.getByRole("button", { name: "Fechar visualizador" }).click();
    await answer.getByRole("button", { name: "Como esta resposta foi gerada" }).click();
    await expect(page.getByTestId("evidence-summary")).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: shot("07-evidencias.png") });
    await page.keyboard.press("Escape");

    // 02 — dashboard (já com documentos, conversa e coleção)
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Olá, / })).toBeVisible();
    await expect(page.getByText("contrato-prestacao-servicos.pdf").first()).toBeVisible();
    await page.screenshot({ path: shot("02-dashboard.png") });

    // 06 — pesquisa híbrida
    await page.goto("/search?q=VPN%20corporativa&mode=hybrid");
    await expect(page.locator("mark").first()).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: shot("06-pesquisa-hibrida.png") });

    // 08 — comparação concluída
    await page.goto("/compare");
    await page.getByRole("checkbox", { name: "contrato-prestacao-servicos.pdf" }).click();
    await page.getByRole("checkbox", { name: "manual-operacao-orbita.docx" }).click();
    await page.getByRole("button", { name: "Quais tópicos aparecem em ambos?" }).click();
    await page.getByRole("button", { name: "Comparar", exact: true }).click();
    await expect(page).toHaveURL(/analysis=/, { timeout: 30_000 });
    await expect(page.getByText("Cobertura e limitações", { exact: false }).first()).toBeVisible({ timeout: 60_000 });
    await page.screenshot({ path: shot("08-comparacao.png") });

    // 09 — administração / uso
    await page.goto("/admin/usage");
    await expect(page.getByRole("heading", { name: "Uso do workspace" })).toBeVisible();
    await expect(page.getByText(user.email).first()).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: shot("09-admin-uso.png") });

    // 10 — configurações
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Configurações" })).toBeVisible();
    await page.screenshot({ path: shot("10-configuracoes.png") });
  });
});
