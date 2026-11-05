import { expect, test } from "@playwright/test";
import { askInNewChat, newUser, register, sample, uploadAndWaitReady } from "./helpers";

test.describe("Abstenção", () => {
  test("pergunta fora do domínio recebe aviso de sem evidência e nenhuma fonte", async ({ page }) => {
    await register(page, newUser("abstencao"));
    await uploadAndWaitReady(page, [sample.contratoPdf]);

    const answer = await askInNewChat(page, "Qual é a capital da Mongólia e sua população em 1990?");
    await expect(answer.getByTestId("no-evidence")).toBeVisible();
    await expect(answer).toContainText("Não encontrei informações suficientes");
    await expect(answer.getByRole("region", { name: "Fontes" })).toHaveCount(0);
    await expect(answer.getByRole("button", { name: /^Fonte \d+:/ })).toHaveCount(0);
  });
});
