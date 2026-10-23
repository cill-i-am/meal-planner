import { Schema } from "effect";
import type { Effect } from "effect";

import type { AcquisitionGeneration } from "./import-media.model.js";
import type { ImportId } from "./import.contracts.js";

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

/** One timestamped piece of normalized speech. */
export const SpeechTranscriptSegment = Schema.Struct({
  endMilliseconds: SafeInteger,
  startMilliseconds: SafeInteger,
  text: TrimmedNonEmptyString.pipe(Schema.check(Schema.isMaxLength(16_384))),
}).pipe(
  Schema.check(
    Schema.makeFilter(
      (segment) => segment.endMilliseconds > segment.startMilliseconds,
      { expected: "a positive timestamp range" }
    )
  )
);
export type SpeechTranscriptSegment = typeof SpeechTranscriptSegment.Type;

/** Provider-neutral normalized transcript returned by a speech adapter. */
export const SpeechTranscript = Schema.Struct({
  cost: Schema.Struct({
    certainty: Schema.Literals(["estimated", "known"]),
    currency: Schema.Literal("USD"),
    estimatedMicroUsd: SafeInteger,
  }),
  detectedLanguage: Schema.String.pipe(
    Schema.check(Schema.isPattern(/^[a-z]{2}$/u))
  ),
  model: SafeAdapterLabel,
  provider: SafeAdapterLabel,
  segments: Schema.NonEmptyArray(SpeechTranscriptSegment).pipe(
    Schema.check(Schema.isMaxLength(4096))
  ),
  text: TrimmedNonEmptyString.pipe(Schema.check(Schema.isMaxLength(1_048_576))),
  usage: Schema.Struct({
    audioDurationMilliseconds: SafeInteger,
    inputBytes: SafeInteger,
  }),
}).pipe(
  Schema.check(
    Schema.makeFilter(
      (transcript) => {
        let previousEnd = 0;
        for (const segment of transcript.segments) {
          if (segment.startMilliseconds < previousEnd) {
            return false;
          }
          previousEnd = segment.endMilliseconds;
        }
        return true;
      },
      { expected: "ordered, non-overlapping transcript segments" }
    )
  )
);
export type SpeechTranscript = typeof SpeechTranscript.Type;

export const SpeechEvidenceStatus = Schema.Union([
  Schema.Struct({ status: Schema.Literal("available") }),
  Schema.Struct({
    reason: Schema.Literals(["no_speech_detected", "no_audio_stream"]),
    status: Schema.Literal("absent"),
  }),
  Schema.Struct({
    reason: Schema.Literal("malformed_response"),
    status: Schema.Literal("failed"),
  }),
]);
export type SpeechEvidenceStatus = typeof SpeechEvidenceStatus.Type;

/** A settled speech attempt with no usable text; never an unknown provider outcome. */
const UnavailableSpeechFields = {
  cost: SpeechTranscript.fields.cost,
  detectedLanguage: Schema.Null,
  model: SpeechTranscript.fields.model,
  provider: SpeechTranscript.fields.provider,
  segments: Schema.Array(SpeechTranscriptSegment).pipe(
    Schema.check(Schema.isMaxLength(0))
  ),
  text: Schema.Null,
  usage: SpeechTranscript.fields.usage,
};
export const AbsentSpeechEvidence = Schema.Struct({
  ...UnavailableSpeechFields,
  reason: Schema.Literal("no_speech_detected"),
  status: Schema.Literal("absent"),
});
export const FailedSpeechEvidence = Schema.Struct({
  ...UnavailableSpeechFields,
  reason: Schema.Literal("malformed_response"),
  status: Schema.Literal("failed"),
});
/** Verified source has no audio stream, so no speech provider was invoked. */
export const NoAudioSpeechEvidence = Schema.Struct({
  ...UnavailableSpeechFields,
  cost: Schema.Struct({
    certainty: Schema.Literal("known"),
    currency: Schema.Literal("USD"),
    estimatedMicroUsd: Schema.Literal(0),
  }),
  model: Schema.Null,
  provider: Schema.Null,
  reason: Schema.Literal("no_audio_stream"),
  status: Schema.Literal("absent"),
  usage: Schema.Struct({
    audioDurationMilliseconds: Schema.Literal(0),
    inputBytes: Schema.Literal(0),
  }),
});

