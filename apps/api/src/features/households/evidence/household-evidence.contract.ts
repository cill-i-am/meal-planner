import { RecipeImportIntentId } from "@meal-planner/recipe-import-api";
import { Schema } from "effect";

import {
  MediaStreamSummary,
  VerifiedSourceMetadata,
} from "../../imports/import-media.model.js";
import { ImportTimestamp } from "../../imports/import.contracts.js";
import { HouseholdImportMutationId } from "../recipe-import/household-recipe-import.contract.js";
import { HouseholdSystemAdmission } from "../rpc/command-envelope.js";

const Sha256Hex = Schema.String.pipe(
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

const OriginalMediaReference = Schema.Struct({
  byteLength: PositiveSafeInteger,
  deleteAt: ImportTimestamp,
  key: R2ObjectKey,
  kind: Schema.Literal("original_media"),
  sha256: Sha256Hex,
});

const AcquisitionManifestReference = Schema.Struct({
  byteLength: PositiveSafeInteger,
  deleteAt: ImportTimestamp,
  key: R2ObjectKey,
  kind: Schema.Literal("acquisition_manifest"),
  sha256: Sha256Hex,
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
      OriginalMediaReference,
      AcquisitionManifestReference,
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
