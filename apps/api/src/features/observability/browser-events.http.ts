import { BrowserObservabilityApi } from "@meal-planner/browser-observability-api";
import { Effect, Layer } from "effect";
import { HttpApiBuilder } from "effect/http-api";

import { JsonHttpPlatformServices } from "../../infrastructure/json-http-platform.js";

export const BrowserEventsHttpLayer = HttpApiBuilder.layer(
  BrowserObservabilityApi
).pipe(
  Layer.provide(
    HttpApiBuilder.group(BrowserObservabilityApi, "browserEvents", (handlers) =>
      handlers.handle("record", ({ payload }) =>
        Effect.logInfo({
          browser: payload.event,
          event: "browser.event",
          source: "untrusted-client",
        })
      )
    )
  ),
  Layer.provide(JsonHttpPlatformServices)
);
