import * as Cloudflare from "alchemy/Cloudflare";
import { Effect, Layer } from "effect";

import { HouseholdImportBatchQueue } from "../../../infrastructure/household-import-batch-queue.js";
import {
  HouseholdImportBatchQueueSendAmbiguous,
  HouseholdImportBatchQueueWriter,
} from "./household-import-batch-queue.port.js";

export const HouseholdImportBatchQueueWriterLive = Layer.effect(
  HouseholdImportBatchQueueWriter,
  Effect.gen(function* makeHouseholdImportBatchQueueWriter() {
    const queue = yield* HouseholdImportBatchQueue;
    const writer = yield* Cloudflare.Queues.WriteQueue(queue);
    return {
      send: (message) =>
        writer
          .send(message)
          .pipe(
            Effect.mapError(() => new HouseholdImportBatchQueueSendAmbiguous())
          ),
    };
  })
);
