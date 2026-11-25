import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/api/src/features/health/alchemy.stack.test.ts"],
    sequence: { hooks: "list" },
  },
});
