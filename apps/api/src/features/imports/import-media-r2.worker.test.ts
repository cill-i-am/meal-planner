import { env } from "cloudflare:test";
import { Cause, Effect, Exit, Fiber, Option, Schema, Stream } from "effect";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HouseholdReadEvidenceReferencesResult } from "../households/evidence/household-evidence.contract.js";
import {
  makeR2SpeechAudioExtractor,
  makeR2VisualFrameSampler,
  persistDerivedProviderEvidence,
} from "./import-derived-media.js";
import { inspectHouseholdEvidenceReferences } from "./import-evidence-availability.js";
import {
  VerifiedPreparedMediaArtifact,
  acquireStoreVerify,
} from "./import-media-acquirer.js";
import type {
  AcquisitionBucketLike,
  AcquisitionMediaObjectLike,
  AcquisitionPutOptions,
  AcquisitionPutValue,
  PreparedMediaArtifact,
  R2ObjectBodyLike,
  R2ObjectLike,
} from "./import-media-acquirer.js";
import { makeAcquisitionMediaObject } from "./import-media-acquisition-object.client.js";
import type { AcquisitionMediaObjectStub } from "./import-media-acquisition-object.client.js";
import { RetryableAcquisitionError } from "./import-media.errors.js";
import {
  AcquisitionGeneration,
  MaximumR2OperationMilliseconds,
  MediaArtifactId,
  MediaByteCount,
  MediaDurationSeconds,
  Sha256Hex,
  manifestObjectKey,
  mediaObjectKey,
} from "./import-media.model.js";
import { workerTestR2PutBody } from "./import-worker-test-environment.js";
import type {
  ImportWorkerR2TestEnvironment,
  WorkerTestR2Object,
  WorkerTestR2ObjectBody,
} from "./import-worker-test-environment.js";
import {
  ImportId,
  ImportTimestamp,
  SourceCanonicalId,
} from "./import.contracts.js";

const testEnv: ImportWorkerR2TestEnvironment = env;
const mediaBytes = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70]);
const sha256 =
  "d9f1cb99ee21291800d5e62bd9bca07850461d7d8096afc4150a52dc8554d49f";
const decodeGeneration = Schema.decodeUnknownSync(AcquisitionGeneration);

const id = (suffix: number) =>
  Schema.decodeUnknownSync(ImportId)(
    `018f47ad-91aa-7c35-b6fe-${String(suffix).padStart(12, "0")}`
  );
const canonicalId = Schema.decodeUnknownSync(SourceCanonicalId)(
  "7520000000000000000"
);

const retryableR2Failure = (stage: "store" | "verify") =>
  new RetryableAcquisitionError({ reason: "container_rpc", stage });

const r2Object = (object: WorkerTestR2Object): R2ObjectLike => {
  let projected: R2ObjectLike = {
    checksums: object.checksums,
    size: object.size,
  };
  if (object.customMetadata !== undefined) {
    projected = { ...projected, customMetadata: object.customMetadata };
  }
  if (object.httpMetadata !== undefined) {
    projected = { ...projected, httpMetadata: object.httpMetadata };
  }
  return projected;
};

const r2ObjectBody = (object: WorkerTestR2ObjectBody): R2ObjectBodyLike => ({
  ...r2Object(object),
  arrayBuffer: () =>
    Effect.tryPromise({
      catch: () => retryableR2Failure("verify"),
      try: () => object.arrayBuffer(),
    }),
  text: () =>
    Effect.tryPromise({
      catch: () => retryableR2Failure("verify"),
      try: () => object.text(),
    }),
});

const bucket = (): AcquisitionBucketLike => ({
  get: (key) =>
    Effect.tryPromise({
      catch: () => retryableR2Failure("verify"),
      try: () => testEnv.ImportEvidenceBucket.get(key),
    }).pipe(
      Effect.map((object) => (object === null ? null : r2ObjectBody(object)))
    ),
  head: (key) =>
    Effect.tryPromise({
      catch: () => retryableR2Failure("verify"),
      try: () => testEnv.ImportEvidenceBucket.head(key),
    }).pipe(
      Effect.map((object) => (object === null ? null : r2Object(object)))
    ),
  put: (key, value, options) =>
    Effect.gen(function* putR2Object() {
      const body = yield* workerTestR2PutBody(value, options.contentLength);
      return yield* Effect.tryPromise({
        catch: () => retryableR2Failure("store"),
        try: () => testEnv.ImportEvidenceBucket.put(key, body, options),
      });
    }).pipe(
      Effect.map((object) => (object === null ? null : r2Object(object)))
    ),
});

const consumingBucket = (): AcquisitionBucketLike => ({
  get: () => Effect.fail(retryableR2Failure("verify")),
  head: () => Effect.fail(retryableR2Failure("verify")),
  put: (_key, value) =>
    ArrayBuffer.isView(value)
      ? Effect.fail(retryableR2Failure("store"))
      : Stream.runDrain(value).pipe(
          Effect.mapError(() => retryableR2Failure("store")),
          Effect.as(null)
        ),
});

const rejectAfterStartingStream = (value: AcquisitionPutValue) =>
  ArrayBuffer.isView(value)
    ? Effect.fail(retryableR2Failure("store"))
    : Effect.scoped(
        Effect.gen(function* rejectStreamedPut() {
          yield* Stream.runDrain(value).pipe(Effect.forkScoped);
          yield* Effect.yieldNow;
          return yield* Effect.fail(retryableR2Failure("store"));
        })
      );

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

