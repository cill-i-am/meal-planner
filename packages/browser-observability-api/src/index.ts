import { Schema } from "effect";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from "effect/http-api";

export const BrowserTelemetryPath = "/v1/browser-events";
export const BrowserArea = Schema.Literals([
  "auth",
  "setup",
  "recipes",
  "profile",
  "home",
  "other",
]);
export type BrowserArea = typeof BrowserArea.Type;
const Duration = Schema.Finite.check(
  Schema.isBetween({ maximum: 600_000, minimum: 0 })
);
const CorrelationId = Schema.String.check(Schema.isUUID());
export const BrowserEvent = Schema.Union([
  Schema.Struct({
    area: BrowserArea,
    durationMs: Duration,
    kind: Schema.Literal("api"),
    method: Schema.Literals(["GET", "POST", "PATCH", "PUT", "DELETE", "OTHER"]),
    operation: Schema.Literals([
      "auth",
      "recipe-import-intents",
      "recipe-import-batches",
      "recipes",
      "household",
      "families",
      "meal-plans",
      "other",
    ]),
    outcome: Schema.Literals([
      "success",
      "http_error",
      "network_error",
      "cancelled",
    ]),
    requestId: Schema.optional(CorrelationId),
    status: Schema.Int.check(Schema.isBetween({ maximum: 599, minimum: 0 })),
  }),
  Schema.Struct({
    area: BrowserArea,
    durationMs: Duration,
    kind: Schema.Literal("navigation"),
  }),
  Schema.Struct({
    area: BrowserArea,
    errorType: Schema.Literals([
      "Error",
      "TypeError",
      "RangeError",
      "SyntaxError",
      "DOMException",
      "Unknown",
    ]),
    kind: Schema.Literal("error"),
    source: Schema.Literals(["javascript", "promise", "react"]),
  }),
]);
export type BrowserEvent = typeof BrowserEvent.Type;

/** Client reports are untrusted diagnostics, never application authority. */
export const BrowserObservabilityApi = HttpApi.make("browserObservability")
  .annotate(HttpApi.PayloadParseOptions, { onExcessProperty: "error" })
  .add(
    HttpApiGroup.make("browserEvents").add(
      HttpApiEndpoint.post("record", BrowserTelemetryPath, {
        payload: Schema.Struct({ event: BrowserEvent }),
        success: Schema.Void.pipe(HttpApiSchema.status(204)),
      })
    )
  );
