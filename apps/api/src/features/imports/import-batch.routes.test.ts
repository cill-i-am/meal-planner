import { Effect, Layer, Redacted, Schema } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ImportBatchId, ImportBatchItemId } from "./import-batch.contracts.js";
import { makeDeterministicImportBatchQueue } from "./import-batch.fake.js";
import { ImportBatchRoutes } from "./import-batch.routes.js";
import {
  ImportBatchService,
  makeImportBatchService,
} from "./import-batch.service.js";
import type { ImportAuthorizerShape } from "./import.auth.js";
import { ImportAuthorizer, makeImportAuthorizer } from "./import.auth.js";
import {
  ImportId,
  ImportTimestamp,
  SourceCanonicalId,
} from "./import.contracts.js";
import type { DeterministicImportAttempt } from "./import.fake.js";
import { makeDeterministicOrdinaryImportService } from "./import.fake.js";

const decodeBatchId = Schema.decodeUnknownSync(ImportBatchId);
const decodeBatchItemId = Schema.decodeUnknownSync(ImportBatchItemId);
const decodeImportId = Schema.decodeUnknownSync(ImportId);
const decodeTimestamp = Schema.decodeUnknownSync(ImportTimestamp);
const decodeCanonicalId = Schema.decodeUnknownSync(SourceCanonicalId);

const batchIds = [decodeBatchId("018f47ad-91aa-7c35-b6fe-100000000001")];
const itemIds = [decodeBatchItemId("018f47ad-91aa-7c35-b6fe-200000000001")];
const importIds = [decodeImportId("018f47ad-91aa-7c35-b6fe-300000000001")];
const timestamp = decodeTimestamp("2026-07-22T09:00:00.000Z");
const canonicalId = decodeCanonicalId("7520000000000000001");
const videoImport = {
  createdAt: timestamp,
  evidence: [
    { kind: "original_media" as const, referenceId: "video-original" },
    {
      kind: "acquisition_manifest" as const,
      referenceId: "video-acquisition",
    },
    { kind: "speech_transcript" as const, referenceId: "video-transcript" },
    {
      kind: "visual_evidence_manifest" as const,
      referenceId: "video-visual",
    },
    { kind: "recipe_draft" as const, referenceId: "video-recipe" },
  ] as const,
  id: importIds[0] ?? decodeImportId("018f47ad-91aa-7c35-b6fe-300000000099"),
  source: { canonicalId, kind: "tiktok" as const },
  status: { kind: "needs_review" as const },
  updatedAt: timestamp,
};

let authorizer: ImportAuthorizerShape;

beforeAll(async () => {
  authorizer = await Effect.runPromise(
    makeImportAuthorizer(Redacted.make("test-import-token"))
  );
});

const makeHarness = (attempts: readonly DeterministicImportAttempt[] = []) => {
  const queue = makeDeterministicImportBatchQueue();
  const imports = makeDeterministicOrdinaryImportService({ attempts });
  const service = makeImportBatchService({
    concurrency: 2,
    imports: imports.service,
    newBatchId: () => {
      const id = batchIds[0];
      if (id === undefined) {
        throw new Error("Missing deterministic batch id");
      }
      return id;
    },
    newItemId: () => {
      const id = itemIds[0];
      if (id === undefined) {
        throw new Error("Missing deterministic batch item id");
      }
      return id;
    },
    now: () => timestamp,
    queue: queue.service,
  });
  const app = HttpRouter.toWebHandler(
    Layer.mergeAll(
      ImportBatchRoutes,
      Layer.succeed(ImportAuthorizer, ImportAuthorizer.of(authorizer)),
      Layer.succeed(ImportBatchService, ImportBatchService.of(service))
    ),
    { disableLogger: true }
  );
  return { app, imports, queue, service };
};

describe("provider-free import batch routes", () => {
  const apps: ReturnType<typeof makeHarness>["app"][] = [];

  afterAll(async () => {
    await Promise.all(apps.map(({ dispose }) => dispose()));
  });

  it("creates and polls an empty batch as an unambiguous completion", async () => {
    const harness = makeHarness();
    apps.push(harness.app);

    const created = await harness.app.handler(
      new Request("https://meal-planner.test/import-batches", {
        body: JSON.stringify({ items: [] }),
        headers: {
          authorization: "Bearer test-import-token",
          "content-type": "application/json",
          "idempotency-key": "batch-empty",
        },
        method: "POST",
      })
    );
    const polled = await harness.app.handler(
      new Request(
        `https://meal-planner.test/import-batches/${batchIds[0] ?? "missing"}`,
        { headers: { authorization: "Bearer test-import-token" } }
      )
    );

    expect(created.status).toBe(200);
    await expect(created.json()).resolves.toMatchObject({
      batch: {
        counts: { failed: 0, queued: 0, running: 0, succeeded: 0, total: 0 },
        id: batchIds[0],
        items: [],
        status: "completed",
      },
      disposition: "created",
    });
    expect(polled.status).toBe(200);
    await expect(polled.json()).resolves.toMatchObject({
      batch: { id: batchIds[0], status: "completed" },
    });
    expect(harness.queue.enqueued).toEqual([]);
    expect(harness.imports.calls).toEqual([]);
  });

  it("fans one item through the ordinary import service and exposes its stable identity", async () => {
    const harness = makeHarness([
      {
        idempotencyKey: "video-item",
        outcome: { _tag: "Success", import: videoImport },
      },
    ]);
    apps.push(harness.app);

    const created = await harness.app.handler(
      new Request("https://meal-planner.test/import-batches", {
        body: JSON.stringify({
          items: [
            {
              idempotencyKey: "video-item",
              source: {
                kind: "tiktok",
                url: "https://www.tiktok.com/@cook/video/7520000000000000001",
              },
            },
          ],
        }),
        headers: {
          authorization: "Bearer test-import-token",
          "content-type": "application/json",
          "idempotency-key": "batch-one",
        },
        method: "POST",
      })
    );

    expect(created.status).toBe(202);
    await expect(created.json()).resolves.toMatchObject({
      batch: {
        counts: { failed: 0, queued: 1, running: 0, succeeded: 0, total: 1 },
        status: "queued",
      },
      disposition: "created",
    });
    expect(harness.queue.enqueued).toEqual([
      { batchId: batchIds[0], itemId: itemIds[0] },
    ]);
    expect(JSON.stringify(harness.queue.enqueued)).not.toContain("tiktok.com");

    await Effect.runPromise(harness.service.consume(harness.queue.enqueued));
    const polled = await harness.app.handler(
      new Request(
        `https://meal-planner.test/import-batches/${batchIds[0] ?? "missing"}`,
        { headers: { authorization: "Bearer test-import-token" } }
      )
    );

    expect(polled.status).toBe(200);
    await expect(polled.json()).resolves.toMatchObject({
      batch: {
        counts: { failed: 0, queued: 0, running: 0, succeeded: 1, total: 1 },
        items: [
          {
            canonicalId,
            disposition: "created",
            id: itemIds[0],
            idempotencyKey: "video-item",
            importId: videoImport.id,
            status: "succeeded",
          },
        ],
        status: "completed",
      },
    });
    expect(harness.imports.calls).toHaveLength(1);
    expect(harness.imports.ordinaryImportsCreated).toBe(1);
    expect(harness.imports.evidenceWrites).toBe(5);
  });
});
