import { RecipeImportIntentId } from "@meal-planner/recipe-import-api";
import { Schema } from "effect";

import {
  RecipeImportProfileAlias,
  resolveRecipeImportProfileAlias,
} from "./profiles.js";
import type {
  RecipeImportProfileAlias as RecipeImportProfileAliasType,
  RecipeImportPublicProfileConfiguration,
} from "./profiles.js";

export const RecipeImportSearch = Schema.Struct({
  intentId: Schema.optional(RecipeImportIntentId),
  profile: Schema.optional(RecipeImportProfileAlias),
});
export type RecipeImportSearch = typeof RecipeImportSearch.Type;

export const decodeRecipeImportSearch = (search: unknown) =>
  Schema.decodeUnknownSync(RecipeImportSearch, {
    onExcessProperty: "error",
  })(search);

export const canonicalizeRecipeImportSearch = (
  configuration: RecipeImportPublicProfileConfiguration,
  searchInput: unknown
): RecipeImportSearch & { readonly profile: RecipeImportProfileAliasType } => {
  const search = decodeRecipeImportSearch(searchInput);
  return {
    ...search,
    profile: resolveRecipeImportProfileAlias(configuration, search.profile),
  };
};

export const recipeImportProfileSwitchSearch = (
  _previous: RecipeImportSearch,
  profile: RecipeImportProfileAliasType
): RecipeImportSearch => ({ profile });

export const recipeImportIntentRedirectSearch = (
  previous: RecipeImportSearch,
  profile: RecipeImportProfileAliasType,
  intentId: typeof RecipeImportIntentId.Type
): RecipeImportSearch => ({ ...previous, intentId, profile });

export const recipeImportPageSessionKey = (
  profile: RecipeImportProfileAliasType,
  intentId?: typeof RecipeImportIntentId.Type
) => `${profile}:${intentId ?? "new"}`;
