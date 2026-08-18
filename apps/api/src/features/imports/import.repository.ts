import { Instant, RecipeImportIntentId } from "@meal-planner/recipe-import-api";
import type {
  CanonicalTikTokUrl,
  RecipeImportIntent,
  RecipeImportTimeline,
  SourceUrl,
} from "@meal-planner/recipe-import-api";
import type { Effect, Option } from "effect";
import { Context, Schema } from "effect";

import type {
  ImportIntentTransitionCommand,
  ImportIntentTransitionMutationConflict,
  ImportIntentTransitionOutcome,
} from "./import-intent-transition.js";
import { ImportIntentExecutionGeneration } from "./import-intent-transition.js";
import type {
  CancelImportIntentCommand,
  ImportPrincipal,
  RecipeImportIntentIdempotencyConflict,
  RecipeImportIntentNotFound,
  RecipeImportIntentRedirected,
  RecipeImportIntentTransitionRejected,
  RecipeImportIntentVersionConflict,
} from "./import-intent.js";
import type {
  AcquisitionGeneration,
  ClassifiedAcquisitionFailure,
  VerifiedAcquisitionEvidence,
} from "./import-media.model.js";
import { ImportTraceContext } from "./import-observability.js";
import type {
  ImportId,
  ImportTimestamp,
  ImportView,
  SourceCanonicalId,
} from "./import.contracts.js";
import type {
  ImportPersistenceCorrupt,
  ImportPersistenceUnavailable,
  ImportNotFound,
  ImportTransitionRejected,
} from "./import.errors.js";

const Sha256Hex = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-f\d]{64}$/u))
);

export const IdempotencyKeyHash = Sha256Hex.pipe(
  Schema.brand("IdempotencyKeyHash")
);
export type IdempotencyKeyHash = typeof IdempotencyKeyHash.Type;

export const RequestFingerprint = Sha256Hex.pipe(
  Schema.brand("RequestFingerprint")
);
export type RequestFingerprint = typeof RequestFingerprint.Type;

export const SourceLocatorHash = Sha256Hex.pipe(
  Schema.brand("SourceLocatorHash")
);
export type SourceLocatorHash = typeof SourceLocatorHash.Type;

export interface StoredImport {
  readonly acquisitionGeneration: AcquisitionGeneration;
  readonly canonicalSourceId: SourceCanonicalId;
  readonly sourceKind: "tiktok";
  readonly trace: ImportTraceContext;
  readonly view: ImportView;
}

export interface StoredImportIntentRequest {
  readonly idempotencyKeyHash: IdempotencyKeyHash;
  readonly intent: RecipeImportIntent;
  readonly requestFingerprint: RequestFingerprint;
}

export interface AdmitImportIntentCommand {
  readonly createdAt: Instant;
  readonly idempotencyKeyHash: IdempotencyKeyHash;
  readonly intentId: RecipeImportIntentId;
  readonly principal: ImportPrincipal;
  readonly requestFingerprint: RequestFingerprint;
  readonly sourceLocatorHash: SourceLocatorHash;
  readonly submittedSourceUrl: SourceUrl;
  readonly trace: ImportTraceContext;
}

export interface AdmitImportIntentResult {
  readonly disposition: "created" | "idempotency_replay";
  readonly intent: RecipeImportIntent;
}

export interface CancelImportIntentResult {
  readonly disposition: "applied" | "replayed";
  readonly intent: RecipeImportIntent;
}

export interface ResolveImportIntentSourceCommand {
  readonly canonicalSourceId: SourceCanonicalId;
  readonly canonicalUrl: CanonicalTikTokUrl;
  readonly commandDigest: ImportIntentTransitionCommand["commandDigest"];
  readonly intentId: RecipeImportIntentId;
  readonly mutationId: ImportIntentTransitionCommand["mutationId"];
  readonly resolvedAt: Instant;
  readonly sourceKind: "video" | "carousel";
}

export type ResolveImportIntentSourceResult =
  | {
      readonly _tag: "Owner";
      readonly disposition: "claimed" | "replayed";
      readonly executionGeneration: ImportIntentTransitionCommand["executionGeneration"];
      readonly intent: RecipeImportIntent;
    }
  | {
      readonly _tag: "Redirected";
      readonly disposition: "redirected" | "replayed";
      readonly intent: RecipeImportIntent;
    }
  | {
      readonly _tag: "NoStart";
      readonly disposition: "replayed";
      readonly intent: RecipeImportIntent;
    };

export type ImportIntentRepositoryError =
  | ImportPersistenceCorrupt
  | ImportPersistenceUnavailable
  | ImportIntentTransitionMutationConflict
  | RecipeImportIntentIdempotencyConflict
  | RecipeImportIntentNotFound
  | RecipeImportIntentRedirected
  | RecipeImportIntentTransitionRejected;

export const StalledImportIntentStartLimit = Schema.Int.pipe(
  Schema.check(
    Schema.isGreaterThanOrEqualTo(1),
    Schema.isLessThanOrEqualTo(100)
  ),
  Schema.brand("StalledImportIntentStartLimit")
);
export type StalledImportIntentStartLimit =
  typeof StalledImportIntentStartLimit.Type;

export const StalledImportIntentStartCandidate = Schema.Struct({
  executionGeneration: ImportIntentExecutionGeneration,
  intentId: RecipeImportIntentId,
  trace: ImportTraceContext,
  updatedAt: Instant,
});
export type StalledImportIntentStartCandidate =
  typeof StalledImportIntentStartCandidate.Type;

export interface PendingImportIntentSourceResolution {
  readonly executionGeneration: ImportIntentExecutionGeneration;
  readonly intentId: RecipeImportIntentId;
  readonly principal: ImportPrincipal;
  readonly submittedSourceUrl: SourceUrl;
  readonly trace: ImportTraceContext;
  readonly updatedAt: Instant;
}

