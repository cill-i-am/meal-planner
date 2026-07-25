import { Effect, Schema } from "effect";

import type {
  TikTokCarouselAdapterFailure,
  TikTokCarouselAdapterShape,
  TikTokCarouselImageArtifact,
} from "./import-carousel-adapter.js";
import {
  MaximumCarouselImages,
  readJpegDimensions,
} from "./import-carousel-adapter.js";
import {
  MaximumVisualFrameBytes,
  MaximumVisualInputBytes,
} from "./import-visual-evidence-extractor.js";
import { ImportTimestamp, SourceUrl } from "./import.contracts.js";
import type { SourceCanonicalId } from "./import.contracts.js";

const PositiveInteger = Schema.Number.pipe(
  Schema.check(
    Schema.isInt(),
    Schema.isGreaterThan(0),
    Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)
  )
);
const SafeOrderIndex = Schema.Number.pipe(
  Schema.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(0),
    Schema.isLessThan(MaximumCarouselImages)
  )
);
const Sha256Hex = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-f\d]{64}$/u))
);
const MaximumEncodedJpegBytes = Math.ceil(MaximumVisualFrameBytes / 3) * 4;
const EncodedJpeg = Schema.String.pipe(
  Schema.check(
    Schema.isNonEmpty(),
    Schema.isMaxLength(MaximumEncodedJpegBytes),
    Schema.isPattern(
      /^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/u
    )
  )
);

export const OperatorCarouselBundle = Schema.Struct({
  declaredPageCount: PositiveInteger.pipe(
    Schema.check(Schema.isLessThanOrEqualTo(MaximumCarouselImages))
  ),
  images: Schema.NonEmptyArray(
    Schema.Struct({
      height: PositiveInteger,
      jpegBase64: EncodedJpeg,
      orderIndex: SafeOrderIndex,
      sha256: Sha256Hex,
      width: PositiveInteger,
    })
  ).pipe(Schema.check(Schema.isMaxLength(MaximumCarouselImages))),
  source: Schema.Struct({
    kind: Schema.Literal("tiktok"),
    url: SourceUrl,
  }),
});
export type OperatorCarouselBundle = typeof OperatorCarouselBundle.Type;

const partialFailure = (): TikTokCarouselAdapterFailure => ({
  _tag: "TikTokCarouselAdapterFailure",
  code: "carousel_partial",
  completeness: "incomplete_no_draft",
  recovery: "request_complete_carousel",
});

const decodeBase64 = (value: string) =>
  Effect.try({
    catch: partialFailure,
    try: () => {
      const binary = atob(value);
      return Uint8Array.from(
        binary,
        (character) => character.codePointAt(0) ?? 0
      );
    },
  });

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

export const makeOperatorCarouselAdapter = (input: {
  readonly bundle: OperatorCarouselBundle;
  readonly canonicalId: SourceCanonicalId;
  readonly receivedAt: string;
  readonly sourceUrl: SourceUrl;
}): TikTokCarouselAdapterShape => ({
  acquire: (descriptor) =>
    Effect.gen(function* acquireOperatorCarousel() {
      yield* Schema.decodeUnknownEffect(ImportTimestamp)(input.receivedAt).pipe(
        Effect.mapError(partialFailure)
      );
      if (
        descriptor.canonicalId !== input.canonicalId ||
        descriptor.sourceUrl !== input.sourceUrl ||
        descriptor.declaredPageCount !== input.bundle.declaredPageCount ||
        input.bundle.images.length !== input.bundle.declaredPageCount
      ) {
        return yield* Effect.fail(partialFailure());
      }

      const images: TikTokCarouselImageArtifact[] = [];
      const checksums = new Set<string>();
      let totalBytes = 0;
      for (const [orderIndex, encoded] of input.bundle.images.entries()) {
        const bytes = yield* decodeBase64(encoded.jpegBase64);
        const dimensions = readJpegDimensions(bytes);
        const actualSha256 = yield* sha256Hex(bytes);
        totalBytes += bytes.byteLength;
        if (
          encoded.orderIndex !== orderIndex ||
          bytes.byteLength < 1 ||
          bytes.byteLength > MaximumVisualFrameBytes ||
          totalBytes > MaximumVisualInputBytes ||
          dimensions === null ||
          dimensions.height !== encoded.height ||
          dimensions.width !== encoded.width ||
          checksums.has(encoded.sha256) ||
          actualSha256 !== encoded.sha256
        ) {
          return yield* Effect.fail(partialFailure());
        }
        checksums.add(encoded.sha256);
        images.push({
          bytes,
          height: encoded.height,
          mimeType: "image/jpeg",
          orderIndex,
          sha256: encoded.sha256,
          width: encoded.width,
        });
      }

      return {
        images,
        source: {
          canonicalUrl: input.sourceUrl,
          caption: null,
          creator: { displayName: null, handle: null, id: null },
          observedAt: input.receivedAt,
          provenance: {
            canonicalUrl: "operator_supplied",
            caption: null,
            creator: { displayName: null, handle: null, id: null },
            publishedAt: null,
          },
          publishedAt: null,
        },
      };
    }),
});
