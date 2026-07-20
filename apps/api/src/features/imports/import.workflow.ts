import { Context, Effect, Layer } from "effect";

import type { ImportId } from "./import.contracts.js";

export interface ImportWorkflowStarterShape {
  readonly start: (importId: ImportId) => Effect.Effect<void>;
}

export class ImportWorkflowStarter extends Context.Service<
  ImportWorkflowStarter,
  ImportWorkflowStarterShape
>()("meal-planner/ImportWorkflowStarter") {}

/** GAIA-109 replaces this inert seam with the queued acquisition workflow. */
export const ImportWorkflowStarterDeferred = Layer.succeed(
  ImportWorkflowStarter,
  ImportWorkflowStarter.of({ start: () => Effect.void })
);
