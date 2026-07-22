import { Clock, Effect, Schema } from "effect";

import { MealPlanDraftId } from "../meal-planning/meal-plan.js";
import {
  ImportBatchId,
  ImportBatchItemFailureCode,
  ImportBatchItemId,
} from "./import-batch.contracts.js";
import { RecipeReviewerActorId } from "./import-recipe-review.js";
import type {
  CreateImportRequest,
  IdempotencyKey,
} from "./import.contracts.js";
import {
  EvidenceReference,
  ImportId,
  ImportTimestamp,
  ImportView,
} from "./import.contracts.js";
import type { CreateImportError } from "./import.errors.js";
import type { ImportServiceShape } from "./import.service.js";

const NonNegativeEpochMilliseconds = Schema.Number.pipe(
  Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
);

/** One transient import artifact governed by the retention sweep. */
export const ExpirableImportArtifact = Schema.Struct({
  evidence: EvidenceReference,
  expiresAtEpochMilliseconds: NonNegativeEpochMilliseconds,
  importId: ImportId,
});
/** One transient import artifact governed by the retention sweep. */
export type ExpirableImportArtifact = typeof ExpirableImportArtifact.Type;

/** Durable identifiers shared by every event in one operational tracer. */
export const OperationalScope = Schema.Struct({
  batchId: ImportBatchId,
  mealPlanId: MealPlanDraftId,
  recipeId: ImportId,
});
/** Durable identifiers shared by every event in one operational tracer. */
export type OperationalScope = typeof OperationalScope.Type;

/** Privacy-safe identifiers shared by operational events. */
export const OperationalCorrelation = Schema.Struct({
  ...OperationalScope.fields,
  evidence: EvidenceReference,
  importId: ImportId,
});
/** Privacy-safe identifiers shared by operational events. */
export type OperationalCorrelation = typeof OperationalCorrelation.Type;

/** Caller identity and privilege used by the fake operational boundary. */
export const OperationalPrincipal = Schema.Struct({
  actorId: RecipeReviewerActorId,
  role: Schema.Literals(["operator", "viewer"]),
});
/** Caller identity and privilege used by the fake operational boundary. */
export type OperationalPrincipal = typeof OperationalPrincipal.Type;

const ReplayQuotaUnits = Schema.Number.pipe(
  Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
);

/** Safe request envelope for privileged dead-letter inspection. */
export const InspectDeadLetterRequest = Schema.Struct({
  correlation: OperationalCorrelation,
  itemId: ImportBatchItemId,
  principal: OperationalPrincipal,
});
/** Safe request envelope for privileged dead-letter inspection. */
export type InspectDeadLetterRequest = typeof InspectDeadLetterRequest.Type;

/** Safe request envelope for one bounded dead-letter replay. */
export const ReplayDeadLetterRequest = Schema.Struct({
  ...InspectDeadLetterRequest.fields,
  quotaUnits: ReplayQuotaUnits,
});
/** Safe request envelope for one bounded dead-letter replay. */
export type ReplayDeadLetterRequest = typeof ReplayDeadLetterRequest.Type;

/** Privacy-safe projection of one failed import batch item. */
export const DeadLetterInspection = Schema.Struct({
  code: ImportBatchItemFailureCode,
  correlation: OperationalCorrelation,
  itemId: ImportBatchItemId,
});
/** Privacy-safe projection of one failed import batch item. */
export type DeadLetterInspection = typeof DeadLetterInspection.Type;

/** Result of replaying, or re-requesting replay of, one dead letter. */
export const ReplayDeadLetterResult = Schema.Struct({
  disposition: Schema.Literals(["already_replayed", "replayed"]),
  import: ImportView,
});
/** Result of replaying, or re-requesting replay of, one dead letter. */
export type ReplayDeadLetterResult = typeof ReplayDeadLetterResult.Type;

const ArtifactsExpiredEvent = Schema.Struct({
  _tag: Schema.Literal("ArtifactsExpired"),
  correlation: OperationalCorrelation,
  occurredAt: ImportTimestamp,
});

const DeadLetterInspectedEvent = Schema.Struct({
  _tag: Schema.Literal("DeadLetterInspected"),
  actorId: RecipeReviewerActorId,
  code: ImportBatchItemFailureCode,
  correlation: OperationalCorrelation,
  itemId: ImportBatchItemId,
  occurredAt: ImportTimestamp,
});

const DeadLetterReplayDeniedEvent = Schema.Struct({
  _tag: Schema.Literal("DeadLetterReplayDenied"),
  actorId: RecipeReviewerActorId,
  correlation: OperationalCorrelation,
  itemId: ImportBatchItemId,
  occurredAt: ImportTimestamp,
  operation: Schema.Literals(["inspect", "replay"]),
  reason: Schema.Literal("insufficient_role"),
});

