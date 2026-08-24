import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import cloudflareRolldown from "@distilled.cloud/cloudflare-rolldown-plugin";
import { RecipeImportBatch } from "@meal-planner/recipe-import-api";
import * as Bundle from "alchemy/Bundle";
import { Effect, Schema } from "effect";
import type { ModuleDefinition } from "miniflare";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { HouseholdRecordRecipeImportDispatchResult } from "../households/recipe-import/household-recipe-import.contract.js";

const compatibilityDate = "2026-07-14";
const compatibilityFlags = ["nodejs_compat"];
let persistenceDirectory = "";
let runtime: Miniflare;

const ScenarioResult = Schema.Struct({
  acquisitionRuns: Schema.Number,
  batch: RecipeImportBatch,
  counts: Schema.Struct({
    admit: Schema.Number,
    claim: Schema.Number,
    complete: Schema.Number,
    dispatch: Schema.Number,
    fail: Schema.Number,
    prepared: Schema.Number,
    reconcile: Schema.Number,
    started: Schema.Number,
    unavailable: Schema.Number,
  }),
  error: Schema.Boolean,
  outbox: Schema.NullOr(HouseholdRecordRecipeImportDispatchResult),
  replay: Schema.Struct({
    intentId: Schema.String,
    workflowIdentity: Schema.String,
  }),
  routeCount: Schema.Number,
  status: Schema.Struct({ status: Schema.String }),
  workflowId: Schema.String,
});

const bundleText = (content: string | Uint8Array<ArrayBufferLike>): string =>
  Schema.is(Schema.String)(content)
    ? content
    : new TextDecoder().decode(content);

const bundleFixture = async (
  fileName: string,
  outputDirectory: string
): Promise<readonly [ModuleDefinition, ...ModuleDefinition[]]> => {
  const output = await Effect.runPromise(
    Bundle.build(
      {
        checks: { ineffectiveDynamicImport: false, unresolvedImport: false },
        external: ["cloudflare:workers"],
        input: fileURLToPath(new URL(fileName, import.meta.url)),
        plugins: [
          cloudflareRolldown({ compatibilityDate, compatibilityFlags }),
        ],
      },
      {
        codeSplitting: false,
        dir: outputDirectory,
        format: "esm",
        minify: true,
        sourcemap: false,
      }
    )
  );
  const [entry, ...assets] = output.files;
  return [
    {
      contents: bundleText(entry.content),
      path: entry.path,
      type: "ESModule",
    },
    ...assets.map(
      (asset): ModuleDefinition => ({
        contents: bundleText(asset.content),
        path: asset.path,
        type: "Text",
      })
    ),
  ];
};

type MiniflareD1Database = Awaited<ReturnType<Miniflare["getD1Database"]>>;

const applyD1Migrations = async (database: MiniflareD1Database) => {
  const migrationsRoot = fileURLToPath(
    new URL("../../../migrations", import.meta.url)
  );
  const migrationEntries = await readdir(migrationsRoot);
  const directories = migrationEntries.toSorted();
  const migrations = await Promise.all(
    directories.map(async (directory) => {
      const migrationPath = `${migrationsRoot}/${directory}/migration.sql`;
      const migrationStats = await stat(migrationPath);
      if (!migrationStats.isFile()) {
        return [];
      }
      const migrationContents = await readFile(migrationPath, "utf-8");
      return migrationContents
        .split("--> statement-breakpoint")
        .map((statement) => statement.trim())
        .filter((statement) => statement.length > 0);
    })
  );
  await database.batch(
    migrations.flat().map((statement) => database.prepare(statement))
  );
};

const runScenario = async (
  commandId: string,
  organizationId: string,
  scenario:
    | "admission-lost-response"
    | "dispatch-all-start-responses-lost"
    | "dispatch-lost-response"
    | "dispatch-pre-start-refusal"
) => {
  const response = await runtime.dispatchFetch("http://localhost/", {
    body: JSON.stringify({ commandId, organizationId, scenario }),
    method: "POST",
  });
  expect(response.status, await response.clone().text()).toBe(200);
  return Schema.decodeUnknownPromise(ScenarioResult)(await response.json());
};

