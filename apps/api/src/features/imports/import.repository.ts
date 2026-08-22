import type { Effect, Option } from "effect";
import { Context, Schema } from "effect";

import type {
  AcquisitionGeneration,
  ClassifiedAcquisitionFailure,
  VerifiedAcquisitionEvidence,
} from "./import-media.model.js";
import type { ImportTraceContext } from "./import-observability.js";
import type {
  ImportId,
  ImportTimestamp,
  ImportView,
  SourceCanonicalId,
} from "./import.contracts.js";
import type {
  ImportNotFound,
  ImportPersistenceCorrupt,
  ImportPersistenceUnavailable,
  ImportTransitionRejected,
} from "./import.errors.js";

export interface StoredImport {
  readonly acquisitionGeneration: AcquisitionGeneration;
  readonly canonicalSourceId: SourceCanonicalId;
  readonly sourceKind: "tiktok";
  readonly trace: ImportTraceContext;
  readonly view: ImportView;
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
