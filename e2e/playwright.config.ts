import { defineConfig, devices } from "@playwright/test";

/**
 * A stack (frontend + API + worker) é externa: suba com `docker compose up -d` antes de rodar.
 * Use 127.0.0.1 (e não localhost) no Windows: o mapeamento de portas do Docker é só IPv4.
 */
const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173";

export default defineConfig({
  testDir: "./tests",
  // 180 s: cabe uma espera pela janela do rate limit de cadastro (60 s) + processamento real
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  outputDir: "./test-results",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    colorScheme: "dark",
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    {
      name: "chromium",
      testIgnore: /screenshots\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "screenshots",
      testMatch: /screenshots\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
    },
  ],
});
