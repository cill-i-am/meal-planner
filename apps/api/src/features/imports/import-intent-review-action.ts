import { recipeContentBlockers } from "@meal-planner/recipe-domain";
import type { RecipeImportAction } from "@meal-planner/recipe-import-api";
import { RecipeReviewEditableField } from "@meal-planner/recipe-import-api";

import type { RecipeDraft } from "./import-recipe-draft.repository.js";

/** Initial provider draft; household authority owns subsequent review and approval. */
export const projectRecipeDraftReviewActionView = (
  draft: RecipeDraft
): RecipeImportAction["review"] => ({
  answers: [],
  blockers: recipeContentBlockers(draft.extraction.recipe),
  editableFields: RecipeReviewEditableField.literals,
  recipe: { ...draft.extraction.recipe },
  tags: null,
});
