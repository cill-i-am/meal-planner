import { Option, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { BrowserEvent } from "./index.js";

describe("browser telemetry values", () => {
  it("accepts the three diagnostic kinds without requiring identifying user data", () => {
    const events = [
      { area: "home", durationMs: 12, kind: "navigation" },
      { area: "auth", errorType: "Unknown", kind: "error", source: "promise" },
      {
        area: "recipes",
        durationMs: 42,
        kind: "api",
        method: "POST",
        operation: "recipes",
        outcome: "http_error",
        requestId: "19a642ad-0c72-4ef4-8b85-32f228e8ab8c",
        status: 503,
      },
    ];
    for (const event of events) {
      expect(Schema.decodeUnknownSync(BrowserEvent)(event)).toEqual(event);
    }
  });

  it("rejects unusable durations and arbitrary strings in correlation and category fields", () => {
    const api = {
      area: "auth",
      durationMs: 1,
      kind: "api",
      method: "POST",
      operation: "auth",
      outcome: "success",
      status: 200,
    };
    const invalid = [
      { ...api, durationMs: Number.POSITIVE_INFINITY },
      { ...api, durationMs: -1 },
      { ...api, requestId: "private-session-token" },
      { ...api, operation: "https://app.test/reset-password/private-token" },
      {
        area: "auth",
        errorType: "private error message",
        kind: "error",
        source: "promise",
      },
    ];
    for (const event of invalid) {
      expect(Schema.decodeUnknownOption(BrowserEvent)(event)).toEqual(
        Option.none()
      );
    }
  });
});
