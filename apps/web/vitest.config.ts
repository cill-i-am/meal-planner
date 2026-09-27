import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("src", import.meta.url)) } },
  test: {
    projects: [
      {
        extends: true,
        test: {
          environment: "node",
          exclude: ["src/**/*.browser.test.ts"],
          include: ["src/**/*.test.ts"],
          name: "node",
        },
      },
      {
        extends: true,
        test: {
          browser: {
            enabled: true,
            headless: true,
            instances: [{ browser: "chromium" }],
            provider: playwright(),
          },
          include: ["src/**/*.test.tsx", "src/**/*.browser.test.ts"],
          name: "browser",
          setupFiles: ["./src/test/setup.ts"],
        },
      },
    ],
  },
});
