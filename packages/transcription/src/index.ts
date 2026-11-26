import { Schema } from "effect";
import type { Effect } from "effect";

const TrimmedNonEmptyString = Schema.String.pipe(
  Schema.check(Schema.isTrimmed(), Schema.isNonEmpty())
);
const SafeAdapterLabel = TrimmedNonEmptyString.pipe(
  Schema.check(Schema.isMaxLength(64))
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

/** Audio prepared by the caller. Provider and job configuration stay outside this contract. */
export interface SpeechTranscriptionRequest {
  readonly audio: SpeechAudioArtifact;
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
export interface SpeechTranscriber<
  Request extends SpeechTranscriptionRequest = SpeechTranscriptionRequest,
> {
  readonly transcribe: (
    input: Request
  ) => Effect.Effect<SpeechTranscriptionResult, SpeechTranscriptionFailure>;
}

/** Strictly decode a speech adapter's normalized response. */
export const decodeSpeechTranscript = Schema.decodeUnknownEffect(
  SpeechTranscript,
  { onExcessProperty: "error" }
);

/** The provider supplies normalized text, not word timings. One segment covers the clip. */
export const normalizeClipTranscript = (input: {
  readonly audio: SpeechAudioArtifact;
  readonly cost: SpeechTranscript["cost"];
  readonly language: string;
  readonly model: string;
  readonly provider: string;
  readonly text: string;
}) =>
  Schema.decodeUnknownOption(SpeechTranscript)({
    cost: input.cost,
    detectedLanguage: input.language,
    model: input.model,
    provider: input.provider,
    segments: [
      {
        startMilliseconds: 0,
        endMilliseconds: input.audio.durationMilliseconds,
        text: input.text,
      },
    ],
    text: input.text,
    usage: {
      audioDurationMilliseconds: input.audio.durationMilliseconds,
      inputBytes: input.audio.bytes.byteLength,
    },
  });
