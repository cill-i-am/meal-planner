import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { NodeServices } from "@effect/platform-node";
import { listSqlFiles } from "alchemy/SQL/SqlFile";
import type { SqlFile } from "alchemy/SQL/SqlFile";
import { Effect, Schema } from "effect";
import { Miniflare } from "miniflare";
import { expect, it } from "vitest";

import {
  ProviderAccountingDispatchId,
  ProviderAccountingProviderStageId,
  ProviderAccountingRunId,
  ProviderAccountingTimestamp,
} from "./provider-accounting.js";
import { makeD1ProviderAccountingRepository } from "./provider-accounting.repository.d1.js";

interface AlchemyMigrations {
  readonly applyMigrationsWith: (
    executor: (sql: string) => Effect.Effect<{
      readonly result: readonly { readonly results?: unknown }[];
    }>,
    options: {
      readonly migrationsTable: string;
      readonly migrationsFiles: readonly SqlFile[];
    }
  ) => Effect.Effect<void, unknown>;
}

it("upgrades an applied baseline and conservatively settles an existing invocation exactly once", async () => {
  // SAFETY: beta.72 exports this executor seam from the resolved module, but not its package barrel.
  const { applyMigrationsWith } = (await import(
    new URL("ApplyMigrations.js", import.meta.resolve("alchemy/Cloudflare/D1"))
      .href
  )) as AlchemyMigrations;
  const migrations = await listSqlFiles(
    fileURLToPath(
      new URL("../../../provider-accounting-migrations", import.meta.url)
    )
  ).pipe(Effect.provide(NodeServices.layer), Effect.runPromise);
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
    await applyMigrationsWith(executeSql, {
      migrationsFiles: [baseline],
      migrationsTable: "d1_migrations",
    }).pipe(Effect.runPromise);
    const historySql = "SELECT id, name FROM d1_migrations ORDER BY id";
    const baselineHistory = await database.prepare(historySql).all();
    expect(baselineHistory.results).toEqual([
      { id: "00001", name: baseline.id },
    ]);

    const repository = makeD1ProviderAccountingRepository(database);
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

    await applyMigrationsWith(executeSql, {
      migrationsFiles: migrations,
      migrationsTable: "d1_migrations",
    }).pipe(Effect.runPromise);
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
    const expectedHistory = migrations.map(({ id }, index) => ({
      id: (index + 1).toString().padStart(5, "0"),
      name: id,
    }));
    const upgradedHistory = await database.prepare(historySql).all();
    expect(upgradedHistory.results).toEqual(expectedHistory);
    await applyMigrationsWith(executeSql, {
      migrationsFiles: migrations,
      migrationsTable: "d1_migrations",
    }).pipe(Effect.runPromise);
    const replayedHistory = await database.prepare(historySql).all();
    expect(replayedHistory.results).toEqual(expectedHistory);
  } finally {
    await runtime.dispose();
    await rm(directory, { force: true, recursive: true });
  }
}, 30_000);
