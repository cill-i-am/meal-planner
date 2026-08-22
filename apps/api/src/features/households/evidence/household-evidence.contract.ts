import { RecipeImportIntentId } from "@meal-planner/recipe-import-api";
import { Schema } from "effect";

import {
  MediaStreamSummary,
  VerifiedSourceMetadata,
} from "../../imports/import-media.model.js";
import { RecipeDraft } from "../../imports/import-recipe-draft.repository.js";
import { ImportTimestamp } from "../../imports/import.contracts.js";
import { HouseholdImportMutationId } from "../recipe-import/household-recipe-import.contract.js";
import { HouseholdSystemAdmission } from "../rpc/command-envelope.js";

export const HouseholdEvidenceSha256 = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-f\d]{64}$/u))
);
const PositiveSafeInteger = Schema.Int.pipe(
  Schema.check(
    Schema.isGreaterThanOrEqualTo(1),
    Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)
  )
);
const R2ObjectKey = Schema.String.pipe(
  Schema.check(
    Schema.isTrimmed(),
    Schema.isNonEmpty(),
    Schema.isMaxLength(1024)
  )
);

export const HouseholdOriginalMediaReference = Schema.Struct({
  byteLength: PositiveSafeInteger,
  deleteAt: ImportTimestamp,
  key: R2ObjectKey,
  kind: Schema.Literal("original_media"),
  sha256: HouseholdEvidenceSha256,
});

export const HouseholdAcquisitionManifestReference = Schema.Struct({
  byteLength: PositiveSafeInteger,
  deleteAt: ImportTimestamp,
  key: R2ObjectKey,
  kind: Schema.Literal("acquisition_manifest"),
  sha256: HouseholdEvidenceSha256,
});

