import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

const API_PORT = 3100;
const WEB_PORT = 5273;
const WEB = `http://localhost:${WEB_PORT}`;
// The sandbox ships a Chromium build that may differ from the one this Playwright version expects.
const PREINSTALLED = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const executablePath = process.env.PW_CHROMIUM ?? (existsSync(PREINSTALLED) ? PREINSTALLED : undefined);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: WEB,
    ...devices["Desktop Chrome"],
    launchOptions: { ...(executablePath ? { executablePath } : {}), args: ["--no-sandbox"] },
    trace: "retain-on-failure",
  },
  webServer: [
    {
      // Fresh SQLite DB + uploads for every run; single-origin through the Vite proxy
      command:
        "rm -f apps/api/prisma/e2e.db* && rm -rf apps/api/uploads/e2e && pnpm --filter @storychain/api db:deploy && pnpm --filter @storychain/api db:seed && pnpm --filter @storychain/api start",
      url: `http://localhost:${API_PORT}/api/health`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        NODE_ENV: "development",
        DEV_MODE: "true",
        PORT: String(API_PORT),
        DATABASE_URL: "file:./e2e.db",
        UPLOAD_DIR: "./uploads/e2e",
        PUBLIC_BASE_URL: WEB,
        CORS_ORIGINS: WEB,
        BOT_TOKEN: "000000:e2e-token",
      },
    },
    {
      command: `pnpm --filter @storychain/web exec vite --port ${WEB_PORT} --strictPort`,
      url: WEB,
      timeout: 60_000,
      reuseExistingServer: false,
      env: { API_PROXY_TARGET: `http://localhost:${API_PORT}`, VITE_DEV_MOCK: "true" },
    },
  ],
});
