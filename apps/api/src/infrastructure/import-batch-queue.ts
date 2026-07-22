import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

import type { ImportBatchQueueShape } from "../features/imports/import-batch.service.js";

/** Primary staging queue for ID-only import batch work. */
export const ImportBatchQueue = Cloudflare.Queues.Queue("ImportBatchQueue");

/** Isolated staging queue reserved for exhausted import batch deliveries. */
export const ImportBatchDeadLetterQueue = Cloudflare.Queues.Queue(
  "ImportBatchDeadLetterQueue"
);

interface ImportBatchQueueSender {
  readonly sendBatch: (
    messages: ReadonlyArray<{
      readonly body: unknown;
      readonly contentType: "json";
    }>
  ) => Promise<void>;
}

/** Adapt a Cloudflare queue sender to the provider-neutral batch queue seam. */
export const makeCloudflareImportBatchQueue = (
  sender: ImportBatchQueueSender
): ImportBatchQueueShape => ({
  enqueue: (messages) =>
    Effect.tryPromise({
      catch: (): { readonly _tag: "ImportBatchQueueUnavailable" } => ({
        _tag: "ImportBatchQueueUnavailable",
      }),
      try: () =>
        sender.sendBatch(
          messages.map((body) => ({ body, contentType: "json" }))
        ),
    }),
});
