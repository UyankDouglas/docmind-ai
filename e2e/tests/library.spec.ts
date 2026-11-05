import { expect, test } from "@playwright/test";
import { newUser, register, sample, uploadAndWaitReady } from "./helpers";

test.describe("Biblioteca de documentos", () => {
  test("upload múltiplo (DOCX + TXT), coleção, mover, filtrar e visualizar texto por seções", async ({ page }) => {
    await register(page, newUser("biblioteca"));

    // Upload múltiplo pela fila
    await uploadAndWaitReady(page, [sample.manualDocx, sample.politicaTxt]);
    const docxRow = page.getByRole("row", { name: /manual-operacao-orbita\.docx/ });
    const txtRow = page.getByRole("row", { name: /politica-seguranca-vertex\.txt/ });
    await expect(docxRow.getByText(/seções/)).toBeVisible();
    await expect(txtRow.getByText(/seções/)).toBeVisible();

    // Criar coleção
    await page.getByRole("button", { name: "Nova coleção" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByPlaceholder("Ex.: Contratos 2026").fill("Operações de TI");
    await dialog.getByRole("button", { name: "Criar coleção" }).click();
    await expect(page.getByRole("navigation", { name: "Lista de coleções" })).toContainText("Operações de TI");

    // Mover o DOCX para a coleção
    await docxRow.getByRole("button", { name: "Ações para manual-operacao-orbita.docx" }).click();
    await page.getByRole("menuitem", { name: "Mover para coleção" }).click();
    const move = page.getByRole("dialog", { name: "Mover para coleção" });
    await move.getByRole("combobox", { name: "Coleção de destino" }).click();
    await page.getByRole("option", { name: "Operações de TI" }).click();
    await move.getByRole("button", { name: "Mover" }).click();
    await expect(move).toBeHidden();
    await expect(docxRow.getByRole("link", { name: "Operações de TI" })).toBeVisible();

    // Filtrar por coleção: só o DOCX aparece
    await page.getByRole("combobox", { name: "Filtrar por coleção" }).click();
    await page.getByRole("option", { name: "Operações de TI" }).click();
    await expect(page.getByRole("row", { name: /manual-operacao-orbita\.docx/ })).toBeVisible();
    await expect(page.getByRole("row", { name: /politica-seguranca-vertex\.txt/ })).toHaveCount(0);

    // Visualizador de texto por seções (DOCX não tem páginas)
    await page.getByRole("link", { name: /manual-operacao-orbita\.docx/ }).first().click();
    await expect(page).toHaveURL(/\/documents\/[0-9a-f-]{36}/);
    const sections = page.getByRole("navigation", { name: "Seções do documento" });
    await expect(sections).toBeVisible();
    await expect(sections).toContainText("1. Backup diário");
    await expect(page.getByTestId("text-section").first()).toBeVisible();
    await expect(page.getByText("As referências usam seções, não páginas.")).toBeVisible();
    await expect(page.getByText(/retenção de 35 dias/).first()).toBeVisible();
  });
});
