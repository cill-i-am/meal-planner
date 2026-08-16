import type {
  CanonicalTikTokUrl,
  Instant,
  RecipeImportIntent,
  RecipeImportIntentId,
  RecipeImportTimeline,
  SourceUrl,
} from "@meal-planner/recipe-import-api";
import type { Effect, Option } from "effect";
import { Context, Schema } from "effect";

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
  ImportIntentTransitionCommand,
  ImportIntentTransitionMutationConflict,
  ImportIntentTransitionOutcome,
} from "./import-intent-transition.js";
import type {
  AcquisitionGeneration,
  ClassifiedAcquisitionFailure,
  VerifiedAcquisitionEvidence,
} from "./import-media.model.js";
import type { ImportTraceContext } from "./import-observability.js";
import type {
  ImportDisposition,
  ImportId,
  ImportTimestamp,
  ImportView,
  SourceCanonicalId,
} from "./import.contracts.js";
import type {
  IdempotencyConflict,
  ImportPersistenceCorrupt,
  ImportPersistenceUnavailable,
  IncompatibleDuplicate,
  ImportNotFound,
  ImportTransitionRejected,
} from "./import.errors.js";

const Sha256Hex = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-f\d]{64}$/u))
);

export const CompatibilityFingerprint = Sha256Hex.pipe(
  Schema.brand("CompatibilityFingerprint")
);
export type CompatibilityFingerprint = typeof CompatibilityFingerprint.Type;

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
  readonly compatibilityFingerprint: CompatibilityFingerprint;
  readonly sourceKind: "tiktok";
  readonly trace: ImportTraceContext;
  readonly view: ImportView;
}

export interface StoredImportRequest {
  readonly import: StoredImport;
  readonly requestFingerprint: RequestFingerprint;
  readonly sourceLocatorHash: SourceLocatorHash;
}

export interface AcceptImportCommand {
  readonly candidate: StoredImport;
  readonly idempotencyKeyHash: IdempotencyKeyHash;
  readonly requestFingerprint: RequestFingerprint;
  readonly sourceLocatorHash: SourceLocatorHash;
}

export interface AcceptImportResult {
  readonly disposition: ImportDisposition;
  readonly import: StoredImport;
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
  readonly intentId: RecipeImportIntentId;
  readonly resolvedAt: Instant;
  readonly sourceKind: "video" | "carousel";
}

export type ImportIntentRepositoryError =
  | ImportPersistenceCorrupt
  | ImportPersistenceUnavailable
  | RecipeImportIntentIdempotencyConflict
  | RecipeImportIntentNotFound
  | RecipeImportIntentRedirected
  | RecipeImportIntentTransitionRejected;

export type InternalImportIntentTransitionError =
  | ImportPersistenceCorrupt
  | ImportPersistenceUnavailable
  | ImportIntentTransitionMutationConflict
  | RecipeImportIntentNotFound;

export interface ImportIntentRepositoryShape {
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
  ) => Effect.Effect<RecipeImportIntent, ImportIntentRepositoryError>;
  readonly transitionIntent: (
    command: ImportIntentTransitionCommand
  ) => Effect.Effect<
    ImportIntentTransitionOutcome,
    InternalImportIntentTransitionError
  >;
}

export type ImportRepositoryError =
  | IdempotencyConflict
  | ImportPersistenceCorrupt
  | ImportPersistenceUnavailable
  | IncompatibleDuplicate;

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

export interface ImportRepositoryShape {
  readonly acceptRequest: (
    command: AcceptImportCommand
  ) => Effect.Effect<AcceptImportResult, ImportRepositoryError>;
  readonly findByCanonicalIdentity: (identity: {
    readonly canonicalId: SourceCanonicalId;
    readonly kind: "tiktok";
  }) => Effect.Effect<
    Option.Option<StoredImport>,
    ImportPersistenceCorrupt | ImportPersistenceUnavailable
  >;
  readonly findById: (
    id: ImportId
  ) => Effect.Effect<
    Option.Option<StoredImport>,
    ImportPersistenceCorrupt | ImportPersistenceUnavailable
  >;
  readonly findRequest: (
    idempotencyKeyHash: IdempotencyKeyHash
  ) => Effect.Effect<
    Option.Option<StoredImportRequest>,
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

export class ImportRepository extends Context.Service<
  ImportRepository,
  ImportRepositoryShape
>()("meal-planner/ImportRepository") {}
