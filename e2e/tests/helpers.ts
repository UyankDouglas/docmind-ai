import { expect, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const SAMPLES = path.resolve(here, "..", "..", "samples");

export const sample = {
  contratoPdf: path.join(SAMPLES, "contrato-prestacao-servicos.pdf"),
  politicaPdf: path.join(SAMPLES, "politica-ferias-com-instrucao-maliciosa.pdf"),
  manualDocx: path.join(SAMPLES, "manual-operacao-orbita.docx"),
  politicaTxt: path.join(SAMPLES, "politica-seguranca-vertex.txt"),
};

export interface TestUser {
  name: string;
  email: string;
  password: string;
}

export function newUser(label = "e2e"): TestUser {
  const stamp = `${Date.now()}-${randomBytes(3).toString("hex")}`;
  return {
    name: `E2E ${label}`,
    email: `e2e-${stamp}@example.com`,
    password: `E2e-${randomBytes(6).toString("hex")}!`,
  };
}

/** Cria uma conta pela UI e aguarda o dashboard. */
export async function register(page: Page, user = newUser()): Promise<TestUser> {
  await page.goto("/register");
  await page.getByLabel("Nome").fill(user.name);
  await page.getByLabel("E-mail").fill(user.email);
  await page.getByLabel("Senha", { exact: true }).fill(user.password);
  await page.getByLabel("Confirmar senha").fill(user.password);
  await submitRegistration(page);
  await expect(page.getByRole("heading", { name: /Olá, / })).toBeVisible();
  return user;
}

/**
 * O backend limita cadastros por IP por minuto (RATE_LIMIT_LOGIN_PER_MINUTE). Rodadas consecutivas da suíte
 * podem bater nesse limite. A detecção usa a resposta HTTP real do POST /auth/register (201 ou 429); em 429
 * aguardamos a janela de 60 s e reenviamos (condição específica, não um sleep arbitrário).
 */
async function submitRegistration(page: Page): Promise<void> {
  const deadline = Date.now() + 160_000;
  while (true) {
    const responsePromise = page.waitForResponse(
      (r) => r.url().includes("/api/v1/auth/register") && r.request().method() === "POST",
      { timeout: 30_000 },
    );
    await page.getByRole("button", { name: "Criar conta" }).click();
    const response = await responsePromise;
    if (response.status() === 201) {
      await expect(page).toHaveURL(/\/$/, { timeout: 20_000 });
      return;
    }
    if (response.status() !== 429 || Date.now() > deadline) {
      throw new Error(`Cadastro não concluído: HTTP ${response.status()} ${await response.text()}`);
    }
    await page.waitForTimeout(61_000); // janela fixa do rate limit do servidor
  }
}

export async function login(page: Page, user: TestUser): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(user.email);
  await page.getByLabel("Senha", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 20_000 });
}

export async function logout(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Menu do usuário" }).click();
  await page.getByRole("menuitem", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
}

/** Envia arquivos pela biblioteca e aguarda cada um ficar "Pronto" (polling real da UI). */
export async function uploadAndWaitReady(page: Page, files: string[], timeout = 60_000): Promise<void> {
  await page.goto("/documents");
  const input = page.locator('input[type="file"]');
  await input.setInputFiles(files);
  for (const file of files) {
    const name = path.basename(file);
    const row = page.getByRole("row", { name: new RegExp(escapeRegExp(name)) });
    await expect(row).toBeVisible({ timeout });
    await expect(row.getByText("Pronto", { exact: true })).toBeVisible({ timeout });
  }
}

/** Abre uma nova conversa e envia uma pergunta; retorna o balão da resposta do assistente. */
export async function askInNewChat(page: Page, question: string) {
  await page.goto("/chat");
  const composer = page.getByPlaceholder("Pergunte algo sobre os documentos selecionados…");
  await composer.fill(question);
  await page.getByRole("button", { name: "Enviar pergunta" }).click();
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}/, { timeout: 30_000 });
  const answer = page.getByRole("article", { name: "Resposta do assistente" }).last();
  await expect(answer).toBeVisible({ timeout: 45_000 });
  // O rascunho de streaming some quando a mensagem final (validada) chega
  await expect(page.getByTestId("streaming-bubble")).toHaveCount(0, { timeout: 45_000 });
  return answer;
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
