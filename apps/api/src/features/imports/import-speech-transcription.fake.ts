import { Effect, Schema } from "effect";

import type {
  SpeechAudioArtifact,
  SpeechAudioExtractionInput,
  SpeechAudioExtractorShape,
  SpeechTranscriberShape,
  SpeechTranscriptionInput,
} from "./import-speech-transcriber.js";
import {
  SpeechTranscript,
  validateSpeechAudioArtifact,
} from "./import-speech-transcriber.js";

/** Deterministic media-tooling fake used by provider-free tracer tests. */
export const makeDeterministicSpeechAudioExtractor = (
  artifact: SpeechAudioArtifact
): {
  readonly calls: SpeechAudioExtractionInput[];
  readonly service: SpeechAudioExtractorShape;
} => {
  if (!validateSpeechAudioArtifact(artifact, "0".repeat(64))) {
    throw new Error("Invalid deterministic audio fixture");
  }
  const calls: SpeechAudioExtractionInput[] = [];
  return {
    calls,
    service: {
      extract: (input) =>
        Effect.sync(() => {
          calls.push(input);
          return { ...artifact, bytes: Uint8Array.from(artifact.bytes) };
        }),
    },
  };
};

/** Deterministic provider-free SpeechTranscriber fake with recorded seam calls. */
export const makeDeterministicSpeechTranscriber = (
  output: typeof SpeechTranscript.Encoded
): {
  readonly calls: SpeechTranscriptionInput[];
  readonly service: SpeechTranscriberShape;
} => {
  const transcript = Schema.decodeUnknownSync(SpeechTranscript, {
    onExcessProperty: "error",
  })(output);
  const calls: SpeechTranscriptionInput[] = [];
  return {
    calls,
    service: {
      transcribe: (input) =>
        Effect.sync(() => {
          calls.push(input);
          return transcript;
        }),
    },
  };
};
