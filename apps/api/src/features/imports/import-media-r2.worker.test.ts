import { env } from "cloudflare:test";
import { Cause, Effect, Exit, Fiber, Option, Schema, Stream } from "effect";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  makeR2SpeechAudioExtractor,
  makeR2VisualFrameSampler,
  persistDerivedProviderEvidence,
} from "./import-derived-media.js";
import { acquireStoreVerify } from "./import-media-acquirer.js";
import type {
  AcquisitionBucketLike,
  AcquisitionMediaObjectLike,
  AcquisitionPutOptions,
  PreparedMediaArtifact,
} from "./import-media-acquirer.js";
import { makeAcquisitionMediaObject } from "./import-media-acquisition-object.client.js";
import type { AcquisitionMediaObjectStub } from "./import-media-acquisition-object.client.js";
import {
  AcquisitionGeneration,
  MaximumR2OperationMilliseconds,
  manifestObjectKey,
  mediaObjectKey,
} from "./import-media.model.js";
import { ImportId, SourceCanonicalId } from "./import.contracts.js";

interface TestR2Object {
  readonly arrayBuffer: () => Promise<ArrayBuffer>;
  readonly checksums?: { readonly sha256?: ArrayBuffer };
  readonly customMetadata?: Record<string, string>;
  readonly httpMetadata?: {
    readonly cacheControl?: string;
    readonly contentType?: string;
  };
  readonly key: string;
  readonly size: number;
  readonly text: () => Promise<string>;
}

interface TestR2Bucket {
  readonly delete: (keys: string | string[]) => Promise<void>;
  readonly get: (key: string) => Promise<TestR2Object | null>;
  readonly head: (key: string) => Promise<TestR2Object | null>;
  readonly list: (options: { readonly prefix: string }) => Promise<{
    readonly objects: readonly TestR2Object[];
  }>;
  readonly put: (
    key: string,
    value: unknown,
    options?: unknown
  ) => Promise<TestR2Object | null>;
}

const testEnv = env as unknown as {
  readonly ImportEvidenceBucket: TestR2Bucket;
};
const mediaBytes = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70]);
const sha256 =
  "d9f1cb99ee21291800d5e62bd9bca07850461d7d8096afc4150a52dc8554d49f";
const now = () => new Date("2026-07-20T12:00:00.000Z");
const decodeGeneration = Schema.decodeUnknownSync(AcquisitionGeneration);

const id = (suffix: number) =>
  Schema.decodeUnknownSync(ImportId)(
    `018f47ad-91aa-7c35-b6fe-${String(suffix).padStart(12, "0")}`
  );
const canonicalId = Schema.decodeUnknownSync(SourceCanonicalId)(
  "7520000000000000000"
);

const bucket = (): AcquisitionBucketLike => ({
  get: (key) => testEnv.ImportEvidenceBucket.get(key),
  head: (key) => testEnv.ImportEvidenceBucket.head(key),
  put: (key, value, options) =>
    testEnv.ImportEvidenceBucket.put(key, value, options),
});

const drainReadable = async (
  reader: ReadableStreamDefaultReader<unknown>
): Promise<void> => {
  const result = await reader.read();
  if (!result.done) {
    await drainReadable(reader);
  }
};

const consumingBucket = (): AcquisitionBucketLike => ({
  get: () => Promise.reject(new Error("read must remain untouched")),
  head: () => Promise.reject(new Error("head must remain untouched")),
  put: async (_key, value) => {
    if (!(value instanceof ReadableStream)) {
      throw new Error("Expected a streamed artifact");
    }
    const reader = value.getReader();
    try {
      await drainReadable(reader);
      return null;
    } finally {
      reader.releaseLock();
    }
  },
});

