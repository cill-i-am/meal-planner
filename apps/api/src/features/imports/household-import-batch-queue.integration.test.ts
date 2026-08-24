import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import cloudflareRolldown from "@distilled.cloud/cloudflare-rolldown-plugin";
import * as Bundle from "alchemy/Bundle";
import { Effect, Schema } from "effect";
import type { ModuleDefinition } from "miniflare";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const compatibilityDate = "2026-07-14";
const compatibilityFlags = ["nodejs_compat"];
let persistenceDirectory = "";
let runtime: Miniflare;

const moduleText = (value: string | Uint8Array<ArrayBufferLike>) =>
  Schema.is(Schema.String)(value) ? value : new TextDecoder().decode(value);

const bundleFixture = async (
  fileName: string
): Promise<readonly [ModuleDefinition, ...ModuleDefinition[]]> => {
  const output = await Effect.runPromise(
    Bundle.build(
      {
        external: ["cloudflare:workers"],
        input: fileURLToPath(new URL(fileName, import.meta.url)),
        plugins: [
          cloudflareRolldown({ compatibilityDate, compatibilityFlags }),
        ],
      },
      { codeSplitting: false, format: "esm", minify: true, sourcemap: false }
    )
  );
  const [entry, ...assets] = output.files;
  return [
    { contents: moduleText(entry.content), path: entry.path, type: "ESModule" },
    ...assets.map(
      (asset): ModuleDefinition => ({
        contents: moduleText(asset.content),
        path: asset.path,
        type: "Text",
      })
    ),
  ];
};

const readEventually = async (
  worker: "consumer" | "dead-letter-consumer",
  binding: "RESULTS" | "DLQ_RESULTS",
  key: string,
  remaining = 200
): Promise<unknown> => {
  const namespace = await runtime.getKVNamespace(binding, worker);
  const value = await namespace.get(key, "json");
  if (value !== null) {
    return value;
  }
  if (remaining === 0) {
    throw new Error(`Queue result ${key} was not recorded.`);
  }
  await delay(25);
  return readEventually(worker, binding, key, remaining - 1);
};

