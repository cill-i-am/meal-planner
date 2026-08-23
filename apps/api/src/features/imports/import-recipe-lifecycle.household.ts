import type { RecipeImportIntentId } from "@meal-planner/recipe-import-api";
import { Effect } from "effect";

import type { HouseholdDomainWorkerMethods } from "../households/household-domain-worker.js";
import type { HouseholdOrganizationId } from "../households/household.contract.js";
import type { HouseholdImportMutationId } from "../households/recipe-import/household-recipe-import.contract.js";
import { projectRecipeDraftReviewActionView } from "./import-intent-review-action.js";
import type { ImportIntentExecutionGeneration } from "./import-intent-transition.js";
import type { ProduceRecipeDraftFromEvidenceInput } from "./import-recipe-draft.js";

type RecipeDraftLifecycle = NonNullable<
  ProduceRecipeDraftFromEvidenceInput["lifecycle"]
>;

/** One Household-owned recipe draft lifecycle shared by initial and recovery Workflows. */
export const makeHouseholdRecipeDraftLifecycle = (input: {
  readonly executionGeneration: ImportIntentExecutionGeneration;
  readonly householdDomain: Pick<
    HouseholdDomainWorkerMethods,
    "commitRecipeImportDraft" | "transitionRecipeImportLifecycle"
  >;
  readonly intentId: RecipeImportIntentId;
  readonly mutationId: (
    semanticKey: string
  ) => Effect.Effect<HouseholdImportMutationId>;
  readonly organizationId: HouseholdOrganizationId;
}): RecipeDraftLifecycle => {
  const admission = {
    actor: {
      _tag: "System" as const,
      purpose: "recipe_import_lifecycle_commit" as const,
    },
    organizationId: input.organizationId,
  };
  const advanceStage = (stage: "grounding_recipe" | "preparing_review") =>
    input.householdDomain
      .transitionRecipeImportLifecycle({
        admission,
        expectedGeneration: input.executionGeneration,
        intentId: input.intentId,
        transition: { _tag: "AdvanceStage", stage },
      })
      .pipe(Effect.asVoid, Effect.orDie);

  return {
    grounding: advanceStage("grounding_recipe"),
    preparingReview: advanceStage("preparing_review"),
    reviewAvailable: (_actionId, draft) =>
      Effect.gen(function* commitHouseholdRecipeDraft() {
        const mutationId = yield* input.mutationId(
          `${input.intentId}:${input.executionGeneration}:commit-draft:${draft.extractionFingerprint}`
        );
        yield* input.householdDomain.commitRecipeImportDraft({
          admission,
          evidenceFingerprint: draft.evidenceFingerprint,
          expectedGeneration: input.executionGeneration,
          extractionFingerprint: draft.extractionFingerprint,
          intentId: input.intentId,
          mutationId,
          review: projectRecipeDraftReviewActionView(draft),
        });
      }).pipe(Effect.orDie),
  };
};