export type NoAudioSpeechEvidence = typeof NoAudioSpeechEvidence.Type;
export const SpeechUnavailableEvidence = Schema.Union([
  AbsentSpeechEvidence,
  FailedSpeechEvidence,
  NoAudioSpeechEvidence,
]);
export type SpeechUnavailableEvidence = typeof SpeechUnavailableEvidence.Type;
export const SpeechTranscriptionResult = Schema.Union([
  SpeechTranscript,
  SpeechUnavailableEvidence,
]);
export type SpeechTranscriptionResult = typeof SpeechTranscriptionResult.Type;
export const decodeSpeechTranscriptionResult = Schema.decodeUnknownEffect(
  SpeechTranscriptionResult,
  { onExcessProperty: "error" }
);

/** Extracted audio owned by the media-tooling boundary for one source generation. */
export interface SpeechAudioArtifact {
  readonly bytes: Uint8Array;
  readonly durationMilliseconds: number;
  readonly mimeType: "audio/wav";
  readonly sha256: string;
}

/** Generation-fenced input to the audio extraction seam. */
interface SpeechAudioExtractionInput {
  readonly generation: AcquisitionGeneration;
  readonly importId: ImportId;
  readonly mediaKey: string;
  readonly sourceMediaSha256: string;
}

/** Safe classified failure from audio extraction. */
export interface SpeechAudioExtractionFailure {
  readonly _tag: "SpeechAudioExtractionFailure";
  readonly code: "audio_extraction_failed";
}

/** Explicit absence established from verified acquisition and derived manifests. */
export const SpeechAudioAbsence = Schema.Struct({
  _tag: Schema.Literal("NoAudioStream"),
});
export type SpeechAudioAbsence = typeof SpeechAudioAbsence.Type;

/** Media-tooling port that produces a bounded speech-audio artifact. */
export interface SpeechAudioExtractor {
  readonly extract: (
    input: SpeechAudioExtractionInput
  ) => Effect.Effect<
    SpeechAudioArtifact | SpeechAudioAbsence,
    SpeechAudioExtractionFailure
  >;
}

/** One replay-fenced request to a provider-neutral speech adapter. */
export interface SpeechTranscriptionInput {
  readonly audio: SpeechAudioArtifact;
  readonly dispatchId: string;
  readonly generation: AcquisitionGeneration;
  readonly importId: ImportId;
  readonly sourceMediaSha256: string;
}

/** Safe classified speech failure; it never contains a provider body or secret. */
export interface SpeechTranscriptionFailure {
  readonly _tag: "SpeechTranscriptionFailure";
  readonly code:
    | "insufficient_evidence"
    | "malformed_response"
    | "model_refusal"
    | "outcome_unknown"
    | "provider_unavailable"
    | "throttled"
    | "timeout"
    | "transcription_failed";
}

/** Provider-neutral speech capability. */
export interface SpeechTranscriber {
  readonly transcribe: (
    input: SpeechTranscriptionInput
  ) => Effect.Effect<SpeechTranscriptionResult, SpeechTranscriptionFailure>;
}

/** Effect service tag for a replaceable speech provider adapter. */

/** Strictly decode a speech adapter's normalized response. */
export const decodeSpeechTranscript = Schema.decodeUnknownEffect(
  SpeechTranscript,
  { onExcessProperty: "error" }
);

/** Validate a media-tooling audio artifact before any speech dispatch. */
export const validateSpeechAudioArtifact = (
  artifact: SpeechAudioArtifact,
  sourceMediaSha256: string
) =>
  artifact.bytes.byteLength > 0 &&
  Number.isSafeInteger(artifact.durationMilliseconds) &&
  artifact.durationMilliseconds > 0 &&
  artifact.mimeType === "audio/wav" &&
  Sha256Hex.pipe(Schema.decodeUnknownOption)(artifact.sha256)._tag === "Some" &&
  Sha256Hex.pipe(Schema.decodeUnknownOption)(sourceMediaSha256)._tag === "Some";
