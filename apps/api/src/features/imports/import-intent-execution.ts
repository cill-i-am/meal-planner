import type { RecipeImportIntentId } from "@meal-planner/recipe-import-api";
import { Context, Data, Effect, Schema } from "effect";

import type { ImportIntentExecutionGeneration } from "./import-intent-transition.js";
import type { ImportIntentRepository } from "./import.repository.js";

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

export const ImportIntentExecutionSuperseded = Schema.TaggedStruct(
  "ImportIntentExecutionSuperseded",
  {}
);
export type ImportIntentExecutionSuperseded =
  typeof ImportIntentExecutionSuperseded.Type;

const importIntentExecutionSuperseded = Schema.decodeUnknownSync(
  ImportIntentExecutionSuperseded
)({
  _tag: "ImportIntentExecutionSuperseded",
});

export const runCurrentImportIntentExecution = Effect.fn(
  "RecipeImportIntent.runCurrentExecution"
)(function* runCurrentImportIntentExecutionEffect<
  Success,
  Failure,
  Requirements,
>(
  repository: Pick<ImportIntentRepository, "isIntentExecutionCurrent">,
  intentId: RecipeImportIntentId,
  executionGeneration: ImportIntentExecutionGeneration,
  run: () => Effect.Effect<Success, Failure, Requirements>
) {
  const isCurrent = yield* repository.isIntentExecutionCurrent(
    intentId,
    executionGeneration
  );
  return isCurrent ? yield* run() : importIntentExecutionSuperseded;
});
