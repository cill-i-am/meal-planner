import { Effect } from "effect";

import type { ImportBatchQueueMessage } from "./import-batch.contracts.js";
import type { ImportBatchQueueShape } from "./import-batch.service.js";

/** Deterministic provider-free queue that records stable ID-only messages. */
export const makeDeterministicImportBatchQueue = (): {
  readonly enqueued: ImportBatchQueueMessage[];
  readonly service: ImportBatchQueueShape;
} => {
  const enqueued: ImportBatchQueueMessage[] = [];
  return {
    enqueued,
    service: {
      enqueue: (messages) =>
        Effect.sync(() => {
          enqueued.push(...messages);
        }),
    },
  };
};
