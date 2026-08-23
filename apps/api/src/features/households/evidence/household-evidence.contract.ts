import { RecipeImportIntentId } from "@meal-planner/recipe-import-api";
import { Schema } from "effect";

import {
  MediaStreamSummary,
  VerifiedSourceMetadata,
} from "../../imports/import-media.model.js";
import { RecipeDraft } from "../../imports/import-recipe-draft.repository.js";
import { RecipeExtractorDescriptor } from "../../imports/import-recipe-extractor.js";
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
  event: Schema.Struct({
    action: Schema.Literals([
      "CompleteMultipartUpload",
      "CopyObject",
      "DeleteObject",
      "IntegrityProbe",
      "LifecycleDeletion",
      "PutObject",
    ]),
    eventTime: ImportTimestamp,
  }),
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
  outcome: Schema.Literals(["Applied", "IgnoredOlder"]),
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

const HouseholdEvidenceReferenceFields = {
  availability: HouseholdEvidenceAvailability,
  byteLength: PositiveSafeInteger,
  deleteAt: ImportTimestamp,
  key: R2ObjectKey,
  observationOrdinal: HouseholdEvidenceObservationOrdinal,
  sha256: HouseholdEvidenceSha256,
} as const;

const HouseholdOriginalEvidenceReference = Schema.Struct({
  ...HouseholdEvidenceReferenceFields,
  kind: Schema.Literal("original_media"),
});

const HouseholdAcquisitionEvidenceReference = Schema.Struct({
  ...HouseholdEvidenceReferenceFields,
  kind: Schema.Literal("acquisition_manifest"),
});

const HouseholdSpeechEvidenceReference = Schema.Struct({
  ...HouseholdEvidenceReferenceFields,
  kind: Schema.Literal("speech_transcript"),
});

const HouseholdVisualEvidenceReference = Schema.Struct({
  ...HouseholdEvidenceReferenceFields,
  kind: Schema.Literal("visual_manifest"),
});

const HouseholdCarouselEvidenceReference = Schema.Struct({
  ...HouseholdEvidenceReferenceFields,
  kind: Schema.Literal("carousel_manifest"),
});

const HouseholdEvidenceReferenceIdentity = {
  committedAt: ImportTimestamp,
  executionGeneration: PositiveSafeInteger,
  intentId: RecipeImportIntentId,
} as const;

