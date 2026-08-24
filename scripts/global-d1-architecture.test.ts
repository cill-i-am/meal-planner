import { readFileSync } from "node:fs";
import path = require("node:path");
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  inspectGlobalD1Architecture,
  readTrackedGlobalD1Architecture,
} from "./global-d1-architecture.js";
import type { TrackedArchitectureSource } from "./global-d1-architecture.js";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

const replaceSource = (
  sources: readonly TrackedArchitectureSource[],
  entryPath: string,
  mutate: (source: string) => string
): readonly TrackedArchitectureSource[] =>
  sources.map((source) =>
    source.path === entryPath
      ? { ...source, source: mutate(source.source) }
      : source
  );

describe("global D1 architecture allowlist", () => {
  it("accepts the exact tracked production architecture", () => {
    expect(
      inspectGlobalD1Architecture(
        readTrackedGlobalD1Architecture(repositoryRoot)
      )
    ).toEqual([]);
  });

  it.each([
    {
      label: "newly named tenant-global household resource",
      mutate: (sources: readonly TrackedArchitectureSource[]) => [
        ...sources,
        {
          path: "apps/api/src/infrastructure/tenant-ledger-database.ts",
          source: `import * as Cloudflare from "alchemy/Cloudflare";
export const TenantLedgerDatabase = Cloudflare.D1.Database(
  "TenantLedgerDatabase",
  {
    migrationsDir: "./apps/api/tenant-ledger-migrations",
    migrationsTable: "d1_migrations",
  }
);`,
        },
      ],
    },
    {
      label: "newly named tenant-global household consumer",
      mutate: (sources: readonly TrackedArchitectureSource[]) => [
        ...sources,
        {
          path: "apps/api/src/features/households/tenant-ledger.repository.d1.ts",
          source: `import type { AnyD1Database } from "drizzle-orm/d1";
export const readTenantMeals = (
  database: AnyD1Database,
  organizationId: string
) => database.prepare(
  "SELECT * FROM tenant_meals WHERE organization_id = ?"
).bind(organizationId);`,
        },
      ],
    },
    {
      label: "newly named tenant-global D1 binding",
      mutate: (sources: readonly TrackedArchitectureSource[]) => [
        ...sources,
        {
          path: "apps/api/src/features/households/tenant-ledger.runtime.ts",
          source: `import * as Cloudflare from "alchemy/Cloudflare";
import { TenantLedgerDatabase } from "../../infrastructure/tenant-ledger-database.js";
export const TenantLedgerQuery = Cloudflare.D1.QueryDatabase(TenantLedgerDatabase);`,
        },
      ],
    },
    {
      label: "newly named migration root",
      mutate: (sources: readonly TrackedArchitectureSource[]) => [
        ...sources,
        {
          path: "apps/api/tenant-ledger-migrations/0001_tenant/migration.sql",
          source:
            "CREATE TABLE `tenant_meals` (`organization_id` text NOT NULL);",
        },
      ],
    },
    {
      label: "sixth provider-accounting schema table",
      mutate: (sources: readonly TrackedArchitectureSource[]) =>
        replaceSource(
          sources,
          "apps/api/src/features/provider-accounting/provider-accounting.database-schema.ts",
          (source) =>
            `${source}\nexport const householdLedger = sqliteTable("household_ledger", { id: text("id").primaryKey() });\n`
        ),
    },
    {
      label: "sixth provider-accounting migration table",
      mutate: (sources: readonly TrackedArchitectureSource[]) =>
        replaceSource(
          sources,
          "apps/api/provider-accounting-migrations/20260824183013_provider_accounting/migration.sql",
          (source) =>
            `${source}\nCREATE TABLE \`household_ledger\` (\`id\` text PRIMARY KEY);\n`
        ),
    },
    {
      label: "sixth provider-accounting snapshot table",
      mutate: (sources: readonly TrackedArchitectureSource[]) =>
        replaceSource(
          sources,
          "apps/api/provider-accounting-migrations/20260824183013_provider_accounting/snapshot.json",
          (source) => {
            const snapshot = JSON.parse(source) as {
              ddl: Record<string, unknown>[];
            };
            snapshot.ddl.push({
              columns: {},
              entityType: "tables",
              name: "household_ledger",
            });
            return JSON.stringify(snapshot);
          }
        ),
    },
  ])("rejects a $label", ({ mutate }) => {
    expect(
      inspectGlobalD1Architecture(
        mutate(readTrackedGlobalD1Architecture(repositoryRoot))
      )
    ).not.toEqual([]);
  });

  it("documents direct Workflow and R2 probes instead of retired Queue reconciliation", () => {
    const migrationPlan = readFileSync(
      path.join(
        repositoryRoot,
        "docs/architecture/household-capability-migration-plan.md"
      ),
      "utf-8"
    );

    expect(migrationPlan).toMatch(
      /R2 integrity is\s+reconciled directly through Workflow and R2 probes/u
    );
    expect(migrationPlan).not.toContain(
      "The unordered Queue carries only R2 notifications"
    );
    expect(migrationPlan).not.toContain("R2-event-only DLQ");
  });
});
