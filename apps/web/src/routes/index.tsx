import {
  Recipe,
  RecipeImportAction,
  RecipeImportIntentId,
  RecipeImportIntent,
} from "@meal-planner/recipe-import-api";
import { createFileRoute, useSearch } from "@tanstack/react-router";
import { Schema } from "effect";

import type { RecipeImportOperations } from "../features/recipe-import/operations.js";
import { RecipeImportPage } from "../features/recipe-import/recipe-import-page.js";
import {
  answerRecipeImportAction,
  cancelRecipeImportIntent,
  confirmRecipeImportAction,
  createRecipeImportIntent,
  getImportedRecipe,
  getRecipeImportAction,
  getRecipeImportIntent,
} from "../features/recipe-import/server/functions.js";

const operations: RecipeImportOperations = {
  answerAction: async (data) =>
    Schema.decodeUnknownSync(RecipeImportIntent)(
      await answerRecipeImportAction({ data })
    ),
  cancel: async (data) =>
    Schema.decodeUnknownSync(RecipeImportIntent)(
      await cancelRecipeImportIntent({ data })
    ),
  confirmAction: async (data) =>
    Schema.decodeUnknownSync(RecipeImportIntent)(
      await confirmRecipeImportAction({ data })
    ),
  create: async (data) =>
    Schema.decodeUnknownSync(RecipeImportIntent)(
      await createRecipeImportIntent({ data })
    ),
  getAction: async (data) =>
    Schema.decodeUnknownSync(RecipeImportAction)(
      await getRecipeImportAction({ data })
    ),
  getIntent: async (data) =>
    Schema.decodeUnknownSync(RecipeImportIntent)(
      await getRecipeImportIntent({ data })
    ),
  getRecipe: async (data) =>
    Schema.decodeUnknownSync(Recipe)(await getImportedRecipe({ data })),
};

const RecipeImportSearch = Schema.Struct({
  intentId: Schema.optional(RecipeImportIntentId),
});

const RecipeImportRoute = () => {
  const { intentId } = useSearch({ from: "/" });
  return (
    <RecipeImportPage
      {...(intentId === undefined ? {} : { initialIntentId: intentId })}
      operations={operations}
    />
  );
};

export const Route = createFileRoute("/")({
  component: RecipeImportRoute,
  validateSearch: (search) =>
    Schema.decodeUnknownSync(RecipeImportSearch, {
      onExcessProperty: "error",
    })(search),
});
