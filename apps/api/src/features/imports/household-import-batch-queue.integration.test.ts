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
        plugins: [cloudflareRolldown({ compatibilityDate })],
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
    runtime = new Miniflare({
      compatibilityDate,
      kvPersist: persistenceDirectory,
      workers: [
        {
          compatibilityDate,
          kvNamespaces: ["RESULTS"],
          modules: [
            ...(await bundleFixture(
              "household-import-batch-queue.test-fixture.ts"
            )),
          ],
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
        },
        {
          compatibilityDate,
          kvNamespaces: ["DLQ_RESULTS"],
          modules: [
            ...(await bundleFixture(
              "household-import-batch-dlq.test-fixture.ts"
            )),
          ],
          name: "dead-letter-consumer",
          queueConsumers: {
            "household-import-batches-dead-letter": {
              maxBatchSize: 1,
              maxBatchTimeout: 0.01,
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
    const message = {
      batchId: "018f47ad-91aa-7c35-b6fe-000000000201",
      generation: 1,
      itemId: "018f47ad-91aa-7c35-b6fe-000000000202",
      organizationId: "organization-batch-queue-proof",
    };
    const queue = await runtime.getQueueProducer("BATCHES", "consumer");
    await queue.send(message);

    await expect(
      readEventually("consumer", "RESULTS", "last")
    ).resolves.toEqual({
      message,
      workflowId: `household-batch:v1:${message.itemId}:g1`,
    });
    expect(
      JSON.stringify(await readEventually("consumer", "RESULTS", "last"))
    ).not.toMatch(/idempotency|source|url/iu);
  });

  it("retries three times and moves the unchanged closed envelope to DLQ", async () => {
    const message = {
      batchId: "018f47ad-91aa-7c35-b6fe-000000000203",
      generation: 2,
      itemId: "018f47ad-91aa-7c35-b6fe-000000009999",
      organizationId: "organization-batch-dlq-proof",
    };
    const results = await runtime.getKVNamespace("RESULTS", "consumer");
    const attemptsBefore = Number((await results.get("attempts")) ?? "0");
    const queue = await runtime.getQueueProducer("BATCHES", "consumer");
    await queue.send(message);

    await expect(
      readEventually("dead-letter-consumer", "DLQ_RESULTS", "last")
    ).resolves.toEqual(message);
    const attemptsAfter = Number((await results.get("attempts")) ?? "0");
    expect(attemptsAfter - attemptsBefore).toBe(4);
  });
});
