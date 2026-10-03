import {
  Cause,
  Clock,
  Context,
  Effect,
  Exit,
  Option,
  Predicate,
  Schema,
} from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";

const ErrorTag = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[A-Za-z][A-Za-z0-9]{0,79}$/u))
);

export const HttpRequestId = Context.Service<string>(
  "meal-planner/HttpRequestId"
);

/** Emit one completion event while preserving the handler's result and interruption. */
export const observeHttpRequest = <E, R>(
  handler: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>
) =>
  Effect.gen(function* observeRequestLifecycle() {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const started = yield* Clock.currentTimeMillis;
    const span = yield* Effect.currentSpan.pipe(Effect.option);
    const requestId = crypto.randomUUID();
    const { pathname } = new URL(request.url, "http://worker.internal");
    // Auth reset tokens can occupy path segments, not just query strings.
    const path = pathname.startsWith("/api/auth/")
      ? pathname.split("/").slice(0, 4).join("/")
      : pathname;
    return yield* handler.pipe(
      Effect.map((response) =>
        response.body._tag === "Raw"
          ? response
          : HttpServerResponse.setHeader(response, "x-request-id", requestId)
      ),
      Effect.onExit((exit) =>
        Effect.gen(function* completeRequestEvent() {
          const durationMs = (yield* Clock.currentTimeMillis) - started;
          let status = 500;
          if (Exit.isSuccess(exit)) {
            ({ status } = exit.value);
          } else if (Cause.hasInterruptsOnly(exit.cause)) {
            status = 499;
          }
          const errorTags = Exit.isFailure(exit)
            ? exit.cause.reasons.map((reason) => {
                if (Cause.isInterruptReason(reason)) {
                  return "Interrupted";
                }
                const error = Cause.isFailReason(reason)
                  ? reason.error
                  : reason.defect;
                return Predicate.hasProperty(error, "_tag") &&
                  Schema.is(ErrorTag)(error._tag)
                  ? error._tag
                  : "UnhandledFailure";
              })
            : [];
          let outcome = "succeeded";
          if (status === 499) {
            outcome = "cancelled";
          } else if (status >= 500) {
            outcome = "failed";
          } else if (status >= 400) {
            outcome = "rejected";
          }
          const currentSpan = Option.getOrUndefined(span);
          const event = {
            durationMs,
            errorTags,
            event: "http.request.completed",
            method: request.method,
            outcome,
            path,
            requestId,
            service: "meal-planner-api",
            spanId: currentSpan?.spanId,
            status,
            traceId: currentSpan?.traceId,
          };
          if (status >= 500) {
            yield* Effect.logError(event);
          } else if (status >= 400) {
            yield* Effect.logWarning(event);
          } else {
            yield* Effect.logInfo(event);
          }
        })
      ),
      Effect.annotateLogs({ requestId }),
      Effect.provideService(HttpRequestId, requestId)
    );
  });
