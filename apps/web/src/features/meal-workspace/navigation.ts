import {
  RecipeId,
  RecipeImportIntentId,
} from "@meal-planner/recipe-import-api";
import { Schema } from "effect";

export const WorkspaceArea = Schema.Literals([
  "tastes",
  "weeks",
  "food",
  "family",
]);
export type WorkspaceArea = typeof WorkspaceArea.Type;

export const WorkspaceSearch = Schema.Struct({
  area: Schema.optional(WorkspaceArea),
  import: Schema.optional(Schema.Boolean),
  intentId: Schema.optional(RecipeImportIntentId),
  recipeId: Schema.optional(RecipeId),
});
export type WorkspaceSearch = typeof WorkspaceSearch.Type;

export const decodeWorkspaceSearch = Schema.decodeUnknownSync(WorkspaceSearch, {
  onExcessProperty: "error",
});

export const workspaceArea = (search: WorkspaceSearch): WorkspaceArea =>
  search.intentId !== undefined ||
  search.recipeId !== undefined ||
  search.import === true
    ? "food"
    : (search.area ?? "tastes");
