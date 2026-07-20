import type { Effect, Option } from "effect";
import { Context, Schema } from "effect";

import type {
  AcquisitionGeneration,
  ClassifiedAcquisitionFailure,
  VerifiedAcquisitionEvidence,
} from "./import-media.model.js";
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