const digest = async (bytes: Uint8Array) => {
  const value = await crypto.subtle.digest(
    "SHA-256",
    Uint8Array.from(bytes).buffer
  );
  return Array.from(new Uint8Array(value), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
};

const makeMediaObject = (
  artifactBytes = mediaBytes,
  artifactSha256 = sha256
) => {
  let cleanupCalls = 0;
  let prepares = 0;
  const preparedInputs: unknown[] = [];
  const prepared: PreparedMediaArtifact = {
    artifactId: "artifact-safe-id",
    audioStreams: [{ codec: "aac", index: 1 }],
    bytes: artifactBytes.byteLength,
    durationSeconds: 1,
    metadata: {
      canonicalId,
      canonicalUrl: `https://www.tiktok.com/@cook/video/${canonicalId}`,
      caption: "Synthetic recipe caption",
      creator: { displayName: "Cook", handle: "cook", id: "cook-id" },
      observedAt: "2026-07-20T11:59:00.000Z",
      provenance: {
        canonicalUrl: "provider_observed",
        caption: "creator_provided",
        creator: {
          displayName: "provider_observed",
          handle: "provider_observed",
          id: "provider_observed",
        },
        publishedAt: null,
      },
      publishedAt: null,
    },
    sha256: artifactSha256,
    videoStreams: [{ codec: "h264", index: 0 }],
  };
  const object: AcquisitionMediaObjectLike = {
    cleanup: () =>
      Effect.sync(() => {
        cleanupCalls += 1;
      }),
    prepare: (input) =>
      Effect.sync(() => {
        prepares += 1;
        preparedInputs.push(input);
        return prepared;
      }),
    readArtifact: () => Stream.make(artifactBytes),
  };
  return {
    cleanupCalls: () => cleanupCalls,
    object,
    prepared,
    preparedInputs: () => preparedInputs,
    prepares: () => prepares,
  };
};

beforeEach(async () => {
  const objects = await testEnv.ImportEvidenceBucket.list({
    prefix: "imports/",
  });
  if (objects.objects.length > 0) {
    await testEnv.ImportEvidenceBucket.delete(
      objects.objects.map(({ key }) => key)
    );
  }
});

afterEach(() => {
  vi.useRealTimers();
});

describe("derived provider evidence", () => {
  it("round-trips strict current-generation evidence without container artifact ids", async () => {
    const importId = id(411);
    const generation = decodeGeneration(2);
    const audioBytes = new Uint8Array(128 * 1024 + 31).fill(7);
    audioBytes.set([82, 73, 70, 70]);
    const firstFrame = new Uint8Array(128 * 1024 + 17).fill(11);
    const secondFrame = new Uint8Array(128 * 1024 + 29).fill(13);
    firstFrame.set([255, 216]);
    firstFrame.set([255, 217], firstFrame.byteLength - 2);
    secondFrame.set([255, 216]);
    secondFrame.set([255, 217], secondFrame.byteLength - 2);
    const frameBytes = [firstFrame, secondFrame] as const;
    const audioSha256 = await digest(audioBytes);
    const [firstFrameSha256, secondFrameSha256] = await Promise.all([
      digest(frameBytes[0]),
      digest(frameBytes[1]),
    ] as const);
    const artifacts = new Map<string, Uint8Array>([
      ["container-audio-411", audioBytes],
      ["container-frame-411-0", frameBytes[0]],
      ["container-frame-411-1", frameBytes[1]],
    ]);
    const prepared: PreparedMediaArtifact = {
      artifactId: "container-source-411",
      audioStreams: [{ codec: "aac", index: 1 }],
      bytes: mediaBytes.byteLength,
      durationSeconds: 2,
      metadata: {
        canonicalId,
        canonicalUrl: `https://www.tiktok.com/@cook/video/${canonicalId}`,
        caption: "Synthetic recipe caption",
        creator: { displayName: "Cook", handle: "cook", id: "cook-id" },
        observedAt: "2026-07-20T11:59:00.000Z",
        provenance: {
          canonicalUrl: "provider_observed",
          caption: "creator_provided",
          creator: {
            displayName: "provider_observed",
            handle: "provider_observed",
            id: "provider_observed",
          },
          publishedAt: null,
        },
        publishedAt: null,
      },
      sha256,
      videoStreams: [{ codec: "h264", index: 0 }],
    };
    const mediaObject: AcquisitionMediaObjectLike = {
      cleanup: () => Effect.void,
      prepare: () => Effect.succeed(prepared),
      prepareProviderEvidence: () =>
        Effect.succeed({
          audio: {
            artifactId: "container-audio-411",
            bytes: audioBytes.byteLength,
            durationMilliseconds: 2000,
            sha256: audioSha256,
          },
          frames: [
            {
              artifactId: "container-frame-411-0",
              bytes: frameBytes[0].byteLength,
              height: 640,
              sha256: firstFrameSha256,
              timestampMilliseconds: 0,
              width: 360,
            },
            {
              artifactId: "container-frame-411-1",
              bytes: frameBytes[1].byteLength,
              height: 640,
              sha256: secondFrameSha256,
              timestampMilliseconds: 1000,
              width: 360,
            },
          ],
        }),
      readArtifact: (artifactId) => {
        const bytes = artifacts.get(artifactId);
        return bytes === undefined
          ? Stream.fail({
              _tag: "RetryableAcquisitionFailure" as const,
              stage: "container" as const,
            })
          : Stream.make(bytes);
      },
    };

    await Effect.runPromise(
      persistDerivedProviderEvidence(bucket(), mediaObject, prepared, {
        generation,
        importId,
      })
    );

    const manifestObject = await testEnv.ImportEvidenceBucket.get(
      `imports/${importId}/generations/${generation}/provider-evidence.json`
    );
    expect(manifestObject).not.toBeNull();
    if (manifestObject === null) {
      throw new Error("Expected persisted provider evidence manifest");
    }
    const manifest = JSON.parse(await manifestObject.text()) as {
      readonly audio: Record<string, unknown>;
      readonly frames: readonly Record<string, unknown>[];
    };
    expect(Object.keys(manifest).toSorted()).toEqual(
      [
        "audio",
        "frames",
        "generation",
        "importId",
        "schemaVersion",
        "sourceMediaSha256",
      ].toSorted()
    );
    expect(Object.keys(manifest.audio).toSorted()).toEqual(
      ["bytes", "durationMilliseconds", "key", "sha256"].toSorted()
    );
    expect(
      manifest.frames.map((frame) => Object.keys(frame).toSorted())
    ).toEqual([
      [
        "bytes",
        "height",
        "key",
        "sha256",
        "timestampMilliseconds",
        "width",
      ].toSorted(),
      [
        "bytes",
        "height",
        "key",
        "sha256",
        "timestampMilliseconds",
        "width",
      ].toSorted(),
    ]);

    const audio = await Effect.runPromise(
      makeR2SpeechAudioExtractor(bucket()).extract({
        generation,
        importId,
        mediaKey: mediaObjectKey(importId, generation),
        sourceMediaSha256: prepared.sha256,
      })
    );
    const frames = await Effect.runPromise(
      makeR2VisualFrameSampler(bucket()).sample({
        durationMilliseconds: 2000,
        generation,
        importId,
        mediaKey: mediaObjectKey(importId, generation),
        sourceMediaSha256: prepared.sha256,
      })
    );

    expect(audio).toEqual({
      bytes: audioBytes,
      durationMilliseconds: 2000,
      mimeType: "audio/wav",
      sha256: audioSha256,
    });
    expect(frames).toEqual([
      {
        bytes: frameBytes[0],
        height: 640,
        mimeType: "image/jpeg",
        sha256: firstFrameSha256,
        timestampMilliseconds: 0,
        width: 360,
      },
      {
        bytes: frameBytes[1],
        height: 640,
        mimeType: "image/jpeg",
        sha256: secondFrameSha256,
        timestampMilliseconds: 1000,
        width: 360,
      },
    ]);
  });

  it("settles a rejected derived read before workflow cleanup", async () => {
    const importId = id(414);
    const generation = decodeGeneration(1);
    const fake = makeMediaObject();
    const events: string[] = [];
    const mediaObject: AcquisitionMediaObjectLike = {
      ...fake.object,
      cleanup: () =>
        Effect.sync(() => {
          events.push("cleanup");
        }),
      prepareProviderEvidence: () =>
        Effect.succeed({
          audio: {
            artifactId: "derived-audio-414",
            bytes: 1,
            durationMilliseconds: 1000,
            sha256:
              "4bf5122f344554c53bde2ebb8cd2b7e3d1600ad631c385a5d7c9ec3941b6d1f",
          },
          frames: [
            {
              artifactId: "derived-frame-414",
              bytes: 1,
              height: 1,
              sha256:
                "dbc1b4c900ffe48d575b5da5c638040125f65db0fe3e24494b76ea986457d986",
              timestampMilliseconds: 0,
              width: 1,
            },
          ],
        }),
      readArtifact: (artifactId) =>
        artifactId === "derived-audio-414"
          ? Stream.never.pipe(
              Stream.ensuring(
                Effect.sync(() => {
                  events.push("derived-finalized");
                })
              )
            )
          : Stream.make(mediaBytes),
    };
    const rejectingDerivedBucket: AcquisitionBucketLike = {
      get: () => Promise.reject(new Error("read must remain untouched")),
      head: () => Promise.reject(new Error("head must remain untouched")),
      put: async (key, value) => {
        if (key.endsWith("/provider-audio.wav")) {
          throw new Error("synthetic derived R2 rejection");
        }
        if (!(value instanceof ReadableStream)) {
          throw new Error("Expected a streamed source artifact");
        }
        const reader = value.getReader();
        try {
          await drainReadable(reader);
        } finally {
          reader.releaseLock();
        }
        return { size: mediaBytes.byteLength };
      },
    };

    const exit = await Effect.runPromiseExit(
      acquireStoreVerify(rejectingDerivedBucket, mediaObject, {
        beforeCleanup: (prepared, acquisition) =>
          persistDerivedProviderEvidence(
            rejectingDerivedBucket,
            acquisition,
            prepared,
            { generation, importId }
          ),
        canonicalId,
        generation,
        importId,
        now,
      })
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Option.getOrThrow(Cause.findErrorOption(exit.cause))).toEqual({
        _tag: "RetryableAcquisitionFailure",
        reason: "container_rpc",
        stage: "store",
      });
    }
    expect(events).toEqual(["derived-finalized", "cleanup"]);
  });
});

