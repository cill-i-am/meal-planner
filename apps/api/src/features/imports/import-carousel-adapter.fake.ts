import { Effect } from "effect";

import type {
  TikTokCarouselAcquisition,
  TikTokCarouselAdapterFailure,
  TikTokCarouselAdapterShape,
  TikTokCarouselDescriptor,
} from "./import-carousel-adapter.js";

/** Deterministic provider-free carousel adapter with recorded calls. */
export const makeDeterministicTikTokCarouselAdapter = (
  output: TikTokCarouselAcquisition | TikTokCarouselAdapterFailure
): {
  readonly calls: TikTokCarouselDescriptor[];
  readonly service: TikTokCarouselAdapterShape;
} => {
  const calls: TikTokCarouselDescriptor[] = [];
  return {
    calls,
    service: {
      acquire: (descriptor) =>
        Effect.suspend(() => {
          calls.push(descriptor);
          if ("_tag" in output) {
            return Effect.fail(output);
          }
          return Effect.succeed({
            images: output.images.map((image) => ({
              ...image,
              bytes: Uint8Array.from(image.bytes),
            })),
            source: output.source,
          });
        }),
    },
  };
};
