import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "tests",
  testMatch: ["e2e/**/*.spec.ts", "screens/**/*.spec.ts"],
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL,
    locale: "ru-RU",
    timezoneId: "Asia/Almaty",
    trace: "retain-on-failure",
    // Native date/time inputs render like a Russian device (24h, dd.mm.yyyy). The headless shell takes the input
    // format from the OS locale (LANG), not from `locale`/--lang, so both are set.
    launchOptions: {
      args: ["--lang=ru-RU"],
      env: { ...process.env, LANG: "ru_RU.UTF-8", LANGUAGE: "ru_RU:ru" },
      ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
    },
  },
  projects: [
    { name: "e2e", testMatch: "e2e/**/*.spec.ts", use: { ...devices["Desktop Chrome"], locale: "ru-RU", viewport: { width: 1440, height: 900 } } },
    { name: "screens", testMatch: "screens/**/*.spec.ts", use: { ...devices["Desktop Chrome"], locale: "ru-RU" } },
  ],
  webServer: {
    command: `scripts/serve-standalone.sh ${PORT}`,
    url: `${baseURL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { APP_URL: baseURL },
  },
});
