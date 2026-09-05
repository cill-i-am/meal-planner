import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { RecipeImportBatch } from "@meal-planner/recipe-import-api";
import { Schema } from "effect";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bundleWorkerFixture } from "../../test/native-worker.test-fixture.js";
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
  status: Schema.Struct({ status: Schema.String }),
  workflowId: Schema.String,
});

const runScenario = async (
  commandId: string,
  organizationId: string,
  scenario:
    | "admission-lost-response"
    | "dispatch-all-start-responses-lost"
    | "dispatch-committed-reconcile-unavailable"
    | "dispatch-lost-response"
    | "dispatch-pre-start-refusal"
    | "dispatch-reconcile-recovered"
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
    const [hostManifest, domainManifest] = await Promise.all([
      bundleWorkerFixture(
        fileURLToPath(
          new URL(
            "household-import-batch-workflow.test-fixture.ts",
            import.meta.url
          )
        ),
        persistenceDirectory
      ),
      bundleWorkerFixture(
        fileURLToPath(
          new URL(
            "../households/household-domain-service.test-fixture.js",
            import.meta.url
          )
        ),
        persistenceDirectory
      ),
    ]);
    runtime = new Miniflare({
      cf: false,
      resourcePersistencePath: persistenceDirectory,
      workers: [
        {
          config: {
            compatibilityDate,
            compatibilityFlags,
            env: {
              BATCH_WORKFLOW_STATE: { id: "BATCH_WORKFLOW_STATE", type: "kv" },
              HouseholdBatchTestWorkflow: {
                exportName: "HouseholdBatchTestWorkflow",
                name: "household-batch-test-workflow",
                type: "workflow",
                worker: "workflow-host",
              },
              HouseholdDomainWorker: {
                type: "worker",
                worker: "household-domain",
              },
              ImportAcquisitionTestWorkflow: {
                exportName: "ImportAcquisitionTestWorkflow",
                name: "import-acquisition-test-workflow",
                type: "workflow",
                worker: "workflow-host",
              },
            },
            manifest: hostManifest,
            name: "workflow-host",
            type: "worker",
          },
        },
        {
          config: {
            compatibilityDate,
            compatibilityFlags,
            env: {
              HouseholdImportBatchQueue: {
                name: "household-import-batches",
                type: "queue",
              },
              HouseholdObject: {
                exportName: "HouseholdObject",
                type: "durable-object",
                worker: "household-domain",
              },
            },
            exports: {
              HouseholdObject: { storage: "sqlite", type: "durable-object" },
            },
            manifest: domainManifest,
            name: "household-domain",
            type: "worker",
          },
        },
      ],
    });
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
      status: { status: "complete" },
    });
    expect(result.counts.dispatch).toBe(1);
    expect(result.counts.prepared).toBeGreaterThanOrEqual(1);
    expect(result.counts.unavailable).toBe(0);
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
      status: { status: "complete" },
      workflowId: first.workflowId,
    });
  }, 20_000);

  it("preserves a committed Workflow when every bounded reconciliation probe is unavailable", async () => {
    const result = await runScenario(
      "7510000000000000305",
      "organization-batch-dispatch-ambiguous",
      "dispatch-committed-reconcile-unavailable"
    );

    expect(result).toMatchObject({
      acquisitionRuns: 1,
      batch: {
        counts: { failed: 0, succeeded: 0, total: 1 },
        status: "running",
      },
      counts: {
        admit: 1,
        claim: 1,
        complete: 0,
        dispatch: 6,
        fail: 0,
        reconcile: 6,
        started: 0,
      },
      error: true,
      outbox: { attempts: 0, state: "pending" },
      status: { status: "errored" },
    });
    expect(result.batch.items[0]).toMatchObject({ status: "running" });

    const recovered = await runScenario(
      "7510000000000000305",
      "organization-batch-dispatch-ambiguous",
      "dispatch-reconcile-recovered"
    );
    expect(recovered).toMatchObject({
      acquisitionRuns: 1,
      batch: {
        counts: { failed: 0, succeeded: 1, total: 1 },
        status: "completed",
      },
      counts: { complete: 1, fail: 0, started: 1 },
      error: true,
      outbox: { state: "dispatched" },
      replay: result.replay,
      status: { status: "complete" },
      workflowId: result.workflowId,
    });
    expect(recovered.batch.items[0]).toMatchObject({
      intentId: result.replay.intentId,
      status: "succeeded",
    });
  }, 20_000);

  it("settles only after bounded exact native pre-start refusals", async () => {
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
      status: { status: "complete" },
    });
    expect(result.batch.items[0]).toMatchObject({
      failureCode: "dispatch_exhausted",
      status: "failed",
    });

    const replay = await runScenario(
      "7510000000000000304",
      "organization-batch-dispatch-pre-start-refusal",
      "dispatch-pre-start-refusal"
    );
    expect(replay).toMatchObject({
      batch: result.batch,
      counts: result.counts,
      error: false,
      outbox: { attempts: 5, state: "exhausted" },
      replay: result.replay,
      status: { status: "complete" },
      workflowId: result.workflowId,
    });
  }, 20_000);
});
