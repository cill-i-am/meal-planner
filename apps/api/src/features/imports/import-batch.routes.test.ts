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

const batchId = decodeBatchId("018f47ad-91aa-7c35-b6fe-100000000001");
const itemIds = Array.from({ length: 50 }, (_, index) =>
  decodeBatchItemId(
    `018f47ad-91aa-7c35-b6fe-${String(200_000_000_001 + index).padStart(12, "0")}`
  )
);
const importIds = Array.from({ length: 50 }, (_, index) =>
  decodeImportId(
    `018f47ad-91aa-7c35-b6fe-${String(300_000_000_001 + index).padStart(12, "0")}`
  )
);
const timestamp = decodeTimestamp("2026-07-22T09:00:00.000Z");
const canonicalIds = Array.from({ length: 50 }, (_, index) =>
  decodeCanonicalId(String(7_520_000_000_000_000_001n + BigInt(index)))
);
const canonicalId = canonicalIds[0] ?? decodeCanonicalId("7520000000000000001");
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
const carouselImport = {
  createdAt: timestamp,
  evidence: [
    {
      kind: "carousel_evidence_manifest" as const,
      referenceId: "carousel-manifest",
    },
    { kind: "recipe_draft" as const, referenceId: "carousel-recipe" },
  ] as const,
  id: importIds[1] ?? decodeImportId("018f47ad-91aa-7c35-b6fe-300000000002"),
  source: {
    canonicalId: canonicalIds[1] ?? decodeCanonicalId("7520000000000000002"),
    kind: "tiktok" as const,
  },
  status: { kind: "needs_review" as const },
  updatedAt: timestamp,
};
const queuedImport = (index: number) => ({
  createdAt: timestamp,
  evidence: [] as const,
  id:
    importIds[index] ??
    decodeImportId(
      `018f47ad-91aa-7c35-b6fe-${String(300_000_000_001 + index).padStart(12, "0")}`
    ),
  source: {
    canonicalId:
      canonicalIds[index] ??
      decodeCanonicalId(String(7_520_000_000_000_000_001n + BigInt(index))),
    kind: "tiktok" as const,
  },
  status: { kind: "queued" as const },
  updatedAt: timestamp,
});

let authorizer: ImportAuthorizerShape;

beforeAll(async () => {
  authorizer = await Effect.runPromise(
    makeImportAuthorizer(Redacted.make("test-import-token"))
  );
});

