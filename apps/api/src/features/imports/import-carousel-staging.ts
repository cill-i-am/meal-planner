import { Effect, Schema } from "effect";

import type {
  TikTokCarouselAdapterShape,
  TikTokCarouselDescriptor,
  TikTokCarouselImageArtifact,
} from "./import-carousel-adapter.js";
import type { AcquisitionBucketLike } from "./import-media-acquirer.js";
import {
  ImportId,
  ImportTimestamp,
  SourceCanonicalId,
  SourceUrl,
} from "./import.contracts.js";

const Sha256Hex = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-f\d]{64}$/u))
);
const PositiveInteger = Schema.Number.pipe(
  Schema.check(Schema.isInt(), Schema.isGreaterThan(0))
);
const StagedCarouselManifest = Schema.Struct({
  canonicalId: SourceCanonicalId,
  declaredPageCount: PositiveInteger,
  images: Schema.NonEmptyArray(
    Schema.Struct({
      byteLength: PositiveInteger,
      height: PositiveInteger,
      key: Schema.String,
      orderIndex: Schema.Number.pipe(
        Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
      ),
      sha256: Sha256Hex,
      width: PositiveInteger,
    })
  ),
  importId: ImportId,
  receivedAt: ImportTimestamp,
  schemaVersion: Schema.Literal(1),
});
type StagedCarouselManifest = typeof StagedCarouselManifest.Type;

const failure = () => ({
  _tag: "TikTokCarouselAdapterFailure" as const,
  code: "carousel_partial" as const,
  completeness: "incomplete_no_draft" as const,
  recovery: "request_complete_carousel" as const,
});

const stagingPrefix = (importId: ImportId) =>
  `imports/${importId}/carousel/v1/staged`;

export const stagedCarouselManifestObjectKey = (importId: ImportId) =>
  `${stagingPrefix(importId)}/manifest.json`;

const stagedCarouselImageObjectKey = (importId: ImportId, orderIndex: number) =>
  `${stagingPrefix(importId)}/images/${String(orderIndex).padStart(2, "0")}.jpg`;

const checksumBuffer = (hex: string) => {
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes.buffer;
};

const bytesToHex = (value: ArrayBuffer) =>
  Array.from(new Uint8Array(value), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");

const sha256Hex = (bytes: Uint8Array) =>
  Effect.promise(() =>
    crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer)
  ).pipe(
    Effect.map((digest) =>
      Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0")
      ).join("")
    )
  );

const putPrivate = (
  bucket: AcquisitionBucketLike,
  input: {
    readonly bytes: Uint8Array;
    readonly contentType: "application/json" | "image/jpeg";
    readonly key: string;
    readonly metadata: Record<string, string>;
    readonly sha256: string;
  }
) =>
  Effect.gen(function* put() {
    yield* Effect.tryPromise({
      catch: failure,
      try: () =>
        bucket.put(input.key, input.bytes, {
          contentLength: input.bytes.byteLength,
          customMetadata: input.metadata,
          httpMetadata: {
            cacheControl: "private, no-store",
            contentType: input.contentType,
          },
          onlyIf: { etagDoesNotMatch: "*" },
          sha256: checksumBuffer(input.sha256),
        }),
    });
    const stored = yield* Effect.tryPromise({
      catch: failure,
      try: () => bucket.head(input.key),
    });
    if (
      stored === null ||
      stored.size !== input.bytes.byteLength ||
      stored.checksums?.sha256 === undefined ||
      bytesToHex(stored.checksums.sha256) !== input.sha256 ||
      stored.httpMetadata?.cacheControl !== "private, no-store" ||
      stored.httpMetadata.contentType !== input.contentType ||
      Object.entries(input.metadata).some(
        ([key, value]) => stored.customMetadata?.[key] !== value
      )
    ) {
      return yield* Effect.fail(failure());
    }
  });

