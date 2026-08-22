import type { Effect } from "effect";

import type { AcquisitionGeneration } from "./import-media.model.js";
import type { ImportId, ImportTimestamp } from "./import.contracts.js";
import type { ImportTransitionError } from "./import.repository.js";

export type VisualEvidenceOutcome = "empty" | "found" | "low_confidence";
export interface CompletedVisualEvidence {
  readonly byteLength?: number;
  readonly completedAt: ImportTimestamp;
  readonly cost: {
    readonly certainty: "estimated" | "known";
    readonly currency: "USD";
    readonly estimatedMicroUsd: number;
  };
  readonly dispatchId: string;
  readonly deleteAt?: ImportTimestamp;
  readonly generation: AcquisitionGeneration;
  readonly importId: ImportId;
  readonly manifestKey: string;
  readonly manifestSha256: string;
  readonly model: string;
  readonly observationsCount: number;
  readonly outcome: VisualEvidenceOutcome;
  readonly provider: string;
  readonly sourceMediaSha256: string;
  readonly usage: {
    readonly inputBytes: number;
    readonly inputFrames: number;
    readonly modelCalls: 1;
  };
}

export type VisualDispatchClaim =
  | { readonly _tag: "Completed"; readonly evidence: CompletedVisualEvidence }
  | { readonly _tag: "DispatchClaimed"; readonly dispatchId: string }
  | {
      readonly _tag: "Failed";
      readonly code: string;
      readonly dispatchId: string;
    }
  | { readonly _tag: "ResumeDispatch"; readonly dispatchId: string };
export type VisualEvidenceFailureCode =
  | "frame_evidence_failed"
  | "frame_sampling_failed"
  | "outcome_unknown"
  | "source_evidence_invalid"
  | "visual_evidence_failed"
  | "visual_extraction_failed";

export interface VisualEvidenceRepository {
  readonly claim: (input: {
    readonly dispatchId: string;
    readonly generation: AcquisitionGeneration;
    readonly importId: ImportId;
    readonly sourceMediaSha256: string;
    readonly startedAt: ImportTimestamp;
  }) => Effect.Effect<VisualDispatchClaim, ImportTransitionError>;
  readonly complete: (
    evidence: CompletedVisualEvidence
  ) => Effect.Effect<CompletedVisualEvidence, ImportTransitionError>;
  readonly fail: (input: {
    readonly completedAt: ImportTimestamp;
    readonly dispatchId: string;
    readonly failureCode: VisualEvidenceFailureCode;
    readonly generation: AcquisitionGeneration;
    readonly importId: ImportId;
    readonly sourceMediaSha256: string;
  }) => Effect.Effect<void, ImportTransitionError>;
}
