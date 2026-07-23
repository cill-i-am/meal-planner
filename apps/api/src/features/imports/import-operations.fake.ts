import { Effect, Schema } from "effect";

import type {
  ImportBatchItemFailureCode,
  ImportBatchItemId,
} from "./import-batch.contracts.js";
import {
  DeadLetterReplayClaimId,
  makeImportOperationsService,
} from "./import-operations.js";
import type {
  DeadLetterReplayClaimId as DeadLetterReplayClaimIdType,
  DeadLetterInspection,
  DeadLetterNotFound,
  DeadLetterReplayClaim,
  DeadLetterReplayInProgress,
  DeadLetterStoreShape,
  ExpirableImportArtifact,
  ExpirableArtifactStoreShape,
  OperationalCorrelation,
  OperationalEvent,
  OperationalEventSinkShape,
} from "./import-operations.js";
import type {
  CreateImportRequest,
  IdempotencyKey,
  ImportView,
} from "./import.contracts.js";
import type { ImportServiceShape } from "./import.service.js";

/** Sensitive fake-only fields deliberately excluded from all safe projections. */
export interface ProviderFreeDeadLetterDiagnostics {
  readonly localPath: string;
  readonly media: Uint8Array;
  readonly providerPayload: unknown;
  readonly token: string;
}

/** Seed for one provider-free dead-letter record behind the adapter boundary. */
export interface ProviderFreeDeadLetter {
  readonly code: ImportBatchItemFailureCode;
  readonly correlation: OperationalCorrelation;
  readonly diagnostics: ProviderFreeDeadLetterDiagnostics;
  readonly idempotencyKey: IdempotencyKey;
  readonly itemId: ImportBatchItemId;
  readonly request: CreateImportRequest;
}

interface StoredDeadLetter {
  claimId?: DeadLetterReplayClaimIdType;
  readonly seed: ProviderFreeDeadLetter;
  state: "claimed" | "ready" | "replayed";
  imported?: ImportView;
}

const missing = (itemId: ImportBatchItemId): DeadLetterNotFound => ({
  _tag: "DeadLetterNotFound",
  itemId,
});

/** Build the deterministic in-memory adapters for the operational tracer. */
export const makeProviderFreeOperationalTracer = (input: {
  readonly artifacts: readonly ExpirableImportArtifact[];
  readonly deadLetters: readonly ProviderFreeDeadLetter[];
  readonly eventFailureTag?: OperationalEvent["_tag"];
  readonly imports: ImportServiceShape;
  readonly replayQuotaLimit: number;
}) => {
  const artifacts = [...input.artifacts];
  const events: OperationalEvent[] = [];
  const deadLetters = new Map<ImportBatchItemId, StoredDeadLetter>(
    input.deadLetters.map((seed) => [seed.itemId, { seed, state: "ready" }])
  );
  let claimCount = 0;
  let completedReplayCount = 0;
  let inspectionCount = 0;
  let releaseCount = 0;
  const artifactStore: ExpirableArtifactStoreShape = {
    expireDue: (cutoffEpochMilliseconds) =>
      Effect.sync(() => {
        const expired = artifacts.filter(
          ({ expiresAtEpochMilliseconds }) =>
            expiresAtEpochMilliseconds <= cutoffEpochMilliseconds
        );
        const retained = artifacts.filter(
          ({ expiresAtEpochMilliseconds }) =>
            expiresAtEpochMilliseconds > cutoffEpochMilliseconds
        );
        artifacts.splice(0, artifacts.length, ...retained);
        return expired;
      }),
  };
  const eventSink: OperationalEventSinkShape = {
    emit: (event) =>
      Effect.sync(() => {
        events.push(event);
        if (event._tag === input.eventFailureTag) {
          throw new Error("Synthetic operational event failure");
        }
      }),
  };
  const deadLetterStore: DeadLetterStoreShape = {
    claimReplay: (itemId) =>
      Effect.suspend<
        DeadLetterReplayClaim,
        DeadLetterNotFound | DeadLetterReplayInProgress,
        never
      >(() => {
        const stored = deadLetters.get(itemId);
        if (stored === undefined) {
          return Effect.fail(missing(itemId));
        }
        if (stored.state === "claimed") {
          return Effect.fail({
            _tag: "DeadLetterReplayInProgress",
            itemId,
          });
        }
        claimCount += 1;
        if (stored.state === "replayed") {
          if (stored.imported === undefined) {
            return Effect.die("Completed dead letter is missing its import");
          }
          return Effect.succeed({
            _tag: "AlreadyReplayed",
            correlation: stored.seed.correlation,
            import: stored.imported,
          });
        }
        stored.state = "claimed";
        stored.claimId = Schema.decodeUnknownSync(DeadLetterReplayClaimId)(
          crypto.randomUUID()
        );
        return Effect.succeed({
          _tag: "Ready",
          claimId: stored.claimId,
          correlation: stored.seed.correlation,
          idempotencyKey: stored.seed.idempotencyKey,
          request: stored.seed.request,
        });
      }),
    completeReplay: (itemId, claimId, imported) =>
      Effect.suspend(() => {
        const stored = deadLetters.get(itemId);
        if (
          stored === undefined ||
          stored.state !== "claimed" ||
          stored.claimId !== claimId
        ) {
          return Effect.fail({
            _tag: "DeadLetterReplayInProgress",
            itemId,
          });
        }
        stored.imported = imported;
        stored.state = "replayed";
        completedReplayCount += 1;
        return Effect.void;
      }),
    inspect: (itemId) =>
      Effect.suspend<DeadLetterInspection, DeadLetterNotFound, never>(() => {
        const stored = deadLetters.get(itemId);
        if (stored === undefined) {
          return Effect.fail(missing(itemId));
        }
        inspectionCount += 1;
        return Effect.succeed({
          code: stored.seed.code,
          correlation: stored.seed.correlation,
          itemId,
        });
      }),
    releaseReplay: (itemId, claimId) =>
      Effect.sync(() => {
        releaseCount += 1;
        const stored = deadLetters.get(itemId);
        if (stored?.state === "claimed" && stored.claimId === claimId) {
          delete stored.claimId;
          stored.state = "ready";
        }
      }),
  };

  return {
    artifacts,
    deadLetterStats: {
      get claimCount() {
        return claimCount;
      },
      get completedReplayCount() {
        return completedReplayCount;
      },
      get inspectionCount() {
        return inspectionCount;
      },
      get releaseCount() {
        return releaseCount;
      },
    },
    events,
    service: makeImportOperationsService({
      artifacts: artifactStore,
      deadLetters: deadLetterStore,
      events: eventSink,
      imports: input.imports,
      replayQuotaLimit: input.replayQuotaLimit,
    }),
  };
};
