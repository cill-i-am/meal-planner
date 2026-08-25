import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path = require("node:path");
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  inspectGlobalD1Architecture,
  readTrackedGlobalD1Architecture,
} from "./global-d1-architecture.js";
import type { TrackedArchitectureSource } from "./global-d1-architecture.js";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
let trackedRepositoryRoot = "";

const trackedPaths = (root: string): readonly string[] =>
  execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf-8",
  })
    .split("\0")
    .filter((entryPath) => entryPath.length > 0);

const copyTrackedRepository = (): string => {
  const destination = mkdtempSync(
    path.join(tmpdir(), "meal-planner-global-d1-")
  );
  for (const entryPath of trackedPaths(repositoryRoot)) {
    const destinationPath = path.join(destination, entryPath);
    mkdirSync(path.dirname(destinationPath), { recursive: true });
    copyFileSync(path.join(repositoryRoot, entryPath), destinationPath);
  }
  symlinkSync(
    path.join(repositoryRoot, "node_modules"),
    path.join(destination, "node_modules"),
    "dir"
  );
  symlinkSync(
    path.join(repositoryRoot, "apps/api/node_modules"),
    path.join(destination, "apps/api/node_modules"),
    "dir"
  );
  execFileSync("git", ["init", "--quiet"], { cwd: destination });
  execFileSync("git", ["add", "--all"], { cwd: destination });
  return destination;
};

const withTrackedSource = <Result>(
  entryPath: string,
  source: string,
  inspect: () => Result
): Result => {
  const absolutePath = path.join(trackedRepositoryRoot, entryPath);
  const priorSource = existsSync(absolutePath)
    ? readFileSync(absolutePath, "utf-8")
    : undefined;
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, source);
  execFileSync("git", ["add", "--all"], { cwd: trackedRepositoryRoot });
  try {
    return inspect();
  } finally {
    if (priorSource === undefined) {
      rmSync(absolutePath);
    } else {
      writeFileSync(absolutePath, priorSource);
    }
    execFileSync("git", ["add", "--all"], { cwd: trackedRepositoryRoot });
  }
};

const withTrackedSources = <Result>(
  sources: readonly {
    readonly path: string;
    readonly source: string;
  }[],
  inspect: () => Result
): Result => {
  const [source, ...remaining] = sources;
  if (source === undefined) {
    return inspect();
  }
  return withTrackedSource(source.path, source.source, () =>
    withTrackedSources(remaining, inspect)
  );
};

/** The global-D1 predicates enforced by 3a1524a before the exact allowlist. */
const inspectPredecessorGlobalD1Structure = (
  sources: readonly TrackedArchitectureSource[]
): readonly string[] => {
  const sourceAt = (entryPath: string): string =>
    sources.find(({ path: sourcePath }) => sourcePath === entryPath)?.source ??
    "";
  const stack = sourceAt("alchemy.run.ts");
  const providerSchema = sourceAt(
    "apps/api/src/features/provider-accounting/provider-accounting.database-schema.ts"
  );
  const providerMigration = sourceAt(
    "apps/api/provider-accounting-migrations/20260824183013_provider_accounting/migration.sql"
  );
  const forbidden = [
    "MealPlannerDatabase",
    "ImportEvidenceEventQueue",
    "BucketEventNotification",
  ];
  const forbiddenProviderAuthority =
    /organizationId|organization_id|import_evidence_routes|import_execution_runs/iu;
  return [
    ...forbidden.filter((token) => stack.includes(token)),
    ...(forbiddenProviderAuthority.test(providerSchema)
      ? ["provider schema household authority"]
      : []),
    ...(forbiddenProviderAuthority.test(providerMigration)
      ? ["provider migration household authority"]
      : []),
  ];
};