describe("household batch native production Workflow composition", () => {
  beforeAll(async () => {
    persistenceDirectory = await mkdtemp(
      `${tmpdir()}/meal-planner-household-batch-workflow-`
    );
    const [hostModules, domainModules] = await Promise.all([
      bundleFixture(
        "household-import-batch-workflow.test-fixture.ts",
        persistenceDirectory
      ),
      bundleFixture(
        "../households/household-domain-service.test-fixture.js",
        persistenceDirectory
      ),
    ]);
    runtime = new Miniflare({
      compatibilityDate,
      compatibilityFlags,
      d1Persist: persistenceDirectory,
      durableObjectsPersist: persistenceDirectory,
      kvPersist: persistenceDirectory,
      workers: [
        {
          compatibilityDate,
          compatibilityFlags,
          d1Databases: {
            MealPlannerDatabase: "household-batch-route-test",
          },
          kvNamespaces: ["BATCH_WORKFLOW_STATE"],
          modules: [...hostModules],
          name: "workflow-host",
          serviceBindings: { HouseholdDomainWorker: "household-domain" },
          workflows: {
            HouseholdBatchTestWorkflow: {
              className: "HouseholdBatchTestWorkflow",
              name: "household-batch-test-workflow",
            },
            ImportAcquisitionTestWorkflow: {
              className: "ImportAcquisitionTestWorkflow",
              name: "import-acquisition-test-workflow",
            },
          },
        },
        {
          compatibilityDate,
          compatibilityFlags,
          durableObjects: {
            HouseholdObject: { className: "HouseholdObject", useSQLite: true },
          },
          modules: [...domainModules],
          name: "household-domain",
          queueProducers: {
            HouseholdImportBatchQueue: {
              queueName: "household-import-batches",
            },
          },
        },
      ],
    });
    await applyD1Migrations(
      await runtime.getD1Database("MealPlannerDatabase", "workflow-host")
    );
  }, 30_000);

  afterAll(async () => {
    await runtime.dispose();
    await rm(persistenceDirectory, { force: true, recursive: true });
  });

  it("retries admission after a committed SQLite response is lost and exactly replays", async () => {
    const first = await runScenario(
      "7510000000000000301",
      "organization-batch-admission-lost-response",
      "admission-lost-response"
    );

    expect(first).toMatchObject({
      acquisitionRuns: 1,
      batch: {
        counts: { failed: 0, succeeded: 1, total: 1 },
        status: "completed",
      },
      counts: { admit: 2, claim: 1, complete: 1, fail: 0 },
      error: false,
      outbox: { state: "dispatched" },
      routeCount: 1,
      status: { status: "complete" },
    });
    expect(first.batch.items[0]).toMatchObject({
      intentId: first.replay.intentId,
      status: "succeeded",
    });

    const replay = await runScenario(
      "7510000000000000301",
      "organization-batch-admission-lost-response",
      "admission-lost-response"
    );
    expect(replay).toMatchObject({
      acquisitionRuns: 1,
      batch: first.batch,
      counts: first.counts,
      error: false,
      outbox: { state: "dispatched" },
      replay: first.replay,
      routeCount: 1,
      status: { status: "complete" },
      workflowId: first.workflowId,
    });
  }, 20_000);

  it("reconciles dispatch after the committed started response is lost", async () => {
    const result = await runScenario(
      "7510000000000000302",
      "organization-batch-dispatch-lost-response",
      "dispatch-lost-response"
    );

    expect(result).toMatchObject({
      acquisitionRuns: 1,
      batch: {
        counts: { failed: 0, succeeded: 1, total: 1 },
        status: "completed",
      },
      counts: {
        admit: 1,
        claim: 1,
        complete: 1,
        fail: 0,
        reconcile: 1,
        started: 1,
      },
      error: false,
      outbox: { state: "dispatched" },
      routeCount: 1,
      status: { status: "complete" },
    });
    expect(result.counts.dispatch).toBe(1);
    expect(result.counts.prepared).toBeGreaterThanOrEqual(1);
    expect(result.counts.unavailable).toBeGreaterThanOrEqual(1);
    expect(result.batch.items[0]).toMatchObject({
      intentId: result.replay.intentId,
      status: "succeeded",
    });
  }, 20_000);

  it("reconciles one committed Workflow when every successful start response is lost", async () => {
    const first = await runScenario(
      "7510000000000000303",
      "organization-batch-dispatch-all-start-responses-lost",
      "dispatch-all-start-responses-lost"
    );

    expect(first).toMatchObject({
      acquisitionRuns: 1,
      batch: {
        counts: { failed: 0, succeeded: 1, total: 1 },
        status: "completed",
      },
      counts: {
        admit: 1,
        claim: 1,
        complete: 1,
        fail: 0,
        reconcile: 1,
        started: 1,
      },
      error: false,
      outbox: { state: "dispatched" },
      routeCount: 1,
      status: { status: "complete" },
    });
    expect(first.counts.dispatch).toBeGreaterThanOrEqual(1);
    expect(first.counts.prepared).toBeGreaterThanOrEqual(1);
    expect(first.counts.unavailable).toBe(0);
    expect(first.batch.items[0]).toMatchObject({
      intentId: first.replay.intentId,
      status: "succeeded",
    });

    const replay = await runScenario(
      "7510000000000000303",
      "organization-batch-dispatch-all-start-responses-lost",
      "dispatch-all-start-responses-lost"
    );
    expect(replay).toMatchObject({
      acquisitionRuns: 1,
      batch: first.batch,
      counts: first.counts,
      error: false,
      outbox: { state: "dispatched" },
      replay: first.replay,
      routeCount: 1,
      status: { status: "complete" },
      workflowId: first.workflowId,
    });
  }, 20_000);

  it("fails only after bounded unambiguous pre-start refusals", async () => {
    const result = await runScenario(
      "7510000000000000304",
      "organization-batch-dispatch-pre-start-refusal",
      "dispatch-pre-start-refusal"
    );

    expect(result).toMatchObject({
      acquisitionRuns: 0,
      batch: {
        counts: { failed: 1, succeeded: 0, total: 1 },
        status: "failed",
      },
      counts: {
        admit: 1,
        claim: 1,
        complete: 0,
        dispatch: 5,
        fail: 1,
        prepared: 5,
        reconcile: 5,
        started: 0,
        unavailable: 5,
      },
      error: false,
      outbox: { attempts: 5, state: "exhausted" },
      routeCount: 1,
      status: { status: "complete" },
    });
    expect(result.batch.items[0]).toMatchObject({
      failureCode: "dispatch_exhausted",
      status: "failed",
    });
  }, 20_000);
});
