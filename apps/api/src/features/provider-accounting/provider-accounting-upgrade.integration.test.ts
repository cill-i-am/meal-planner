import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { NodeServices } from "@effect/platform-node";
import { applyMigrations } from "alchemy/SQL/Migrations/index";
import type { SqlExecutor } from "alchemy/SQL/Migrations/index";
import { listSqlFiles } from "alchemy/SQL/SqlFile";
import { Effect, Schema } from "effect";
import { Miniflare } from "miniflare";
import { expect, it } from "vitest";

import { makeProviderAccountingDatabase } from "./provider-accounting.database.js";
import {
  ProviderAccountingDispatchId,
  ProviderAccountingProviderStageId,
  ProviderAccountingRunId,
  ProviderAccountingTimestamp,
} from "./provider-accounting.js";
import { makeD1ProviderAccountingRepository } from "./provider-accounting.repository.d1.js";
import { makeD1ProviderAccountingRepository as makePreviousRepository } from "./provider-accounting.repository.previous.test-fixture.js";

type UpgradeDatabase = Awaited<ReturnType<Miniflare["getD1Database"]>>;

const readPersisted = async (database: UpgradeDatabase) => {
  const [budgets, dispatches, audits, replay, reconciliations] =
    await Promise.all([
      database
        .prepare("SELECT * FROM provider_accounting_budgets ORDER BY rowid")
        .all(),
      database
        .prepare("SELECT * FROM provider_accounting_dispatches ORDER BY rowid")
        .all(),
      database
        .prepare(
          "SELECT * FROM provider_accounting_conservative_settlements ORDER BY rowid"
        )
        .all(),
      database
        .prepare(
          "SELECT * FROM provider_accounting_recipe_replay_values ORDER BY rowid"
        )
        .all(),
      database
        .prepare(
          "SELECT * FROM provider_accounting_reconciliations ORDER BY rowid"
        )
        .all(),
    ]);
  return {
    provider_accounting_budgets: budgets.results,
    provider_accounting_conservative_settlements: audits.results,
    provider_accounting_dispatches: dispatches.results,
    provider_accounting_recipe_replay_values: replay.results,
    provider_accounting_reconciliations: reconciliations.results,
  };
};