export type InternalImportIntentTransitionError =
  | ImportPersistenceCorrupt
  | ImportPersistenceUnavailable
  | ImportIntentTransitionMutationConflict
  | RecipeImportIntentNotFound;

export interface ImportIntentRepository {
  readonly admitIntent: (
    command: AdmitImportIntentCommand
  ) => Effect.Effect<AdmitImportIntentResult, ImportIntentRepositoryError>;
  readonly cancelIntent: (
    command: CancelImportIntentCommand
  ) => Effect.Effect<
    CancelImportIntentResult,
    | ImportPersistenceCorrupt
    | ImportPersistenceUnavailable
    | ImportIntentTransitionMutationConflict
    | RecipeImportIntentNotFound
    | RecipeImportIntentRedirected
    | RecipeImportIntentTransitionRejected
    | RecipeImportIntentVersionConflict
  >;
  readonly findIntent: (
    principal: ImportPrincipal,
    intentId: RecipeImportIntentId
  ) => Effect.Effect<
    Option.Option<RecipeImportIntent>,
    ImportPersistenceCorrupt | ImportPersistenceUnavailable
  >;
  readonly findPendingSourceResolution: (
    principal: ImportPrincipal,
    intentId: RecipeImportIntentId
  ) => Effect.Effect<
    Option.Option<PendingImportIntentSourceResolution>,
    ImportPersistenceCorrupt | ImportPersistenceUnavailable
  >;
  readonly isIntentExecutionCurrent: (
    intentId: RecipeImportIntentId,
    executionGeneration: ImportIntentTransitionCommand["executionGeneration"]
  ) => Effect.Effect<
    boolean,
    ImportPersistenceCorrupt | ImportPersistenceUnavailable
  >;
  readonly listStalledIntentStarts: (
    cutoff: Instant,
    limit: StalledImportIntentStartLimit
  ) => Effect.Effect<
    readonly StalledImportIntentStartCandidate[],
    ImportPersistenceCorrupt | ImportPersistenceUnavailable
  >;
  readonly listStalledSourceResolutions: (
    cutoff: Instant,
    limit: StalledImportIntentStartLimit
  ) => Effect.Effect<
    readonly PendingImportIntentSourceResolution[],
    ImportPersistenceCorrupt | ImportPersistenceUnavailable
  >;
  readonly requireMutableIntent: (
    principal: ImportPrincipal,
    intentId: RecipeImportIntentId
  ) => Effect.Effect<
    RecipeImportIntent,
    | ImportPersistenceCorrupt
    | ImportPersistenceUnavailable
    | RecipeImportIntentNotFound
    | RecipeImportIntentRedirected
  >;
  readonly readIntentTimeline: (
    principal: ImportPrincipal,
    intentId: RecipeImportIntentId
  ) => Effect.Effect<
    RecipeImportTimeline,
    | ImportPersistenceCorrupt
    | ImportPersistenceUnavailable
    | RecipeImportIntentNotFound
  >;
  readonly resolveIntentSource: (
    principal: ImportPrincipal,
    command: ResolveImportIntentSourceCommand
  ) => Effect.Effect<
    ResolveImportIntentSourceResult,
    ImportIntentRepositoryError
  >;
  readonly transitionIntent: (
    command: ImportIntentTransitionCommand
  ) => Effect.Effect<
    ImportIntentTransitionOutcome,
    InternalImportIntentTransitionError
  >;
}

export type ImportTransitionError =
  | ImportNotFound
  | ImportPersistenceCorrupt
  | ImportPersistenceUnavailable
  | ImportTransitionRejected;

export type ClaimAcquisitionResult =
  | { readonly _tag: "Acquiring"; readonly import: StoredImport }
  | { readonly _tag: "Finished"; readonly import: StoredImport };

export interface BeginAcquisitionAttemptResult {
  readonly canonicalSourceId: SourceCanonicalId;
  readonly generation: AcquisitionGeneration;
}

export const AcquisitionFinalizationResult = Schema.Literals([
  "Recorded",
  "Superseded",
]);
export type AcquisitionFinalizationResult =
  typeof AcquisitionFinalizationResult.Type;

export interface ImportRepository {
  readonly findById: (
    id: ImportId
  ) => Effect.Effect<
    Option.Option<StoredImport>,
    ImportPersistenceCorrupt | ImportPersistenceUnavailable
  >;
  readonly isAudioExtractionRecoveryEligible: (
    id: ImportId
  ) => Effect.Effect<
    boolean,
    ImportPersistenceCorrupt | ImportPersistenceUnavailable
  >;
  readonly claimAcquisition?: (
    id: ImportId
  ) => Effect.Effect<ClaimAcquisitionResult, ImportTransitionError>;
  readonly beginAcquisitionAttempt?: (
    id: ImportId
  ) => Effect.Effect<BeginAcquisitionAttemptResult, ImportTransitionError>;
  readonly recordAcquired?: (
    id: ImportId,
    generation: AcquisitionGeneration,
    evidence: VerifiedAcquisitionEvidence,
    acquiredAt: ImportTimestamp
  ) => Effect.Effect<AcquisitionFinalizationResult, ImportTransitionError>;
  readonly recordAcquisitionFailure?: (
    id: ImportId,
    generation: AcquisitionGeneration,
    failure: ClassifiedAcquisitionFailure,
    failedAt: ImportTimestamp
  ) => Effect.Effect<AcquisitionFinalizationResult, ImportTransitionError>;
}

export const ImportRepository = Context.Service<ImportRepository>(
  "meal-planner/ImportRepository"
);
