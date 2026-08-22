import type { RecipeImportIntentId } from "@meal-planner/recipe-import-api";
import type { Effect } from "effect";
import { Context, Data } from "effect";

export class ImportWorkflowTerminationUnavailable extends Data.TaggedError(
  "ImportWorkflowTerminationUnavailable"
) {}

export interface ImportIntentWorkflowTerminator {
  readonly terminate: (
    intentId: RecipeImportIntentId
  ) => Effect.Effect<void, ImportWorkflowTerminationUnavailable>;
}

export const ImportIntentWorkflowTerminator =
  Context.Service<ImportIntentWorkflowTerminator>(
    "meal-planner/ImportIntentWorkflowTerminator"
  );
