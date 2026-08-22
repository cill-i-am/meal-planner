import { RecipeImportIntentId } from "@meal-planner/recipe-import-api";
import { Schema } from "effect";

import {
  MediaStreamSummary,
  VerifiedSourceMetadata,
} from "../../imports/import-media.model.js";
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

export const HouseholdReadEvidenceReferencesResult = Schema.Struct({
  executionGeneration: PositiveSafeInteger,
  intentId: RecipeImportIntentId,
  references: Schema.Tuple([
    Schema.Struct({
      ...HouseholdOriginalMediaReference.fields,
      availability: HouseholdEvidenceAvailability,
      observationOrdinal: HouseholdEvidenceObservationOrdinal,
    }),
    Schema.Struct({
      ...HouseholdAcquisitionManifestReference.fields,
      availability: HouseholdEvidenceAvailability,
      observationOrdinal: HouseholdEvidenceObservationOrdinal,
    }),
  ]),
});
export type HouseholdReadEvidenceReferencesResult =
  typeof HouseholdReadEvidenceReferencesResult.Type;
