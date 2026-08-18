import { RecipeImportIntentId } from "@meal-planner/recipe-import-api";
import { Schema } from "effect";

export const RecipeImportSearch = Schema.Struct({
  intentId: Schema.optional(RecipeImportIntentId),
});
export type RecipeImportSearch = typeof RecipeImportSearch.Type;

export const decodeRecipeImportSearch = (search: unknown) =>
  Schema.decodeUnknownSync(RecipeImportSearch, {
    onExcessProperty: "error",
  })(search);

export const recipeImportIntentRedirectSearch = (
  previous: RecipeImportSearch,
  intentId: typeof RecipeImportIntentId.Type
): RecipeImportSearch => ({ ...previous, intentId });

export const recipeImportPageSessionKey = (
  householdId: string,
  intentId?: typeof RecipeImportIntentId.Type
) => `${householdId}:${intentId ?? "new"}`;