const DeadLetterReplayQuotaRejectedEvent = Schema.Struct({
  _tag: Schema.Literal("DeadLetterReplayQuotaRejected"),
  actorId: RecipeReviewerActorId,
  correlation: OperationalCorrelation,
  itemId: ImportBatchItemId,
  limit: ReplayQuotaUnits,
  occurredAt: ImportTimestamp,
  requested: ReplayQuotaUnits,
});

const DeadLetterReplayedEvent = Schema.Struct({
  _tag: Schema.Literal("DeadLetterReplayed"),
  actorId: RecipeReviewerActorId,
  correlation: OperationalCorrelation,
  itemId: ImportBatchItemId,
  occurredAt: ImportTimestamp,
});

/** Closed privacy-safe event contract for provider-free operations. */
export const OperationalEvent = Schema.Union([
  ArtifactsExpiredEvent,
  DeadLetterInspectedEvent,
  DeadLetterReplayDeniedEvent,
  DeadLetterReplayQuotaRejectedEvent,
  DeadLetterReplayedEvent,
]);
/** Closed privacy-safe event contract for provider-free operations. */
export type OperationalEvent = typeof OperationalEvent.Type;

/** Result of one retention pass at the active Effect clock instant. */
export const RetentionSweepResult = Schema.Struct({
  expired: Schema.Array(ExpirableImportArtifact),
});
/** Result of one retention pass at the active Effect clock instant. */
export type RetentionSweepResult = typeof RetentionSweepResult.Type;

/** Artifact persistence seam used by the provider-free retention service. */
export interface ExpirableArtifactStoreShape {
  readonly expireDue: (
    cutoffEpochMilliseconds: number
  ) => Effect.Effect<readonly ExpirableImportArtifact[]>;
}

/** Structured event sink that only accepts the safe event union. */
export interface OperationalEventSinkShape {
  readonly emit: (event: OperationalEvent) => Effect.Effect<void>;
}

/** The caller is not privileged to inspect or replay dead letters. */
export interface DeadLetterAccessDenied {
  readonly _tag: "DeadLetterAccessDenied";
  readonly itemId: ImportBatchItemId;
}

/** The requested provider-free dead-letter item does not exist. */
export interface DeadLetterNotFound {
  readonly _tag: "DeadLetterNotFound";
  readonly itemId: ImportBatchItemId;
}

/** Another caller already owns the in-memory replay claim. */
export interface DeadLetterReplayInProgress {
  readonly _tag: "DeadLetterReplayInProgress";
  readonly itemId: ImportBatchItemId;
}

/** Replay work exceeded the one configured operational quota. */
export interface DeadLetterReplayQuotaExceeded {
  readonly _tag: "DeadLetterReplayQuotaExceeded";
  readonly itemId: ImportBatchItemId;
  readonly limit: number;
  readonly requested: number;
}

/** Expected failures from privileged dead-letter inspection. */
export type InspectDeadLetterError =
  | DeadLetterAccessDenied
  | DeadLetterNotFound;

/** Expected failures from privileged dead-letter replay. */
export type ReplayDeadLetterError =
  | CreateImportError
  | DeadLetterAccessDenied
  | DeadLetterNotFound
  | DeadLetterReplayInProgress
  | DeadLetterReplayQuotaExceeded;

/** Atomic replay state returned by the provider-free dead-letter store. */
export type DeadLetterReplayClaim =
  | {
      readonly _tag: "AlreadyReplayed";
      readonly import: ImportView;
    }
  | {
      readonly _tag: "Ready";
      readonly idempotencyKey: IdempotencyKey;
      readonly request: CreateImportRequest;
    };

/** Persistence seam for safe inspection and atomic replay claims. */
export interface DeadLetterStoreShape {
  readonly claimReplay: (
    itemId: ImportBatchItemId
  ) => Effect.Effect<
    DeadLetterReplayClaim,
    DeadLetterNotFound | DeadLetterReplayInProgress
  >;
  readonly completeReplay: (
    itemId: ImportBatchItemId,
    imported: ImportView
  ) => Effect.Effect<void>;
  readonly inspect: (
    itemId: ImportBatchItemId
  ) => Effect.Effect<DeadLetterInspection, DeadLetterNotFound>;
  readonly releaseReplay: (itemId: ImportBatchItemId) => Effect.Effect<void>;
}

