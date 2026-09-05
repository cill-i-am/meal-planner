import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const readDrizzleD1Migrations = (migrationsPath: string) => {
  const sqlFiles = readdirSync(migrationsPath, { recursive: true })
    .map(String)
    .filter((name) => name.endsWith(".sql"))
    .toSorted();

  return Promise.all(
    sqlFiles.map(async (name) => {
      const migrationPath = path.join(migrationsPath, name);
      if (!statSync(migrationPath).isFile()) {
        throw new Error(`Expected a migration file at ${migrationPath}.`);
      }
      const [migration] = await readD1Migrations(path.dirname(migrationPath));
      if (migration === undefined) {
        throw new Error(`Unable to read Drizzle migration ${migrationPath}.`);
      }
      return {
        ...migration,
        name: path.relative(migrationsPath, migrationPath),
      };
    })
  );
};

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          exclude: [
            "src/**/*.worker.test.ts",
            "src/features/imports/import-acquisition-restart.integration.test.ts",
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
                AUTH_TEST_MIGRATIONS: await readDrizzleD1Migrations(
                  fileURLToPath(new URL("auth-migrations", import.meta.url))
                ),
                TEST_MIGRATIONS: await readDrizzleD1Migrations(
                  fileURLToPath(
                    new URL("provider-accounting-migrations", import.meta.url)
                  )
                ),
              },
              compatibilityDate: "2026-07-14",
              d1Databases: [
                "MealPlannerAuthDatabase",
                "ProviderAccountingDatabase",
              ],
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
