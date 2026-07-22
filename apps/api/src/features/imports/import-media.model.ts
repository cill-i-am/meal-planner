import { Schema } from "effect";

import {
  ImportId,
  ImportTimestamp,
  SourceCanonicalId,
} from "./import.contracts.js";

export const MaximumMediaBytes = 268_435_456;
export const MaximumTemporaryBytes = 805_306_368;
export const MaximumTemporaryFiles = 16;
export const MaximumTemporaryFileBytes = 268_435_456;
export const MaximumMediaDurationSeconds = 900;
export const MaximumMetadataStdoutBytes = 1_048_576;
export const MaximumRetainedStderrBytes = 65_536;
export const MaximumConcurrentFragments = 1;
export const MaximumSourceRedirects = 5;
export const EvidenceRetentionSeconds = 604_800;
export const MaximumAcquisitionAttemptSeconds = 330;
export const MaximumR2OperationMilliseconds = 120_000;
export const MaximumLocalCleanupMilliseconds = 5000;
export const MaximumMediaProcessMilliseconds = 180_000;

export const AcquisitionGeneration = Schema.Number.pipe(
  Schema.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(0),
    Schema.isLessThanOrEqualTo(9_007_199_254_740_991)
  ),
  Schema.brand("AcquisitionGeneration")
);
export type AcquisitionGeneration = typeof AcquisitionGeneration.Type;

export const AcquisitionStage = Schema.Literals([
  "container",
  "process",
  "reconcile",
  "resolve",
  "store",
  "validation",
  "verify",
]);
export type AcquisitionStage = typeof AcquisitionStage.Type;

export const MediaStreamSummary = Schema.Struct({
  codec: Schema.String.pipe(
    Schema.check(Schema.isTrimmed(), Schema.isNonEmpty())
  ),
  index: Schema.Number.pipe(
    Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
  ),
});
export type MediaStreamSummary = typeof MediaStreamSummary.Type;

const Sha256Hex = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-f\d]{64}$/u))
);

/** Verified public attribution carried by the private acquisition manifest. */
export const VerifiedSourceMetadata = Schema.Struct({
  canonicalUrl: Schema.String,
  caption: Schema.NullOr(Schema.String),
  creator: Schema.Struct({
    displayName: Schema.NullOr(Schema.String),
    handle: Schema.NullOr(Schema.String),
    id: Schema.NullOr(Schema.String),
  }),
  observedAt: ImportTimestamp,
  provenance: Schema.Struct({
    canonicalUrl: Schema.Literal("provider_observed"),
    caption: Schema.NullOr(Schema.Literal("creator_provided")),
    creator: Schema.Struct({
      displayName: Schema.NullOr(Schema.Literal("provider_observed")),
      handle: Schema.NullOr(Schema.Literal("provider_observed")),
      id: Schema.NullOr(Schema.Literal("provider_observed")),
    }),
    publishedAt: Schema.NullOr(Schema.Literal("provider_observed")),
  }),
  publishedAt: Schema.NullOr(ImportTimestamp),
});
export type VerifiedSourceMetadata = typeof VerifiedSourceMetadata.Type;

export const VerifiedAcquisitionEvidence = Schema.Struct({
  acquiredAt: ImportTimestamp,
  audioStreams: Schema.NonEmptyArray(MediaStreamSummary),
  bytes: Schema.Number.pipe(
    Schema.check(
      Schema.isInt(),
      Schema.isGreaterThan(0),
      Schema.isLessThanOrEqualTo(MaximumMediaBytes)
    )
  ),
  deleteAt: ImportTimestamp,
  durationSeconds: Schema.Number.pipe(
    Schema.check(
      Schema.isFinite(),
      Schema.isGreaterThan(0),
      Schema.isLessThanOrEqualTo(MaximumMediaDurationSeconds)
    )
  ),
  generation: AcquisitionGeneration,
  manifestKey: Schema.String,
  mediaKey: Schema.String,
  sha256: Sha256Hex,
  source: Schema.optionalKey(VerifiedSourceMetadata),
  videoStreams: Schema.NonEmptyArray(MediaStreamSummary),
});
export type VerifiedAcquisitionEvidence =
  typeof VerifiedAcquisitionEvidence.Type;

export const RetryableAcquisitionFailure = Schema.Struct({
  _tag: Schema.Literal("RetryableAcquisitionFailure"),
  stage: AcquisitionStage,
});
export type RetryableAcquisitionFailure =
  typeof RetryableAcquisitionFailure.Type;

