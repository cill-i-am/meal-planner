import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  makeOperatorCarouselAdapter,
  OperatorCarouselBundle,
} from "./import-carousel-operator.js";
import { MaximumVisualFrameBytes } from "./import-visual-evidence-extractor.js";
import { SourceCanonicalId, SourceUrl } from "./import.contracts.js";

const canonicalId = Schema.decodeUnknownSync(SourceCanonicalId)(
  "7520000000000000000"
);
const sourceUrl = Schema.decodeUnknownSync(SourceUrl)(
  "https://www.tiktok.com/@cook/photo/7520000000000000000"
);

const jpeg = (width: number, height: number, marker: number) =>
  new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x0b,
    0x08,
    Math.floor(height / 256),
    height % 256,
    Math.floor(width / 256),
    width % 256,
    0x01,
    0x01,
    0x11,
    0x00,
    marker,
    0xff,
    0xd9,
  ]);

const sha256 = async (bytes: Uint8Array) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer)
    ),
    (byte) => byte.toString(16).padStart(2, "0")
  ).join("");

const base64 = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }
  return btoa(binary);
};

const completeBundle = async () => {
  const first = jpeg(360, 640, 1);
  const second = jpeg(720, 1280, 2);
  return Schema.decodeUnknownSync(OperatorCarouselBundle)({
    declaredPageCount: 2,
    images: [
      {
        height: 640,
        jpegBase64: base64(first),
        orderIndex: 0,
        sha256: await sha256(first),
        width: 360,
      },
      {
        height: 1280,
        jpegBase64: base64(second),
        orderIndex: 1,
        sha256: await sha256(second),
        width: 720,
      },
    ],
    source: {
      kind: "tiktok",
      url: sourceUrl,
    },
  });
};

describe("operator carousel adapter", () => {
  it.each([
    ["empty JPEG", ""],
    [
      "oversized JPEG",
      "A".repeat(Math.ceil(MaximumVisualFrameBytes / 3) * 4 + 1),
    ],
  ])(
    "rejects a structurally %s before adapter execution",
    async (_name, jpegBase64) => {
      const bundle = await completeBundle();

      expect(() =>
        Schema.decodeUnknownSync(OperatorCarouselBundle)({
          ...bundle,
          images: [{ ...bundle.images[0], jpegBase64 }, bundle.images[1]],
        })
      ).toThrow();
    }
  );

  it("adapts a complete ordered JPEG bundle with honest provenance", async () => {
    const bundle = await completeBundle();
    const adapter = makeOperatorCarouselAdapter({
      bundle,
      canonicalId,
      receivedAt: "2026-07-25T20:00:00.000Z",
      sourceUrl,
    });

    const acquisition = await Effect.runPromise(
      adapter.acquire({
        canonicalId,
        declaredPageCount: 2,
        kind: "tiktok_carousel",
        sourceUrl,
      })
    );

    expect(acquisition.images.map(({ orderIndex }) => orderIndex)).toEqual([
      0, 1,
    ]);
    expect(acquisition.images.map(({ bytes }) => bytes.byteLength)).toEqual([
      18, 18,
    ]);
    expect(acquisition.source).toMatchObject({
      canonicalUrl: sourceUrl,
      provenance: {
        canonicalUrl: "operator_supplied",
        caption: null,
        creator: { displayName: null, handle: null, id: null },
        publishedAt: null,
      },
    });
  });

  it.each([
    [
      "page count",
      (bundle: Awaited<ReturnType<typeof completeBundle>>) => ({
        ...bundle,
        declaredPageCount: 1,
      }),
    ],
    [
      "order",
      (bundle: Awaited<ReturnType<typeof completeBundle>>) => ({
        ...bundle,
        images: [bundle.images[0], { ...bundle.images[1], orderIndex: 0 }],
      }),
    ],
    [
      "duplicate",
      (bundle: Awaited<ReturnType<typeof completeBundle>>) => ({
        ...bundle,
        images: [
          bundle.images[0],
          {
            ...bundle.images[1],
            jpegBase64: bundle.images[0].jpegBase64,
            sha256: bundle.images[0].sha256,
          },
        ],
      }),
    ],
    [
      "checksum",
      (bundle: Awaited<ReturnType<typeof completeBundle>>) => ({
        ...bundle,
        images: [
          { ...bundle.images[0], sha256: "0".repeat(64) },
          bundle.images[1],
        ],
      }),
    ],
    [
      "dimensions",
      (bundle: Awaited<ReturnType<typeof completeBundle>>) => ({
        ...bundle,
        images: [{ ...bundle.images[0], width: 361 }, bundle.images[1]],
      }),
    ],
    [
      "jpeg",
      (bundle: Awaited<ReturnType<typeof completeBundle>>) => ({
        ...bundle,
        images: [
          {
            ...bundle.images[0],
            jpegBase64: base64(new Uint8Array([1, 2, 3])),
          },
          bundle.images[1],
        ],
      }),
    ],
  ])("fails closed for a %s mismatch", async (_name, mutate) => {
    const bundle = await completeBundle();
    const adapter = makeOperatorCarouselAdapter({
      bundle: Schema.decodeUnknownSync(OperatorCarouselBundle)(mutate(bundle)),
      canonicalId,
      receivedAt: "2026-07-25T20:00:00.000Z",
      sourceUrl,
    });

    await expect(
      Effect.runPromise(
        adapter.acquire({
          canonicalId,
          declaredPageCount: 2,
          kind: "tiktok_carousel",
          sourceUrl,
        })
      )
    ).rejects.toEqual({
      _tag: "TikTokCarouselAdapterFailure",
      code: "carousel_partial",
      completeness: "incomplete_no_draft",
      recovery: "request_complete_carousel",
    });
  });
});
