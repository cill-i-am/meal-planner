import { Effect, Schema } from "effect";

import {
  ImportEvidenceEventFailure,
  ImportEvidenceRoute,
  reconcileImportEvidenceQueueMessage,
} from "./import-evidence-event.js";

interface TestKvNamespace {
  readonly get: (key: string) => Promise<string | null>;
  readonly put: (key: string, value: string) => Promise<void>;
}

interface TestMessageBatch {
  readonly messages: readonly {
    readonly ack: () => void;
    readonly body: unknown;
    readonly retry: () => void;
  }[];
}

interface Environment {
  readonly RESULTS: TestKvNamespace;
  readonly ROUTES: TestKvNamespace;
}

const importId = "018f7f67-e0c7-7d34-a593-8c20c6f7b868";
const organizationId = "organization-event-reconciliation-proof";
const objectKey = `imports/${importId}/acquisition/v1/generations/4/manifest.json`;
const manifestHash = "8".repeat(64);

const dependencyFailure = () =>
  new ImportEvidenceEventFailure({
    reason: "dependency_unavailable",
    retryable: true,
  });

export default {
  async queue(batch: TestMessageBatch, environment: Environment) {
    await Promise.all(
      batch.messages.map(async (message) => {
        const reconciled = reconcileImportEvidenceQueueMessage(message.body, {
          bucket: { head: () => Effect.succeed(null) },
          household: {
            observeEvidenceReference: (input) =>
              input.admission.organizationId === organizationId &&
              input.intentId === importId &&
              input.expectedGeneration === 4 &&
              input.reference.key === objectKey &&
              input.reference.sha256 === manifestHash
                ? Effect.succeed({
                    availability: input.availability,
                    committedAt: "2026-08-22T12:00:01.000Z",
                    executionGeneration: 4,
                    intentId: importId,
                    kind: "acquisition_manifest" as const,
                    observationOrdinal: 1,
                    outcome: "Applied" as const,
                    receiptVersion: 1 as const,
                  })
                : Effect.fail(
                    new ImportEvidenceEventFailure({
                      reason: "stale_event",
                      retryable: false,
                    })
                  ),
            readEvidenceReferences: (input) =>
              input.admission.organizationId === organizationId &&
              input.intentId === importId &&
              input.expectedGeneration === 4
                ? Effect.succeed({
                    committedAt: "2026-08-22T11:59:00.000Z",
                    executionGeneration: 4,
                    intentId: importId,
                    references: [
                      {
                        availability: "available" as const,
                        byteLength: 4096,
                        deleteAt: "2026-08-29T11:59:00.000Z",
                        key: `imports/${importId}/acquisition/v1/generations/4/original.mp4`,
                        kind: "original_media" as const,
                        observationOrdinal: 0,
                        sha256: "7".repeat(64),
                      },
                      {
                        availability: "available" as const,
                        byteLength: 512,
                        deleteAt: "2026-08-29T11:59:00.000Z",
                        key: objectKey,
                        kind: "acquisition_manifest" as const,
                        observationOrdinal: 0,
                        sha256: manifestHash,
                      },
                    ],
                  })
                : Effect.fail(
                    new ImportEvidenceEventFailure({
                      reason: "stale_event",
                      retryable: false,
                    })
                  ),
          },
          routes: {
            get: (key) =>
              Effect.promise(() => environment.ROUTES.get(key)).pipe(
                Effect.mapError(dependencyFailure),
                Effect.flatMap((value) =>
                  value === null
                    ? Effect.succeed(null)
                    : Effect.try({
                        catch: dependencyFailure,
                        try: () => JSON.parse(value),
                      }).pipe(
                        Effect.flatMap(
                          Schema.decodeUnknownEffect(ImportEvidenceRoute)
                        ),
                        Effect.mapError(dependencyFailure)
                      )
                )
              ),
          },
        });
        const outcome = await Effect.runPromise(
          reconciled.pipe(
            Effect.map((value) => ({ _tag: "Accepted" as const, value })),
            Effect.catch((error) =>
              Effect.succeed({
                _tag: "Rejected" as const,
                reason: error.reason,
                retryable: error.retryable,
              })
            )
          )
        );
        await environment.RESULTS.put("last", JSON.stringify(outcome));
        if (outcome._tag === "Rejected" && outcome.retryable) {
          message.retry();
        } else {
          message.ack();
        }
      })
    );
  },
};
