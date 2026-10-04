import { Cause, Option, Schedule, Schema } from "effect";
import { HttpClientError } from "effect/http";

/** One retry owner: Effect. React Query must not multiply these attempts. */
export const transientRetry = {
  schedule: Schedule.exponential("200 millis").pipe(Schedule.jittered),
  times: 2,
};
export const isTransientHttpFailure = (cause: unknown) =>
  HttpClientError.isHttpClientError(cause) &&
  (cause.reason._tag === "TransportError" ||
    (cause.reason._tag === "StatusCodeError" &&
      cause.reason.response.status >= 500));

const QueryFailure = Schema.Struct({
  _tag: Schema.Literal("EffectQueryFailure"),
  failure: Schema.Unknown,
});
/** Effect Query wraps expected failures; framework callbacks can throw ordinary errors. */
export const queryFailure = (cause: unknown): unknown => {
  const decoded = Schema.decodeUnknownOption(QueryFailure)(cause);
  return Option.isSome(decoded) ? decoded.value.failure : cause;
};

const QueryCause = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("EffectQueryFailure"),
    failureCause: Schema.declare<Cause.Cause<unknown>>(Cause.isCause),
  }),
  Schema.Struct({
    _tag: Schema.Literal("EffectQueryDefect"),
    defectCause: Schema.declare<Cause.Cause<unknown>>(Cause.isCause),
  }),
]);
/** Preserve the complete cause when a feature decides whether a write is unresolved. */
export const queryFailureCause = (
  cause: unknown
): Option.Option<Cause.Cause<unknown>> =>
  Schema.decodeUnknownOption(QueryCause)(cause).pipe(
    Option.map((value) =>
      value._tag === "EffectQueryFailure"
        ? value.failureCause
        : value.defectCause
    )
  );
