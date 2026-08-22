import type { Effect } from "effect";

import type { AcquisitionGeneration } from "./import-media.model.js";
import type { ImportId, ImportTimestamp } from "./import.contracts.js";
import type { ImportTransitionError } from "./import.repository.js";

export interface CompletedTranscriptEvidence {
  readonly byteLength?: number;
  readonly completedAt: ImportTimestamp;
  readonly cost: {
    readonly certainty: "estimated" | "known";
    readonly currency: "USD";
    readonly estimatedMicroUsd: number;
  };
  readonly detectedLanguage: string;
  readonly deleteAt?: ImportTimestamp;
  readonly dispatchId: string;
  readonly generation: AcquisitionGeneration;
  readonly importId: ImportId;
  readonly model: string;
  readonly provider: string;
  readonly segmentsCount: number;
  readonly sourceMediaSha256: string;
  readonly transcriptKey: string;
  readonly transcriptSha256: string;
  readonly usage: {
    readonly audioDurationMilliseconds: number;
    readonly inputBytes: number;
  };
}

export type SpeechDispatchClaim =
  | {
      readonly _tag: "Completed";
      readonly evidence: CompletedTranscriptEvidence;
    }
  | { readonly _tag: "DispatchClaimed"; readonly dispatchId: string }
  | {
      readonly _tag: "Failed";
      readonly code: string;
      readonly dispatchId: string;
    }
  | { readonly _tag: "ResumeDispatch"; readonly dispatchId: string };

export interface SpeechTranscriptionRepository {
  readonly claim: (input: {
    readonly dispatchId: string;
    readonly generation: AcquisitionGeneration;
    readonly importId: ImportId;
    readonly sourceMediaSha256: string;
    readonly startedAt: ImportTimestamp;
  }) => Effect.Effect<SpeechDispatchClaim, ImportTransitionError>;
  readonly complete: (
    evidence: CompletedTranscriptEvidence
  ) => Effect.Effect<CompletedTranscriptEvidence, ImportTransitionError>;
  readonly fail: (input: {
    readonly completedAt: ImportTimestamp;
    readonly dispatchId: string;
    readonly failureCode:
      | "audio_extraction_failed"
      | "outcome_unknown"
      | "source_evidence_invalid"
      | "transcription_failed"
      | "transcript_evidence_failed";
    readonly generation: AcquisitionGeneration;
    readonly importId: ImportId;
    readonly sourceMediaSha256: string;
  }) => Effect.Effect<void, ImportTransitionError>;
}
