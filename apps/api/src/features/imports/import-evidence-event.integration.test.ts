import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import cloudflareRolldown from "@distilled.cloud/cloudflare-rolldown-plugin";
import * as Bundle from "alchemy/Bundle";
import { Effect } from "effect";
import type { ModuleDefinition } from "miniflare";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { decodeSafeImportEvidenceEvent } from "./import-evidence-event.js";

const compatibilityDate = "2026-07-14";
const importId = "018f7f67-e0c7-7d34-a593-8c20c6f7b868";
const organizationId = "organization-event-reconciliation-proof";
let persistenceDirectory = "";
let runtime: Miniflare | undefined;

const moduleContents = (value: string | Uint8Array<ArrayBufferLike>) => {
  if (value instanceof Uint8Array) {
    return new TextDecoder().decode(value);
  }
  return value;
};

const bundleFixture = async (): Promise<
  readonly [ModuleDefinition, ...ModuleDefinition[]]
> => {
  const output = await Effect.runPromise(
    Bundle.build(
      {
        external: ["cloudflare:workers"],
        input: fileURLToPath(
          new URL("import-evidence-event.test-fixture.ts", import.meta.url)
        ),
        plugins: [cloudflareRolldown({ compatibilityDate })],
      },
      { codeSplitting: false, format: "esm", minify: true, sourcemap: false }
    )
  );
  const [entry, ...assets] = output.files;
  return [
    {
      contents: moduleContents(entry.content),
      path: entry.path,
      type: "ESModule",
    },
    ...assets.map(
      (asset): ModuleDefinition => ({
        contents: moduleContents(asset.content),
        path: asset.path,
        type: "Text",
      })
    ),
  ];
};

const bundleDeadLetterFixture = async (): Promise<
  readonly [ModuleDefinition, ...ModuleDefinition[]]
> => {
  const output = await Effect.runPromise(
    Bundle.build(
      {
        external: ["cloudflare:workers"],
        input: fileURLToPath(
          new URL("import-evidence-event-dlq.test-fixture.ts", import.meta.url)
        ),
        plugins: [cloudflareRolldown({ compatibilityDate })],
      },
      { codeSplitting: false, format: "esm", minify: true, sourcemap: false }
    )
  );
  const [entry, ...assets] = output.files;
  return [
    {
      contents: moduleContents(entry.content),
      path: entry.path,
      type: "ESModule",
    },
    ...assets.map(
      (asset): ModuleDefinition => ({
        contents: moduleContents(asset.content),
        path: asset.path,
        type: "Text",
      })
    ),
  ];
};

const readResult = async (
  namespace: Awaited<ReturnType<Miniflare["getKVNamespace"]>> | undefined,
  attemptsRemaining: number
): Promise<unknown> => {
  const value = await namespace?.get("last", "json");
  if (value !== null && value !== undefined) {
    return value;
  }
  if (attemptsRemaining === 0) {
    throw new Error("Queue event was not processed");
  }
  await delay(25);
  return readResult(namespace, attemptsRemaining - 1);
};

const result = async () => {
  const namespace = await runtime?.getKVNamespace("RESULTS", "consumer");
  return readResult(namespace, 39);
};

const deadLetterResult = async () => {
  const namespace = await runtime?.getKVNamespace(
    "DLQ_RESULTS",
    "dead-letter-consumer"
  );
  return readResult(namespace, 199);
};

describe("import evidence Queue runtime", () => {
  beforeAll(async () => {
    persistenceDirectory = await mkdtemp(
      `${tmpdir()}/meal-planner-evidence-queue-`
    );
    runtime = new Miniflare({
      compatibilityDate,
      kvPersist: persistenceDirectory,
      workers: [
        {
          compatibilityDate,
          kvNamespaces: ["RESULTS", "ROUTES"],
          modules: [...(await bundleFixture())],
          name: "consumer",
          queueConsumers: {
            "evidence-events": {
              deadLetterQueue: "evidence-events-dead-letter",
              maxBatchSize: 1,
              maxBatchTimeout: 0.01,
              maxRetries: 3,
              retryDelay: 0,
            },
          },
          queueProducers: {
            EVENTS: { queueName: "evidence-events" },
          },
        },
        {
          compatibilityDate,
          kvNamespaces: ["DLQ_RESULTS"],
          modules: [...(await bundleDeadLetterFixture())],
          name: "dead-letter-consumer",
          queueConsumers: {
            "evidence-events-dead-letter": {
              maxBatchSize: 1,
              maxBatchTimeout: 0.01,
            },
          },
        },
      ],
    });
  });

  afterAll(async () => {
    await runtime?.dispose();
    if (persistenceDirectory !== "") {
      await rm(persistenceDirectory, { force: true, recursive: true });
    }
  });

  it("delivers an R2 lifecycle deletion through the production reconciliation core", async () => {
    const queue = await runtime?.getQueueProducer("EVENTS", "consumer");
    const routes = await runtime?.getKVNamespace("ROUTES", "consumer");
    await routes?.put(
      importId,
      JSON.stringify({
        executionGeneration: 1,
        importId,
        organizationId,
        routeVersion: 1,
      })
    );
    await queue?.send({
      account: "must-not-escape",
      action: "LifecycleDeletion",
      bucket: "must-not-escape",
      eventTime: "2026-08-22T12:00:00.000Z",
      object: {
        key: `imports/${importId}/acquisition/v1/generations/4/manifest.json`,
      },
    });

    await expect(result()).resolves.toEqual({
      _tag: "Accepted",
      value: {
        _tag: "Observed",
        availability: "deleted",
      },
    });
    expect(JSON.stringify(await result())).not.toMatch(
      /organization-event|imports\/|must-not-escape/u
    );
  });

  it("strictly decodes Cloudflare's CopyObject notification shape", async () => {
    await expect(
      Effect.runPromise(
        decodeSafeImportEvidenceEvent({
          account: "must-not-escape",
          action: "CopyObject",
          bucket: "must-not-escape",
          copySource: {
            bucket: "source-bucket",
            object: "source-key",
          },
          eventTime: "2026-08-22T12:00:00.000Z",
          object: {
            eTag: "etag",
            key: `imports/${importId}/acquisition/v1/generations/4/manifest.json`,
            size: 42,
          },
        })
      )
    ).resolves.toMatchObject({ action: "CopyObject", importId });
  });

  it("moves an exhausted retryable R2 event to the dedicated dead-letter queue", async () => {
    const queue = await runtime?.getQueueProducer("EVENTS", "consumer");
    const results = await runtime?.getKVNamespace("RESULTS", "consumer");
    const attemptsBefore = Number((await results?.get("attempts")) ?? "0");
    const event = {
      account: "must-not-escape",
      action: "LifecycleDeletion",
      bucket: "must-not-escape",
      eventTime: "2026-08-22T12:05:00.000Z",
      object: {
        key: "imports/018f7f67-e0c7-7d34-a593-8c20c6f7b869/acquisition/v1/generations/4/manifest.json",
      },
    };
    await queue?.send(event);

    await expect(deadLetterResult()).resolves.toEqual(event);
    const attemptsAfter = Number((await results?.get("attempts")) ?? "0");
    expect(attemptsAfter - attemptsBefore).toBe(4);
  });
});
