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

const ImportUuidPattern =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

export const MediaArtifactId = Schema.String.pipe(
  Schema.check(
    Schema.isMaxLength(256),
    Schema.isPattern(/^[a-z\d][a-z\d:-]*$/iu)
  ),
  Schema.brand("MediaArtifactId")
);
export type MediaArtifactId = typeof MediaArtifactId.Type;

export const MediaObjectKey = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(
      new RegExp(
        `^imports/${ImportUuidPattern}/acquisition/v1/generations/[0-9]+/original\\.mp4$`,
        "iu"
      )
    )
  ),
  Schema.brand("MediaObjectKey")
);
export type MediaObjectKey = typeof MediaObjectKey.Type;

export const ManifestObjectKey = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(
      new RegExp(
        `^imports/${ImportUuidPattern}/acquisition/v1/generations/[0-9]+/manifest\\.json$`,
        "iu"
      )
    )
  ),
  Schema.brand("ManifestObjectKey")
);
export type ManifestObjectKey = typeof ManifestObjectKey.Type;

export const Sha256Hex = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-f\d]{64}$/u)),
  Schema.brand("Sha256Hex")
);
export type Sha256Hex = typeof Sha256Hex.Type;

export const MediaByteCount = Schema.Number.pipe(
  Schema.check(
    Schema.isInt(),
    Schema.isGreaterThan(0),
    Schema.isLessThanOrEqualTo(MaximumMediaBytes)
  ),
  Schema.brand("MediaByteCount")
);
export type MediaByteCount = typeof MediaByteCount.Type;

export const MediaDurationSeconds = Schema.Number.pipe(
  Schema.check(
    Schema.isFinite(),
    Schema.isGreaterThan(0),
    Schema.isLessThanOrEqualTo(MaximumMediaDurationSeconds)
  ),
  Schema.brand("MediaDurationSeconds")
);
export type MediaDurationSeconds = typeof MediaDurationSeconds.Type;

export const MediaDurationMilliseconds = Schema.Number.pipe(
  Schema.check(
    Schema.isInt(),
    Schema.isGreaterThan(0),
    Schema.isLessThanOrEqualTo(MaximumMediaDurationSeconds * 1000)
  ),
  Schema.brand("MediaDurationMilliseconds")
);
export type MediaDurationMilliseconds = typeof MediaDurationMilliseconds.Type;

export const FrameTimestampMilliseconds = Schema.Number.pipe(
  Schema.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(0),
    Schema.isLessThanOrEqualTo(MaximumMediaDurationSeconds * 1000)
  ),
  Schema.brand("FrameTimestampMilliseconds")
);
export type FrameTimestampMilliseconds = typeof FrameTimestampMilliseconds.Type;

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

export const AcquisitionFailureReason = Schema.Literals([
  "acquisition_timeout",
  "container_exit",
  "container_process_timeout",
  "container_rpc",
  "download_dns",
  "download_http_response",
  "download_source_unavailable",
  "download_stream_or_tls",
  "download_timeout",
  "media_session_invalid",
  "temporary_workspace_unavailable",
]);
export type AcquisitionFailureReason = typeof AcquisitionFailureReason.Type;

export const MediaStreamSummary = Schema.Struct({
  codec: Schema.String.pipe(
    Schema.check(Schema.isTrimmed(), Schema.isNonEmpty())
  ),
  index: Schema.Number.pipe(
    Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
  ),
});
export type MediaStreamSummary = typeof MediaStreamSummary.Type;

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
    canonicalUrl: Schema.Literals(["operator_supplied", "provider_observed"]),
    caption: Schema.NullOr(
      Schema.Literals(["creator_provided", "operator_supplied"])
    ),
    creator: Schema.Struct({
      displayName: Schema.NullOr(
        Schema.Literals(["operator_supplied", "provider_observed"])
      ),
      handle: Schema.NullOr(
        Schema.Literals(["operator_supplied", "provider_observed"])
      ),
      id: Schema.NullOr(
        Schema.Literals(["operator_supplied", "provider_observed"])
      ),
    }),
    publishedAt: Schema.NullOr(
      Schema.Literals(["operator_supplied", "provider_observed"])
    ),
  }),
  publishedAt: Schema.NullOr(ImportTimestamp),
});
export type VerifiedSourceMetadata = typeof VerifiedSourceMetadata.Type;

export const VerifiedAcquisitionEvidence = Schema.Struct({
  acquiredAt: ImportTimestamp,
  audioStreams: Schema.NonEmptyArray(MediaStreamSummary),
  bytes: MediaByteCount,
  deleteAt: ImportTimestamp,
  durationSeconds: MediaDurationSeconds,
  generation: AcquisitionGeneration,
  manifestKey: ManifestObjectKey,
  mediaKey: MediaObjectKey,
  sha256: Sha256Hex,
  source: Schema.optionalKey(VerifiedSourceMetadata),
  videoStreams: Schema.NonEmptyArray(MediaStreamSummary),
});
export type VerifiedAcquisitionEvidence =
  typeof VerifiedAcquisitionEvidence.Type;

export const RetryableAcquisitionFailure = Schema.Struct({
  _tag: Schema.Literal("RetryableAcquisitionFailure"),
  reason: Schema.optionalKey(AcquisitionFailureReason),
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
  reason: Schema.optionalKey(AcquisitionFailureReason),
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
) =>
  Schema.decodeUnknownSync(MediaArtifactId)(
    `${importId}:acquisition-generation:${generation}`
  );

export const mediaObjectKey = (
  importId: ImportId,
  generation: AcquisitionGeneration
) =>
  Schema.decodeUnknownSync(MediaObjectKey)(
    `${generationPrefix(importId, generation)}/original.mp4`
  );
export const manifestObjectKey = (
  importId: ImportId,
  generation: AcquisitionGeneration
) =>
  Schema.decodeUnknownSync(ManifestObjectKey)(
    `${generationPrefix(importId, generation)}/manifest.json`
  );

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