describe("household batch Queue transport", () => {
  beforeAll(async () => {
    persistenceDirectory = await mkdtemp(
      `${tmpdir()}/meal-planner-household-batch-queue-`
    );
    const [consumerModules, deadLetterModules, domainModules] =
      await Promise.all([
        bundleFixture("household-import-batch-queue.test-fixture.ts"),
        bundleFixture("household-import-batch-dlq.test-fixture.ts"),
        bundleFixture("../households/household-domain-service.test-fixture.js"),
      ]);
    runtime = new Miniflare({
      compatibilityDate,
      compatibilityFlags,
      durableObjectsPersist: persistenceDirectory,
      kvPersist: persistenceDirectory,
      workers: [
        {
          compatibilityDate,
          compatibilityFlags,
          kvNamespaces: ["RESULTS"],
          modules: [...consumerModules],
          name: "consumer",
          queueConsumers: {
            "household-import-batches": {
              deadLetterQueue: "household-import-batches-dead-letter",
              maxBatchSize: 1,
              maxBatchTimeout: 0.01,
              maxRetries: 3,
              retryDelay: 0,
            },
          },
          queueProducers: {
            BATCHES: { queueName: "household-import-batches" },
          },
          serviceBindings: { HouseholdDomainWorker: "household-domain" },
          workflows: {
            BATCH_WORKFLOW: {
              className: "HouseholdBatchQueueTestWorkflow",
              name: "household-batch-queue-test-workflow",
            },
          },
        },
        {
          compatibilityDate,
          compatibilityFlags,
          kvNamespaces: ["DLQ_RESULTS"],
          modules: [...deadLetterModules],
          name: "dead-letter-consumer",
          queueConsumers: {
            "household-import-batches-dead-letter": {
              maxBatchSize: 1,
              maxBatchTimeout: 0.01,
              maxRetries: 3,
              retryDelay: 0,
            },
          },
          serviceBindings: {
            HouseholdDomainWorker: "household-domain",
            QueueConsumer: "consumer",
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
  }, 30_000);

  afterAll(async () => {
    await runtime.dispose();
    await rm(persistenceDirectory, { force: true, recursive: true });
  });

  it("delivers only immutable identifiers to one deterministic Workflow execution", async () => {
    const admissionResponse = await runtime.dispatchFetch(
      "http://localhost/admit",
      {
        body: JSON.stringify({
          commandId: "7510000000000000996",
          organizationId: "organization-batch-queue-proof",
        }),
        method: "POST",
      }
    );
    expect(
      admissionResponse.status,
      await admissionResponse.clone().text()
    ).toBe(200);
    const admitted = Schema.decodeUnknownSync(
      Schema.Struct({
        message: Schema.Struct({
          batchId: Schema.String,
          generation: Schema.Int,
          itemId: Schema.String,
          organizationId: Schema.String,
        }),
      })
    )(await admissionResponse.json());
    const { message } = admitted;
    const workflowId = `household-batch-v1-${message.itemId}-g1`;

    await expect(
      readEventually("consumer", "RESULTS", "last")
    ).resolves.toEqual({
      message,
      workflowId,
    });
    expect(
      JSON.stringify(await readEventually("consumer", "RESULTS", "last"))
    ).not.toMatch(/idempotency|source|url/iu);

    const results = await runtime.getKVNamespace("RESULTS", "consumer");
    await expect(
      readEventually("consumer", "RESULTS", `workflow-runs:${workflowId}`)
    ).resolves.toBe(1);
    const attemptsBeforeReplay = Number((await results.get("attempts")) ?? "0");
    const queue = await runtime.getQueueProducer("BATCHES", "consumer");
    await queue.send(message);
    await expect
      .poll(async () => Number((await results.get("attempts")) ?? "0"))
      .toBe(attemptsBeforeReplay + 1);
    expect(await results.get(`workflow-runs:${workflowId}`)).toBe("1");
  });

  it("redrives an errored outer Workflow through production Queue composition", async () => {
    const admissionResponse = await runtime.dispatchFetch(
      "http://localhost/admit",
      {
        body: JSON.stringify({
          commandId: "7510000000000000997",
          organizationId: "organization-batch-workflow-redrive-proof",
        }),
        method: "POST",
      }
    );
    expect(
      admissionResponse.status,
      await admissionResponse.clone().text()
    ).toBe(200);
    const admitted = Schema.decodeUnknownSync(
      Schema.Struct({
        message: Schema.Struct({
          batchId: Schema.String,
          generation: Schema.Int,
          itemId: Schema.String,
          organizationId: Schema.String,
        }),
      })
    )(await admissionResponse.json());
    const { message } = admitted;
    const workflowId = `household-batch-v1-${message.itemId}-g1`;

    await expect
      .poll(async () => {
        const response = await runtime.dispatchFetch(
          `http://localhost/workflow?workflowId=${encodeURIComponent(workflowId)}`
        );
        return response.ok
          ? ((await response.json()) as { status: { status: string } }).status
              .status
          : "missing";
      })
      .toBe("errored");
    const erroredBatch = await runtime.dispatchFetch(
      `http://localhost/batch?organizationId=${encodeURIComponent(message.organizationId)}&batchId=${encodeURIComponent(message.batchId)}`
    );
    await expect(erroredBatch.json()).resolves.toMatchObject({
      counts: { failed: 0, queued: 0, running: 1, succeeded: 0, total: 1 },
      items: [{ id: message.itemId, status: "running" }],
      status: "running",
    });

    await expect
      .poll(
        async () => {
          const response = await runtime.dispatchFetch(
            `http://localhost/workflow?workflowId=${encodeURIComponent(workflowId)}`
          );
          return response.json();
        },
        { timeout: 7000 }
      )
      .toMatchObject({
        attempts: 2,
        runs: 2,
        status: { status: "complete" },
      });
    const recoveredBatch = await runtime.dispatchFetch(
      `http://localhost/batch?organizationId=${encodeURIComponent(message.organizationId)}&batchId=${encodeURIComponent(message.batchId)}`
    );
    await expect(recoveredBatch.json()).resolves.toMatchObject({
      counts: { failed: 0, queued: 0, running: 0, succeeded: 1, total: 1 },
      items: [{ id: message.itemId, status: "succeeded" }],
      status: "completed",
    });
    await delay(5500);
    const settledWorkflow = await runtime.dispatchFetch(
      `http://localhost/workflow?workflowId=${encodeURIComponent(workflowId)}`
    );
    await expect(settledWorkflow.json()).resolves.toMatchObject({
      attempts: 2,
      runs: 2,
      status: { status: "complete" },
    });
  }, 25_000);

  it("retries three times and moves the unchanged closed envelope to DLQ", async () => {
    const results = await runtime.getKVNamespace("RESULTS", "consumer");
    const attemptsBefore = Number((await results.get("attempts")) ?? "0");
    const admissionResponse = await runtime.dispatchFetch(
      "http://localhost/admit",
      {
        body: JSON.stringify({
          commandId: "7510000000000000999",
          organizationId: "organization-batch-dlq-proof",
        }),
        method: "POST",
      }
    );
    expect(
      admissionResponse.status,
      await admissionResponse.clone().text()
    ).toBe(200);
    const admitted = Schema.decodeUnknownSync(
      Schema.Struct({
        batch: Schema.Unknown,
        message: Schema.Struct({
          batchId: Schema.String,
          generation: Schema.Int,
          itemId: Schema.String,
          organizationId: Schema.String,
        }),
      })
    )(await admissionResponse.json());
    const { message } = admitted;
    const workflowId = `household-batch-v1-${message.itemId}-g1`;

    const settled = await readEventually(
      "dead-letter-consumer",
      "DLQ_RESULTS",
      "last"
    );
    expect(settled).toEqual({ message, workflowId });
    const batchResponse = await runtime.dispatchFetch(
      `http://localhost/batch?organizationId=${encodeURIComponent(message.organizationId)}&batchId=${encodeURIComponent(message.batchId)}`
    );
    expect(batchResponse.status, await batchResponse.clone().text()).toBe(200);
    await expect(batchResponse.json()).resolves.toMatchObject({
      counts: { failed: 1, queued: 0, running: 0, succeeded: 0, total: 1 },
      id: message.batchId,
      items: [
        {
          failureCode: "dispatch_exhausted",
          id: message.itemId,
          status: "failed",
        },
      ],
      status: "failed",
    });
    const attemptsAfter = Number((await results.get("attempts")) ?? "0");
    expect(attemptsAfter - attemptsBefore).toBe(4);
    expect(await results.get(`workflow-runs:${workflowId}`)).toBeNull();
  }, 20_000);

  it("preserves a committed batch Workflow through unavailable Queue and DLQ probes", async () => {
    const results = await runtime.getKVNamespace("RESULTS", "consumer");
    const dlqResults = await runtime.getKVNamespace(
      "DLQ_RESULTS",
      "dead-letter-consumer"
    );
    const attemptsBefore = Number((await results.get("attempts")) ?? "0");
    const dlqAttemptsBefore = Number((await dlqResults.get("attempts")) ?? "0");
    const admissionResponse = await runtime.dispatchFetch(
      "http://localhost/admit",
      {
        body: JSON.stringify({
          commandId: "7510000000000000998",
          organizationId: "organization-batch-dlq-ambiguous-proof",
        }),
        method: "POST",
      }
    );
    expect(
      admissionResponse.status,
      await admissionResponse.clone().text()
    ).toBe(200);
    const admitted = Schema.decodeUnknownSync(
      Schema.Struct({
        message: Schema.Struct({
          batchId: Schema.String,
          generation: Schema.Int,
          itemId: Schema.String,
          organizationId: Schema.String,
        }),
      })
    )(await admissionResponse.json());
    const { message } = admitted;
    const workflowId = `household-batch-v1-${message.itemId}-g1`;

    await expect
      .poll(async () => Number((await dlqResults.get("attempts")) ?? "0"))
      .toBe(dlqAttemptsBefore + 3);
    await expect(
      readEventually("dead-letter-consumer", "DLQ_RESULTS", "last")
    ).resolves.toMatchObject({ message, workflowId });
    expect(
      Number((await results.get("attempts")) ?? "0") - attemptsBefore
    ).toBe(4);
    expect(await results.get(`workflow-runs:${workflowId}`)).toBe("1");
    expect(await results.get(`dlq-probes:${workflowId}`)).toBe("3");

    const batchResponse = await runtime.dispatchFetch(
      `http://localhost/batch?organizationId=${encodeURIComponent(message.organizationId)}&batchId=${encodeURIComponent(message.batchId)}`
    );
    expect(batchResponse.status, await batchResponse.clone().text()).toBe(200);
    await expect(batchResponse.json()).resolves.toMatchObject({
      counts: { failed: 0, queued: 0, succeeded: 1, total: 1 },
      id: message.batchId,
      items: [{ id: message.itemId, status: "succeeded" }],
      status: "completed",
    });
  }, 20_000);
});
