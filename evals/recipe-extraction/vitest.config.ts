import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["evals/recipe-extraction/*.test.ts"] },
});
