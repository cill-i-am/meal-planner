import { Effect } from "effect";

import type { AcquisitionGeneration } from "./import-media.model.js";
import type { ImportId } from "./import.contracts.js";

export interface ProviderTerminalDispatchAuthority {
  readonly speechDispatchId: (input: {
    readonly acquisitionGeneration: AcquisitionGeneration;
    readonly importId: ImportId;
  }) => Effect.Effect<string, unknown>;
  readonly visualDispatchId: (input: {
    readonly acquisitionGeneration: AcquisitionGeneration;
    readonly importId: ImportId;
  }) => Effect.Effect<string, unknown>;
}

/**
 * Continue into visual work with the exact speech dispatch that owns the
 * durable transcript. This lookup intentionally runs outside the visual task
 * so a workflow replay from that task re-resolves recovered speech ownership.
 */
export const continueVisualFromSettledSpeech = <A, E, R>(input: {
  readonly acquisitionGeneration: AcquisitionGeneration;
  readonly continueVisual: (dispatchIds: {
    readonly speechDispatchId: string;
    readonly visualDispatchId: string;
  }) => Effect.Effect<A, E, R>;
  readonly importId: ImportId;
  readonly terminalRecovery: ProviderTerminalDispatchAuthority;
}): Effect.Effect<A, E, R> =>
  Effect.all({
    speechDispatchId: input.terminalRecovery.speechDispatchId({
      acquisitionGeneration: input.acquisitionGeneration,
      importId: input.importId,
    }),
    visualDispatchId: input.terminalRecovery.visualDispatchId({
      acquisitionGeneration: input.acquisitionGeneration,
      importId: input.importId,
    }),
  }).pipe(Effect.orDie, Effect.flatMap(input.continueVisual));
