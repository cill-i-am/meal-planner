import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  makeR2SpeechAudioExtractor,
  makeR2VisualFrameSampler,
} from "./import-derived-media.js";
import type { AcquisitionBucketLike } from "./import-media-acquirer.js";
import { AcquisitionGeneration } from "./import-media.model.js";
import { ImportId } from "./import.contracts.js";

const hash = async (bytes: Uint8Array) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer)
    ),
    (byte) => byte.toString(16).padStart(2, "0")
  ).join("");

const object = (bytes: Uint8Array) => ({
  arrayBuffer: () => Promise.resolve(Uint8Array.from(bytes).buffer),
  size: bytes.byteLength,
  text: () => Promise.resolve(new TextDecoder().decode(bytes)),
});

describe("private derived provider evidence", () => {
  it("returns only hash-verified audio and ordered frames", async () => {
    const importId = Schema.decodeUnknownSync(ImportId)(
      "00000000-0000-4000-8000-000000000001"
    );
    const generation = Schema.decodeUnknownSync(AcquisitionGeneration)(1);
    const audio = new Uint8Array([1, 2, 3]);
    const first = new Uint8Array([4, 5]);
    const second = new Uint8Array([6, 7]);
    const sourceMediaSha256 = "a".repeat(64);
    const manifest = {
      audio: {
        bytes: audio.byteLength,
        durationMilliseconds: 60_000,
        key: "private/audio",
        sha256: await hash(audio),
      },
      frames: [
        {
          bytes: first.byteLength,
          height: 20,
          key: "private/frame-0",
          sha256: await hash(first),
          timestampMilliseconds: 12_000,
          width: 10,
        },
        {
          bytes: second.byteLength,
          height: 20,
          key: "private/frame-1",
          sha256: await hash(second),
          timestampMilliseconds: 30_000,
          width: 10,
        },
      ],
      generation,
      importId,
      schemaVersion: 1,
      sourceMediaSha256,
    };
    const values = new Map<string, Uint8Array>([
      [
        `imports/${importId}/generations/${generation}/provider-evidence.json`,
        new TextEncoder().encode(JSON.stringify(manifest)),
      ],
      ["private/audio", audio],
      ["private/frame-0", first],
      ["private/frame-1", second],
    ]);
    const bucket = {
      get: (key: string) => {
        const bytes = values.get(key);
        return Promise.resolve(bytes === undefined ? null : object(bytes));
      },
    } as unknown as AcquisitionBucketLike;
    const input = {
      generation,
      importId,
      mediaKey: "private/original",
      sourceMediaSha256,
    };

    const extractedAudio = await Effect.runPromise(
      makeR2SpeechAudioExtractor(bucket).extract(input)
    );
    const frames = await Effect.runPromise(
      makeR2VisualFrameSampler(bucket).sample({
        ...input,
        durationMilliseconds: 60_000,
      })
    );

    expect(extractedAudio.bytes).toEqual(audio);
    expect(
      frames.map(({ timestampMilliseconds }) => timestampMilliseconds)
    ).toEqual([12_000, 30_000]);
    expect(JSON.stringify(manifest)).not.toMatch(
      /https?:|creator|caption|transcript|ingredient/iu
    );
  });

  it("fails closed when a private derived object no longer matches its hash", async () => {
    const importId = Schema.decodeUnknownSync(ImportId)(
      "00000000-0000-4000-8000-000000000002"
    );
    const generation = Schema.decodeUnknownSync(AcquisitionGeneration)(1);
    const manifest = {
      audio: {
        bytes: 1,
        durationMilliseconds: 1000,
        key: "private/audio",
        sha256: "b".repeat(64),
      },
      frames: [
        {
          bytes: 1,
          height: 1,
          key: "private/frame",
          sha256: "c".repeat(64),
          timestampMilliseconds: 0,
          width: 1,
        },
      ],
      generation,
      importId,
      schemaVersion: 1,
      sourceMediaSha256: "a".repeat(64),
    };
    const bucket = {
      get: (key: string) =>
        Promise.resolve(
          key.endsWith("provider-evidence.json")
            ? object(new TextEncoder().encode(JSON.stringify(manifest)))
            : object(new Uint8Array([9]))
        ),
    } as unknown as AcquisitionBucketLike;

    const exit = await Effect.runPromiseExit(
      makeR2SpeechAudioExtractor(bucket).extract({
        generation,
        importId,
        mediaKey: "private/original",
        sourceMediaSha256: "a".repeat(64),
      })
    );
    expect(exit._tag).toBe("Failure");
    expect(JSON.stringify(exit)).not.toContain("private/audio");
  });
});
