import type { Effect } from "effect";
import { Context } from "effect";

import type { HouseholdAdmitRecipeImportResult } from "../households/recipe-import/household-recipe-import.contract.js";
import type { HouseholdMemberAdmission } from "../households/rpc/command-envelope.js";

export interface RecipeImportWorkflowDispatcherService {
  readonly dispatch: (input: {
    readonly admission: HouseholdMemberAdmission;
    readonly committed: HouseholdAdmitRecipeImportResult;
  }) => Effect.Effect<void>;
}

export class RecipeImportWorkflowDispatcher extends Context.Service<
  RecipeImportWorkflowDispatcher,
  RecipeImportWorkflowDispatcherService
>()("meal-planner/RecipeImportWorkflowDispatcher") {}
