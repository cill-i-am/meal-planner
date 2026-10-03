import type { BrowserEvent } from "@meal-planner/browser-observability-api";
import { describe, expect, it } from "vitest";

import {
  createBrowserReporter,
  parseBrowserError,
} from "./browser-observability.js";

const requestId = "19a642ad-0c72-4ef4-8b85-32f228e8ab8c";
describe("browser diagnostics", () => {
  it("correlates an API failure without consuming its response or logging private inputs", async () => {
    const events: BrowserEvent[] = [];
    let now = 0;
    const response = new Response("private error body", {
      headers: { "x-request-id": requestId },
      status: 503,
    });
    const reporter = createBrowserReporter({
      fetch: async () => {
        now = 42;
        return response;
      },
      now: () => now,
      origin: "https://app.test",
      pathname: () => "/reset-password/private-token?email=private",
      send: async (event) => {
        events.push(event);
      },
    });
    expect(
      await reporter.fetch("/api/auth/reset-password?token=private", {
        body: "private",
        method: "POST",
      })
    ).toBe(response);
    expect(await response.text()).toBe("private error body");
    expect(events).toEqual([
      {
        area: "auth",
        durationMs: 42,
        kind: "api",
        method: "POST",
        operation: "auth",
        outcome: "http_error",
        requestId,
        status: 503,
      },
    ]);
    expect(JSON.stringify(events)).not.toContain("private");
  });

  it("preserves cancellation and thrown values even when telemetry fails", async () => {
    const aborted = new DOMException("private reason", "AbortError");
    const events: BrowserEvent[] = [];
    const reporter = createBrowserReporter({
      fetch: async () => {
        throw aborted;
      },
      now: () => 0,
      origin: "https://app.test",
      pathname: () => "/recipes",
      send: async (event) => {
        events.push(event);
        throw new Error("offline collector");
      },
    });
    await expect(reporter.fetch("/v1/recipe-import-intents")).rejects.toBe(
      aborted
    );
    expect(events[0]).toMatchObject({ outcome: "cancelled", status: 0 });
    reporter.error("promise", parseBrowserError({ token: "private" }));
    expect(events[1]).toEqual({
      area: "recipes",
      errorType: "Unknown",
      kind: "error",
      source: "promise",
    });
  });

  it("ignores external and collector requests and bounds event volume per minute", async () => {
    const events: BrowserEvent[] = [];
    let now = 0;
    const reporter = createBrowserReporter({
      fetch: async () => new Response(),
      now: () => now,
      origin: "https://app.test",
      pathname: () => "/setup/family",
      send: async (event) => {
        events.push(event);
      },
    });
    await reporter.fetch("https://other.test/v1/recipes");
    await reporter.fetch("/v1/browser-events");
    expect(events).toEqual([]);
    for (let index = 0; index < 40; index += 1) {
      reporter.navigation(0);
    }
    expect(events).toHaveLength(30);
    now = 60_000;
    reporter.error(
      "javascript",
      parseBrowserError(new TypeError("private input"))
    );
    expect(events).toHaveLength(31);
    expect(events[30]).toEqual({
      area: "setup",
      errorType: "TypeError",
      kind: "error",
      source: "javascript",
    });
  });
});
