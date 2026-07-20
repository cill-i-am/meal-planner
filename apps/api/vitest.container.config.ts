import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    hookTimeout: 1_800_000,
    include: ["src/features/imports/import-media-container.integration.ts"],
    testTimeout: 1_800_000,
  },
});
