import { RecipeImportIntentId } from "@meal-planner/recipe-import-api";
import { Schema } from "effect";

export const RecipeImportSearch = Schema.Struct({
  intentId: Schema.optional(RecipeImportIntentId),
});
export type RecipeImportSearch = typeof RecipeImportSearch.Type;

export const decodeRecipeImportSearch = Schema.decodeUnknownSync(
  RecipeImportSearch,
  { onExcessProperty: "error" }
);
