import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  forbidOnly: Boolean(process.env["CI"]),
  fullyParallel: true,
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  retries: 0,
  testDir: "./e2e",
  use: { baseURL: "http://127.0.0.1:4398", trace: "retain-on-failure" },
  webServer: {
    command: "pnpm dev:auth-family",
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
    reuseExistingServer: false,
    timeout: 120_000,
    url: "http://127.0.0.1:4398/__test/ready",
  },
});