describe("native R2 generation commit", () => {
  it("preserves a private fetch stream above 128 KiB through real R2 commits", async () => {
    const importId = id(410);
    const generation = decodeGeneration(1);
    const chunks = [
      new Uint8Array(64 * 1024).fill(1),
      new Uint8Array(64 * 1024).fill(2),
      new Uint8Array(24).fill(3),
    ];
    const expectedBytes = new Uint8Array(
      chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
    );
    let offset = 0;
    for (const chunk of chunks) {
      expectedBytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const expectedSha256 =
      "695cedeae3fa2e339107057b05975667fa8cecba1d534c996a68d08df4ad27c9";
    const fake = makeMediaObject(expectedBytes, expectedSha256);
    let deleteCalls = 0;
    const acquisitionBucket = {
      ...bucket(),
      delete: () => {
        deleteCalls += 1;
        return Promise.reject(new Error("acquisition must never delete"));
      },
    };
    const stub: AcquisitionMediaObjectStub = {
      cleanup: fake.object.cleanup,
      fetch: () =>
        Effect.succeed(
          HttpServerResponse.stream(Stream.fromIterable(chunks), {
            contentLength: expectedBytes.byteLength,
            contentType: "video/mp4",
            headers: { "cache-control": "private, no-store" },
          })
        ),
      prepare: fake.object.prepare,
      prepareProviderEvidence: () =>
        Effect.die("derived evidence must remain untouched"),
    };
    const mediaObject = makeAcquisitionMediaObject(stub);

    const first = await Effect.runPromise(
      acquireStoreVerify(acquisitionBucket, mediaObject, {
        canonicalId,
        generation,
        importId,
        now,
      })
    );
    const mediaKey = mediaObjectKey(importId, generation);
    const manifestKey = manifestObjectKey(importId, generation);
    const storedMedia = await testEnv.ImportEvidenceBucket.get(mediaKey);
    const storedManifest = await testEnv.ImportEvidenceBucket.get(manifestKey);

    expect(first).toMatchObject({
      _tag: "VerifiedAcquisition",
      evidence: {
        bytes: expectedBytes.byteLength,
        sha256: expectedSha256,
      },
    });
    expect(storedMedia).not.toBeNull();
    expect(storedManifest).not.toBeNull();
    if (storedMedia === null || storedManifest === null) {
      throw new Error("Expected committed media and manifest");
    }
    expect(new Uint8Array(await storedMedia.arrayBuffer())).toEqual(
      expectedBytes
    );
    expect(storedMedia).toMatchObject({
      customMetadata: {
        generation: String(generation),
        importId,
        kind: "media",
        sha256: expectedSha256,
      },
      httpMetadata: {
        cacheControl: "private, no-store",
        contentType: "video/mp4",
      },
      size: expectedBytes.byteLength,
    });
    const manifest = JSON.parse(await storedManifest.text()) as {
      readonly bytes?: number;
      readonly manifestKey?: string;
      readonly mediaKey?: string;
      readonly sha256?: string;
    };
    expect(manifest).toMatchObject({
      bytes: expectedBytes.byteLength,
      manifestKey,
      mediaKey,
      sha256: expectedSha256,
    });
    expect(
      JSON.stringify({
        keys: [mediaKey, manifestKey],
        manifestMetadata: storedManifest.customMetadata,
        mediaMetadata: storedMedia.customMetadata,
      })
    ).not.toMatch(/authorization|cookie|header|locator|https?:/iu);

    const replay = await Effect.runPromiseExit(
      acquireStoreVerify(acquisitionBucket, mediaObject, {
        canonicalId,
        generation,
        importId,
        now,
      })
    );
    const listed = await testEnv.ImportEvidenceBucket.list({
      prefix: `imports/${importId}/`,
    });

    expect(Exit.isFailure(replay)).toBe(true);
    expect(listed.objects.map(({ key }) => key).toSorted()).toEqual(
      [mediaKey, manifestKey].toSorted()
    );
    const replayedMedia = await testEnv.ImportEvidenceBucket.get(mediaKey);
    if (replayedMedia === null) {
      throw new Error("Expected immutable replayed media");
    }
    expect(new Uint8Array(await replayedMedia.arrayBuffer())).toEqual(
      expectedBytes
    );
    expect(fake.cleanupCalls()).toBe(2);
    expect(deleteCalls).toBe(0);
  });

  it("keeps Miniflare's extra fourth execution harmless with immutable keys and zero delete", async () => {
    const importId = id(401);
    const generations = [1, 2, 3, 4].map((generation) =>
      decodeGeneration(generation)
    );
    const fake = makeMediaObject();
    let deleteCalls = 0;
    const acquisitionBucket = {
      ...bucket(),
      delete: () => {
        deleteCalls += 1;
        return Promise.reject(new Error("acquisition must never delete"));
      },
    };

    const results = await Promise.all(
      generations.map((generation) =>
        Effect.runPromise(
          acquireStoreVerify(acquisitionBucket, fake.object, {
            canonicalId,
            generation,
            importId,
            now,
          })
        )
      )
    );
    const listed = await testEnv.ImportEvidenceBucket.list({
      prefix: `imports/${importId}/`,
    });

    expect(results).toEqual(
      generations.map((generation) =>
        expect.objectContaining({
          _tag: "VerifiedAcquisition",
          generation,
        })
      )
    );
    expect(fake.prepares()).toBe(4);
    expect(fake.preparedInputs()).toEqual(
      generations.map((generation) => ({
        canonicalId,
        generation,
        importId,
        kind: "tiktok",
      }))
    );
    expect(fake.cleanupCalls()).toBe(4);
    expect(deleteCalls).toBe(0);
    const keys = listed.objects.map(({ key }) => key).toSorted();
    expect(keys).toEqual(
      generations
        .flatMap((generation) => [
          mediaObjectKey(importId, generation),
          manifestObjectKey(importId, generation),
        ])
        .toSorted()
    );
    expect(
      JSON.stringify({ keys, prepared: fake.preparedInputs() })
    ).not.toMatch(/https?:|locator/iu);
  });

  it("passes the full create-only integrity and privacy envelope to each raw native put", async () => {
    const importId = id(402);
    const generation = decodeGeneration(7);
    const fake = makeMediaObject();
    const calls: {
      readonly key: string;
      readonly options: AcquisitionPutOptions;
      readonly value: ArrayBufferView | ReadableStream;
    }[] = [];
    const native = bucket();
    const recording: AcquisitionBucketLike = {
      ...native,
      put: (key, value, options) => {
        calls.push({ key, options, value });
        return native.put(key, value, options);
      },
    };

    await Effect.runPromise(
      acquireStoreVerify(recording, fake.object, {
        canonicalId,
        generation,
        importId,
        now,
      })
    );

    expect(calls.map(({ key }) => key)).toEqual([
      mediaObjectKey(importId, generation),
      manifestObjectKey(importId, generation),
    ]);
    expect(calls[0]?.options).toMatchObject({
      contentLength: mediaBytes.byteLength,
      httpMetadata: {
        cacheControl: "private, no-store",
        contentType: "video/mp4",
      },
      onlyIf: { etagDoesNotMatch: "*" },
    });
    expect(calls[1]?.options).toMatchObject({
      contentLength: expect.any(Number),
      httpMetadata: {
        cacheControl: "private, no-store",
        contentType: "application/json",
      },
      onlyIf: { etagDoesNotMatch: "*" },
    });
    for (const { options } of calls) {
      expect(options.contentLength).toBeGreaterThan(0);
      expect(new Uint8Array(options.sha256)).toHaveLength(32);
      expect(Object.keys(options.customMetadata)).toHaveLength(4);
      expect(options.customMetadata).toMatchObject({
        generation: String(generation),
        importId,
        sha256: expect.stringMatching(/^[a-f\d]{64}$/u),
      });
      for (const [key, value] of Object.entries(options.customMetadata)) {
        expect(key.length).toBeLessThanOrEqual(32);
        expect(value.length).toBeLessThanOrEqual(64);
      }
    }
    expect(calls[0]?.value).toBeInstanceOf(ReadableStream);
    expect(ArrayBuffer.isView(calls[1]?.value)).toBe(true);
  });

  it("leaves a partial old generation untouched while a fresh generation succeeds", async () => {
    const importId = id(403);
    const oldGeneration = decodeGeneration(1);
    const currentGeneration = decodeGeneration(2);
    const fake = makeMediaObject();
    await testEnv.ImportEvidenceBucket.put(
      mediaObjectKey(importId, oldGeneration),
      mediaBytes,
      { customMetadata: { sha256 } }
    );

    await expect(
      Effect.runPromise(
        acquireStoreVerify(bucket(), fake.object, {
          canonicalId,
          generation: currentGeneration,
          importId,
          now,
        })
      )
    ).resolves.toMatchObject({
      _tag: "VerifiedAcquisition",
      generation: currentGeneration,
    });

    expect(
      await testEnv.ImportEvidenceBucket.head(
        mediaObjectKey(importId, oldGeneration)
      )
    ).not.toBeNull();
    expect(
      await testEnv.ImportEvidenceBucket.head(
        mediaObjectKey(importId, currentGeneration)
      )
    ).not.toBeNull();
    expect(
      await testEnv.ImportEvidenceBucket.head(
        manifestObjectKey(importId, currentGeneration)
      )
    ).not.toBeNull();
  });

  it("treats an impossible pre-existing current-generation key as retryable without writing the manifest", async () => {
    const importId = id(409);
    const generation = decodeGeneration(9);
    const fake = makeMediaObject();
    await testEnv.ImportEvidenceBucket.put(
      mediaObjectKey(importId, generation),
      mediaBytes
    );

    const exit = await Effect.runPromiseExit(
      acquireStoreVerify(bucket(), fake.object, {
        canonicalId,
        generation,
        importId,
        now,
      })
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect(
      await testEnv.ImportEvidenceBucket.head(
        mediaObjectKey(importId, generation)
      )
    ).not.toBeNull();
    expect(
      await testEnv.ImportEvidenceBucket.head(
        manifestObjectKey(importId, generation)
      )
    ).toBeNull();
  });

  it("encodes a semantic failure with its generation and writes no object", async () => {
    const importId = id(404);
    const generation = decodeGeneration(3);
    let calls = 0;
    const unavailable: AcquisitionMediaObjectLike = {
      cleanup: () => Effect.void,
      prepare: () => {
        calls += 1;
        return Effect.fail({
          _tag: "Unavailable",
          code: "private_or_unavailable",
        });
      },
      readArtifact: () => Stream.empty,
    };

    const result = await Effect.runPromise(
      acquireStoreVerify(bucket(), unavailable, {
        canonicalId,
        generation,
        importId,
        now,
      })
    );
    const listed = await testEnv.ImportEvidenceBucket.list({
      prefix: `imports/${importId}/`,
    });

    expect(result).toEqual({
      _tag: "Unavailable",
      code: "private_or_unavailable",
      generation,
    });
    expect(calls).toBe(1);
    expect(listed.objects).toEqual([]);
  });

  it.each(["resolve", "reject"] as const)(
    "returns at the hard mutation deadline and a fresh generation survives late %s",
    async (lateSettlement) => {
      vi.useFakeTimers();
      const importId = id(lateSettlement === "resolve" ? 405 : 407);
      const oldGeneration = decodeGeneration(1);
      const currentGeneration = decodeGeneration(2);
      const fake = makeMediaObject();
      const latePut = Promise.withResolvers<null>();
      const neverSettling: AcquisitionBucketLike = {
        ...bucket(),
        put: () => latePut.promise,
      };
      const result = Effect.runPromiseExit(
        acquireStoreVerify(neverSettling, fake.object, {
          canonicalId,
          generation: oldGeneration,
          importId,
          now,
        })
      );

      await vi.advanceTimersByTimeAsync(MaximumR2OperationMilliseconds - 1);
      let settled = false;
      void result.then(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      const exit = await result;
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(Option.getOrThrow(Cause.findErrorOption(exit.cause))).toEqual({
          _tag: "RetryableAcquisitionFailure",
          reason: "acquisition_timeout",
          stage: "store",
        });
      }

      await expect(
        Effect.runPromise(
          acquireStoreVerify(bucket(), fake.object, {
            canonicalId,
            generation: currentGeneration,
            importId,
            now,
          })
        )
      ).resolves.toMatchObject({
        _tag: "VerifiedAcquisition",
        generation: currentGeneration,
      });

      if (lateSettlement === "resolve") {
        latePut.resolve(null);
      } else {
        latePut.reject(new Error("late obsolete-generation rejection"));
      }
      await Promise.resolve();
      await Promise.resolve();
      expect(
        await testEnv.ImportEvidenceBucket.head(
          mediaObjectKey(importId, currentGeneration)
        )
      ).not.toBeNull();
      expect(fake.cleanupCalls()).toBe(2);
    }
  );

  it("cancels the local stream before bounded cleanup when R2 rejects", async () => {
    const importId = id(406);
    const generation = decodeGeneration(1);
    const fake = makeMediaObject();
    const events: string[] = [];
    const stub: AcquisitionMediaObjectStub = {
      cleanup: () =>
        Effect.sync(() => {
          events.push("cleanup");
        }),
      fetch: () =>
        Effect.succeed(
          HttpServerResponse.stream(
            Stream.never.pipe(
              Stream.ensuring(
                Effect.sync(() => {
                  events.push("stream-finalized");
                })
              )
            ),
            {
              contentLength: fake.prepared.bytes,
              contentType: "video/mp4",
              headers: { "cache-control": "private, no-store" },
            }
          )
        ),
      prepare: fake.object.prepare,
      prepareProviderEvidence: () =>
        Effect.die("derived evidence must remain untouched"),
    };
    const mediaObject = makeAcquisitionMediaObject(stub);
    const rejecting: AcquisitionBucketLike = {
      ...bucket(),
      put: () => Promise.reject(new Error("synthetic R2 rejection")),
    };

    const exit = await Effect.runPromiseExit(
      acquireStoreVerify(rejecting, mediaObject, {
        canonicalId,
        generation,
        importId,
        now,
      })
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Option.getOrThrow(Cause.findErrorOption(exit.cause))).toEqual({
        _tag: "RetryableAcquisitionFailure",
        reason: "container_rpc",
        stage: "store",
      });
    }
    expect(events).toEqual(["stream-finalized", "cleanup"]);
  });

  it("settles a mid-body read failure before cleanup", async () => {
    const importId = id(412);
    const generation = decodeGeneration(1);
    const fake = makeMediaObject();
    const events: string[] = [];
    const mediaObject: AcquisitionMediaObjectLike = {
      ...fake.object,
      cleanup: () =>
        Effect.sync(() => {
          events.push("cleanup");
        }),
      readArtifact: () =>
        Stream.make(mediaBytes.slice(0, 4)).pipe(
          Stream.concat(
            Stream.fail({
              _tag: "RetryableAcquisitionFailure" as const,
              reason: "container_rpc" as const,
              stage: "container" as const,
            })
          ),
          Stream.ensuring(
            Effect.sync(() => {
              events.push("stream-finalized");
            })
          )
        ),
    };

    const exit = await Effect.runPromiseExit(
      acquireStoreVerify(consumingBucket(), mediaObject, {
        canonicalId,
        generation,
        importId,
        now,
      })
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Option.getOrThrow(Cause.findErrorOption(exit.cause))).toEqual({
        _tag: "RetryableAcquisitionFailure",
        reason: "container_rpc",
        stage: "store",
      });
    }
    expect(events).toEqual(["stream-finalized", "cleanup"]);
  });

  it("interrupts the private read before workflow cleanup", async () => {
    const importId = id(413);
    const generation = decodeGeneration(1);
    const fake = makeMediaObject();
    const events: string[] = [];
    const streamStarted = Promise.withResolvers<null>();
    const mediaObject: AcquisitionMediaObjectLike = {
      ...fake.object,
      cleanup: () =>
        Effect.sync(() => {
          events.push("cleanup");
        }),
      readArtifact: () =>
        Stream.fromEffect(
          Effect.sync(() => {
            streamStarted.resolve(null);
          })
        ).pipe(
          Stream.flatMap(() => Stream.never),
          Stream.ensuring(
            Effect.sync(() => {
              events.push("stream-finalized");
            })
          )
        ),
    };
    const fiber = Effect.runFork(
      acquireStoreVerify(consumingBucket(), mediaObject, {
        canonicalId,
        generation,
        importId,
        now,
      })
    );

    await streamStarted.promise;
    await Effect.runPromise(Fiber.interrupt(fiber));

    expect(events).toEqual(["stream-finalized", "cleanup"]);
  });

  it("bounds a non-settling task-owned cleanup to exactly five seconds", async () => {
    vi.useFakeTimers();
    const importId = id(408);
    const generation = decodeGeneration(1);
    const fake = makeMediaObject();
    const cleanupStarted = Promise.withResolvers<null>();
    const mediaObject: AcquisitionMediaObjectLike = {
      ...fake.object,
      cleanup: () =>
        Effect.sync(() => cleanupStarted.resolve(null)).pipe(
          Effect.andThen(Effect.never)
        ),
    };
    const rejecting: AcquisitionBucketLike = {
      ...bucket(),
      put: () => Promise.reject(new Error("synthetic R2 rejection")),
    };
    const result = Effect.runPromiseExit(
      acquireStoreVerify(rejecting, mediaObject, {
        canonicalId,
        generation,
        importId,
        now,
      })
    );
    await cleanupStarted.promise;
    await vi.advanceTimersByTimeAsync(4999);
    let settled = false;
    void result.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const exit = await result;

    expect(Exit.isFailure(exit)).toBe(true);
  });

  it("closes an installed container RPC failure without retaining transport details", async () => {
    const importId = id(409);
    const generation = decodeGeneration(1);
    const fake = makeMediaObject();
    const mediaObject: AcquisitionMediaObjectLike = {
      ...fake.object,
      prepare: () =>
        Effect.fail({
          _tag: "RpcCallError",
          cause: new Error("opaque-provider-secret-fragment"),
          method: "prepare",
        } as never),
    };

    const exit = await Effect.runPromiseExit(
      acquireStoreVerify(bucket(), mediaObject, {
        canonicalId,
        generation,
        importId,
        now,
      })
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const error = Option.getOrThrow(Cause.findErrorOption(exit.cause));
      expect(error).toEqual({
        _tag: "RetryableAcquisitionFailure",
        reason: "container_rpc",
        stage: "container",
      });
      expect(JSON.stringify(error)).not.toContain(
        "opaque-provider-secret-fragment"
      );
    }
    expect(fake.cleanupCalls()).toBe(0);
  });
});