export const HouseholdReadEvidenceReferencesResult = Schema.NullOr(
  Schema.Union([
    Schema.Struct({
      ...HouseholdEvidenceReferenceIdentity,
      references: Schema.Tuple([HouseholdCarouselEvidenceReference]),
    }),
    Schema.Struct({
      ...HouseholdEvidenceReferenceIdentity,
      references: Schema.Union([
        Schema.Tuple([
          HouseholdOriginalEvidenceReference,
          HouseholdAcquisitionEvidenceReference,
        ]),
        Schema.Tuple([
          HouseholdOriginalEvidenceReference,
          HouseholdAcquisitionEvidenceReference,
          HouseholdSpeechEvidenceReference,
        ]),
        Schema.Tuple([
          HouseholdOriginalEvidenceReference,
          HouseholdAcquisitionEvidenceReference,
          HouseholdVisualEvidenceReference,
        ]),
        Schema.Tuple([
          HouseholdOriginalEvidenceReference,
          HouseholdAcquisitionEvidenceReference,
          HouseholdSpeechEvidenceReference,
          HouseholdVisualEvidenceReference,
        ]),
      ]),
    }),
  ])
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
export const HouseholdExtractionClaimContext = Schema.Struct({
  descriptor: RecipeExtractorDescriptor,
  evidenceFingerprint: HouseholdEvidenceSha256,
  sourceMediaSha256: HouseholdEvidenceSha256,
  transcriptSha256: HouseholdEvidenceSha256,
  visualManifestSha256: HouseholdEvidenceSha256,
});
export type HouseholdExtractionClaimContext =
  typeof HouseholdExtractionClaimContext.Type;
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
      extractionContext: Schema.optionalKey(HouseholdExtractionClaimContext),
      stage: HouseholdEvidenceStage,
      startedAt: ImportTimestamp,
    }),
    Schema.Struct({
      _tag: Schema.Literal("Complete"),
      dispatchId: DispatchId,
      reference: Schema.optionalKey(HouseholdEvidenceStageReference),
      result: HouseholdEvidenceStageResult,
      stage: HouseholdEvidenceStage,
    }),
    Schema.Struct({
      _tag: Schema.Literal("Fail"),
      completedAt: ImportTimestamp,
      dispatchId: DispatchId,
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
    Schema.Struct({
      _tag: Schema.Literal("PrepareRecovery"),
      dispatchId: DispatchId,
      predecessorDispatchId: DispatchId,
      predecessorInputFingerprint: HouseholdEvidenceSha256,
      settlement: Schema.Struct({
        completedAt: ImportTimestamp,
        dispatchId: DispatchId,
        outcome: Schema.Literal("settled_unknown"),
      }),
      stage: Schema.Literals(["speech", "visual"]),
      startedAt: ImportTimestamp,
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
    "RecoveryPrepared",
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
    dispatchId: DispatchId,
    executionGeneration: PositiveSafeInteger,
    extractionContext: Schema.NullOr(HouseholdExtractionClaimContext),
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

export const HouseholdTerminalCheckpointStage = Schema.Literals([
  "extraction",
  "speech",
  "visual",
]);
export type HouseholdTerminalCheckpointStage =
  typeof HouseholdTerminalCheckpointStage.Type;

export const HouseholdReadImportTerminalCheckpointInput = Schema.Struct({
  admission: HouseholdSystemAdmission,
  expectedGeneration: PositiveSafeInteger,
  intentId: RecipeImportIntentId,
  ownershipId: DispatchId,
  stage: HouseholdTerminalCheckpointStage,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type HouseholdReadImportTerminalCheckpointInput =
  typeof HouseholdReadImportTerminalCheckpointInput.Type;

/** Closed private result; no organization or R2 identity is projected. */
export const HouseholdReadImportTerminalCheckpointResult = Schema.NullOr(
  Schema.Struct({
    completedAt: ImportTimestamp,
    executionGeneration: PositiveSafeInteger,
    failureCode: HouseholdEvidenceStageFailureCode,
    inputFingerprint: HouseholdEvidenceSha256,
    intentId: RecipeImportIntentId,
    ownershipId: DispatchId,
    stage: HouseholdTerminalCheckpointStage,
  })
);
export type HouseholdReadImportTerminalCheckpointResult =
  typeof HouseholdReadImportTerminalCheckpointResult.Type;

export const HouseholdRecipeRecoveryOrdinal = Schema.Literals([
  1, 2, 3, 4, 5, 6, 7, 8,
]);
export type HouseholdRecipeRecoveryOrdinal =
  typeof HouseholdRecipeRecoveryOrdinal.Type;

export const HouseholdRecipeRecoveryAttempt = Schema.Struct({
  acquisitionGeneration: PositiveSafeInteger,
  createdAt: ImportTimestamp,
  currentDispatchId: DispatchId,
  currentExtractionFingerprint: HouseholdEvidenceSha256,
  evidenceFingerprint: HouseholdEvidenceSha256,
  importId: RecipeImportIntentId,
  ordinal: HouseholdRecipeRecoveryOrdinal,
  predecessorDispatchId: DispatchId,
  predecessorExtractionFingerprint: HouseholdEvidenceSha256,
  rootDispatchId: DispatchId,
  rootExtractionFingerprint: HouseholdEvidenceSha256,
  sourceMediaSha256: HouseholdEvidenceSha256,
  terminalCheckpointCompletedAt: ImportTimestamp,
  transcriptSha256: HouseholdEvidenceSha256,
  visualManifestSha256: HouseholdEvidenceSha256,
});
export type HouseholdRecipeRecoveryAttempt =
  typeof HouseholdRecipeRecoveryAttempt.Type;

export const HouseholdPrepareRecipeRecoveryInput = Schema.Struct({
  admission: HouseholdSystemAdmission,
  expectedGeneration: PositiveSafeInteger,
  intentId: RecipeImportIntentId,
  mutationId: HouseholdImportMutationId,
  predecessorDispatchId: DispatchId,
  settlement: Schema.Struct({
    completedAt: ImportTimestamp,
    dispatchId: DispatchId,
    outcome: Schema.Literal("settled_unknown"),
  }),
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type HouseholdPrepareRecipeRecoveryInput =
  typeof HouseholdPrepareRecipeRecoveryInput.Type;

/** Closed private recovery receipt; evidence object keys never cross it. */
export const HouseholdPrepareRecipeRecoveryResult = Schema.Struct({
  attempt: HouseholdRecipeRecoveryAttempt,
  outcome: Schema.Literals(["Prepared", "Replay"]),
  receiptVersion: Schema.Literal(1),
});
export type HouseholdPrepareRecipeRecoveryResult =
  typeof HouseholdPrepareRecipeRecoveryResult.Type;

export const HouseholdReadRecipeRecoveryAttemptInput = Schema.Struct({
  admission: HouseholdSystemAdmission,
  expectedGeneration: PositiveSafeInteger,
  intentId: RecipeImportIntentId,
  selector: Schema.Union([
    Schema.Struct({
      _tag: Schema.Literal("Ordinal"),
      ordinal: HouseholdRecipeRecoveryOrdinal,
    }),
    Schema.Struct({
      _tag: Schema.Literal("Latest"),
      rootDispatchId: DispatchId,
    }),
  ]),
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type HouseholdReadRecipeRecoveryAttemptInput =
  typeof HouseholdReadRecipeRecoveryAttemptInput.Type;

export const HouseholdReadRecipeRecoveryAttemptResult = Schema.NullOr(
  HouseholdRecipeRecoveryAttempt
);
export type HouseholdReadRecipeRecoveryAttemptResult =
  typeof HouseholdReadRecipeRecoveryAttemptResult.Type;
