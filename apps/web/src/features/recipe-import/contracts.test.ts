import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  ImportStatusView,
  TikTokRecipeUrl,
  isTerminalImportStatus,
} from "./contracts.js";

const decodeUrl = (input: unknown) =>
  Effect.runPromise(Schema.decodeUnknownEffect(TikTokRecipeUrl)(input));

describe("TikTokRecipeUrl", () => {
  it("accepts a public TikTok HTTPS URL", async () => {
    await expect(
      decodeUrl("https://www.tiktok.com/@kitchen/video/7390123456789012345")
    ).resolves.toBe(
      "https://www.tiktok.com/@kitchen/video/7390123456789012345"
    );
  });

  it.each([
    "http://www.tiktok.com/@kitchen/video/7390123456789012345",
    "https://user:pass@www.tiktok.com/@kitchen/video/7390123456789012345",
    "https://www.tiktok.com:444/@kitchen/video/7390123456789012345",
    "https://not-tiktok.example/@kitchen/video/7390123456789012345",
    "https://tiktok.com.evil.example/@kitchen/video/7390123456789012345",
  ])("rejects an unsafe locator: %s", async (input) => {
    await expect(decodeUrl(input)).rejects.toBeDefined();
  });

  it("rejects an overlong URL", async () => {
    await expect(
      decodeUrl(`https://www.tiktok.com/@kitchen/video/${"1".repeat(2049)}`)
    ).rejects.toBeDefined();
  });
});

describe("terminal import statuses", () => {
  it.each([
    { kind: "needs_review" },
    { code: "private_or_unavailable", kind: "failed" },
    { code: "unsupported_post_type", kind: "unsupported" },
  ] as const)("stops polling at $kind", (status) => {
    const decoded = Schema.decodeUnknownSync(ImportStatusView)(status);
    expect(isTerminalImportStatus(decoded)).toBe(true);
  });

  it.each([
    "queued",
    "acquiring",
    "acquired",
    "transcribing",
    "transcribed",
    "extracting_visual",
    "visual_evidence_found",
    "visual_evidence_empty",
    "visual_evidence_low_confidence",
  ] as const)("continues polling at %s", (kind) => {
    const decoded = Schema.decodeUnknownSync(ImportStatusView)({ kind });
    expect(isTerminalImportStatus(decoded)).toBe(false);
  });
});