/** Persist an already validated operator bundle before starting the workflow. */
export const stageOperatorCarouselForWorkflow = (input: {
  readonly adapter: TikTokCarouselAdapterShape;
  readonly bucket: AcquisitionBucketLike;
  readonly descriptor: TikTokCarouselDescriptor;
  readonly importId: ImportId;
}) =>
  Effect.gen(function* stage() {
    const acquired = yield* input.adapter.acquire(input.descriptor);
    const images = yield* Effect.forEach(
      acquired.images,
      (image, orderIndex) =>
        Effect.gen(function* stageImage() {
          const key = stagedCarouselImageObjectKey(input.importId, orderIndex);
          yield* putPrivate(input.bucket, {
            bytes: image.bytes,
            contentType: "image/jpeg",
            key,
            metadata: {
              importId: input.importId,
              kind: "staged_operator_carousel_image",
              orderIndex: String(orderIndex),
              sha256: image.sha256,
            },
            sha256: image.sha256,
          });
          return {
            byteLength: image.bytes.byteLength,
            height: image.height,
            key,
            orderIndex,
            sha256: image.sha256,
            width: image.width,
          };
        }),
      { concurrency: 1 }
    );
    const [firstImage, ...remainingImages] = images;
    if (
      firstImage === undefined ||
      images.length !== input.descriptor.declaredPageCount
    ) {
      return yield* Effect.fail(failure());
    }
    const manifest: StagedCarouselManifest = {
      canonicalId: input.descriptor.canonicalId,
      declaredPageCount: input.descriptor.declaredPageCount,
      images: [firstImage, ...remainingImages],
      importId: input.importId,
      receivedAt: Schema.decodeUnknownSync(ImportTimestamp)(
        acquired.source.observedAt
      ),
      schemaVersion: 1,
    };
    const bytes = new TextEncoder().encode(
      JSON.stringify(Schema.encodeSync(StagedCarouselManifest)(manifest))
    );
    const sha256 = yield* sha256Hex(bytes);
    yield* putPrivate(input.bucket, {
      bytes,
      contentType: "application/json",
      key: stagedCarouselManifestObjectKey(input.importId),
      metadata: {
        importId: input.importId,
        kind: "staged_operator_carousel_manifest",
        sha256,
      },
      sha256,
    });
  });

const readBytes = (
  bucket: AcquisitionBucketLike,
  key: string,
  expectedLength: number,
  expectedSha256: string
) =>
  Effect.gen(function* read() {
    const object = yield* Effect.tryPromise({
      catch: failure,
      try: () => bucket.get(key),
    });
    if (object === null || object.arrayBuffer === undefined) {
      return yield* Effect.fail(failure());
    }
    const { arrayBuffer } = object;
    const bytes = new Uint8Array(
      yield* Effect.tryPromise({
        catch: failure,
        try: () => arrayBuffer(),
      })
    );
    if (
      bytes.byteLength !== expectedLength ||
      (yield* sha256Hex(bytes)) !== expectedSha256
    ) {
      return yield* Effect.fail(failure());
    }
    return bytes;
  });

/** Resolve a staged bundle by import ID without placing media in workflow input. */
export const loadStagedOperatorCarousel = (input: {
  readonly bucket: AcquisitionBucketLike;
  readonly importId: ImportId;
}) =>
  Effect.gen(function* load() {
    const object = yield* Effect.tryPromise({
      catch: failure,
      try: () =>
        input.bucket.get(stagedCarouselManifestObjectKey(input.importId)),
    });
    if (object === null) {
      return null;
    }
    const manifest = yield* Effect.tryPromise({
      catch: failure,
      try: () => object.text(),
    }).pipe(
      Effect.flatMap((text) =>
        Effect.try({
          catch: failure,
          try: () => JSON.parse(text) as unknown,
        })
      ),
      Effect.flatMap(
        Schema.decodeUnknownEffect(StagedCarouselManifest, {
          onExcessProperty: "error",
        })
      ),
      Effect.mapError(failure)
    );
    if (manifest.importId !== input.importId) {
      return yield* Effect.fail(failure());
    }
    const images = yield* Effect.forEach(
      manifest.images,
      (image, orderIndex) =>
        readBytes(input.bucket, image.key, image.byteLength, image.sha256).pipe(
          Effect.map(
            (bytes): TikTokCarouselImageArtifact => ({
              bytes,
              height: image.height,
              mimeType: "image/jpeg",
              orderIndex,
              sha256: image.sha256,
              width: image.width,
            })
          )
        ),
      { concurrency: 1 }
    );
    const sourceUrl = Schema.decodeUnknownSync(SourceUrl)(
      `https://www.tiktok.com/@source/photo/${manifest.canonicalId}`
    );
    const descriptor: TikTokCarouselDescriptor = {
      canonicalId: manifest.canonicalId,
      declaredPageCount: manifest.declaredPageCount,
      kind: "tiktok_carousel",
      sourceUrl,
    };
    const adapter: TikTokCarouselAdapterShape = {
      acquire: (requested) =>
        requested.canonicalId === descriptor.canonicalId &&
        requested.declaredPageCount === descriptor.declaredPageCount
          ? Effect.succeed({
              images,
              source: {
                canonicalUrl: sourceUrl,
                caption: null,
                creator: { displayName: null, handle: null, id: null },
                observedAt: Schema.encodeSync(ImportTimestamp)(
                  manifest.receivedAt
                ),
                provenance: {
                  canonicalUrl: "operator_supplied",
                  caption: null,
                  creator: {
                    displayName: null,
                    handle: null,
                    id: null,
                  },
                  publishedAt: null,
                },
                publishedAt: null,
              },
            })
          : Effect.fail(failure()),
    };
    return { adapter, descriptor };
  });
