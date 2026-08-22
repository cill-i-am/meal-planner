import type { Effect, Option } from "effect";

import type {
  TikTokCarouselFailureCode,
  TikTokCarouselRecovery,
} from "./import-carousel-adapter.js";
import type { AcquisitionGeneration } from "./import-media.model.js";
import type {
  ImportId,
  ImportTimestamp,
  SourceCanonicalId,
} from "./import.contracts.js";
import type { ImportTransitionError } from "./import.repository.js";

export interface CompletedCarouselEvidence {
  readonly byteLength?: number;
  readonly completedAt: ImportTimestamp;
  readonly descriptorFingerprint: string;
  readonly deleteAt?: ImportTimestamp;
  readonly dispatchId: string;
  readonly generation: AcquisitionGeneration;
  readonly imageCount: number;
  readonly importId: ImportId;
  readonly manifestKey: string;
  readonly manifestSha256: string;
}

export type CarouselEvidenceClaim =
  | { readonly _tag: "Completed"; readonly evidence: CompletedCarouselEvidence }
  | {
      readonly _tag: "Failed";
      readonly code: TikTokCarouselFailureCode;
      readonly recovery: TikTokCarouselRecovery;
    }
  | { readonly _tag: "DispatchClaimed" }
  | { readonly _tag: "ResumeDispatch" };

export interface CarouselEvidenceRepository {
  readonly findParent: (importId: ImportId) => Effect.Effect<
    Option.Option<{
      readonly canonicalId: SourceCanonicalId;
      readonly generation: AcquisitionGeneration;
      readonly status: string;
    }>,
    ImportTransitionError
  >;
  readonly claim: (input: {
    readonly descriptorFingerprint: string;
    readonly dispatchId: string;
    readonly generation: AcquisitionGeneration;
    readonly importId: ImportId;
    readonly startedAt: ImportTimestamp;
  }) => Effect.Effect<CarouselEvidenceClaim, ImportTransitionError>;
  readonly complete: (
    evidence: CompletedCarouselEvidence
  ) => Effect.Effect<CompletedCarouselEvidence, ImportTransitionError>;
  readonly fail: (input: {
    readonly code: TikTokCarouselFailureCode;
    readonly completedAt: ImportTimestamp;
    readonly descriptorFingerprint: string;
    readonly generation: AcquisitionGeneration;
    readonly importId: ImportId;
    readonly recovery: TikTokCarouselRecovery;
  }) => Effect.Effect<void, ImportTransitionError>;
}