describe("household evidence availability inspection", () => {
  it("reports a physically missing R2 object without changing compact integrity metadata", async () => {
    const importId = id(410);
    const generation = decodeGeneration(1);
    const mediaKey = mediaObjectKey(importId, generation);
    const manifestKey = manifestObjectKey(importId, generation);
    await testEnv.ImportEvidenceBucket.put(manifestKey, "{}", {
      httpMetadata: { contentType: "application/json" },
    });
    const result = Schema.decodeUnknownSync(
      HouseholdReadEvidenceReferencesResult
    )({
      executionGeneration: generation,
      intentId: importId,
      references: [
        {
          availability: "available",
          byteLength: 8,
          deleteAt: "2026-08-29T12:00:00.000Z",
          key: mediaKey,
          kind: "original_media",
          observationOrdinal: 0,
          sha256: "a".repeat(64),
        },
        {
          availability: "available",
          byteLength: 2,
          deleteAt: "2026-08-29T12:00:00.000Z",
          key: manifestKey,
          kind: "acquisition_manifest",
          observationOrdinal: 0,
          sha256: "b".repeat(64),
        },
      ],
    });

    const inspected = await Effect.runPromise(
      inspectHouseholdEvidenceReferences(bucket(), result.references)
    );

    expect(inspected.map(({ availability }) => availability)).toEqual([
      "missing",
      "available",
    ]);
    expect(inspected.map(({ reference }) => reference)).toEqual(
      result.references
    );
  });
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
      persistDerivedProviderEvidence(
        bucket(),
        mediaObject,
        Schema.decodeUnknownSync(VerifiedPreparedMediaArtifact)(prepared),
        {
          generation,
          importId,
        }
      )
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
            sha256: "a".repeat(64),
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
      get: () => Effect.fail(retryableR2Failure("verify")),
      head: () => Effect.fail(retryableR2Failure("verify")),
      put: (key, value) => {
        if (key.endsWith("/provider-audio.wav")) {
          return rejectAfterStartingStream(value);
        }
        return ArrayBuffer.isView(value)
          ? Effect.fail(retryableR2Failure("store"))
          : Stream.runDrain(value).pipe(
              Effect.as({ size: mediaBytes.byteLength })
            );
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
      })
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(
        Option.getOrThrow(Cause.findErrorOption(exit.cause))
      ).toMatchObject({
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
    let observedVerifiedPreparedArtifact = false;

    const first = await Effect.runPromise(
      acquireStoreVerify(acquisitionBucket, mediaObject, {
        beforeCleanup: (prepared) =>
          Effect.sync(() => {
            const {
              artifactId,
              bytes,
              durationSeconds: duration,
              metadata: { observedAt },
              sha256: hash,
            }: {
              readonly artifactId: typeof MediaArtifactId.Type;
              readonly bytes: typeof MediaByteCount.Type;
              readonly durationSeconds: typeof MediaDurationSeconds.Type;
              readonly metadata: {
                readonly observedAt: typeof ImportTimestamp.Type;
              };
              readonly sha256: typeof Sha256Hex.Type;
            } = prepared;

            expect(Schema.is(MediaArtifactId)(artifactId)).toBe(true);
            expect(Schema.is(MediaByteCount)(bytes)).toBe(true);
            expect(Schema.is(MediaDurationSeconds)(duration)).toBe(true);
            expect(Schema.is(ImportTimestamp)(observedAt)).toBe(true);
            expect(Schema.is(Sha256Hex)(hash)).toBe(true);
            observedVerifiedPreparedArtifact = true;
          }),
        canonicalId,
        generation,
        importId,
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
    expect(observedVerifiedPreparedArtifact).toBe(true);
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
      readonly value: AcquisitionPutValue;
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
    expect(Stream.isStream(calls[0]?.value)).toBe(true);
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
        put: () =>
          Effect.tryPromise({
            catch: () => retryableR2Failure("store"),
            try: () => latePut.promise,
          }),
      };
      const result = Effect.runPromiseExit(
        acquireStoreVerify(neverSettling, fake.object, {
          canonicalId,
          generation: oldGeneration,
          importId,
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
        expect(
          Option.getOrThrow(Cause.findErrorOption(exit.cause))
        ).toMatchObject({
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
      put: (_key, value) => rejectAfterStartingStream(value),
    };

    const exit = await Effect.runPromiseExit(
      acquireStoreVerify(rejecting, mediaObject, {
        canonicalId,
        generation,
        importId,
      })
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(
        Option.getOrThrow(Cause.findErrorOption(exit.cause))
      ).toMatchObject({
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
      })
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(
        Option.getOrThrow(Cause.findErrorOption(exit.cause))
      ).toMatchObject({
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
      put: () => Effect.fail(retryableR2Failure("store")),
    };
    const result = Effect.runPromiseExit(
      acquireStoreVerify(rejecting, mediaObject, {
        canonicalId,
        generation,
        importId,
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
    const stub: AcquisitionMediaObjectStub = {
      cleanup: fake.object.cleanup,
      fetch: () => Effect.fail(new Error("opaque-provider-secret-fragment")),
      prepare: fake.object.prepare,
      prepareProviderEvidence: () =>
        Effect.die("derived evidence must remain untouched"),
    };
    const mediaObject = makeAcquisitionMediaObject(stub);

    const exit = await Effect.runPromiseExit(
      acquireStoreVerify(bucket(), mediaObject, {
        canonicalId,
        generation,
        importId,
      })
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const error = Option.getOrThrow(Cause.findErrorOption(exit.cause));
      expect(error).toMatchObject({
        _tag: "RetryableAcquisitionFailure",
        reason: "container_rpc",
        stage: "container",
      });
      expect(JSON.stringify(error)).not.toContain(
        "opaque-provider-secret-fragment"
      );
    }
    expect(fake.cleanupCalls()).toBe(1);
  });
});
