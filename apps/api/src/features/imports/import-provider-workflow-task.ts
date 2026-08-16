import { WorkflowStepContext, task } from "alchemy/Cloudflare/Workflows";
import { Effect, Schema } from "effect";

import type { ImportTraceContext } from "./import-observability.js";
import { emitImportObservabilityEvent } from "./import-observability.js";
import { ProviderTaskDiagnosticReasonCode } from "./import-provider-workflow-checkpoint.js";

export const ProviderTaskStepConfig = {
  retries: { backoff: "exponential", delay: "2 seconds", limit: 2 },
  timeout: "3 minutes",
} as const;

export const ProviderTaskFailureCheckpoint = Schema.Struct({
  _tag: Schema.Literal("Failed"),
  code: Schema.String,
  reasonCode: Schema.optionalKey(ProviderTaskDiagnosticReasonCode),
  stage: Schema.Literals(["recipe", "speech", "visual"]),
});

export type ProviderTaskFailureCheckpoint =
  typeof ProviderTaskFailureCheckpoint.Type;
export type ProviderTaskStage = ProviderTaskFailureCheckpoint["stage"];

export interface ProviderTaskRetryLifecycle {
  readonly retrying: (attempt: number) => Effect.Effect<void>;
  readonly working: (attempt: number) => Effect.Effect<void>;
}

export const providerTaskFailureCode = (error: unknown): string => {
  if (typeof error === "string") {
    return error;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return "stage_failed";
};

const providerTaskFailureReasonCode = (
  error: unknown
): ProviderTaskFailureCheckpoint["reasonCode"] => {
  if (typeof error !== "object" || error === null || !("reasonCode" in error)) {
    return undefined;
  }
  const decoded = Schema.decodeUnknownOption(ProviderTaskDiagnosticReasonCode)(
    error.reasonCode
  );
  return decoded._tag === "Some" ? decoded.value : undefined;
};

export const isRetryableProviderTaskFailure = (code: string) =>
  code === "provider_unavailable" || code === "throttled" || code === "timeout";

const retryExhaustedCheckpoint = (
  stage: ProviderTaskStage
): ProviderTaskFailureCheckpoint => ({
  _tag: "Failed",
  code: "retry_exhausted",
  stage,
});

const terminalFailureCheckpoint = (
  stage: ProviderTaskStage,
  code: string,
  reasonCode?: ProviderTaskFailureCheckpoint["reasonCode"]
): ProviderTaskFailureCheckpoint => ({
  _tag: "Failed",
  code,
  ...(reasonCode === undefined ? {} : { reasonCode }),
  stage,
});

/**
 * Keeps retryable provider failures in Cloudflare's native retry path until
 * the installed task policy reaches its final attempt. That attempt succeeds
 * with a safe typed checkpoint, so Cloudflare persists and replays the
 * terminal result instead of leaving the workflow errored.
 */
export const runProviderTaskAttempt = <Value, Failure, Success>(
  stage: ProviderTaskStage,
  effect: Effect.Effect<Value, Failure>,
  onSuccess: (value: Value) => Success,
  trace?: ImportTraceContext,
  lifecycle?: ProviderTaskRetryLifecycle
) =>
  Effect.gen(function* runProviderAttempt() {
    const context = yield* WorkflowStepContext;
    if (context.attempt > 1 && lifecycle !== undefined) {
      yield* lifecycle.working(context.attempt);
    }
    return yield* effect.pipe(
      Effect.matchEffect({
        onFailure: (error) => {
          const code = providerTaskFailureCode(error);
          const reasonCode = providerTaskFailureReasonCode(error);
          if (!isRetryableProviderTaskFailure(code)) {
            return (
              trace === undefined
                ? Effect.void
                : emitImportObservabilityEvent({
                    correlationId: trace.correlationId,
                    event: "provider.terminal",
                    outcome: "failed",
                    providerStage: stage,
                    ...(reasonCode === undefined ? {} : { reasonCode }),
                  })
            ).pipe(
              Effect.as(terminalFailureCheckpoint(stage, code, reasonCode))
            );
          }

          return Effect.gen(function* handleRetryableProviderFailure() {
            const retryLimit =
              context.config.retries?.limit ??
              ProviderTaskStepConfig.retries.limit;
            if (context.attempt >= retryLimit + 1) {
              if (trace !== undefined) {
                yield* emitImportObservabilityEvent({
                  attempt: context.attempt,
                  correlationId: trace.correlationId,
                  event: "provider.retry_exhausted",
                  outcome: "exhausted",
                  providerStage: stage,
                });
                yield* emitImportObservabilityEvent({
                  attempt: context.attempt,
                  correlationId: trace.correlationId,
                  event: "provider.terminal",
                  outcome: "failed",
                  providerStage: stage,
                });
              }
              return retryExhaustedCheckpoint(stage);
            }

            if (lifecycle !== undefined) {
              yield* lifecycle.retrying(context.attempt);
            }
            if (trace !== undefined) {
              yield* emitImportObservabilityEvent({
                attempt: context.attempt,
                correlationId: trace.correlationId,
                event: "provider.retry",
                outcome: "retrying",
                providerStage: stage,
              });
            }
            return yield* Effect.die(
              new Error(`Retryable provider task failure: ${code}`)
            );
          });
        },
        onSuccess: (value) =>
          (trace === undefined
            ? Effect.void
            : emitImportObservabilityEvent({
                correlationId: trace.correlationId,
                event: "provider.terminal",
                outcome: "succeeded",
                providerStage: stage,
              })
          ).pipe(Effect.as(onSuccess(value))),
      })
    );
  });

export const runProviderTask = <Value, Failure, Success>(
  name: string,
  stage: ProviderTaskStage,
  effect: Effect.Effect<Value, Failure>,
  onSuccess: (value: Value) => Success,
  trace?: ImportTraceContext,
  lifecycle?: ProviderTaskRetryLifecycle
) =>
  task(
    name,
    runProviderTaskAttempt(stage, effect, onSuccess, trace, lifecycle),
    ProviderTaskStepConfig
  );
