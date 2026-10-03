import { Effect, Logger } from "effect";
import { HttpRouter } from "effect/http";
import { describe, expect, it } from "vitest";

import { BrowserEventsHttpLayer } from "./browser-events.http.js";

const makeRawTelemetryRequest = (event: object) =>
  new Request("https://app.test/v1/browser-events", {
    body: JSON.stringify({ event }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });

describe("browser telemetry boundary", () => {
  it("decodes and logs a client report, rejecting arbitrary private fields", async () => {
    const events: unknown[] = [];
    const app = HttpRouter.toWebHandler(BrowserEventsHttpLayer, {
      disableLogger: true,
      middleware: (handler) =>
        handler.pipe(
          Effect.provide(
            Logger.layer([
              Logger.make((options) => events.push(options.message)),
            ])
          )
        ),
    });
    const event = {
      area: "auth",
      errorType: "Unknown",
      kind: "error",
      source: "promise",
    };
    try {
      const accepted = await app.handler(makeRawTelemetryRequest(event));
      expect(accepted.status).toBe(204);
      expect(events).toEqual([
        [
          {
            browser: event,
            event: "browser.event",
            source: "untrusted-client",
          },
        ],
      ]);
      const invalid = await app.handler(
        makeRawTelemetryRequest({ ...event, message: "private token" })
      );
      expect(invalid.status).toBeGreaterThanOrEqual(400);
      expect(events).toHaveLength(1);
    } finally {
      await app.dispose();
    }
  });
});
