import { fileURLToPath } from "node:url";

import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          exclude: [
            "src/**/*.worker.test.ts",
            "src/features/imports/import-provider-workflow-task.integration.test.ts",
          ],
          include: ["src/**/*.test.ts"],
          name: "node",
        },
      },
      {
        plugins: [
          cloudflareTest(async () => ({
            miniflare: {
              bindings: {
                TEST_MIGRATIONS: await readD1Migrations(
                  fileURLToPath(new URL("migrations", import.meta.url))
                ),
              },
              compatibilityDate: "2026-07-14",
              d1Databases: ["MealPlannerDatabase"],
              r2Buckets: ["ImportEvidenceBucket"],
            },
          })),
        ],
        test: {
          deps: {
            optimizer: {
              ssr: { enabled: true, include: ["jpeg-js"] },
            },
          },
          include: ["src/**/*.worker.test.ts"],
          name: "workerd-d1",
        },
      },
      {
        test: {
          include: [
            "src/features/imports/import-provider-workflow-task.integration.test.ts",
          ],
          name: "node-workflows",
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
