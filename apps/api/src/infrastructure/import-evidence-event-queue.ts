import * as Cloudflare from "alchemy/Cloudflare";
import { Effect, Stream } from "effect";

import { decodeSafeImportEvidenceEvent } from "../features/imports/import-evidence-event.js";

export const ImportEvidenceEventQueue = Cloudflare.Queues.Queue(
  "ImportEvidenceEventQueue"
);

/** R2 notifications are delivery evidence and cannot route household state. */
export default class ImportEvidenceEventWorker extends Cloudflare.Worker<ImportEvidenceEventWorker>()(
  "ImportEvidenceEventWorker",
  { main: import.meta.url, workersDev: false },
  Effect.gen(function* ImportEvidenceEventWorkerInit() {
    const queue = yield* ImportEvidenceEventQueue;
    yield* Cloudflare.Queues.consumeQueueMessages(
      queue,
      { batchSize: 10, maxConcurrency: 1, maxRetries: 3 },
      (messages) =>
        Stream.runForEach(messages, (message) =>
          decodeSafeImportEvidenceEvent(message.body).pipe(
            Effect.tap((event) =>
              Effect.logInfo("import evidence object event", event)
            ),
            // Poison events are acknowledged without logging their raw body.
            Effect.catch(() =>
              Effect.logWarning("rejected import evidence object event")
            )
          )
        )
    );
    return {};
  }).pipe(Effect.provide(Cloudflare.Queues.EventSourceLive))
) {}
