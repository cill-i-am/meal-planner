import { env } from "cloudflare:test";
import { Effect, Exit, Schema, Stream } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { acquireStoreVerify } from "./import-media-acquirer.js";
import type {
  AcquisitionBucketLike,
  AcquisitionMediaObjectLike,
  AcquisitionPutOptions,
  PreparedMediaArtifact,
} from "./import-media-acquirer.js";
import {
  AcquisitionGeneration,
  MaximumR2OperationMilliseconds,
  manifestObjectKey,
  mediaObjectKey,
} from "./import-media.model.js";
import { ImportId, SourceCanonicalId } from "./import.contracts.js";

interface TestR2Object {
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

const makeMediaObject = () => {
  let cleanupCalls = 0;
  let prepares = 0;
  const preparedInputs: unknown[] = [];
  const prepared: PreparedMediaArtifact = {
    artifactId: "artifact-safe-id",
    audioStreams: [{ codec: "aac", index: 1 }],
    bytes: mediaBytes.byteLength,
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
    sha256,
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
    stream: () => Stream.make(mediaBytes),
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

describe("native R2 generation commit", () => {
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
      stream: () => Stream.empty,
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
    const mediaObject: AcquisitionMediaObjectLike = {
      ...fake.object,
      cleanup: () =>
        Effect.sync(() => {
          events.push("cleanup");
        }),
      stream: () =>
        Stream.never.pipe(
          Stream.ensuring(
            Effect.sync(() => {
              events.push("stream-finalized");
            })
          )
        ),
    };
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
});