describe.sequential(
  "global D1 architecture allowlist",
  { timeout: 15_000 },
  () => {
    beforeAll(() => {
      trackedRepositoryRoot = copyTrackedRepository();
    });

    afterAll(() => {
      rmSync(trackedRepositoryRoot, { recursive: true });
    });

    it("accepts the exact tracked production architecture", () => {
      expect(
        inspectGlobalD1Architecture(
          readTrackedGlobalD1Architecture(repositoryRoot)
        )
      ).toEqual([]);
    });

    it.each(["test.ts", "test-fixture.ts"])(
      "rejects an imported tracked production %s D1 authority",
      (suffix) => {
        const fixturePath = `apps/api/src/features/households/tenant-ledger.${suffix}`;
        const workerPath = "apps/api/src/worker.ts";
        const worker = readFileSync(
          path.join(repositoryRoot, workerPath),
          "utf-8"
        );
        const fixture = `import * as Cloudflare from "alchemy/Cloudflare";
export const TenantLedgerDatabase = Cloudflare.D1.Database(
  "TenantLedgerDatabase",
  {
    migrationsDir: "./apps/api/tenant-ledger-migrations",
    migrationsTable: "d1_migrations",
  }
);`;

        withTrackedSources(
          [
            { path: fixturePath, source: fixture },
            {
              path: workerPath,
              source: `${worker}\nimport "./features/households/tenant-ledger.${suffix.replace(".ts", ".js")}";\n`,
            },
          ],
          () => {
            const tracked = readTrackedGlobalD1Architecture(
              trackedRepositoryRoot
            );
            expect(
              tracked.sources.some(
                ({ path: sourcePath }) => sourcePath === fixturePath
              )
            ).toBe(true);
            expect(inspectGlobalD1Architecture(tracked)).not.toEqual([]);
          }
        );
      }
    );

    it("fails closed for an unresolved local production import", () => {
      const workerPath = "apps/api/src/worker.ts";
      const worker = readFileSync(
        path.join(repositoryRoot, workerPath),
        "utf-8"
      );

      withTrackedSource(
        workerPath,
        `${worker}\nimport "./features/households/missing-tenant-ledger.js";\n`,
        () => {
          expect(() =>
            readTrackedGlobalD1Architecture(trackedRepositoryRoot)
          ).toThrow(/unresolved local production import/u);
        }
      );
    });

    it("rejects a destructured alias for the D1 resource namespace", () => {
      withTrackedSource(
        "apps/api/src/features/households/tenant-ledger-destructured.ts",
        `import * as Cloudflare from "alchemy/Cloudflare";
const { D1: TenantD1 } = Cloudflare;
export const TenantLedgerDatabase = TenantD1.Database(
  "TenantLedgerDatabase",
  {
    migrationsDir: "./apps/api/tenant-ledger-migrations",
    migrationsTable: "d1_migrations",
  }
);`,
        () => {
          expect(
            inspectGlobalD1Architecture(
              readTrackedGlobalD1Architecture(trackedRepositoryRoot)
            )
          ).not.toEqual([]);
        }
      );
    });

    it("rejects element access to the D1 resource constructor", () => {
      withTrackedSource(
        "apps/api/src/features/households/tenant-ledger-element-access.ts",
        `import * as Cloudflare from "alchemy/Cloudflare";
export const TenantLedgerDatabase = Cloudflare["D1"]["Database"](
  "TenantLedgerDatabase",
  {
    migrationsDir: "./apps/api/tenant-ledger-migrations",
    migrationsTable: "d1_migrations",
  }
);`,
        () => {
          expect(
            inspectGlobalD1Architecture(
              readTrackedGlobalD1Architecture(trackedRepositoryRoot)
            )
          ).not.toEqual([]);
        }
      );
    });

    it("rejects element access to the D1 query-binding constructor", () => {
      const workerPath = "apps/api/src/worker.ts";
      const worker = readFileSync(
        path.join(repositoryRoot, workerPath),
        "utf-8"
      );

      withTrackedSource(
        workerPath,
        `${worker}\nconst tenantQuery = Cloudflare["D1"]["QueryDatabase"](MealPlannerAuthDatabase);\n`,
        () => {
          expect(
            inspectGlobalD1Architecture(
              readTrackedGlobalD1Architecture(trackedRepositoryRoot)
            )
          ).not.toEqual([]);
        }
      );
    });

    it("rejects element access to the D1 query-binding service", () => {
      const workerPath = "apps/api/src/worker.ts";
      const worker = readFileSync(
        path.join(repositoryRoot, workerPath),
        "utf-8"
      );

      withTrackedSource(
        workerPath,
        `${worker}\nconst tenantQueryBinding = Cloudflare["D1"]["QueryDatabaseBinding"];\n`,
        () => {
          expect(
            inspectGlobalD1Architecture(
              readTrackedGlobalD1Architecture(trackedRepositoryRoot)
            )
          ).not.toEqual([]);
        }
      );
    });

    it("rejects namespace element access that hides a sixth provider-accounting table", () => {
      const schemaPath =
        "apps/api/src/features/provider-accounting/provider-accounting.database-schema.ts";
      const schema = readFileSync(
        path.join(repositoryRoot, schemaPath),
        "utf-8"
      );

      withTrackedSource(
        schemaPath,
        `${schema}\nimport * as sqliteCore from "drizzle-orm/sqlite-core";\nexport const providerAccountingTenantMeals = sqliteCore["sqliteTable"]("provider_accounting_tenant_meals", { id: sqliteCore.text("id").primaryKey() });\n`,
        () => {
          expect(
            inspectGlobalD1Architecture(
              readTrackedGlobalD1Architecture(trackedRepositoryRoot)
            )
          ).not.toEqual([]);
        }
      );
    });

    it("rejects a computed dynamic D1 consumer import and runtime call", () => {
      withTrackedSource(
        "apps/api/src/features/households/tenant-ledger-runtime.ts",
        `export const loadTenantD1 = async (database: never) => {
  const runtime = await import("drizzle-orm/" + "d1");
  return runtime.drizzle(database);
};`,
        () => {
          expect(
            inspectGlobalD1Architecture(
              readTrackedGlobalD1Architecture(trackedRepositoryRoot)
            )
          ).not.toEqual([]);
        }
      );
    });

    it.each([
      {
        entryPath: "apps/api/src/infrastructure/tenant-ledger-database.ts",
        label: "newly named tenant-global household resource",
        source: () => `import * as Cloudflare from "alchemy/Cloudflare";
export const TenantLedgerDatabase = Cloudflare.D1.Database(
  "TenantLedgerDatabase",
  {
    migrationsDir: "./apps/api/tenant-ledger-migrations",
    migrationsTable: "d1_migrations",
  }
);`,
      },
      {
        entryPath:
          "apps/api/src/features/households/tenant-ledger.repository.d1.ts",
        label: "newly named tenant-global household consumer",
        source: () => `import type { AnyD1Database } from "drizzle-orm/d1";
export const readTenantMeals = (
  database: AnyD1Database,
  organizationId: string
) => database.prepare(
  "SELECT * FROM tenant_meals WHERE organization_id = ?"
).bind(organizationId);`,
      },
      {
        entryPath: "apps/api/src/features/households/tenant-ledger.runtime.ts",
        label: "newly named tenant-global D1 binding",
        source: () => `import * as Cloudflare from "alchemy/Cloudflare";
import { ProviderAccountingDatabase } from "../../infrastructure/provider-accounting-database.js";
export const TenantLedgerQuery = Cloudflare.D1.QueryDatabase(ProviderAccountingDatabase);`,
      },
      {
        entryPath:
          "apps/api/tenant-ledger-migrations/0001_tenant/migration.sql",
        label: "newly named migration root",
        source: () =>
          "CREATE TABLE `tenant_meals` (`organization_id` text NOT NULL);",
      },
      {
        entryPath:
          "apps/api/src/features/provider-accounting/provider-accounting.database-schema.ts",
        label: "sixth provider-accounting schema table",
        source: () =>
          `${readFileSync(path.join(repositoryRoot, "apps/api/src/features/provider-accounting/provider-accounting.database-schema.ts"), "utf-8")}\nexport const householdLedger = sqliteTable("household_ledger", { id: text("id").primaryKey() });\n`,
      },
      {
        entryPath:
          "apps/api/provider-accounting-migrations/20260824183013_provider_accounting/migration.sql",
        label: "sixth provider-accounting migration table",
        source: () =>
          `${readFileSync(path.join(repositoryRoot, "apps/api/provider-accounting-migrations/20260824183013_provider_accounting/migration.sql"), "utf-8")}\nCREATE TABLE \`household_ledger\` (\`id\` text PRIMARY KEY);\n`,
      },
      {
        entryPath:
          "apps/api/provider-accounting-migrations/20260824183013_provider_accounting/snapshot.json",
        label: "sixth provider-accounting snapshot table",
        source: () => {
          const snapshot = JSON.parse(
            readFileSync(
              path.join(
                repositoryRoot,
                "apps/api/provider-accounting-migrations/20260824183013_provider_accounting/snapshot.json"
              ),
              "utf-8"
            )
          ) as { ddl: Record<string, unknown>[] };
          snapshot.ddl.push({
            columns: {},
            entityType: "tables",
            name: "household_ledger",
          });
          return JSON.stringify(snapshot);
        },
      },
    ])("rejects a $label", ({ entryPath, source }) => {
      withTrackedSource(entryPath, source(), () => {
        expect(
          inspectGlobalD1Architecture(
            readTrackedGlobalD1Architecture(trackedRepositoryRoot)
          )
        ).not.toEqual([]);
      });
    });

    it("proves the predecessor accepted but the current guard rejects a tracked production config authority", () => {
      const fixturePath =
        "apps/api/src/features/households/tenant-ledger.config.ts";
      const fixture = `import * as Cloudflare from "alchemy/Cloudflare";
import type { AnyD1Database } from "drizzle-orm/d1";
export const TenantLedgerDatabase = Cloudflare.D1.Database(
  "TenantLedgerDatabase",
  {
    migrationsDir: "./apps/api/tenant-ledger-migrations",
    migrationsTable: "d1_migrations",
  }
);
export const TenantLedgerQuery = Cloudflare.D1.QueryDatabase(TenantLedgerDatabase);
export const readTenantMeals = (database: AnyD1Database, organizationId: string) =>
  database.prepare("SELECT * FROM tenant_meals WHERE organization_id = ?").bind(organizationId);`;

      withTrackedSource(fixturePath, fixture, () => {
        const tracked = readTrackedGlobalD1Architecture(trackedRepositoryRoot);
        expect(
          tracked.sources.some(
            ({ path: sourcePath }) => sourcePath === fixturePath
          )
        ).toBe(true);
        expect(inspectPredecessorGlobalD1Structure(tracked.sources)).toEqual(
          []
        );
        expect(inspectGlobalD1Architecture(tracked)).not.toEqual([]);
      });
    });

    it("rejects a tracked production alias for the D1 resource constructor", () => {
      withTrackedSource(
        "apps/api/src/features/households/tenant-ledger-alias.ts",
        `import * as Cloudflare from "alchemy/Cloudflare";
export const makeD1 = Cloudflare.D1.Database;`,
        () => {
          expect(
            inspectGlobalD1Architecture(
              readTrackedGlobalD1Architecture(trackedRepositoryRoot)
            )
          ).not.toEqual([]);
        }
      );
    });

    it("rejects a second-hop D1 namespace alias in tracked production", () => {
      withTrackedSource(
        "apps/api/src/features/households/tenant-ledger-namespace.ts",
        `import * as Cloudflare from "alchemy/Cloudflare";
const tenantD1 = Cloudflare.D1;
export const makeD1 = tenantD1.Database;`,
        () => {
          expect(
            inspectGlobalD1Architecture(
              readTrackedGlobalD1Architecture(trackedRepositoryRoot)
            )
          ).not.toEqual([]);
        }
      );
    });

    it("rejects a named D1 factory import in tracked production", () => {
      withTrackedSource(
        "apps/api/src/features/households/tenant-ledger-import.ts",
        `import { D1 as TenantD1 } from "alchemy/Cloudflare";
export const makeD1 = TenantD1.Database;`,
        () => {
          expect(
            inspectGlobalD1Architecture(
              readTrackedGlobalD1Architecture(trackedRepositoryRoot)
            )
          ).not.toEqual([]);
        }
      );
    });

    it("rejects a tracked alias that hides a sixth provider-accounting table", () => {
      const schemaPath =
        "apps/api/src/features/provider-accounting/provider-accounting.database-schema.ts";
      const schema = readFileSync(
        path.join(repositoryRoot, schemaPath),
        "utf-8"
      );

      withTrackedSource(
        schemaPath,
        `${schema}\nconst defineTable = sqliteTable;\nexport const providerAccountingTenantMeals = defineTable("provider_accounting_tenant_meals", { id: text("id").primaryKey() });\n`,
        () => {
          expect(
            inspectGlobalD1Architecture(
              readTrackedGlobalD1Architecture(trackedRepositoryRoot)
            )
          ).not.toEqual([]);
        }
      );
    });

    it("rejects a D1 query-binding constructor alias in an allowed consumer", () => {
      const workerPath = "apps/api/src/worker.ts";
      const worker = readFileSync(
        path.join(repositoryRoot, workerPath),
        "utf-8"
      );

      withTrackedSource(
        workerPath,
        `${worker}\nconst makeQueryDatabase = Cloudflare.D1.QueryDatabase;\n`,
        () => {
          expect(
            inspectGlobalD1Architecture(
              readTrackedGlobalD1Architecture(trackedRepositoryRoot)
            )
          ).not.toEqual([]);
        }
      );
    });

    it("rejects a D1 query-binding service alias in an allowed consumer", () => {
      const workerPath = "apps/api/src/worker.ts";
      const worker = readFileSync(
        path.join(repositoryRoot, workerPath),
        "utf-8"
      );

      withTrackedSource(
        workerPath,
        `${worker}\nconst queryDatabaseBinding = Cloudflare.D1.QueryDatabaseBinding;\n`,
        () => {
          expect(
            inspectGlobalD1Architecture(
              readTrackedGlobalD1Architecture(trackedRepositoryRoot)
            )
          ).not.toEqual([]);
        }
      );
    });

    it("rejects a D1 consumer wrapper in an allowed call path", () => {
      const workerPath = "apps/api/src/worker.ts";
      const worker = readFileSync(
        path.join(repositoryRoot, workerPath),
        "utf-8"
      );

      withTrackedSource(
        workerPath,
        `${worker}\nconst makeD1Consumer = drizzle;\n`,
        () => {
          expect(
            inspectGlobalD1Architecture(
              readTrackedGlobalD1Architecture(trackedRepositoryRoot)
            )
          ).not.toEqual([]);
        }
      );
    });

    it("rejects a D1 consumer function wrapper in an allowed call path", () => {
      const workerPath = "apps/api/src/worker.ts";
      const worker = readFileSync(
        path.join(repositoryRoot, workerPath),
        "utf-8"
      );

      withTrackedSource(
        workerPath,
        `${worker}\nconst makeD1Consumer = (database: never) => drizzle(database);\n`,
        () => {
          expect(
            inspectGlobalD1Architecture(
              readTrackedGlobalD1Architecture(trackedRepositoryRoot)
            )
          ).not.toEqual([]);
        }
      );
    });

    it("rejects a dynamic D1 consumer import in an allowed call path", () => {
      const workerPath = "apps/api/src/worker.ts";
      const worker = readFileSync(
        path.join(repositoryRoot, workerPath),
        "utf-8"
      );

      withTrackedSource(
        workerPath,
        `${worker}\nconst loadD1Consumer = () => import("drizzle-orm/d1");\n`,
        () => {
          expect(
            inspectGlobalD1Architecture(
              readTrackedGlobalD1Architecture(trackedRepositoryRoot)
            )
          ).not.toEqual([]);
        }
      );
    });

    it("rejects an aliased D1 consumer import in an allowed call path", () => {
      const servicePath =
        "apps/api/src/features/provider-accounting/provider-accounting.service.ts";
      const service = readFileSync(
        path.join(repositoryRoot, servicePath),
        "utf-8"
      )
        .replaceAll("AnyD1Database", "TenantGlobalDatabase")
        .replace(
          'import type { TenantGlobalDatabase } from "drizzle-orm/d1";',
          'import type { AnyD1Database as TenantGlobalDatabase } from "drizzle-orm/d1";'
        );

      withTrackedSource(servicePath, service, () => {
        expect(
          inspectGlobalD1Architecture(
            readTrackedGlobalD1Architecture(trackedRepositoryRoot)
          )
        ).not.toEqual([]);
      });
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

    it("documents the exact current provider-accounting table inventory", () => {
      const infrastructure = readFileSync(
        path.join(repositoryRoot, "docs/infrastructure/alchemy.md"),
        "utf-8"
      );

      for (const table of [
        "provider_accounting_budgets",
        "provider_accounting_conservative_settlements",
        "provider_accounting_dispatches",
        "provider_accounting_recipe_replay_values",
        "provider_accounting_reconciliations",
      ]) {
        expect(infrastructure).toContain(table);
      }
      expect(infrastructure).not.toContain("provider_cost_");
    });
  }
);