/** Application interface for the bounded operational tracer. */
export interface ImportOperationsServiceShape {
  readonly expireArtifacts: (
    scope: OperationalScope
  ) => Effect.Effect<RetentionSweepResult>;
  readonly inspectDeadLetter: (
    request: InspectDeadLetterRequest
  ) => Effect.Effect<DeadLetterInspection, InspectDeadLetterError>;
  readonly replayDeadLetter: (
    request: ReplayDeadLetterRequest
  ) => Effect.Effect<ReplayDeadLetterResult, ReplayDeadLetterError>;
}

const timestampFromEpochMilliseconds = (value: number) =>
  Schema.decodeUnknownSync(ImportTimestamp)(new Date(value).toISOString());

/** Build the bounded provider-free import operations service. */
export const makeImportOperationsService = (input: {
  readonly artifacts: ExpirableArtifactStoreShape;
  readonly deadLetters: DeadLetterStoreShape;
  readonly events: OperationalEventSinkShape;
  readonly imports: ImportServiceShape;
  readonly replayQuotaLimit: number;
}): ImportOperationsServiceShape => ({
  expireArtifacts: Effect.fn("ImportOperations.expireArtifacts")(
    function* expireArtifacts(scope) {
      const cutoff = yield* Clock.currentTimeMillis;
      const expired = yield* input.artifacts.expireDue(cutoff);
      const occurredAt = timestampFromEpochMilliseconds(cutoff);
      yield* Effect.forEach(
        expired,
        (artifact) =>
          input.events.emit({
            _tag: "ArtifactsExpired",
            correlation: {
              ...scope,
              evidence: artifact.evidence,
              importId: artifact.importId,
            },
            occurredAt,
          }),
        { discard: true }
      );
      return { expired };
    }
  ),
  inspectDeadLetter: Effect.fn("ImportOperations.inspectDeadLetter")(
    function* inspectDeadLetter(request) {
      const occurredAt = timestampFromEpochMilliseconds(
        yield* Clock.currentTimeMillis
      );
      if (request.principal.role !== "operator") {
        yield* input.events.emit({
          _tag: "DeadLetterReplayDenied",
          actorId: request.principal.actorId,
          correlation: request.correlation,
          itemId: request.itemId,
          occurredAt,
          operation: "inspect",
          reason: "insufficient_role",
        });
        return yield* Effect.fail<DeadLetterAccessDenied>({
          _tag: "DeadLetterAccessDenied",
          itemId: request.itemId,
        });
      }
      const inspection = yield* input.deadLetters.inspect(request.itemId);
      yield* input.events.emit({
        _tag: "DeadLetterInspected",
        actorId: request.principal.actorId,
        code: inspection.code,
        correlation: inspection.correlation,
        itemId: inspection.itemId,
        occurredAt,
      });
      return inspection;
    }
  ),
  replayDeadLetter: Effect.fn("ImportOperations.replayDeadLetter")(
    function* replayDeadLetter(request) {
      const occurredAt = timestampFromEpochMilliseconds(
        yield* Clock.currentTimeMillis
      );
      if (request.principal.role !== "operator") {
        yield* input.events.emit({
          _tag: "DeadLetterReplayDenied",
          actorId: request.principal.actorId,
          correlation: request.correlation,
          itemId: request.itemId,
          occurredAt,
          operation: "replay",
          reason: "insufficient_role",
        });
        return yield* Effect.fail<DeadLetterAccessDenied>({
          _tag: "DeadLetterAccessDenied",
          itemId: request.itemId,
        });
      }
      if (request.quotaUnits > input.replayQuotaLimit) {
        yield* input.events.emit({
          _tag: "DeadLetterReplayQuotaRejected",
          actorId: request.principal.actorId,
          correlation: request.correlation,
          itemId: request.itemId,
          limit: input.replayQuotaLimit,
          occurredAt,
          requested: request.quotaUnits,
        });
        return yield* Effect.fail<DeadLetterReplayQuotaExceeded>({
          _tag: "DeadLetterReplayQuotaExceeded",
          itemId: request.itemId,
          limit: input.replayQuotaLimit,
          requested: request.quotaUnits,
        });
      }
      const claim = yield* input.deadLetters.claimReplay(request.itemId);
      if (claim._tag === "AlreadyReplayed") {
        return {
          disposition: "already_replayed" as const,
          import: claim.import,
        };
      }
      const result = yield* input.imports
        .create(claim.request, claim.idempotencyKey)
        .pipe(
          Effect.tapError(() => input.deadLetters.releaseReplay(request.itemId))
        );
      yield* input.deadLetters.completeReplay(request.itemId, result.import);
      yield* input.events.emit({
        _tag: "DeadLetterReplayed",
        actorId: request.principal.actorId,
        correlation: request.correlation,
        itemId: request.itemId,
        occurredAt,
      });
      return { disposition: "replayed" as const, import: result.import };
    }
  ),
});
