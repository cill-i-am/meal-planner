import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  CreateImportRequest,
  IdempotencyKey,
  ImportView,
  SourceUrl,
} from "./import.contracts.js";

const decodeCreate = Schema.decodeUnknownSync(CreateImportRequest);
const decodeImport = Schema.decodeUnknownSync(ImportView);

describe("import contracts", () => {
  it("accepts the source-agnostic TikTok request envelope", () => {
    expect(
      decodeCreate({
        source: {
          kind: "tiktok",
          url: "https://www.tiktok.com/@cook/video/7520000000000000000",
        },
      })
    ).toStrictEqual({
      source: {
        kind: "tiktok",
        url: "https://www.tiktok.com/@cook/video/7520000000000000000",
      },
    });

    expect(() =>
      decodeCreate({ source: { kind: "youtube", url: "https://example.test" } })
    ).toThrow();
    expect(() =>
      decodeCreate({ source: { kind: "tiktok", url: "" } })
    ).toThrow();
  });

  it("requires a trimmed idempotency key between one and 128 characters", () => {
    const decode = Schema.decodeUnknownSync(IdempotencyKey);

    expect(decode("request-1")).toBe("request-1");
    expect(decode("x".repeat(128))).toHaveLength(128);
    expect(() => decode(" request-1 ")).toThrow();
    expect(() => decode("")).toThrow();
    expect(() => decode("x".repeat(129))).toThrow();
  });

  it("accepts only finite absolute HTTPS source URLs", () => {
    const decode = Schema.decodeUnknownSync(SourceUrl);
    const prefix = "https://www.tiktok.com/";
    const maximumLengthUrl = `${prefix}${"a".repeat(2048 - prefix.length)}`;

    expect(decode(maximumLengthUrl)).toHaveLength(2048);
    expect(() => decode(`${maximumLengthUrl}a`)).toThrow();
    expect(() => decode("x".repeat(1_000_000))).toThrow();
    expect(() => decode("http://www.tiktok.com/@cook/video/1")).toThrow();
    expect(() => decode("https://[")).toThrow();
  });

  it("decodes only valid queued, failed, and unsupported public states", () => {
    const base = {
      createdAt: "2026-07-20T09:30:00.000Z",
      evidence: [],
      id: "018f47ad-91aa-7c35-b6fe-3f00a63f8502",
      source: { canonicalId: "7520000000000000000", kind: "tiktok" },
      updatedAt: "2026-07-20T09:30:00.000Z",
    };

    expect(
      decodeImport({ ...base, status: { kind: "queued" } }).status
    ).toEqual({ kind: "queued" });
    expect(
      decodeImport({
        ...base,
        status: {
          code: "private_or_unavailable",
          kind: "failed",
          recovery: "check_source_visibility",
        },
      }).status
    ).toEqual({
      code: "private_or_unavailable",
      kind: "failed",
      recovery: "check_source_visibility",
    });
    expect(
      decodeImport({
        ...base,
        status: {
          code: "unsupported_post_type",
          kind: "unsupported",
          recovery: "submit_supported_public_video",
        },
      }).status
    ).toEqual({
      code: "unsupported_post_type",
      kind: "unsupported",
      recovery: "submit_supported_public_video",
    });

    expect(() =>
      decodeImport({
        ...base,
        status: {
          code: "unsupported_post_type",
          kind: "failed",
          recovery: "submit_supported_public_video",
        },
      })
    ).toThrow();
  });

  it("keeps submitted URLs and recipe data out of the public projection", () => {
    const decoded = decodeImport({
      createdAt: "2026-07-20T09:30:00.000Z",
      evidence: [],
      id: "018f47ad-91aa-7c35-b6fe-3f00a63f8502",
      source: { canonicalId: "7520000000000000000", kind: "tiktok" },
      status: { kind: "queued" },
      updatedAt: "2026-07-20T09:30:00.000Z",
    });
    const encoded = JSON.stringify(decoded);

    expect(encoded).not.toContain("url");
    expect(encoded).not.toContain("ingredient");
    expect(encoded).not.toContain("instruction");
  });
});
