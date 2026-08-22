import { RuntimeContext } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect, Layer, Schema, Stream } from "effect";

import { HouseholdDomainWorker } from "../features/households/household-domain-binding.js";
import { HouseholdRecipeImportFailure } from "../features/households/recipe-import/household-recipe-import.contract.js";
import {
  ImportEvidenceEventFailure,
  reconcileImportEvidenceQueueMessage,
} from "../features/imports/import-evidence-event.js";
import { ImportEvidenceBucket } from "./import-evidence-bucket.js";

export const ImportEvidenceEventQueue = Cloudflare.Queues.Queue(
  "ImportEvidenceEventQueue"
);
export const ImportEvidenceEventRoutes = Cloudflare.KV.Namespace(
  "ImportEvidenceEventRoutes"
);

const dependencyFailure = () =>
  new ImportEvidenceEventFailure({
    reason: "dependency_unavailable",
    retryable: true,
  });

const householdFailure = (
  error: Schema.Schema.Type<typeof HouseholdRecipeImportFailure> | object
) =>
  Schema.is(HouseholdRecipeImportFailure)(error) &&
  error.reason !== "persistence_unavailable"
    ? new ImportEvidenceEventFailure({
        reason: "stale_event",
        retryable: false,
      })
    : dependencyFailure();

/** Private reconciliation Worker; logs only closed outcomes and safe reasons. */
export default class ImportEvidenceEventWorker extends Cloudflare.Worker<ImportEvidenceEventWorker>()(
  "ImportEvidenceEventWorker",
  { main: import.meta.url, workersDev: false },
  Effect.gen(function* ImportEvidenceEventWorkerInit() {
    const queue = yield* ImportEvidenceEventQueue;
    const routes = yield* Cloudflare.KV.ReadWriteNamespace(
      ImportEvidenceEventRoutes
    );
    const bucket = yield* Cloudflare.R2.ReadWriteBucket(ImportEvidenceBucket);
    const householdDomain = yield* Cloudflare.Workers.bindWorker(
      HouseholdDomainWorker
    );
    yield* Cloudflare.Queues.consumeQueueMessages(
      queue,
      { batchSize: 10, maxConcurrency: 1, maxRetries: 3 },
      (messages) =>
        Stream.runForEach(messages, (message) =>
          Effect.gen(function* reconcileImportEvidenceMessage() {
            const runtimeContext = yield* RuntimeContext;
            const provideRuntime = <A, E>(
              effect: Effect.Effect<A, E, RuntimeContext>
            ) =>
              effect.pipe(
                Effect.provideService(RuntimeContext, runtimeContext)
              );
            return yield* reconcileImportEvidenceQueueMessage(message.body, {
              bucket: {
                head: (key) =>
                  provideRuntime(bucket.head(key)).pipe(
                    Effect.mapError(dependencyFailure)
                  ),
              },
              household: {
                observeEvidenceReference: (input) =>
                  provideRuntime(
                    householdDomain.observeEvidenceReference(input)
                  ).pipe(Effect.mapError(householdFailure)),
                readEvidenceReferences: (input) =>
                  provideRuntime(
                    householdDomain.readEvidenceReferences(input)
                  ).pipe(Effect.mapError(householdFailure)),
              },
              routes: {
                get: (importId) =>
                  provideRuntime(routes.get(importId)).pipe(
                    Effect.mapError(dependencyFailure)
                  ),
                put: (importId, value) =>
                  provideRuntime(routes.put(importId, value)).pipe(
                    Effect.mapError(dependencyFailure)
                  ),
              },
            });
          }).pipe(
            Effect.tap((outcome) =>
              Effect.logInfo("import evidence event reconciled", outcome)
            ),
            Effect.catch((error) =>
              error.retryable
                ? Effect.fail(error)
                : Effect.logWarning("rejected import evidence object event", {
                    reason: error.reason,
                  })
            )
          )
        )
    );
    return {};
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        Cloudflare.Queues.EventSourceLive,
        Cloudflare.KV.ReadWriteNamespaceBinding,
        Cloudflare.R2.ReadWriteBucketBinding
      )
    )
  )
) {}
