import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import cloudflareRolldown from "@distilled.cloud/cloudflare-rolldown-plugin";
import * as Bundle from "alchemy/Bundle";
import { Effect } from "effect";
import type { ModuleDefinition } from "miniflare";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const compatibilityDate = "2026-07-14";
const importId = "018f7f67-e0c7-7d34-a593-8c20c6f7b868";
let persistenceDirectory = "";
let runtime: Miniflare | undefined;

const bundleFixture = async (): Promise<
  readonly [ModuleDefinition, ...ModuleDefinition[]]
> => {
  const output = await Effect.runPromise(
    Bundle.build(
      {
        external: ["cloudflare:workers"],
        input: fileURLToPath(
          new URL("./import-evidence-event.test-fixture.ts", import.meta.url)
        ),
        plugins: [cloudflareRolldown({ compatibilityDate })],
      },
      { codeSplitting: false, format: "esm", minify: true, sourcemap: false }
    )
  );
  const [entry, ...assets] = output.files;
  const text = (value: string | Uint8Array<ArrayBufferLike>) =>
    typeof value === "string" ? value : new TextDecoder().decode(value);
  return [
    { contents: text(entry.content), path: entry.path, type: "ESModule" },
    ...assets.map(
      (asset): ModuleDefinition => ({
        contents: text(asset.content),
        path: asset.path,
        type: "Text",
      })
    ),
  ];
};

const result = async () => {
  const namespace = await runtime?.getKVNamespace("RESULTS", "consumer");
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const value = await namespace?.get("last", "json");
    if (value !== null && value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Queue event was not processed");
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
          kvNamespaces: ["RESULTS"],
          modules: [...(await bundleFixture())],
          name: "consumer",
          queueConsumers: ["evidence-events"],
          queueProducers: {
            EVENTS: { queueName: "evidence-events" },
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

  it("delivers and privacy-projects an R2 lifecycle deletion", async () => {
    const queue = await runtime?.getQueueProducer("EVENTS", "consumer");
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
        action: "LifecycleDeletion",
        artifact: "acquisition_manifest",
        executionGeneration: 4,
        trackedReference: true,
      },
    });
  });
});
