import { createFileRoute } from "@tanstack/react-router";

import type { RecipeImportOperations } from "../features/recipe-import/contracts.js";
import { RecipeImportPage } from "../features/recipe-import/recipe-import-page.js";
import {
  approveRecipeDraft,
  listMatchingRecipeBankEntry,
  loadRecipeReview,
  pollRecipeImport,
  submitRecipeImport,
} from "../features/recipe-import/server/functions.js";

const operations: RecipeImportOperations = {
  approve: (data) => approveRecipeDraft({ data }),
  listBank: (data) => listMatchingRecipeBankEntry({ data }),
  loadReview: (data) => loadRecipeReview({ data }),
  poll: (data) => pollRecipeImport({ data }),
  submit: (data) => submitRecipeImport({ data }),
};

const RecipeImportRoute = () => <RecipeImportPage operations={operations} />;

export const Route = createFileRoute("/")({
  component: RecipeImportRoute,
});
