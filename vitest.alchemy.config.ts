import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["alchemy.run.structural.test.ts", "scripts/**/*.test.ts"],
  },
});
