import type { StoredImport } from "./import.repository.js";

export type PreparedVisualRecoveryResolution =
  | {
      readonly _tag: "PreparedVisualRecoveryReady";
      readonly acquisitionGeneration: StoredImport["acquisitionGeneration"];
      readonly speechDispatchId: string;
      readonly visualDispatchId: string;
    }
  | {
      readonly _tag: "PreparedVisualRecoveryRejected";
      readonly code: "state_mismatch";
    };

const rejected = (): PreparedVisualRecoveryResolution => ({
  _tag: "PreparedVisualRecoveryRejected",
  code: "state_mismatch",
});

/**
 * Admit only the already-prepared second visual recovery for the exact
 * transcript-owning generation. This private workflow entrypoint contains no
 * source or provider payload and cannot manufacture a new recovery lineage.
 */
export const resolvePreparedVisualRecovery = (input: {
  readonly importId: StoredImport["view"]["id"];
  readonly speechDispatchId: string;
  readonly stored: null | StoredImport;
  readonly visualDispatchId: string;
}): PreparedVisualRecoveryResolution => {
  const { stored } = input;
  if (
    stored === null ||
    stored.view.id !== input.importId ||
    stored.view.status.kind !== "transcribed" ||
    stored.view.evidence.length !== 3 ||
    stored.view.evidence[0]?.kind !== "original_media" ||
    stored.view.evidence[1]?.kind !== "acquisition_manifest" ||
    stored.view.evidence[2]?.kind !== "speech_transcript"
  ) {
    return rejected();
  }
  const rootSpeechDispatchId = `speech:${input.importId}:${stored.acquisitionGeneration}`;
  const expectedVisualDispatchId = `visual:${input.importId}:${stored.acquisitionGeneration}:recovery:2`;
  if (
    !(
      input.speechDispatchId === rootSpeechDispatchId ||
      input.speechDispatchId === `${rootSpeechDispatchId}:recovery:1`
    ) ||
    input.visualDispatchId !== expectedVisualDispatchId
  ) {
    return rejected();
  }
  return {
    _tag: "PreparedVisualRecoveryReady",
    acquisitionGeneration: stored.acquisitionGeneration,
    speechDispatchId: input.speechDispatchId,
    visualDispatchId: input.visualDispatchId,
  };
};