const withAppliedBaseline = async (
  run: (
    database: UpgradeDatabase,
    upgrade: () => Promise<void>
  ) => Promise<void>
) => {
  // Alchemy's Cloudflare wildcard export maps to barrels; this executor is internal.
  const { makeD1MigrationExecutor } = (await import(
    new URL("ApplyMigrations.js", import.meta.resolve("alchemy/Cloudflare/D1"))
      .href
  )) as {
    readonly makeD1MigrationExecutor: (
      execute: (sql: string) => Effect.Effect<{
        readonly result: readonly { readonly results?: unknown }[];
      }>
    ) => SqlExecutor;
  };
  const migrationsDirectory = fileURLToPath(
    new URL("../../../provider-accounting-migrations", import.meta.url)
  );
  const migrations = await listSqlFiles(migrationsDirectory).pipe(
    Effect.provide(NodeServices.layer),
    Effect.runPromise
  );
  const baseline = migrations.find(
    ({ id }) => id === "20260824183013_provider_accounting/migration.sql"
  );
  if (baseline === undefined) {
    throw new Error("The applied provider accounting baseline is missing");
  }
  // Pin the installed schema from main at 9a59f851, so editing the baseline cannot bypass this upgrade test.
  expect(baseline.hash).toBe(
    "e45012cfd5270be6bfb5b133ba85a065299e148c52cddf59076364f06ce6238f"
  );
  const directory = await mkdtemp(`${tmpdir()}/provider-accounting-upgrade-`);
  const runtime = new Miniflare({
    compatibilityDate: "2026-07-14",
    d1Databases: ["ProviderAccountingDatabase"],
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
  });
  try {
    const database = await runtime.getD1Database("ProviderAccountingDatabase");
    const executeSql = (sql: string) =>
      Effect.promise(async () => {
        // Cloudflare's SQL parser preserves compound trigger bodies in the atomic batch.
        await writeFile(`${directory}/0001_payload.sql`, sql);
        const parsed = await readD1Migrations(directory);
        const statements = parsed.flatMap(({ queries }) =>
          queries.map((query) => database.prepare(query))
        );
        return { result: await database.batch(statements) };
      });
    // Seed the installed beta.72 schema and ledger to exercise the real upgrade.
    await executeSql(`
      ${baseline.sql}
      CREATE TABLE d1_migrations (id TEXT PRIMARY KEY, name TEXT, applied_at TEXT);
      INSERT INTO d1_migrations VALUES ('00001', '${baseline.id}', '2026-08-24T18:30:13.000Z');
    `).pipe(Effect.runPromise);
    const historySql = "SELECT * FROM d1_migrations ORDER BY id";
    const baselineHistory = await database.prepare(historySql).all();
    expect(baselineHistory.results).toEqual([
      { applied_at: expect.any(String), id: "00001", name: baseline.id },
    ]);

    const upgrade = () =>
      applyMigrations({
        executor: makeD1MigrationExecutor(executeSql),
        resolved: { dir: migrationsDirectory, table: "d1_migrations" },
      }).pipe(Effect.provide(NodeServices.layer), Effect.runPromise);
    await run(database, upgrade);
    const upgradedHistory = await database.prepare(historySql).all();
    expect(upgradedHistory.results).toEqual(
      migrations.map(({ id, hash }, index) => ({
        applied_at: expect.any(String),
        created_at: expect.any(Number),
        hash,
        id: index + 1,
        name: id === baseline.id ? id : id.replace("/migration.sql", ""),
      }))
    );
    const persisted = await readPersisted(database);
    await upgrade();
    const repeatedHistory = await database.prepare(historySql).all();
    expect(repeatedHistory.results).toEqual(upgradedHistory.results);
    expect(await readPersisted(database)).toEqual(persisted);
  } finally {
    await runtime.dispose();
    await rm(directory, { force: true, recursive: true });
  }
};

it("upgrades an applied baseline and conservatively settles an existing invocation exactly once", async () => {
  await withAppliedBaseline(async (database, upgrade) => {
    const repository = makeD1ProviderAccountingRepository(
      makeProviderAccountingDatabase(database)
    );
    const evidenceFingerprint = "e".repeat(64);
    const command = {
      dispatchId: Schema.decodeUnknownSync(ProviderAccountingDispatchId)(
        `recipe:import-upgrade:1:${evidenceFingerprint}`
      ),
      maximumCostMicroUsd: 100_000,
      providerStageId: Schema.decodeUnknownSync(
        ProviderAccountingProviderStageId
      )("recipe-extraction"),
      runId: Schema.decodeUnknownSync(ProviderAccountingRunId)(
        "recipe-import:import-upgrade"
      ),
      timestamp: Schema.decodeUnknownSync(ProviderAccountingTimestamp)(
        new Date().toISOString()
      ),
    };
    await repository.reserve(command).pipe(Effect.runPromise);
    const claim = await repository
      .beginInvocation(command)
      .pipe(Effect.runPromise);
    if (claim._tag !== "Claimed") {
      throw new Error("Expected an invocation under the baseline schema");
    }
    expect(await repository.readStage().pipe(Effect.runPromise)).toMatchObject({
      reservedMicroUsd: 100_000,
      settledMicroUsd: 0,
      state: "invoking",
    });

    await upgrade();
    const settlement = {
      ...command,
      conservativeChargeMicroUsd: 100_000,
      invocationGeneration: claim.dispatch.invocationGeneration,
      replay: {
        evidenceFingerprint,
        generation: 1,
        importId: "import-upgrade",
        valueJson: JSON.stringify("decoded-recipe"),
        valueSha256: "a".repeat(64),
      },
    };
    const expectedDispatch = {
      actualCostMicroUsd: null,
      state: "settled_conservative",
    };
    await expect(
      repository.settleConservative(settlement).pipe(Effect.runPromise)
    ).resolves.toMatchObject(expectedDispatch);
    await expect(
      repository.settleConservative(settlement).pipe(Effect.runPromise)
    ).resolves.toMatchObject(expectedDispatch);
    expect(await repository.readStage().pipe(Effect.runPromise)).toEqual({
      budgetCapMicroUsd: 10_000_000,
      reservedMicroUsd: 0,
      settledMicroUsd: 100_000,
      state: "open",
    });
    const dispatches = await database
      .prepare(
        "SELECT state, actual_cost_micro_usd FROM provider_accounting_dispatches"
      )
      .all();
    expect(dispatches.results).toEqual([
      { actual_cost_micro_usd: null, state: "settled_conservative" },
    ]);
    const audit = await database
      .prepare(
        `SELECT actual_cost_was_unknown, authority, conservative_charge_micro_usd
         FROM provider_accounting_conservative_settlements`
      )
      .all();
    expect(audit.results).toEqual([
      {
        actual_cost_was_unknown: 1,
        authority: "schema_valid_provider_response",
        conservative_charge_micro_usd: 100_000,
      },
    ]);
    const replay = await database
      .prepare(
        `SELECT evidence_fingerprint, generation, import_id, value_json, value_sha256
         FROM provider_accounting_recipe_replay_values`
      )
      .all();
    expect(replay.results).toEqual([
      {
        evidence_fingerprint: evidenceFingerprint,
        generation: 1,
        import_id: "import-upgrade",
        value_json: settlement.replay.valueJson,
        value_sha256: settlement.replay.valueSha256,
      },
    ]);
  });
}, 30_000);

