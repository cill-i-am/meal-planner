import { Effect } from "effect";

import type { AcquisitionGeneration } from "./import-media.model.js";
import type { ProviderTerminalRecoveryRepository } from "./import-provider-terminal.js";
import type { ImportId } from "./import.contracts.js";

/**
 * Continue into visual work with the exact speech dispatch that owns the
 * durable transcript. This lookup intentionally runs outside the visual task
 * so a workflow replay from that task re-resolves recovered speech ownership.
 */
export const continueVisualFromSettledSpeech = <A, E, R>(input: {
  readonly acquisitionGeneration: AcquisitionGeneration;
  readonly continueVisual: (speechDispatchId: string) => Effect.Effect<A, E, R>;
  readonly importId: ImportId;
  readonly terminalRecovery: ProviderTerminalRecoveryRepository;
}): Effect.Effect<A, E, R> =>
  input.terminalRecovery
    .speechDispatchId({
      acquisitionGeneration: input.acquisitionGeneration,
      importId: input.importId,
    })
    .pipe(Effect.orDie, Effect.flatMap(input.continueVisual));