export const HouseholdCommitAcquisitionEvidenceInput = Schema.Struct({
  admission: HouseholdSystemAdmission,
  expectedGeneration: PositiveSafeInteger,
  intentId: RecipeImportIntentId,
  mutationId: HouseholdImportMutationId,
  result: Schema.Struct({
    acquiredAt: ImportTimestamp,
    audioStreams: Schema.NonEmptyArray(MediaStreamSummary),
    durationSeconds: Schema.Number.pipe(
      Schema.check(Schema.isFinite(), Schema.isGreaterThan(0))
    ),
    references: Schema.Tuple([
      HouseholdOriginalMediaReference,
      HouseholdAcquisitionManifestReference,
    ]),
    source: Schema.optionalKey(VerifiedSourceMetadata),
    videoStreams: Schema.NonEmptyArray(MediaStreamSummary),
  }),
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type HouseholdCommitAcquisitionEvidenceInput =
  typeof HouseholdCommitAcquisitionEvidenceInput.Type;

/** Privacy-safe receipt returned across the private Worker boundary. */
export const HouseholdCommitAcquisitionEvidenceResult = Schema.Struct({
  committedAt: ImportTimestamp,
  executionGeneration: PositiveSafeInteger,
  intentId: RecipeImportIntentId,
  outcome: Schema.Literal("Recorded"),
  receiptVersion: Schema.Literal(1),
});
export type HouseholdCommitAcquisitionEvidenceResult =
  typeof HouseholdCommitAcquisitionEvidenceResult.Type;

export const HouseholdEvidenceReferenceKind = Schema.Literals([
  "acquisition_manifest",
  "carousel_manifest",
  "original_media",
  "speech_transcript",
  "visual_manifest",
]);
export type HouseholdEvidenceReferenceKind =
  typeof HouseholdEvidenceReferenceKind.Type;

export const HouseholdEvidenceAvailability = Schema.Literals([
  "available",
  "deleted",
  "missing",
]);
export type HouseholdEvidenceAvailability =
  typeof HouseholdEvidenceAvailability.Type;

export const HouseholdObserveEvidenceReferenceInput = Schema.Struct({
  admission: HouseholdSystemAdmission,
  availability: HouseholdEvidenceAvailability,
  expectedGeneration: PositiveSafeInteger,
  intentId: RecipeImportIntentId,
  mutationId: HouseholdImportMutationId,
  reference: Schema.Struct({
    key: R2ObjectKey,
    kind: HouseholdEvidenceReferenceKind,
    sha256: HouseholdEvidenceSha256,
  }),
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type HouseholdObserveEvidenceReferenceInput =
  typeof HouseholdObserveEvidenceReferenceInput.Type;

/** Privacy-safe lifecycle receipt; integrity metadata never crosses this result. */
export const HouseholdObserveEvidenceReferenceResult = Schema.Struct({
  availability: HouseholdEvidenceAvailability,
  committedAt: ImportTimestamp,
  executionGeneration: PositiveSafeInteger,
  intentId: RecipeImportIntentId,
  kind: HouseholdEvidenceReferenceKind,
  observationOrdinal: PositiveSafeInteger,
  receiptVersion: Schema.Literal(1),
});
export type HouseholdObserveEvidenceReferenceResult =
  typeof HouseholdObserveEvidenceReferenceResult.Type;

export const HouseholdReadEvidenceReferencesInput = Schema.Struct({
  admission: HouseholdSystemAdmission,
  expectedGeneration: PositiveSafeInteger,
  intentId: RecipeImportIntentId,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type HouseholdReadEvidenceReferencesInput =
  typeof HouseholdReadEvidenceReferencesInput.Type;

const HouseholdEvidenceObservationOrdinal = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(0))
);

const HouseholdEvidenceReference = Schema.Struct({
  availability: HouseholdEvidenceAvailability,
  byteLength: PositiveSafeInteger,
  deleteAt: ImportTimestamp,
  key: R2ObjectKey,
  kind: HouseholdEvidenceReferenceKind,
  observationOrdinal: HouseholdEvidenceObservationOrdinal,
  sha256: HouseholdEvidenceSha256,
});

export const HouseholdReadEvidenceReferencesResult = Schema.NullOr(
  Schema.Struct({
    committedAt: ImportTimestamp,
    executionGeneration: PositiveSafeInteger,
    intentId: RecipeImportIntentId,
    references: Schema.Array(HouseholdEvidenceReference).pipe(
      Schema.check(Schema.isMinLength(2), Schema.isMaxLength(5))
    ),
  })
);
export type HouseholdReadEvidenceReferencesResult =
  typeof HouseholdReadEvidenceReferencesResult.Type;

export const HouseholdEvidenceStage = Schema.Literals([
  "carousel",
  "extraction",
  "speech",
  "visual",
]);
export type HouseholdEvidenceStage = typeof HouseholdEvidenceStage.Type;

const NonNegativeSafeInteger = Schema.Int.pipe(
  Schema.check(
    Schema.isGreaterThanOrEqualTo(0),
    Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)
  )
);
const DispatchId = Schema.String.pipe(
  Schema.check(Schema.isTrimmed(), Schema.isNonEmpty(), Schema.isMaxLength(256))
);
const EvidenceCost = Schema.Struct({
  certainty: Schema.Literals(["estimated", "known"]),
  currency: Schema.Literal("USD"),
  estimatedMicroUsd: NonNegativeSafeInteger,
});

export const HouseholdSpeechEvidenceResult = Schema.Struct({
  _tag: Schema.Literal("Speech"),
  completedAt: ImportTimestamp,
  cost: EvidenceCost,
  detectedLanguage: Schema.String,
  dispatchId: DispatchId,
  model: Schema.String,
  provider: Schema.String,
  segmentsCount: NonNegativeSafeInteger,
  sourceMediaSha256: HouseholdEvidenceSha256,
  transcriptKey: R2ObjectKey,
  transcriptSha256: HouseholdEvidenceSha256,
  usage: Schema.Struct({
    audioDurationMilliseconds: NonNegativeSafeInteger,
    inputBytes: NonNegativeSafeInteger,
  }),
});
export const HouseholdVisualEvidenceResult = Schema.Struct({
  _tag: Schema.Literal("Visual"),
  completedAt: ImportTimestamp,
  cost: EvidenceCost,
  dispatchId: DispatchId,
  manifestKey: R2ObjectKey,
  manifestSha256: HouseholdEvidenceSha256,
  model: Schema.String,
  observationsCount: NonNegativeSafeInteger,
  outcome: Schema.Literals(["empty", "found", "low_confidence"]),
  provider: Schema.String,
  sourceMediaSha256: HouseholdEvidenceSha256,
  usage: Schema.Struct({
    inputBytes: NonNegativeSafeInteger,
    inputFrames: NonNegativeSafeInteger,
    modelCalls: Schema.Literal(1),
  }),
});
export const HouseholdCarouselEvidenceResult = Schema.Struct({
  _tag: Schema.Literal("Carousel"),
  completedAt: ImportTimestamp,
  descriptorFingerprint: HouseholdEvidenceSha256,
  dispatchId: DispatchId,
  imageCount: PositiveSafeInteger,
  manifestKey: R2ObjectKey,
  manifestSha256: HouseholdEvidenceSha256,
});
export const HouseholdExtractionEvidenceResult = Schema.Struct({
  _tag: Schema.Literal("Extraction"),
  draft: RecipeDraft,
});
export const HouseholdEvidenceStageResult = Schema.Union([
  HouseholdCarouselEvidenceResult,
  HouseholdExtractionEvidenceResult,
  HouseholdSpeechEvidenceResult,
  HouseholdVisualEvidenceResult,
]);
export type HouseholdEvidenceStageResult =
  typeof HouseholdEvidenceStageResult.Type;

export const HouseholdEvidenceStageFailureCode = Schema.Literals([
  "audio_extraction_failed",
  "carousel_inaccessible",
  "carousel_layout_drift",
  "carousel_partial",
  "download_exhausted",
  "frame_evidence_failed",
  "frame_sampling_failed",
  "insufficient_evidence",
  "invalid_schema",
  "invalid_source",
  "model_refusal",
  "outcome_unknown",
  "provider_error",
  "source_evidence_invalid",
  "transcription_failed",
  "transcript_evidence_failed",
  "unsupported_media",
  "visual_evidence_failed",
  "visual_extraction_failed",
]);

const HouseholdEvidenceStageReference = Schema.Struct({
  byteLength: PositiveSafeInteger,
  deleteAt: ImportTimestamp,
  key: R2ObjectKey,
  kind: Schema.Literals([
    "carousel_manifest",
    "speech_transcript",
    "visual_manifest",
  ]),
  sha256: HouseholdEvidenceSha256,
});

export const HouseholdMutateEvidenceStageInput = Schema.Struct({
  admission: HouseholdSystemAdmission,
  expectedGeneration: PositiveSafeInteger,
  inputFingerprint: HouseholdEvidenceSha256,
  intentId: RecipeImportIntentId,
  mutationId: HouseholdImportMutationId,
  operation: Schema.Union([
    Schema.Struct({
      _tag: Schema.Literal("Claim"),
      dispatchId: DispatchId,
      stage: HouseholdEvidenceStage,
      startedAt: ImportTimestamp,
    }),
    Schema.Struct({
      _tag: Schema.Literal("Complete"),
      reference: Schema.optionalKey(HouseholdEvidenceStageReference),
      result: HouseholdEvidenceStageResult,
      stage: HouseholdEvidenceStage,
    }),
    Schema.Struct({
      _tag: Schema.Literal("Fail"),
      completedAt: ImportTimestamp,
      failureCode: HouseholdEvidenceStageFailureCode,
      recovery: Schema.optionalKey(
        Schema.Literals([
          "check_source_visibility",
          "operator_review",
          "request_complete_carousel",
          "retry_later",
          "submit_supported_media",
          "update_carousel_adapter",
        ])
      ),
      stage: HouseholdEvidenceStage,
    }),
  ]),
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type HouseholdMutateEvidenceStageInput =
  typeof HouseholdMutateEvidenceStageInput.Type;

export const HouseholdMutateEvidenceStageResult = Schema.Struct({
  committedAt: ImportTimestamp,
  executionGeneration: PositiveSafeInteger,
  intentId: RecipeImportIntentId,
  outcome: Schema.Literals([
    "Completed",
    "DispatchClaimed",
    "Failed",
    "ResumeDispatch",
  ]),
  receiptVersion: Schema.Literal(1),
  stage: HouseholdEvidenceStage,
});
export type HouseholdMutateEvidenceStageResult =
  typeof HouseholdMutateEvidenceStageResult.Type;

export const HouseholdReadEvidenceStageInput = Schema.Struct({
  admission: HouseholdSystemAdmission,
  expectedGeneration: PositiveSafeInteger,
  intentId: RecipeImportIntentId,
  stage: HouseholdEvidenceStage,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type HouseholdReadEvidenceStageInput =
  typeof HouseholdReadEvidenceStageInput.Type;

export const HouseholdReadEvidenceStageResult = Schema.NullOr(
  Schema.Struct({
    committedAt: ImportTimestamp,
    executionGeneration: PositiveSafeInteger,
    failureCode: Schema.NullOr(HouseholdEvidenceStageFailureCode),
    inputFingerprint: HouseholdEvidenceSha256,
    intentId: RecipeImportIntentId,
    outcome: Schema.Literals(["Completed", "Dispatching", "Failed"]),
    reference: Schema.NullOr(HouseholdEvidenceStageReference),
    result: Schema.NullOr(HouseholdEvidenceStageResult),
    stage: HouseholdEvidenceStage,
  })
);
export type HouseholdReadEvidenceStageResult =
  typeof HouseholdReadEvidenceStageResult.Type;
