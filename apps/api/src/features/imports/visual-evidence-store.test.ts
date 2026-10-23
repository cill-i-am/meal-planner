import { it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";
import { expect } from "vitest";

import { checksumBytes, sha256Bytes } from "./import-digest.js";
import type {
  AcquisitionBucketLike,
  AcquisitionPutOptions,
  R2ObjectBodyLike,
} from "./import-media-acquirer.js";
import {
  AcquisitionGeneration,
  EvidenceRetentionSeconds,
  Sha256Hex,
} from "./import-media.model.js";
import type { VisualFrameArtifact } from "./import-visual-evidence-extractor.js";
import { ImportId, ImportTimestamp } from "./import.contracts.js";
import {
  VisualEvidenceManifestDocument,
  VisualEvidenceStore,
  VisualEvidenceStoreLive,
} from "./visual-evidence-store.js";
import type { VisualEvidenceManifest } from "./visual-evidence-store.js";

const importId = Schema.decodeUnknownSync(ImportId)(
  "11111111-1111-4111-8111-111111111111"
);
const generation = Schema.decodeUnknownSync(AcquisitionGeneration)(1);
const sourceMediaSha256 = Schema.decodeUnknownSync(Sha256Hex)("a".repeat(64));
const sourceEvidenceDeleteAt = Schema.decodeUnknownSync(ImportTimestamp)(
  "2026-10-30T12:00:00.000Z"
);
const dispatchId = `visual:${importId}:${generation}`;
const prefix = `imports/${importId}/visual/v1/generations/${generation}`;
const manifestKey = `${prefix}/manifest.json`;
const expected = {
  dispatchId,
  generation,
  importId,
  sourceEvidenceDeleteAt,
  sourceMediaSha256,
};

const memoryBucket = () => {
  const objects = new Map<string, R2ObjectBodyLike>();
  const bucket: AcquisitionBucketLike = {
    get: (key) => Effect.sync(() => objects.get(key) ?? null),
    head: (key) => Effect.sync(() => objects.get(key) ?? null),
    put: (key, value, options) =>
      Effect.gen(function* putFixtureObject() {
        if (objects.has(key)) {
          return null;
        }
        if (!ArrayBuffer.isView(value)) {
          return yield* Effect.die("Visual evidence writes must contain bytes");
        }
        const bytes = new Uint8Array(
          value.buffer,
          value.byteOffset,
          value.byteLength
        ).slice();
        const digest = yield* sha256Bytes(bytes);
        const object: R2ObjectBodyLike = {
          arrayBuffer: () => Effect.succeed(Uint8Array.from(bytes).buffer),
          checksums: { sha256: checksumBytes(digest) },
          customMetadata: options.customMetadata,
          httpMetadata: options.httpMetadata,
          size: bytes.byteLength,
          text: () => Effect.succeed(new TextDecoder().decode(bytes)),
        };
        objects.set(key, object);
        return object;
      }),
  };
  return { bucket, objects };
};

const fixture = () =>
  Effect.gen(function* makeVisualFixture() {
    const frames = yield* Effect.forEach([3, 5, 7], (size, frameIndex) => {
      const bytes = new Uint8Array(size).fill(frameIndex + 1);
      return sha256Bytes(bytes).pipe(
        Effect.map((sha256): VisualFrameArtifact => ({
          bytes,
          height: 640,
          mimeType: "image/jpeg",
          sha256,
          timestampMilliseconds: (frameIndex + 1) * 100,
          width: 360,
        }))
      );
    });
    const manifest: VisualEvidenceManifest = {
      acquisitionGeneration: generation,
      cost: { certainty: "known", currency: "USD", estimatedMicroUsd: 9 },
      createdAt: Schema.decodeUnknownSync(ImportTimestamp)(
        "2026-10-23T12:00:00.000Z"
      ),
      dispatchId,
      importId,
      model: "fixture-visual",
      observations: frames.map((frame, frameIndex) => ({
        confidence: 1,
        frameIndex,
        kind: "visible_text",
        regions: [{ height: 1, width: 1, x: 0, y: 0 }],
        text: `Text from frame ${frameIndex}`,
        timestampMilliseconds: frame.timestampMilliseconds,
      })),
      outcome: "found",
      provider: "fixture",
      retention: {
        configuredAgeSeconds: EvidenceRetentionSeconds,
        policy: "r2_bucket_object_age",
      },
      schemaVersion: 2,
      sourceEvidenceDeleteAt,
      sourceMediaSha256,
      usage: { inputBytes: 15, inputFrames: 3, modelCalls: 1 },
    };
    return { ...memoryBucket(), frames, manifest };
  });

// Seed persisted bytes independently of the writer, with real content digests.
const seedDocument = (
  bucket: AcquisitionBucketLike,
  manifest: VisualEvidenceManifest,
  frames: readonly VisualFrameArtifact[]
) =>
  Effect.gen(function* seedPersistedVisualDocument() {
    const references = frames.map((frame, frameIndex) => ({
      byteLength: frame.bytes.byteLength,
      frameIndex,
      height: frame.height,
      key: `${prefix}/frames/${String(frameIndex).padStart(2, "0")}.jpg`,
      mimeType: frame.mimeType,
      sha256: frame.sha256,
      timestampMilliseconds: frame.timestampMilliseconds,
      width: frame.width,
    }));
    const document = Schema.decodeUnknownSync(
      Schema.toType(VisualEvidenceManifestDocument)
    )({ ...manifest, frames: references });
    const put = (
      key: string,
      bytes: Uint8Array,
      contentType: AcquisitionPutOptions["httpMetadata"]["contentType"],
      customMetadata: Record<string, string>
    ) =>
      sha256Bytes(bytes).pipe(
        Effect.flatMap((sha256) =>
          bucket.put(key, bytes, {
            contentLength: bytes.byteLength,
            customMetadata: { ...customMetadata, sha256 },
            httpMetadata: { cacheControl: "private, no-store", contentType },
            onlyIf: { etagDoesNotMatch: "*" },
            sha256: checksumBytes(sha256),
          })
        )
      );
    const metadata = {
      generation: String(generation),
      importId,
      sourceMediaSha256,
    };
    yield* Effect.forEach(
      frames,
      (frame, frameIndex) =>
        put(
          `${prefix}/frames/${String(frameIndex).padStart(2, "0")}.jpg`,
          frame.bytes,
          "image/jpeg",
          {
            ...metadata,
            frameIndex: String(frameIndex),
            kind: "visual_frame",
            timestampMilliseconds: String(frame.timestampMilliseconds),
          }
        ),
      { discard: true }
    );
    const bytes = new TextEncoder().encode(
      JSON.stringify(
        Schema.encodeSync(VisualEvidenceManifestDocument)(document)
      )
    );
    yield* put(manifestKey, bytes, "application/json", {
      ...metadata,
      kind: "visual_evidence_manifest",
    });
  });

const invalidFrameContract = {
  _tag: "VisualEvidenceStoreError",
  code: "invalid_manifest",
  reasonCode: "visual_manifest_frame_contract_invalid",
};

it.effect("writes and recovers version 2 with every frame accounted for", () =>
  Effect.gen(function* roundTripAllFrames() {
    const { bucket, frames, manifest, objects } = yield* fixture();
    const result = yield* Effect.gen(function* writeAndReadEvidence() {
      const store = yield* VisualEvidenceStore;
      const written = yield* store.putVerified({ frames, manifest });
      const recovered = yield* store.readVerified({
        ...expected,
        recoverySha256: written.sha256,
      });
      expect(Option.getOrThrow(recovered)).toEqual(written);
      return written;
    }).pipe(Effect.provide(VisualEvidenceStoreLive(bucket)));
    expect(result.document).toMatchObject({
      observations: manifest.observations,
      schemaVersion: 2,
      usage: { inputBytes: 15, inputFrames: 3, modelCalls: 1 },
    });
    expect(result.document.frames).toHaveLength(3);
    expect(objects.size).toBe(4);
  })
);

for (const usage of [
  { inputBytes: 5, inputFrames: 3, modelCalls: 1 as const },
  { inputBytes: 15, inputFrames: 1, modelCalls: 1 as const },
]) {
  it.effect(
    `rejects version 2 undercount before writing: ${JSON.stringify(usage)}`,
    () =>
      Effect.gen(function* rejectWriteUndercount() {
        const { bucket, frames, manifest, objects } = yield* fixture();
        const error = yield* Effect.gen(function* writeUndercountedEvidence() {
          const store = yield* VisualEvidenceStore;
          return yield* Effect.flip(
            store.putVerified({ frames, manifest: { ...manifest, usage } })
          );
        }).pipe(Effect.provide(VisualEvidenceStoreLive(bucket)));
        expect(error).toMatchObject(invalidFrameContract);
        expect(objects.size).toBe(0);
      })
  );

  it.effect(
    `rejects persisted version 2 undercount: ${JSON.stringify(usage)}`,
    () =>
      Effect.gen(function* rejectReadUndercount() {
        const { bucket, frames, manifest } = yield* fixture();
        yield* seedDocument(bucket, { ...manifest, usage }, frames);
        const error = yield* Effect.gen(function* readUndercountedEvidence() {
          const store = yield* VisualEvidenceStore;
          return yield* Effect.flip(store.readVerified(expected));
        }).pipe(Effect.provide(VisualEvidenceStoreLive(bucket)));
        expect(error).toMatchObject(invalidFrameContract);
      })
  );
}

it.effect(
  "recovers persisted version 1 with only the middle frame charged",
  () =>
    Effect.gen(function* recoverLegacyEvidence() {
      const { bucket, frames, manifest, objects } = yield* fixture();
      const legacy: VisualEvidenceManifest = {
        ...manifest,
        observations: manifest.observations.filter(
          ({ frameIndex }) => frameIndex === 1
        ),
        schemaVersion: 1,
        usage: { inputBytes: 5, inputFrames: 1, modelCalls: 1 },
      };
      yield* seedDocument(bucket, legacy, frames);
      const recovered = yield* Effect.gen(function* readLegacyEvidence() {
        const store = yield* VisualEvidenceStore;
        return yield* store.readVerified(expected);
      }).pipe(Effect.provide(VisualEvidenceStoreLive(bucket)));
      expect(Option.getOrThrow(recovered).document).toMatchObject(legacy);
      expect(objects.size).toBe(4);
    })
);

it.effect(
  "does not interpret aggregate usage as a valid version 1 manifest",
  () =>
    Effect.gen(function* rejectLegacyAggregateUsage() {
      const { bucket, frames, manifest } = yield* fixture();
      yield* seedDocument(bucket, { ...manifest, schemaVersion: 1 }, frames);
      const error = yield* Effect.gen(function* readInvalidLegacyEvidence() {
        const store = yield* VisualEvidenceStore;
        return yield* Effect.flip(store.readVerified(expected));
      }).pipe(Effect.provide(VisualEvidenceStoreLive(bucket)));
      expect(error).toMatchObject(invalidFrameContract);
    })
);

for (const observationIdentity of [
  { frameIndex: 3, timestampMilliseconds: 100 },
  { frameIndex: 0, timestampMilliseconds: 999 },
]) {
  it.effect(
    `rejects incorrect observation identity on write and read: ${JSON.stringify(observationIdentity)}`,
    () =>
      Effect.gen(function* rejectObservationIdentity() {
        const { bucket, frames, manifest, objects } = yield* fixture();
        const invalid = {
          ...manifest,
          observations: manifest.observations.map((observation) => ({
            ...observation,
            ...observationIdentity,
          })),
        };
        const layer = VisualEvidenceStoreLive(bucket);
        const writeError = yield* Effect.gen(function* writeInvalidIdentity() {
          const store = yield* VisualEvidenceStore;
          return yield* Effect.flip(
            store.putVerified({ frames, manifest: invalid })
          );
        }).pipe(Effect.provide(layer));
        expect(writeError).toMatchObject(invalidFrameContract);
        expect(objects.size).toBe(0);
        yield* seedDocument(bucket, invalid, frames);
        const readError = yield* Effect.gen(function* readInvalidIdentity() {
          const store = yield* VisualEvidenceStore;
          return yield* Effect.flip(store.readVerified(expected));
        }).pipe(Effect.provide(layer));
        expect(readError).toMatchObject(invalidFrameContract);
      })
  );
}
