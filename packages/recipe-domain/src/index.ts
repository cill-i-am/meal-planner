import { Schema } from "effect";

import { RecipeContent, RecipeText } from "./content.js";
import { PlanningTags } from "./planning-tags.js";

export {
  RecipeText,
  RecipeDuration,
  RecipeQuantity,
  RecipeIngredient,
  RecipeIngredients,
  RecipeTemperature,
  RecipeInstruction,
  RecipeInstructions,
  RecipeAuthor,
  RecipeServings,
  RecipeTimes,
  RecipeNutrient,
  RecipeNutrition,
  RecipeDietaryClaim,
  RecipeMedia,
  RecipeContentFields,
  RecipeContent,
  RecipeDraftContent,
  recipeIngredientFromText,
  recipeInstructionFromText,
  emptyRecipeDetails,
  makeRecipeContent,
  formatRecipeIngredient,
  recipeContentBlockers,
} from "./content.js";
export { scaleRecipeIngredients } from "./scaling.js";
export type { RecipeScalingResult } from "./scaling.js";

export {
  PlanningDifficulty,
  PlanningLeftovers,
  PlanningMealType,
  PlanningTags,
  PlanningTotalTimeBand,
} from "./planning-tags.js";
export {
  RecipeEditableField,
  RecipeReviewEditableField,
  RecipeReviewAnswer,
} from "./review.js";

/** Reviewed, source-grounded recipe snapshot available to household planning. */
export const PublishedRecipeSnapshot = Schema.Struct({
  approvedAt: Schema.DateTimeUtcFromString,
  extractionFingerprint: RecipeText,
  importId: Schema.String.pipe(Schema.check(Schema.isUUID())),
  recipe: RecipeContent,
  source: Schema.Struct({
    evidenceFingerprint: RecipeText,
    sourceUrl: Schema.NullOr(RecipeText),
  }),
  tags: PlanningTags,
  version: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1))),
});
export type PublishedRecipeSnapshot = typeof PublishedRecipeSnapshot.Type;
