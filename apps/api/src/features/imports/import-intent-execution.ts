import type { RecipeImportIntentId } from "@meal-planner/recipe-import-api";
import { Context, Effect, Schema } from "effect";

import type { ImportIntentExecutionGeneration } from "./import-intent-transition.js";
import type { ImportIntentRepositoryShape } from "./import.repository.js";

export interface ImportIntentWorkflowTerminatorShape {
  readonly terminate: (
    intentId: RecipeImportIntentId
  ) => Effect.Effect<void, unknown>;
}

export class ImportIntentWorkflowTerminator extends Context.Service<
  ImportIntentWorkflowTerminator,
  ImportIntentWorkflowTerminatorShape
>()("meal-planner/ImportIntentWorkflowTerminator") {}

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
  repository: Pick<ImportIntentRepositoryShape, "isIntentExecutionCurrent">,
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
