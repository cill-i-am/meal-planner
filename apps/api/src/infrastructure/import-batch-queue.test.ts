import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { ImportBatchQueueMessage } from "../features/imports/import-batch.contracts.js";
import { makeCloudflareImportBatchQueue } from "./import-batch-queue.js";

describe("Cloudflare import batch queue adapter", () => {
  it("sends only stable batch and item identifiers", async () => {
    const sent: unknown[] = [];
    const queue = makeCloudflareImportBatchQueue({
      sendBatch: (messages) => {
        sent.push(...messages);
        return Promise.resolve();
      },
    });
    const message = Schema.decodeUnknownSync(ImportBatchQueueMessage)({
      batchId: "018f47ad-91aa-7c35-b6fe-000000000501",
      itemId: "018f47ad-91aa-7c35-b6fe-000000000601",
    });

    await Effect.runPromise(queue.enqueue([message]));

    expect(sent).toEqual([{ body: message, contentType: "json" }]);
    expect(JSON.stringify(sent)).not.toMatch(/url|source|token|payload/iu);
  });

  it("maps provider failures to the safe queue error contract", async () => {
    const queue = makeCloudflareImportBatchQueue({
      sendBatch: () => Promise.reject(new Error("provider detail")),
    });

    const error = await Effect.runPromise(Effect.flip(queue.enqueue([])));

    expect(error).toEqual({ _tag: "ImportBatchQueueUnavailable" });
    expect(error).not.toHaveProperty("cause");
  });
});