// Frozen, unmodified repository from main at 9a59f85170f379e065920eadaaf69593d90c2c40.
const previousRepositorySha256 =
  "447c63a4de74627a5f581e2338c86449a27725579fde0484a7bfe84ccbbe5aa8";

it.each(["active", "expired", "swept", "unknown"] as const)(
  "upgrades a previously completed %s settlement without changing its persisted evidence or charging again",
  async (scenario) => {
    const source = await readFile(
      new URL(
        "provider-accounting.repository.previous.test-fixture.ts",
        import.meta.url
      )
    );
    expect(createHash("sha256").update(source).digest("hex")).toBe(
      previousRepositorySha256
    );
    await withAppliedBaseline(async (database, upgrade) => {
      const previous = makePreviousRepository(database);
      const evidenceFingerprint = "e".repeat(64);
      const command = {
        dispatchId: Schema.decodeUnknownSync(ProviderAccountingDispatchId)(
          `recipe:upgrade-${scenario}:1:${evidenceFingerprint}`
        ),
        maximumCostMicroUsd: 100_000,
        providerStageId: Schema.decodeUnknownSync(
          ProviderAccountingProviderStageId
        )("recipe-extraction"),
        runId: Schema.decodeUnknownSync(ProviderAccountingRunId)(
          `recipe-import:upgrade-${scenario}`
        ),
        timestamp: Schema.decodeUnknownSync(ProviderAccountingTimestamp)(
          new Date().toISOString()
        ),
      };
      await previous.reserve(command).pipe(Effect.runPromise);
      const claim = await previous
        .beginInvocation(command)
        .pipe(Effect.runPromise);
      if (claim._tag !== "Claimed") {
        throw new Error("Expected a previous-repository invocation");
      }
      const settlement = {
        ...command,
        conservativeChargeMicroUsd: 100_000,
        invocationGeneration: claim.dispatch.invocationGeneration,
        replay: {
          evidenceFingerprint,
          generation: 1,
          importId: `upgrade-${scenario}`,
          valueJson: JSON.stringify("decoded-recipe"),
          valueSha256: "a".repeat(64),
        },
      };
      await (
        scenario === "unknown"
          ? previous.settleUnknown(settlement)
          : previous.settleConservative(settlement)
      ).pipe(Effect.runPromise);
      const cleanupCommand = {
        ...command,
        dispatchId: Schema.decodeUnknownSync(ProviderAccountingDispatchId)(
          "recipe:cleanup-after-upgrade"
        ),
      };
      if (scenario === "expired") {
        await previous.reserve(cleanupCommand).pipe(Effect.runPromise);
      }
      if (scenario === "expired" || scenario === "swept") {
        const immutableTrigger = await database
          .prepare(
            "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'provider_accounting_recipe_replay_values_immutable_update'"
          )
          .first<string>("sql");
        if (immutableTrigger === null) {
          throw new Error("Replay immutability trigger is missing");
        }
        await database
          .prepare(
            "DROP TRIGGER provider_accounting_recipe_replay_values_immutable_update"
          )
          .run();
        try {
          await database
            .prepare(
              "UPDATE provider_accounting_recipe_replay_values SET created_at = '2026-07-20T18:00:00.000Z', expires_at = '2026-07-27T18:00:00.000Z'"
            )
            .run();
        } finally {
          await database.prepare(immutableTrigger).run();
        }
        if (scenario === "swept") {
          await database
            .prepare(
              "DELETE FROM provider_accounting_recipe_replay_values WHERE expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"
            )
            .run();
        }
      }
      const before = await readPersisted(database);
      expect(
        before.provider_accounting_dispatches.map((row) => row["state"])
      ).toEqual(
        scenario === "expired"
          ? ["settled_unknown", "reserved"]
          : ["settled_unknown"]
      );
      expect(before.provider_accounting_budgets).toEqual([
        expect.objectContaining({
          reserved_micro_usd: ["unknown", "expired"].includes(scenario)
            ? 100_000
            : 0,
          settled_micro_usd: scenario === "unknown" ? 0 : 100_000,
          state: scenario === "unknown" ? "poisoned" : "open",
        }),
      ]);
      expect(before.provider_accounting_conservative_settlements).toHaveLength(
        scenario === "unknown" ? 0 : 1
      );
      expect(before.provider_accounting_recipe_replay_values).toHaveLength(
        scenario === "active" || scenario === "expired" ? 1 : 0
      );
      await upgrade();
      const expected =
        scenario === "unknown"
          ? before
          : {
              ...before,
              provider_accounting_dispatches:
                before.provider_accounting_dispatches.map((row) =>
                  row["dispatch_id"] === command.dispatchId
                    ? {
                        ...row,
                        state: "settled_conservative",
                      }
                    : row
                ),
            };
      expect(await readPersisted(database)).toEqual(expected);
      const current = makeD1ProviderAccountingRepository(
        makeProviderAccountingDatabase(database)
      );
      const read = await current.readDispatch(command).pipe(Effect.runPromise);
      expect(read.state).toBe(
        scenario === "unknown" ? "settled_unknown" : "settled_conservative"
      );
      if (scenario === "active") {
        expect(read.conservativeReplay).toMatchObject(settlement.replay);
        await expect(
          current.settleConservative(settlement).pipe(Effect.runPromise)
        ).resolves.toEqual(read);
        await expect(
          current.settleConservative(settlement).pipe(Effect.runPromise)
        ).resolves.toEqual(read);
      } else if (scenario === "unknown") {
        expect(read.conservativeReplay).toBeUndefined();
        await expect(
          current.settleUnknown(settlement).pipe(Effect.runPromise)
        ).resolves.toEqual(read);
      } else {
        expect(read.conservativeReplay).toBeUndefined();
        await expect(
          current.settleConservative(settlement).pipe(Effect.runPromise)
        ).rejects.toMatchObject({
          _tag: "ProviderAccountingError",
          code: "dispatch_conflict",
        });
      }
      expect(await readPersisted(database)).toEqual(expected);
      if (scenario === "expired") {
        await expect(
          current.beginInvocation(cleanupCommand).pipe(Effect.runPromise)
        ).resolves.toMatchObject({ _tag: "Claimed" });
        const remainingReplay = await database
          .prepare("SELECT * FROM provider_accounting_recipe_replay_values")
          .all();
        expect(remainingReplay.results).toEqual([]);
      }
    });
  },
  30_000
);
