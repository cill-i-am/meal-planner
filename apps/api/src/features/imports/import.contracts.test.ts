import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  IdempotencyKey,
  SourceDescriptor,
  SourceUrl,
} from "./import.contracts.js";

const decodeSource = Schema.decodeUnknownSync(SourceDescriptor);

describe("import contracts", () => {
  it("accepts the source-agnostic TikTok request envelope", () => {
    expect(
      decodeSource({
        kind: "tiktok",
        url: "https://www.tiktok.com/@cook/video/7520000000000000000",
      })
    ).toStrictEqual({
      kind: "tiktok",
      url: "https://www.tiktok.com/@cook/video/7520000000000000000",
    });

    expect(() =>
      decodeSource({ kind: "youtube", url: "https://example.test" })
    ).toThrow();
    expect(() => decodeSource({ kind: "tiktok", url: "" })).toThrow();
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
});
