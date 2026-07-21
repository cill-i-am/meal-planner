import { Context, Schema } from "effect";
import type { Effect } from "effect";

import type { AcquisitionGeneration } from "./import-media.model.js";
import type { ImportId } from "./import.contracts.js";

export const MaximumVisualFrames = 12;
export const MaximumVisualFrameBytes = 1_048_576;
export const MaximumVisualInputBytes = 6_291_456;
export const MaximumVisualObservations = 256;
export const VisualConfidenceThreshold = 0.8;

const TrimmedNonEmptyString = Schema.String.pipe(
  Schema.check(Schema.isTrimmed(), Schema.isNonEmpty())
);
const SafeAdapterLabel = TrimmedNonEmptyString.pipe(
  Schema.check(Schema.isMaxLength(64))
);
const Sha256Hex = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-f\d]{64}$/u))
);
const SafeInteger = Schema.Number.pipe(
  Schema.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(0),
    Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)
  )
);
const PositiveInteger = SafeInteger.pipe(Schema.check(Schema.isGreaterThan(0)));
const UnitInterval = Schema.Number.pipe(
  Schema.check(
    Schema.isFinite(),
    Schema.isGreaterThanOrEqualTo(0),
    Schema.isLessThanOrEqualTo(1)
  )
);

/** Normalized rectangular evidence region relative to a source frame. */
export const VisualEvidenceRegion = Schema.Struct({
  height: UnitInterval,
  width: UnitInterval,
  x: UnitInterval,
  y: UnitInterval,
}).pipe(
  Schema.check(
    Schema.makeFilter(
      (region) =>
        region.height > 0 &&
        region.width > 0 &&
        region.x + region.width <= 1 &&
        region.y + region.height <= 1,
      { expected: "a positive region contained within the source frame" }
    )
  )
);
export type VisualEvidenceRegion = typeof VisualEvidenceRegion.Type;

/** Provider-neutral normalized visual observation. */
export const VisualEvidenceObservation = Schema.Struct({
  confidence: UnitInterval,
  frameIndex: SafeInteger,
  kind: Schema.Literal("visible_text"),
  regions: Schema.NonEmptyArray(VisualEvidenceRegion).pipe(
    Schema.check(Schema.isMaxLength(16))
  ),
  text: TrimmedNonEmptyString.pipe(Schema.check(Schema.isMaxLength(4096))),
  timestampMilliseconds: SafeInteger,
});
export type VisualEvidenceObservation = typeof VisualEvidenceObservation.Type;

/** Normalized result returned by any future OCR or vision adapter. */
export const VisualEvidence = Schema.Struct({
  cost: Schema.Struct({
    certainty: Schema.Literals(["estimated", "known"]),
    currency: Schema.Literal("USD"),
    estimatedMicroUsd: SafeInteger,
  }),
  model: SafeAdapterLabel,
  observations: Schema.Array(VisualEvidenceObservation).pipe(
    Schema.check(Schema.isMaxLength(MaximumVisualObservations))
  ),
  outcome: Schema.Literals(["empty", "found", "low_confidence"]),
  provider: SafeAdapterLabel,
  usage: Schema.Struct({
    inputBytes: PositiveInteger,
    inputFrames: PositiveInteger.pipe(
      Schema.check(Schema.isLessThanOrEqualTo(MaximumVisualFrames))
    ),
    modelCalls: Schema.Literal(1),
  }),
}).pipe(
  Schema.check(
    Schema.makeFilter(
      (evidence) => {
        switch (evidence.outcome) {
          case "empty": {
            return evidence.observations.length === 0;
          }
          case "found": {
            return (
              evidence.observations.length > 0 &&
              evidence.observations.some(
                ({ confidence }) => confidence >= VisualConfidenceThreshold
              )
            );
          }
          case "low_confidence": {
            return (
              evidence.observations.length > 0 &&
              evidence.observations.every(
                ({ confidence }) => confidence < VisualConfidenceThreshold
              )
            );
          }
          default: {
            return false;
          }
        }
      },
      { expected: "observations consistent with the visual outcome" }
    )
  )
);
export type VisualEvidence = typeof VisualEvidence.Type;

/** One deterministic media-tooling frame, before private R2 persistence. */
export interface VisualFrameArtifact {
  readonly bytes: Uint8Array;
  readonly height: number;
  readonly mimeType: "image/jpeg";
  readonly sha256: string;
  readonly timestampMilliseconds: number;
  readonly width: number;
}

export interface VisualFrameSamplingInput {
  readonly durationMilliseconds: number;
  readonly generation: AcquisitionGeneration;
  readonly importId: ImportId;
  readonly mediaKey: string;
  readonly sourceMediaSha256: string;
}

export interface VisualFrameSamplingFailure {
  readonly _tag: "VisualFrameSamplingFailure";
  readonly code: "frame_sampling_failed";
}

export interface VisualFrameSamplerShape {
  readonly sample: (
    input: VisualFrameSamplingInput
  ) => Effect.Effect<
    readonly VisualFrameArtifact[],
    VisualFrameSamplingFailure
  >;
}

export interface VisualEvidenceExtractionInput {
  readonly dispatchId: string;
  readonly frames: readonly VisualFrameArtifact[];
  readonly generation: AcquisitionGeneration;
  readonly importId: ImportId;
  readonly sourceMediaSha256: string;
}

/** Safe classified adapter failure without a provider body or secret. */
export interface VisualEvidenceExtractionFailure {
  readonly _tag: "VisualEvidenceExtractionFailure";
  readonly code: "outcome_unknown" | "visual_extraction_failed";
}

export interface VisualEvidenceExtractorShape {
  readonly extract: (
    input: VisualEvidenceExtractionInput
  ) => Effect.Effect<VisualEvidence, VisualEvidenceExtractionFailure>;
}

/** Replaceable provider-neutral visual evidence capability. */
export class VisualEvidenceExtractor extends Context.Service<
  VisualEvidenceExtractor,
  VisualEvidenceExtractorShape
>()("meal-planner/VisualEvidenceExtractor") {}

export const decodeVisualEvidence = Schema.decodeUnknownEffect(VisualEvidence, {
  onExcessProperty: "error",
});

/** Validate deterministic sampling bounds before frames are stored or dispatched. */
export const validateVisualFrames = (
  frames: readonly VisualFrameArtifact[],
  durationMilliseconds: number
) => {
  if (
    frames.length < 1 ||
    frames.length > MaximumVisualFrames ||
    !Number.isSafeInteger(durationMilliseconds) ||
    durationMilliseconds <= 0
  ) {
    return false;
  }
  let previousTimestamp = -1;
  let totalBytes = 0;
  for (const frame of frames) {
    totalBytes += frame.bytes.byteLength;
    if (
      frame.bytes.byteLength < 1 ||
      frame.bytes.byteLength > MaximumVisualFrameBytes ||
      !Number.isSafeInteger(frame.timestampMilliseconds) ||
      frame.timestampMilliseconds < 0 ||
      frame.timestampMilliseconds >= durationMilliseconds ||
      frame.timestampMilliseconds <= previousTimestamp ||
      !Number.isSafeInteger(frame.height) ||
      frame.height <= 0 ||
      !Number.isSafeInteger(frame.width) ||
      frame.width <= 0 ||
      frame.mimeType !== "image/jpeg" ||
      Schema.decodeUnknownOption(Sha256Hex)(frame.sha256)._tag === "None"
    ) {
      return false;
    }
    previousTimestamp = frame.timestampMilliseconds;
  }
  return totalBytes <= MaximumVisualInputBytes;
};
