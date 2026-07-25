import { Context, Schema } from "effect";
import type { Effect } from "effect";

import type { VerifiedSourceMetadata } from "./import-media.model.js";
import { SourceCanonicalId, SourceUrl } from "./import.contracts.js";

export const MaximumCarouselImages = 12;

const PositiveInteger = Schema.Number.pipe(
  Schema.check(Schema.isInt(), Schema.isGreaterThan(0))
);

/** Internal descriptor for the dedicated carousel route. */
export const TikTokCarouselDescriptor = Schema.Struct({
  canonicalId: SourceCanonicalId,
  declaredPageCount: PositiveInteger.pipe(
    Schema.check(Schema.isLessThanOrEqualTo(MaximumCarouselImages))
  ),
  kind: Schema.Literal("tiktok_carousel"),
  sourceUrl: SourceUrl,
});
export type TikTokCarouselDescriptor = typeof TikTokCarouselDescriptor.Type;

export interface TikTokCarouselImageArtifact {
  readonly bytes: Uint8Array;
  readonly height: number;
  readonly mimeType: "image/jpeg";
  readonly orderIndex: number;
  readonly sha256: string;
  readonly width: number;
}

/** Reads dimensions from a complete JPEG without decoding or trusting metadata. */
export const readJpegDimensions = (bytes: Uint8Array) => {
  if (
    bytes.length < 11 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes.at(-2) !== 0xff ||
    bytes.at(-1) !== 0xd9
  ) {
    return null;
  }
  for (let index = 2; index + 8 < bytes.length; index += 1) {
    const marker = bytes[index + 1];
    if (
      bytes[index] === 0xff &&
      marker !== undefined &&
      [
        0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
        0xcf,
      ].includes(marker)
    ) {
      const height = (bytes[index + 5] ?? 0) * 256 + (bytes[index + 6] ?? 0);
      const width = (bytes[index + 7] ?? 0) * 256 + (bytes[index + 8] ?? 0);
      return height > 0 && width > 0 ? { height, width } : null;
    }
  }
  return null;
};

export interface TikTokCarouselAcquisition {
  readonly images: readonly TikTokCarouselImageArtifact[];
  readonly source: typeof VerifiedSourceMetadata.Encoded;
}

export type TikTokCarouselFailureCode =
  | "carousel_inaccessible"
  | "carousel_layout_drift"
  | "carousel_partial";

export type TikTokCarouselRecovery =
  | "check_source_visibility"
  | "request_complete_carousel"
  | "update_carousel_adapter";

/** Classified safe failure. Provider bodies and locators are never retained. */
export type TikTokCarouselAdapterFailure = {
  readonly _tag: "TikTokCarouselAdapterFailure";
  readonly completeness: "incomplete_no_draft";
} & (
  | {
      readonly code: "carousel_inaccessible";
      readonly recovery: "check_source_visibility";
    }
  | {
      readonly code: "carousel_partial";
      readonly recovery: "request_complete_carousel";
    }
  | {
      readonly code: "carousel_layout_drift";
      readonly recovery: "update_carousel_adapter";
    }
);

export interface TikTokCarouselAdapterShape {
  readonly acquire: (
    descriptor: TikTokCarouselDescriptor
  ) => Effect.Effect<TikTokCarouselAcquisition, TikTokCarouselAdapterFailure>;
}

/** Replaceable carousel capability; no real provider implementation lands here. */
export class TikTokCarouselAdapter extends Context.Service<
  TikTokCarouselAdapter,
  TikTokCarouselAdapterShape
>()("meal-planner/TikTokCarouselAdapter") {}
