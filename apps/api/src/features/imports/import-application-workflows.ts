import { Effect } from "effect";

import type { ProviderTaskCheckpoint } from "./import-provider-workflow-checkpoint.js";

type ProviderCheckpoint = typeof ProviderTaskCheckpoint.Type;
type FailedProviderCheckpoint = Extract<
  ProviderCheckpoint,
  { readonly _tag: "Failed" }
>;

/** Preserve carousel evidence while exposing the same truthful visual seams. */
export const runImportCarouselVisualAndRecipeWorkflow = Effect.fn(
  "ImportRuntime.runCarouselVisualAndRecipe"
)(function* runImportCarouselVisualAndRecipeWorkflowEffect<
  Evidence,
  Failure extends { readonly _tag: "Failed" },
  Recipe,
  Requirements,
>(input: {
  readonly lifecycle: {
    readonly beforeRecipe: Effect.Effect<void, never, Requirements>;
    readonly beforeVisual: Effect.Effect<void, never, Requirements>;
    readonly visualCompleted: Effect.Effect<void, never, Requirements>;
  };
  readonly recipe: (visual: {
    readonly _tag: "Succeeded";
    readonly evidence: Evidence;
  }) => Effect.Effect<Recipe, never, Requirements>;
  readonly visual: Effect.Effect<
    Failure | { readonly _tag: "Succeeded"; readonly evidence: Evidence },
    never,
    Requirements
  >;
}) {
  yield* input.lifecycle.beforeVisual;
  const visual = yield* input.visual;
  if (visual._tag === "Failed") {
    return visual;
  }
  yield* input.lifecycle.visualCompleted;
  yield* input.lifecycle.beforeRecipe;
  return yield* input.recipe(visual);
});

/** Complete the ordered visual-then-recipe application workflow once. */
export const runImportVisualAndRecipeWorkflow = Effect.fn(
  "ImportRuntime.runVisualAndRecipe"
)(function* runImportVisualAndRecipeWorkflowEffect<
  PersistedTerminal extends { readonly ownershipId: string },
  PersistenceFailure,
  Requirements,
>(input: {
  readonly lifecycle?: {
    readonly beforeRecipe: Effect.Effect<void, never, Requirements>;
    readonly beforeVisual: Effect.Effect<void, never, Requirements>;
    readonly failurePersisted?: (
      failure: FailedProviderCheckpoint,
      terminal: PersistedTerminal
    ) => Effect.Effect<void, never, Requirements>;
    readonly visualCompleted: Effect.Effect<void, never, Requirements>;
  };
  readonly persistTerminal: (
    failure: FailedProviderCheckpoint
  ) => Effect.Effect<PersistedTerminal, PersistenceFailure, Requirements>;
  readonly recipe: Effect.Effect<ProviderCheckpoint, never, Requirements>;
  readonly visual: Effect.Effect<ProviderCheckpoint, never, Requirements>;
}) {
  if (input.lifecycle !== undefined) {
    yield* input.lifecycle.beforeVisual;
  }
  const visual = yield* input.visual;
  if (visual._tag === "Failed") {
    const terminal = yield* input.persistTerminal(visual);
    if (input.lifecycle?.failurePersisted !== undefined) {
      yield* input.lifecycle.failurePersisted(visual, terminal);
    }
    return visual;
  }
  if (input.lifecycle !== undefined) {
    yield* input.lifecycle.visualCompleted;
    yield* input.lifecycle.beforeRecipe;
  }
  const recipe = yield* input.recipe;
  if (recipe._tag === "Failed") {
    const terminal = yield* input.persistTerminal(recipe);
    if (input.lifecycle?.failurePersisted !== undefined) {
      yield* input.lifecycle.failurePersisted(recipe, terminal);
    }
    return recipe;
  }
  return null;
});
