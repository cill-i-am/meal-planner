import { AnswerReviewRecipeActionRequest } from "@meal-planner/recipe-import-api";
import { Schema } from "effect";

import { RecipeDraft } from "../imports/import-recipe-draft.repository.d1.js";
import {
  ApprovedRecipe,
  RecipeReviewerActorId,
  RecipeReviewLifecycle,
  RecipeReviewVersion,
  Review,
} from "../imports/import-recipe-review.js";
import {
  EvidenceReference,
  ImportId,
  ImportTimestamp,
} from "../imports/import.contracts.js";
import { HouseholdEnsureInput } from "./household.contract.js";

export const HouseholdRecipeReviewSnapshotWire = Schema.Struct({
  draft: Schema.toEncoded(RecipeDraft),
  evidence: Schema.Array(Schema.toEncoded(EvidenceReference)),
});
export type HouseholdRecipeReviewSnapshotWire =
  typeof HouseholdRecipeReviewSnapshotWire.Type;

export const HouseholdOpenRecipeReviewInput = Schema.Struct({
  openedAt: Schema.toEncoded(ImportTimestamp),
  organizationId: HouseholdEnsureInput.fields.organizationId,
  snapshot: HouseholdRecipeReviewSnapshotWire,
});
export type HouseholdOpenRecipeReviewInput =
  typeof HouseholdOpenRecipeReviewInput.Type;

const RecipeReviewMutationId = Schema.String.pipe(
  Schema.check(Schema.isTrimmed(), Schema.isNonEmpty(), Schema.isMaxLength(128))
);
const RecipeReviewMutationReason = Schema.String.pipe(
  Schema.check(
    Schema.isTrimmed(),
    Schema.isNonEmpty(),
    Schema.isMaxLength(4096)
  )
);

const RecipeReviewMutationCommon = {
  actorId: RecipeReviewerActorId,
  expectedVersion: RecipeReviewVersion,
  importId: ImportId,
  mutationId: RecipeReviewMutationId,
} as const;

export const HouseholdAnswerRecipeReviewInput = Schema.Struct({
  answeredAt: Schema.toEncoded(ImportTimestamp),
  answers: AnswerReviewRecipeActionRequest.fields.answers,
  ...RecipeReviewMutationCommon,
  organizationId: HouseholdEnsureInput.fields.organizationId,
});
export type HouseholdAnswerRecipeReviewInput =
  typeof HouseholdAnswerRecipeReviewInput.Type;

export const HouseholdTransitionRecipeReviewInput = Schema.Struct({
  ...RecipeReviewMutationCommon,
  organizationId: HouseholdEnsureInput.fields.organizationId,
  reason: RecipeReviewMutationReason,
  to: RecipeReviewLifecycle,
  transitionedAt: Schema.toEncoded(ImportTimestamp),
});
export type HouseholdTransitionRecipeReviewInput =
  typeof HouseholdTransitionRecipeReviewInput.Type;

export const HouseholdReadRecipeReviewInput = Schema.Struct({
  importId: ImportId,
  organizationId: HouseholdEnsureInput.fields.organizationId,
});
export type HouseholdReadRecipeReviewInput =
  typeof HouseholdReadRecipeReviewInput.Type;

export const HouseholdRecipeReviewWire = Schema.toEncoded(Review);
export type HouseholdRecipeReviewWire = typeof HouseholdRecipeReviewWire.Type;

export const HouseholdApprovedRecipeWire = Schema.toEncoded(ApprovedRecipe);
export type HouseholdApprovedRecipeWire =
  typeof HouseholdApprovedRecipeWire.Type;

export interface RecipeReviewOpenConflict {
  readonly _tag: "RecipeReviewOpenConflict";
  readonly importId: string;
}
export const RecipeReviewOpenConflict =
  // eslint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is Effect's constructor factory, not a thrown expression.
  Schema.TaggedError<RecipeReviewOpenConflict>()("RecipeReviewOpenConflict", {
    importId: Schema.String,
  });

export const RecipeReviewNotFound = Schema.TaggedStruct(
  "RecipeReviewNotFound",
  { importId: ImportId }
);
export type RecipeReviewNotFound = typeof RecipeReviewNotFound.Type;

export const RecipeReviewVersionConflict = Schema.TaggedStruct(
  "RecipeReviewVersionConflict",
  {
    actualVersion: RecipeReviewVersion,
    expectedVersion: RecipeReviewVersion,
  }
);
export type RecipeReviewVersionConflict =
  typeof RecipeReviewVersionConflict.Type;

export const RecipeReviewMutationConflict = Schema.TaggedStruct(
  "RecipeReviewMutationConflict",
  { mutationId: RecipeReviewMutationId }
);
export type RecipeReviewMutationConflict =
  typeof RecipeReviewMutationConflict.Type;

export const RecipeReviewTransitionRejected = Schema.TaggedStruct(
  "RecipeReviewTransitionRejected",
  { lifecycle: RecipeReviewLifecycle }
);
export type RecipeReviewTransitionRejected =
  typeof RecipeReviewTransitionRejected.Type;
