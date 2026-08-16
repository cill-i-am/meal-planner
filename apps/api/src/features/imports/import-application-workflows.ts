import { Effect, Option } from "effect";

import { resolvePreparedVisualRecovery } from "./import-prepared-visual-recovery.js";
import type { ProviderTaskCheckpoint } from "./import-provider-workflow-checkpoint.js";
import type { ImportId } from "./import.contracts.js";
import type { StoredImport } from "./import.repository.js";

/**
 * Continue only an admitted post-transcription recovery. The composition has
 * no acquisition or speech operation available, preventing replay upstream.
 */
export const runPreparedVisualRecoveryWorkflowBranch = <
  Failure,
  Requirements,
>(input: {
  readonly completeVisualAndRecipe: (
    recovery: Extract<
      ReturnType<typeof resolvePreparedVisualRecovery>,
      { readonly _tag: "PreparedVisualRecoveryReady" }
    >
  ) => Effect.Effect<Failure | null, never, Requirements>;
  readonly findStored: Effect.Effect<Option.Option<StoredImport>>;
  readonly importId: ImportId;
  readonly resolveDispatchIds: (stored: StoredImport) => Effect.Effect<{
    readonly speechDispatchId: string;
    readonly visualDispatchId: string;
  }>;
}) =>
  Effect.gen(function* runPreparedVisualRecoveryBranch() {
    const stored = Option.getOrNull(yield* input.findStored);
    if (stored === null) {
      return resolvePreparedVisualRecovery({
        importId: input.importId,
        speechDispatchId: "",
        stored,
        visualDispatchId: "",
      });
    }
    const dispatchIds = yield* input.resolveDispatchIds(stored);
    const recovery = resolvePreparedVisualRecovery({
      importId: input.importId,
      stored,
      ...dispatchIds,
    });
    if (recovery._tag === "PreparedVisualRecoveryRejected") {
      return recovery;
    }
    const failure = yield* input.completeVisualAndRecipe(recovery);
    return failure ?? { _tag: "PreparedVisualRecoveryCompleted" as const };
  }).pipe(Effect.withSpan("ImportRuntime.runPreparedVisualRecovery"));

type ProviderCheckpoint = typeof ProviderTaskCheckpoint.Type;
type FailedProviderCheckpoint = Extract<
  ProviderCheckpoint,
  { readonly _tag: "Failed" }
>;

/** Complete the ordered visual-then-recipe application workflow once. */
export const runImportVisualAndRecipeWorkflow = Effect.fn(
  "ImportRuntime.runVisualAndRecipe"
)(function* runImportVisualAndRecipeWorkflowEffect<Requirements>(input: {
  readonly persistTerminal: (
    failure: FailedProviderCheckpoint
  ) => Effect.Effect<void, never, Requirements>;
  readonly recipe: Effect.Effect<ProviderCheckpoint, never, Requirements>;
  readonly visual: Effect.Effect<ProviderCheckpoint, never, Requirements>;
}) {
  const visual = yield* input.visual;
  if (visual._tag === "Failed") {
    yield* input.persistTerminal(visual);
    return visual;
  }
  const recipe = yield* input.recipe;
  if (recipe._tag === "Failed") {
    yield* input.persistTerminal(recipe);
    return recipe;
  }
  return null;
});
