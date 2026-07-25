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

const decodeBase64 = (value: string) =>
  Uint8Array.from(atob(value), (character) => character.codePointAt(0) ?? 0);

const realJpegs = [
  {
    bytes: decodeBase64(
      "/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAADAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABgj/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABykX//Z"
    ),
    height: 3,
    sha256: "7f593180ed96b891629067143da2fb44eb996b1a45e7561870a5754d5bba506e",
    width: 2,
  },
  {
    bytes: decodeBase64(
      "/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAACAAMDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABQj/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCewFIh3//Z"
    ),
    height: 2,
    sha256: "8a2cbe47caa698585b361ae9a034bea0363d4c5fc05807262673be911dd7cf32",
    width: 3,
  },
] as const;

const completeBundle = () =>
  Schema.decodeUnknownSync(OperatorCarouselBundle)({
    declaredPageCount: 2,
    images: realJpegs.map(
      ({ bytes, height, sha256: checksum, width }, orderIndex) => ({
        height,
        jpegBase64: base64(bytes),
        orderIndex,
        sha256: checksum,
        width,
      })
    ),
    source: {
      kind: "tiktok",
      url: sourceUrl,
    },
  });

describe("operator carousel adapter", () => {
  it("rejects JPEG-like bytes without a valid scan", async () => {
    const bytes = jpeg(360, 640, 1);
    const bundle = Schema.decodeUnknownSync(OperatorCarouselBundle)({
      declaredPageCount: 1,
      images: [
        {
          height: 640,
          jpegBase64: base64(bytes),
          orderIndex: 0,
          sha256: await sha256(bytes),
          width: 360,
        },
      ],
      source: { kind: "tiktok", url: sourceUrl },
    });
    const adapter = makeOperatorCarouselAdapter({
      bundle,
      canonicalId,
      receivedAt: "2026-07-25T20:00:00.000Z",
      sourceUrl,
    });

    await expect(
      Effect.runPromise(
        adapter.acquire({
          canonicalId,
          declaredPageCount: 1,
          kind: "tiktok_carousel",
          sourceUrl,
        })
      )
    ).rejects.toMatchObject({
      _tag: "TikTokCarouselAdapterFailure",
      code: "carousel_partial",
    });
  });

  it("rejects a structurally complete JPEG with undecodable scan data", async () => {
    const [source] = realJpegs;
    const bytes = Uint8Array.from([
      ...source.bytes.slice(0, -7),
      0,
      0xff,
      0xd9,
    ]);
    const bundle = Schema.decodeUnknownSync(OperatorCarouselBundle)({
      declaredPageCount: 1,
      images: [
        {
          height: source.height,
          jpegBase64: base64(bytes),
          orderIndex: 0,
          sha256: await sha256(bytes),
          width: source.width,
        },
      ],
      source: { kind: "tiktok", url: sourceUrl },
    });
    const adapter = makeOperatorCarouselAdapter({
      bundle,
      canonicalId,
      receivedAt: "2026-07-25T20:00:00.000Z",
      sourceUrl,
    });

    await expect(
      Effect.runPromise(
        adapter.acquire({
          canonicalId,
          declaredPageCount: 1,
          kind: "tiktok_carousel",
          sourceUrl,
        })
      )
    ).rejects.toMatchObject({
      _tag: "TikTokCarouselAdapterFailure",
      code: "carousel_partial",
    });
  });

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
      270, 270,
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