export const UnavailableFailure = Schema.Struct({
  _tag: Schema.Literal("Unavailable"),
  code: Schema.Literal("private_or_unavailable"),
});
export type UnavailableFailure = typeof UnavailableFailure.Type;
export const Unavailable = Schema.Struct({
  ...UnavailableFailure.fields,
  generation: AcquisitionGeneration,
});
export type Unavailable = typeof Unavailable.Type;
export const UnsupportedCarouselFailure = Schema.Struct({
  _tag: Schema.Literal("UnsupportedCarousel"),
  code: Schema.Literal("unsupported_carousel"),
});
export type UnsupportedCarouselFailure = typeof UnsupportedCarouselFailure.Type;
export const UnsupportedCarousel = Schema.Struct({
  ...UnsupportedCarouselFailure.fields,
  generation: AcquisitionGeneration,
});
export type UnsupportedCarousel = typeof UnsupportedCarousel.Type;
export const TerminalMediaFailure = Schema.Struct({
  _tag: Schema.Literal("TerminalMedia"),
  code: Schema.Literals([
    "invalid_media",
    "limit_exceeded",
    "unsupported_streams",
  ]),
  stage: AcquisitionStage,
});
export type TerminalMediaFailure = typeof TerminalMediaFailure.Type;
export const TerminalMedia = Schema.Struct({
  ...TerminalMediaFailure.fields,
  generation: AcquisitionGeneration,
});
export type TerminalMedia = typeof TerminalMedia.Type;
export const RetryExhausted = Schema.Struct({
  _tag: Schema.Literal("RetryExhausted"),
  attempts: Schema.Literal(3),
  generation: AcquisitionGeneration,
  stage: AcquisitionStage,
});
export type RetryExhausted = typeof RetryExhausted.Type;

export const ClassifiedAcquisitionFailure = Schema.Union([
  RetryExhausted,
  TerminalMedia,
  Unavailable,
  UnsupportedCarousel,
]);
export type ClassifiedAcquisitionFailure =
  typeof ClassifiedAcquisitionFailure.Type;

export const AcquisitionTaskOutcome = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("VerifiedAcquisition"),
    evidence: VerifiedAcquisitionEvidence,
    generation: AcquisitionGeneration,
  }),
  RetryExhausted,
  TerminalMedia,
  Unavailable,
  UnsupportedCarousel,
]);
export type AcquisitionTaskOutcome = typeof AcquisitionTaskOutcome.Type;

export const TikTokIdentity = Schema.Struct({
  canonicalId: SourceCanonicalId,
  generation: AcquisitionGeneration,
  importId: ImportId,
  kind: Schema.Literal("tiktok"),
});
export type TikTokIdentity = typeof TikTokIdentity.Type;

const generationPrefix = (
  importId: ImportId,
  generation: AcquisitionGeneration
) => `imports/${importId}/acquisition/v1/generations/${generation}`;

export const acquisitionArtifactId = (
  importId: ImportId,
  generation: AcquisitionGeneration
) => `${importId}:acquisition-generation:${generation}`;

export const mediaObjectKey = (
  importId: ImportId,
  generation: AcquisitionGeneration
) => `${generationPrefix(importId, generation)}/original.mp4`;
export const manifestObjectKey = (
  importId: ImportId,
  generation: AcquisitionGeneration
) => `${generationPrefix(importId, generation)}/manifest.json`;

export const MediaLimits = Schema.Struct({
  maximumDurationSeconds: Schema.Literal(MaximumMediaDurationSeconds),
  maximumMediaBytes: Schema.Literal(MaximumMediaBytes),
  maximumTemporaryBytes: Schema.Literal(MaximumTemporaryBytes),
  maximumTemporaryFileBytes: Schema.Literal(MaximumTemporaryFileBytes),
  maximumTemporaryFiles: Schema.Literal(MaximumTemporaryFiles),
});
export type MediaLimits = typeof MediaLimits.Type;

export const ProductionMediaLimits: MediaLimits = {
  maximumDurationSeconds: MaximumMediaDurationSeconds,
  maximumMediaBytes: MaximumMediaBytes,
  maximumTemporaryBytes: MaximumTemporaryBytes,
  maximumTemporaryFileBytes: MaximumTemporaryFileBytes,
  maximumTemporaryFiles: MaximumTemporaryFiles,
};
