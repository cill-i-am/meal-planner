import type {
  SpeechAudioArtifact,
  SpeechTranscriber,
  SpeechTranscriptionRequest,
} from "@meal-planner/transcription";
import { Schema } from "effect";
import type { Effect } from "effect";

import type { ImportId } from "../contracts/import.contracts.js";
import type { AcquisitionGeneration } from "../media/import-media.model.js";

const Sha256Hex = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-f\d]{64}$/u))
);

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
export interface SpeechTranscriptionInput extends SpeechTranscriptionRequest {
  readonly dispatchId: string;
  readonly generation: AcquisitionGeneration;
  readonly importId: ImportId;
  readonly sourceMediaSha256: string;
}

export type RecipeSpeechTranscriber =
  SpeechTranscriber<SpeechTranscriptionInput>;

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
