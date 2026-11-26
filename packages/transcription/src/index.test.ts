import { Option } from "effect";
import { describe, expect, it } from "vitest";

import { normalizeClipTranscript } from "./index.js";

describe("clip transcription", () => {
  const input = {
    audio: {
      bytes: new Uint8Array([1, 2, 3]),
      durationMilliseconds: 4200,
      mimeType: "audio/wav",
      sha256: "a".repeat(64),
    },
    cost: { certainty: "estimated", currency: "USD", estimatedMicroUsd: 5 },
    language: "en",
    model: "fixture",
    provider: "fixture",
    text: "Hello family.",
  } as const;

  it("represents clip-level timing and exact audio usage, not word timings", () => {
    const transcript = Option.getOrThrow(normalizeClipTranscript(input));
    expect(transcript.segments).toEqual([
      { startMilliseconds: 0, endMilliseconds: 4200, text: "Hello family." },
    ]);
    expect(transcript.usage).toEqual({
      audioDurationMilliseconds: 4200,
      inputBytes: 3,
    });
  });

  it("does not manufacture a transcript for missing text or invalid duration", () => {
    expect(normalizeClipTranscript({ ...input, text: " " })).toEqual(
      Option.none()
    );
    expect(
      normalizeClipTranscript({
        ...input,
        audio: { ...input.audio, durationMilliseconds: 0 },
      })
    ).toEqual(Option.none());
  });
});
