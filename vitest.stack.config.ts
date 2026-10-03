import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    hookTimeout: 1_200_000,
    include: ["apps/api/src/test/alchemy.stack.test.ts"],
    sequence: { hooks: "list" },
    testTimeout: 120_000,
  },
});
