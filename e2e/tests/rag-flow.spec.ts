import { expect, test } from "@playwright/test";
import { askInNewChat, newUser, register, sample, uploadAndWaitReady } from "./helpers";

test.describe("Fluxo RAG completo", () => {
  test("cadastro → upload → indexação → pergunta → resposta com fonte → visualizador PDF → histórico", async ({ page }) => {
    await register(page, newUser("rag"));

    // Upload e processamento real pelo worker (status "Pronto" via polling da UI)
    await uploadAndWaitReady(page, [sample.contratoPdf]);
    const row = page.getByRole("row", { name: /contrato-prestacao-servicos\.pdf/ });
    await expect(row.getByText(/pág\./)).toBeVisible();

    // Pergunta no chat (streaming + mensagem final validada)
    const answer = await askInNewChat(page, "Qual é o prazo de aviso prévio para cancelamento do contrato?");
    await expect(answer.getByRole("button", { name: /^Fonte 1:/ })).toBeVisible();
    const sources = answer.getByRole("region", { name: "Fontes" });
    await expect(sources).toBeVisible();
    await expect(sources).toContainText("contrato-prestacao-servicos.pdf");
    await expect(sources).toContainText(/Página/);
    await expect(answer.getByTestId("no-evidence")).toHaveCount(0);

    // Clicar na fonte abre o PDF lado a lado, com a página renderizada em canvas
    await answer.getByRole("button", { name: /^Fonte 1:/ }).click();
    const viewer = page.getByRole("complementary", { name: "Documento citado" });
    await expect(viewer).toBeVisible();
    await expect(viewer.locator("canvas").first()).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => viewer.locator("canvas").first().evaluate((c) => (c as HTMLCanvasElement).width), { timeout: 30_000 }).toBeGreaterThan(0);
    await expect(viewer.getByLabel("Número da página")).toBeVisible();

    // Histórico: a conversa aparece na lista com o título derivado da pergunta
    await expect(page.getByText("Qual é o prazo de aviso prévio para cancelamento do contrato?").first()).toBeVisible();
    const conversationUrl = page.url();
    await page.goto("/chat");
    await page.getByRole("link", { name: /Qual é o prazo de aviso prévio/ }).first().click();
    await expect(page).toHaveURL(conversationUrl);
    await expect(page.getByRole("article", { name: "Resposta do assistente" }).last()).toBeVisible();
  });
});
