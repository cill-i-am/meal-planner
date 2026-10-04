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
  plugins: [
    cloudflareTest(async () => ({
      miniflare: {
        bindings: {
          AUTH_TEST_MIGRATIONS: await readDrizzleD1Migrations(
            fileURLToPath(
              new URL("../../apps/api/auth-migrations", import.meta.url)
            )
          ),
          TEST_MIGRATIONS: await readDrizzleD1Migrations(
            fileURLToPath(
              new URL(
                "../../apps/api/provider-accounting-migrations",
                import.meta.url
              )
            )
          ),
        },
        compatibilityDate: "2026-07-14",
        compatibilityFlags: ["nodejs_compat"],
        d1Databases: ["MealPlannerAuthDatabase", "ProviderAccountingDatabase"],
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
    include: ["../../apps/api/src/**/*.worker.test.ts"],
    name: "workerd-d1",
  },
});
