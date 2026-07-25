import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  makeOperatorCarouselAdapter,
  OperatorCarouselBundle,
} from "./import-carousel-operator.js";
import {
  loadStagedOperatorCarousel,
  stagedCarouselManifestObjectKey,
  stageOperatorCarouselForWorkflow,
} from "./import-carousel-staging.js";
import type {
  AcquisitionBucketLike,
  AcquisitionPutOptions,
} from "./import-media-acquirer.js";
import { ImportId, SourceCanonicalId, SourceUrl } from "./import.contracts.js";

const importId = Schema.decodeUnknownSync(ImportId)(
  "018f47ad-91aa-7c35-b6fe-000000000160"
);
const canonicalId = Schema.decodeUnknownSync(SourceCanonicalId)(
  "7520000000000000160"
);
const sourceUrl = Schema.decodeUnknownSync(SourceUrl)(
  `https://www.tiktok.com/@cook/photo/${canonicalId}`
);
const jpegBase64 =
  "/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAADAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABgj/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABykX//Z";
const jpegSha256 =
  "7f593180ed96b891629067143da2fb44eb996b1a45e7561870a5754d5bba506e";

const makeBucket = () => {
  const objects = new Map<
    string,
    {
      readonly bytes: Uint8Array;
      readonly options: AcquisitionPutOptions;
    }
  >();
  const bucket: AcquisitionBucketLike = {
    get: (key) => {
      const object = objects.get(key);
      return Promise.resolve(
        object === undefined
          ? null
          : {
              arrayBuffer: () =>
                Promise.resolve(Uint8Array.from(object.bytes).buffer),
              checksums: { sha256: object.options.sha256 },
              customMetadata: object.options.customMetadata,
              httpMetadata: object.options.httpMetadata,
              size: object.bytes.byteLength,
              text: () =>
                Promise.resolve(new TextDecoder().decode(object.bytes)),
            }
      );
    },
    head: (key) => {
      const object = objects.get(key);
      return Promise.resolve(
        object === undefined
          ? null
          : {
              checksums: { sha256: object.options.sha256 },
              customMetadata: object.options.customMetadata,
              httpMetadata: object.options.httpMetadata,
              size: object.bytes.byteLength,
            }
      );
    },
    put: (key, value, options) => {
      if (objects.has(key)) {
        return Promise.resolve(null);
      }
      if (!ArrayBuffer.isView(value)) {
        throw new TypeError("Test bucket accepts byte views only");
      }
      const bytes = new Uint8Array(
        value.buffer,
        value.byteOffset,
        value.byteLength
      );
      objects.set(key, { bytes: Uint8Array.from(bytes), options });
      return Promise.resolve({
        checksums: { sha256: options.sha256 },
        customMetadata: options.customMetadata,
        httpMetadata: options.httpMetadata,
        size: bytes.byteLength,
      });
    },
  };
  return { bucket, objects };
};

const makeInput = () => {
  const bundle = Schema.decodeUnknownSync(OperatorCarouselBundle)({
    declaredPageCount: 1,
    images: [
      {
        height: 3,
        jpegBase64,
        orderIndex: 0,
        sha256: jpegSha256,
        width: 2,
      },
    ],
    source: { kind: "tiktok", url: sourceUrl },
  });
  const descriptor = {
    canonicalId,
    declaredPageCount: 1,
    kind: "tiktok_carousel" as const,
    sourceUrl,
  };
  return {
    adapter: makeOperatorCarouselAdapter({
      bundle,
      canonicalId,
      receivedAt: "2026-07-25T20:00:00.000Z",
      sourceUrl,
    }),
    descriptor,
  };
};

describe("operator carousel workflow staging", () => {
  it("keeps media private in R2 and workflow input limited to importId", async () => {
    const { bucket, objects } = makeBucket();
    const input = makeInput();

    await Effect.runPromise(
      stageOperatorCarouselForWorkflow({
        ...input,
        bucket,
        importId,
      })
    );
    const manifestObject = objects.get(
      stagedCarouselManifestObjectKey(importId)
    );
    expect(manifestObject).toBeDefined();
    const manifestText = new TextDecoder().decode(manifestObject?.bytes);
    expect(manifestText).not.toContain("https://");
    expect(manifestText).not.toContain("@cook");
    expect(manifestText).not.toContain(jpegBase64);
    expect(manifestObject?.options.httpMetadata).toEqual({
      cacheControl: "private, no-store",
      contentType: "application/json",
    });

    const staged = await Effect.runPromise(
      loadStagedOperatorCarousel({ bucket, importId })
    );
    expect(staged).not.toBeNull();
    if (staged === null) {
      throw new Error("Expected staged operator carousel");
    }
    const acquired = await Effect.runPromise(
      staged.adapter.acquire(staged.descriptor)
    );
    expect(acquired.images).toHaveLength(1);
    expect(acquired.images[0]?.sha256).toBe(jpegSha256);
    expect(acquired.source.provenance.canonicalUrl).toBe("operator_supplied");
  });

  it("replays idempotently only when staged bytes still verify", async () => {
    const { bucket, objects } = makeBucket();
    const input = makeInput();
    const stage = () =>
      Effect.runPromise(
        stageOperatorCarouselForWorkflow({
          ...input,
          bucket,
          importId,
        })
      );

    await stage();
    await expect(stage()).resolves.toBeUndefined();
    const image = [...objects.entries()].find(([key]) =>
      key.endsWith("/images/00.jpg")
    );
    expect(image).toBeDefined();
    if (image === undefined) {
      throw new Error("Expected staged carousel image");
    }
    objects.set(image[0], {
      ...image[1],
      bytes: new Uint8Array([1, 2, 3]),
    });
    await expect(stage()).rejects.toMatchObject({
      _tag: "TikTokCarouselAdapterFailure",
      code: "carousel_partial",
    });
  });
});
