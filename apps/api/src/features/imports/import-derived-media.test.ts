import { Effect, Schema, Stream } from "effect";
import { describe, expect, it } from "vitest";

import {
  makeR2SpeechAudioExtractor,
  makeR2VisualFrameSampler,
  persistDerivedProviderEvidence,
} from "./import-derived-media.js";
import type {
  AcquisitionBucketLike,
  AcquisitionMediaObjectLike,
  R2ObjectBodyLike,
} from "./import-media-acquirer.js";
import { VerifiedPreparedMediaArtifact } from "./import-media-acquirer.js";
import { AcquisitionGeneration } from "./import-media.model.js";
import { ImportId } from "./import.contracts.js";
import { memoryBucket } from "./transcript-evidence.test-fixture.js";

const hash = async (bytes: Uint8Array) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer)
    ),
    (byte) => byte.toString(16).padStart(2, "0")
  ).join("");

const object = (bytes: Uint8Array): R2ObjectBodyLike => ({
  arrayBuffer: () => Effect.succeed(Uint8Array.from(bytes).buffer),
  size: bytes.byteLength,
  text: () => Effect.succeed(new TextDecoder().decode(bytes)),
});

const readOnlyBucket = (
  read: (key: string) => Uint8Array | undefined
): AcquisitionBucketLike => ({
  get: (key) => {
    const bytes = read(key);
    return Effect.succeed(bytes === undefined ? null : object(bytes));
  },
  head: () => Effect.die("Unexpected derived-evidence head"),
  put: () => Effect.die("Unexpected derived-evidence write"),
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
    const audioKey = `imports/${importId}/generations/${generation}/provider-audio.wav`;
    const firstFrameKey = `imports/${importId}/generations/${generation}/provider-frame-0.jpg`;
    const secondFrameKey = `imports/${importId}/generations/${generation}/provider-frame-1.jpg`;
    const manifest = {
      audio: {
        bytes: audio.byteLength,
        durationMilliseconds: 60_000,
        key: audioKey,
        sha256: await hash(audio),
      },
      frames: [
        {
          bytes: first.byteLength,
          height: 20,
          key: firstFrameKey,
          sha256: await hash(first),
          timestampMilliseconds: 12_000,
          width: 10,
        },
        {
          bytes: second.byteLength,
          height: 20,
          key: secondFrameKey,
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
      [audioKey, audio],
      [firstFrameKey, first],
      [secondFrameKey, second],
    ]);
    const bucket = readOnlyBucket((key) => values.get(key));
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

    expect(extractedAudio).toMatchObject({ bytes: audio });
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
        key: `imports/${importId}/generations/${generation}/provider-audio.wav`,
        sha256: "b".repeat(64),
      },
      frames: [
        {
          bytes: 1,
          height: 1,
          key: `imports/${importId}/generations/${generation}/provider-frame-0.jpg`,
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
    const bucket = readOnlyBucket((key) =>
      key.endsWith("provider-evidence.json")
        ? new TextEncoder().encode(JSON.stringify(manifest))
        : new Uint8Array([9])
    );

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

const noAudioFixture = async () => {
  const importId = Schema.decodeUnknownSync(ImportId)(
    "00000000-0000-4000-8000-000000000003"
  );
  const generation = Schema.decodeUnknownSync(AcquisitionGeneration)(1);
  const storage = memoryBucket();
  const frameBytes = new Uint8Array([4, 5, 6]);
  const frameSha256 = await hash(frameBytes);
  const prepared = Schema.decodeUnknownSync(VerifiedPreparedMediaArtifact)({
    artifactId: "video-only-source",
    audioStreams: [],
    bytes: 1024,
    durationSeconds: 1,
    metadata: {
      canonicalId: "7392489304682556679",
      canonicalUrl: "https://www.tiktok.com/@fixture/video/7392489304682556679",
      caption: "2 onions",
      creator: { displayName: null, handle: null, id: null },
      observedAt: "2026-10-23T12:00:00.000Z",
      provenance: {
        canonicalUrl: "provider_observed",
        caption: "creator_provided",
        creator: { displayName: null, handle: null, id: null },
        publishedAt: null,
      },
      publishedAt: null,
    },
    sha256: "a".repeat(64),
    videoStreams: [{ codec: "h264", index: 0 }],
  });
  const frame = (index: number) => ({
    artifactId: `video-only-frame-${index}`,
    bytes: frameBytes.byteLength,
    height: 1,
    sha256: frameSha256,
    timestampMilliseconds: index * 250,
    width: 1,
  });
  const readArtifacts: string[] = [];
  const mediaObject: AcquisitionMediaObjectLike = {
    cleanup: () => Effect.void,
    prepare: () => Effect.die("Unexpected source preparation"),
    prepareProviderEvidence: () =>
      Effect.succeed({
        audio: { reason: "no_audio_stream", status: "absent" },
        frames: [frame(0), frame(1), frame(2)],
      }),
    readArtifact: (artifactId) => {
      readArtifacts.push(artifactId);
      return Stream.succeed(frameBytes);
    },
  };
  const input = { generation, importId };
  const readInput = {
    ...input,
    mediaKey: "private/original",
    sourceMediaSha256: prepared.sha256,
  };
  const manifestKey = `imports/${importId}/generations/${generation}/provider-evidence.json`;
  return {
    ...storage,
    input,
    manifestKey,
    mediaObject,
    prepared,
    readArtifacts,
    readInput,
  };
};

describe("verified video-only derived evidence", () => {
  it("persists all three frames and an absence marker without reading or writing audio", async () => {
    const fixture = await noAudioFixture();
    await Effect.runPromise(
      persistDerivedProviderEvidence(
        fixture.bucket,
        fixture.mediaObject,
        fixture.prepared,
        fixture.input
      )
    );
    expect(fixture.readArtifacts).toEqual([
      "video-only-frame-0",
      "video-only-frame-1",
      "video-only-frame-2",
    ]);
    expect(
      [...fixture.objects.keys()].some((key) =>
        key.endsWith("provider-audio.wav")
      )
    ).toBe(false);
    expect(
      await Effect.runPromise(
        makeR2SpeechAudioExtractor(fixture.bucket).extract(fixture.readInput)
      )
    ).toEqual({ _tag: "NoAudioStream" });
    expect(
      await Effect.runPromise(
        makeR2VisualFrameSampler(fixture.bucket).sample({
          ...fixture.readInput,
          durationMilliseconds: 1000,
        })
      )
    ).toHaveLength(3);
  });

  it("rejects absence that conflicts with the validated source probe before writing", async () => {
    const fixture = await noAudioFixture();
    const exit = await Effect.runPromiseExit(
      persistDerivedProviderEvidence(
        fixture.bucket,
        fixture.mediaObject,
        {
          ...fixture.prepared,
          audioStreams: [{ codec: "aac", index: 1 }],
        },
        fixture.input
      )
    );
    expect(exit._tag).toBe("Failure");
    expect(fixture.objects.size).toBe(0);
  });

  it.each(["missing", "checksum", "audio-field"] as const)(
    "never treats a %s manifest as verified audio absence",
    async (corruption) => {
      const fixture = await noAudioFixture();
      await Effect.runPromise(
        persistDerivedProviderEvidence(
          fixture.bucket,
          fixture.mediaObject,
          fixture.prepared,
          fixture.input
        )
      );
      if (corruption === "missing") {
        fixture.objects.delete(fixture.manifestKey);
      } else {
        fixture.update(fixture.manifestKey, (stored) =>
          corruption === "checksum"
            ? { ...stored, checksums: { sha256: new Uint8Array(32).buffer } }
            : {
                ...stored,
                text: () => Effect.succeed(JSON.stringify({ audio: null })),
              }
        );
      }
      const exit = await Effect.runPromiseExit(
        makeR2SpeechAudioExtractor(fixture.bucket).extract(fixture.readInput)
      );
      expect(exit._tag).toBe("Failure");
    }
  );
});
