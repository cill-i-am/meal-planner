import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          exclude: [
            "src/**/*.stack.test.ts",
            "src/**/*.worker.test.ts",
            "src/features/imports/import-acquisition-restart.integration.test.ts",
            "src/features/imports/import-provider-workflow-task.integration.test.ts",
          ],
          include: ["src/**/*.test.ts"],
          name: "node",
        },
      },
      {
        test: {
          include: [
            "src/features/imports/import-acquisition-restart.integration.test.ts",
            "src/features/imports/import-provider-workflow-task.integration.test.ts",
          ],
          name: "node-workflows",
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