const makeHarness = (
  attempts: readonly DeterministicImportAttempt[] = [],
  options: {
    readonly concurrency?: number;
    readonly importLatencyMilliseconds?: number;
  } = {}
) => {
  const queue = makeDeterministicImportBatchQueue();
  const imports = makeDeterministicOrdinaryImportService({
    attempts,
    ...(options.importLatencyMilliseconds === undefined
      ? {}
      : { latencyMilliseconds: options.importLatencyMilliseconds }),
  });
  let nextItemId = 0;
  const service = makeImportBatchService({
    concurrency: options.concurrency ?? 2,
    imports: imports.service,
    newBatchId: () => batchId,
    newItemId: () => {
      const id = itemIds[nextItemId];
      if (id === undefined) {
        throw new Error("Missing deterministic batch item id");
      }
      nextItemId += 1;
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
      new Request(`https://meal-planner.test/import-batches/${batchId}`, {
        headers: { authorization: "Bearer test-import-token" },
      })
    );

    expect(created.status).toBe(200);
    await expect(created.json()).resolves.toMatchObject({
      batch: {
        counts: { failed: 0, queued: 0, running: 0, succeeded: 0, total: 0 },
        id: batchId,
        items: [],
        status: "completed",
      },
      disposition: "created",
    });
    expect(polled.status).toBe(200);
    await expect(polled.json()).resolves.toMatchObject({
      batch: { id: batchId, status: "completed" },
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
    expect(harness.queue.enqueued).toEqual([{ batchId, itemId: itemIds[0] }]);
    expect(JSON.stringify(harness.queue.enqueued)).not.toContain("tiktok.com");

    await Effect.runPromise(harness.service.consume(harness.queue.enqueued));
    const polled = await harness.app.handler(
      new Request(`https://meal-planner.test/import-batches/${batchId}`, {
        headers: { authorization: "Bearer test-import-token" },
      })
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
            importStatus: { kind: "needs_review" },
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

  it("replays a completed batch without changing per-item identities or re-enqueueing", async () => {
    const harness = makeHarness([
      {
        idempotencyKey: "stable-video-item",
        outcome: { _tag: "Success", import: videoImport },
      },
    ]);
    apps.push(harness.app);
    const body = JSON.stringify({
      items: [
        {
          idempotencyKey: "stable-video-item",
          source: {
            kind: "tiktok",
            url: "https://www.tiktok.com/@cook/video/7520000000000000001",
          },
        },
      ],
    });
    const request = () =>
      new Request("https://meal-planner.test/import-batches", {
        body,
        headers: {
          authorization: "Bearer test-import-token",
          "content-type": "application/json",
          "idempotency-key": "stable-batch",
        },
        method: "POST",
      });

    const created = await harness.app.handler(request());
    await Effect.runPromise(harness.service.consume(harness.queue.enqueued));
    const replayed = await harness.app.handler(request());

    expect(created.status).toBe(202);
    expect(replayed.status).toBe(200);
    await expect(replayed.json()).resolves.toMatchObject({
      batch: {
        id: batchId,
        items: [
          {
            canonicalId,
            id: itemIds[0],
            idempotencyKey: "stable-video-item",
            importId: videoImport.id,
            importStatus: { kind: "needs_review" },
            status: "succeeded",
          },
        ],
      },
      disposition: "idempotency_replay",
    });
    expect(harness.queue.enqueued).toHaveLength(1);
    expect(harness.imports.calls).toEqual([
      {
        idempotencyKey: "stable-video-item",
        request: {
          source: {
            kind: "tiktok",
            url: "https://www.tiktok.com/@cook/video/7520000000000000001",
          },
        },
      },
    ]);
  });

  it("preserves video and carousel review successes when another item fails", async () => {
    const harness = makeHarness([
      {
        idempotencyKey: "mixed-video",
        outcome: { _tag: "Success", import: videoImport },
      },
      {
        idempotencyKey: "mixed-carousel",
        outcome: { _tag: "Success", import: carouselImport },
      },
      {
        idempotencyKey: "mixed-failure",
        outcome: {
          _tag: "Failure",
          error: { _tag: "SourceValidationUnavailable" },
        },
      },
    ]);
    apps.push(harness.app);
    const items = ["mixed-video", "mixed-carousel", "mixed-failure"].map(
      (idempotencyKey, index) => ({
        idempotencyKey,
        source: {
          kind: "tiktok",
          url: `https://www.tiktok.com/@cook/video/${7_520_000_000_000_000_010n + BigInt(index)}`,
        },
      })
    );

    const created = await harness.app.handler(
      new Request("https://meal-planner.test/import-batches", {
        body: JSON.stringify({ items }),
        headers: {
          authorization: "Bearer test-import-token",
          "content-type": "application/json",
          "idempotency-key": "mixed-batch",
        },
        method: "POST",
      })
    );
    expect(created.status).toBe(202);
    await Effect.runPromise(harness.service.consume(harness.queue.enqueued));

    const result = await Effect.runPromise(harness.service.get(batchId));
    expect(result.batch).toMatchObject({
      counts: { failed: 1, queued: 0, running: 0, succeeded: 2, total: 3 },
      items: [
        {
          canonicalId,
          importStatus: { kind: "needs_review" },
          status: "succeeded",
        },
        {
          canonicalId: carouselImport.source.canonicalId,
          importStatus: { kind: "needs_review" },
          status: "succeeded",
        },
        { code: "source_validation_unavailable", status: "failed" },
      ],
      status: "partial_failure",
    });
    expect(harness.imports.ordinaryImportsCreated).toBe(2);
    expect(harness.imports.evidenceWrites).toBe(7);
  });

  it("retries a failed item without duplicating its eventual import or evidence", async () => {
    const harness = makeHarness([
      {
        idempotencyKey: "retry-video",
        outcome: {
          _tag: "Failure",
          error: { _tag: "SourceValidationUnavailable" },
        },
      },
      {
        idempotencyKey: "retry-video",
        outcome: { _tag: "Success", import: videoImport },
      },
    ]);
    apps.push(harness.app);
    const response = await harness.app.handler(
      new Request("https://meal-planner.test/import-batches", {
        body: JSON.stringify({
          items: [
            {
              idempotencyKey: "retry-video",
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
          "idempotency-key": "retry-batch",
        },
        method: "POST",
      })
    );
    expect(response.status).toBe(202);

    await Effect.runPromise(harness.service.consume(harness.queue.enqueued));
    await expect(
      Effect.runPromise(harness.service.get(batchId))
    ).resolves.toMatchObject({
      batch: { counts: { failed: 1, succeeded: 0 }, status: "failed" },
    });
    await Effect.runPromise(harness.service.consume(harness.queue.enqueued));
    await Effect.runPromise(harness.service.consume(harness.queue.enqueued));

    await expect(
      Effect.runPromise(harness.service.get(batchId))
    ).resolves.toMatchObject({
      batch: {
        counts: { failed: 0, succeeded: 1 },
        items: [
          {
            canonicalId,
            idempotencyKey: "retry-video",
            importId: videoImport.id,
            importStatus: { kind: "needs_review" },
            status: "succeeded",
          },
        ],
        status: "completed",
      },
    });
    expect(harness.imports.calls).toHaveLength(2);
    expect(harness.imports.ordinaryImportsCreated).toBe(1);
    expect(harness.imports.evidenceWrites).toBe(5);
  });

  it.each([
    { concurrency: 1, expectedMaximum: 1 },
    { concurrency: 3, expectedMaximum: 3 },
  ])(
    "bounds ordinary imports at configured concurrency $concurrency",
    async ({ concurrency, expectedMaximum }) => {
      const attempts = Array.from({ length: 6 }, (_, index) => ({
        idempotencyKey: `concurrent-item-${index}`,
        outcome: { _tag: "Success" as const, import: queuedImport(index) },
      }));
      const harness = makeHarness(attempts, {
        concurrency,
        importLatencyMilliseconds: 5,
      });
      apps.push(harness.app);
      const items = attempts.map(({ idempotencyKey }, index) => ({
        idempotencyKey,
        source: {
          kind: "tiktok",
          url: `https://www.tiktok.com/@cook/video/${7_520_000_000_000_000_300n + BigInt(index)}`,
        },
      }));
      const response = await harness.app.handler(
        new Request("https://meal-planner.test/import-batches", {
          body: JSON.stringify({ items }),
          headers: {
            authorization: "Bearer test-import-token",
            "content-type": "application/json",
            "idempotency-key": `concurrency-${concurrency}`,
          },
          method: "POST",
        })
      );
      expect(response.status).toBe(202);

      await Effect.runPromise(harness.service.consume(harness.queue.enqueued));

      expect(harness.imports.maximumActiveCalls).toBe(expectedMaximum);
      const result = await Effect.runPromise(harness.service.get(batchId));
      expect(result.batch).toMatchObject({
        counts: { failed: 0, succeeded: 6, total: 6 },
        status: "completed",
      });
      expect(
        result.batch.items.every(
          (item) =>
            item.status === "succeeded" && item.importStatus.kind === "queued"
        )
      ).toBe(true);
    }
  );

  it("admits the boundary batch of 50 ordinary imports", async () => {
    const harness = makeHarness();
    apps.push(harness.app);
    const items = Array.from({ length: 50 }, (_, index) => ({
      idempotencyKey: `boundary-item-${index}`,
      source: {
        kind: "tiktok",
        url: `https://www.tiktok.com/@cook/video/${7_520_000_000_000_000_100n + BigInt(index)}`,
      },
    }));

    const response = await harness.app.handler(
      new Request("https://meal-planner.test/import-batches", {
        body: JSON.stringify({ items }),
        headers: {
          authorization: "Bearer test-import-token",
          "content-type": "application/json",
          "idempotency-key": "batch-boundary-50",
        },
        method: "POST",
      })
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      batch: {
        counts: { failed: 0, queued: 50, running: 0, succeeded: 0, total: 50 },
        status: "queued",
      },
    });
    expect(harness.queue.enqueued).toHaveLength(50);
  });

  it("rejects 51 items before any queue or ordinary-import call", async () => {
    const harness = makeHarness();
    apps.push(harness.app);
    const items = Array.from({ length: 51 }, (_, index) => ({
      idempotencyKey: `rejected-item-${index}`,
      source: {
        kind: "tiktok",
        url: `https://www.tiktok.com/@cook/video/${7_520_000_000_000_000_200n + BigInt(index)}`,
      },
    }));

    const response = await harness.app.handler(
      new Request("https://meal-planner.test/import-batches", {
        body: JSON.stringify({ items }),
        headers: {
          authorization: "Bearer test-import-token",
          "content-type": "application/json",
          "idempotency-key": "batch-rejected-51",
        },
        method: "POST",
      })
    );

    expect(response.status).toBe(400);
    expect(harness.queue.enqueued).toEqual([]);
    expect(harness.imports.calls).toEqual([]);
  });

  it("rejects duplicate per-item idempotency identities before fan-out", async () => {
    const harness = makeHarness();
    apps.push(harness.app);
    const response = await harness.app.handler(
      new Request("https://meal-planner.test/import-batches", {
        body: JSON.stringify({
          items: [
            {
              idempotencyKey: "duplicate-item-key",
              source: {
                kind: "tiktok",
                url: "https://www.tiktok.com/@cook/video/7520000000000000401",
              },
            },
            {
              idempotencyKey: "duplicate-item-key",
              source: {
                kind: "tiktok",
                url: "https://www.tiktok.com/@cook/video/7520000000000000402",
              },
            },
          ],
        }),
        headers: {
          authorization: "Bearer test-import-token",
          "content-type": "application/json",
          "idempotency-key": "duplicate-item-batch",
        },
        method: "POST",
      })
    );

    expect(response.status).toBe(400);
    expect(harness.queue.enqueued).toEqual([]);
    expect(harness.imports.calls).toEqual([]);
  });
});
