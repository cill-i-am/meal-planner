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
const ProviderVisualConfidence = Schema.Number.pipe(
  Schema.check(
    Schema.isFinite(),
    Schema.isGreaterThanOrEqualTo(0),
    Schema.isLessThanOrEqualTo(100)
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

/** Strict model-owned observation fields before trusted adapter normalization. */
export const VisualEvidenceSemanticObservation = Schema.Struct({
  confidence: UnitInterval,
  frameIndex: SafeInteger,
  text: TrimmedNonEmptyString.pipe(Schema.check(Schema.isMaxLength(4096))),
});
export type VisualEvidenceSemanticObservation =
  typeof VisualEvidenceSemanticObservation.Type;

/** Derive aggregate outcome only after strict provider observations decode. */
export const visualEvidenceOutcomeForObservations = (
  observations: readonly { readonly confidence: number }[]
): "empty" | "found" | "low_confidence" => {
  if (observations.length === 0) {
    return "empty";
  }
  return observations.some(
    ({ confidence }) => confidence >= VisualConfidenceThreshold
  )
    ? "found"
    : "low_confidence";
};

const visualEvidenceOutcomeMatchesObservations = (evidence: {
  readonly observations: readonly { readonly confidence: number }[];
  readonly outcome: "empty" | "found" | "low_confidence";
}) =>
  evidence.outcome ===
  visualEvidenceOutcomeForObservations(evidence.observations);

/** Strict model-owned visual semantics, excluding adapter transport metadata. */
export const VisualEvidenceSemantics = Schema.Struct({
  observations: Schema.Array(VisualEvidenceSemanticObservation).pipe(
    Schema.check(Schema.isMaxLength(MaximumVisualObservations))
  ),
  outcome: Schema.Literals(["empty", "found", "low_confidence"]),
}).pipe(
  Schema.check(
    Schema.makeFilter(visualEvidenceOutcomeMatchesObservations, {
      expected: "observations consistent with the visual outcome",
    })
  )
);
export type VisualEvidenceSemantics = typeof VisualEvidenceSemantics.Type;

/** Pick one stable source frame for the native single-image vision request. */
export const representativeVisualFrameIndex = (frameCount: number) =>
  Math.floor(frameCount / 2);

/**
 * Closed provider transport schema. Only text and confidence are authoritative.
 * Older model shapes may echo bounded metadata, but the adapter ignores it and
 * derives transport identity and aggregate outcome from trusted inputs.
 */
export const VisualEvidenceProviderSemantics = Schema.Struct({
  observations: Schema.Array(
    Schema.Struct({
      confidence: ProviderVisualConfidence,
      frameIndex: Schema.optionalKey(SafeInteger),
      kind: Schema.optionalKey(Schema.Literal("visible_text")),
      regions: Schema.optionalKey(
        Schema.Array(VisualEvidenceRegion).pipe(
          Schema.check(Schema.isMaxLength(16))
        )
      ),
      text: VisualEvidenceSemanticObservation.fields.text,
      timestampMilliseconds: Schema.optionalKey(SafeInteger),
    })
  ).pipe(Schema.check(Schema.isMaxLength(MaximumVisualObservations))),
  outcome: Schema.optionalKey(
    Schema.Literals(["empty", "found", "low_confidence"])
  ),
});

const VisualProviderRootKeys = new Set(["observations", "outcome"]);
const VisualProviderObservationKeys = new Set([
  "confidence",
  "frameIndex",
  "kind",
  "regions",
  "text",
  "timestampMilliseconds",
]);

const isUnknownRecord = (
  input: unknown
): input is Readonly<Record<string, unknown>> =>
  typeof input === "object" && input !== null && !Array.isArray(input);

const normalizeProviderConfidence = (input: unknown): unknown => {
  if (typeof input !== "string") {
    return input;
  }
  const trimmed = input.trim();
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/u.test(trimmed)) {
    return input;
  }
  return Number(trimmed);
};

/**
 * Project a closed provider response onto its authoritative semantic fields.
 * Known legacy transport fields are intentionally discarded before semantic
 * validation; an unknown key keeps the original value so strict decoding
 * still fails closed.
 */
export const projectVisualProviderSemanticsInput = (
  input: unknown
): unknown => {
  if (
    !isUnknownRecord(input) ||
    Object.keys(input).some((key) => !VisualProviderRootKeys.has(key)) ||
    !Array.isArray(input["observations"])
  ) {
    return input;
  }

  const observations: unknown[] = [];
  for (const observation of input["observations"]) {
    if (
      !isUnknownRecord(observation) ||
      Object.keys(observation).some(
        (key) => !VisualProviderObservationKeys.has(key)
      )
    ) {
      return input;
    }
    observations.push({
      confidence: normalizeProviderConfidence(observation["confidence"]),
      text:
        typeof observation["text"] === "string"
          ? observation["text"].trim()
          : observation["text"],
    });
  }

  return { observations };
};

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
  outcome: VisualEvidenceSemantics.fields.outcome,
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
    Schema.makeFilter(visualEvidenceOutcomeMatchesObservations, {
      expected: "observations consistent with the visual outcome",
    })
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
  readonly code:
    | "insufficient_evidence"
    | "malformed_response"
    | "model_refusal"
    | "outcome_unknown"
    | "provider_unavailable"
    | "throttled"
    | "timeout"
    | "visual_extraction_failed";
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
