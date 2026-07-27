import { WorkflowStepContext, task } from "alchemy/Cloudflare/Workflows";
import { Effect, Schema } from "effect";

import type { ImportCorrelationId } from "./import-observability.js";
import { emitImportObservabilityEvent } from "./import-observability.js";

export const ProviderTaskStepConfig = {
  retries: { backoff: "exponential", delay: "2 seconds", limit: 2 },
  timeout: "2 minutes",
} as const;

export const ProviderTaskFailureCheckpoint = Schema.Struct({
  _tag: Schema.Literal("Failed"),
  code: Schema.String,
  stage: Schema.Literals(["recipe", "speech", "visual"]),
});

export type ProviderTaskFailureCheckpoint =
  typeof ProviderTaskFailureCheckpoint.Type;
export type ProviderTaskStage = ProviderTaskFailureCheckpoint["stage"];

const providerTaskFailureCode = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  typeof error.code === "string"
    ? error.code
    : "stage_failed";

const isRetryableProviderTaskFailure = (code: string) =>
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
  code: string
): ProviderTaskFailureCheckpoint => ({
  _tag: "Failed",
  code,
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
  correlationId?: ImportCorrelationId
) =>
  effect.pipe(
    Effect.matchEffect({
      onFailure: (error) => {
        const code = providerTaskFailureCode(error);
        if (!isRetryableProviderTaskFailure(code)) {
          return (
            correlationId === undefined
              ? Effect.void
              : emitImportObservabilityEvent({
                  correlationId,
                  event: "provider.terminal",
                  outcome: "failed",
                  providerStage: stage,
                })
          ).pipe(Effect.as(terminalFailureCheckpoint(stage, code)));
        }

        return Effect.gen(function* handleRetryableProviderFailure() {
          const context = yield* WorkflowStepContext;
          const retryLimit =
            context.config.retries?.limit ??
            ProviderTaskStepConfig.retries.limit;
          if (context.attempt >= retryLimit + 1) {
            if (correlationId !== undefined) {
              yield* emitImportObservabilityEvent({
                attempt: context.attempt,
                correlationId,
                event: "provider.retry_exhausted",
                outcome: "exhausted",
                providerStage: stage,
              });
              yield* emitImportObservabilityEvent({
                attempt: context.attempt,
                correlationId,
                event: "provider.terminal",
                outcome: "failed",
                providerStage: stage,
              });
            }
            return retryExhaustedCheckpoint(stage);
          }

          if (correlationId !== undefined) {
            yield* emitImportObservabilityEvent({
              attempt: context.attempt,
              correlationId,
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
        (correlationId === undefined
          ? Effect.void
          : emitImportObservabilityEvent({
              correlationId,
              event: "provider.terminal",
              outcome: "succeeded",
              providerStage: stage,
            })
        ).pipe(Effect.as(onSuccess(value))),
    })
  );

export const runProviderTask = <Value, Failure, Success>(
  name: string,
  stage: ProviderTaskStage,
  effect: Effect.Effect<Value, Failure>,
  onSuccess: (value: Value) => Success,
  correlationId?: ImportCorrelationId
) =>
  task(
    name,
    runProviderTaskAttempt(stage, effect, onSuccess, correlationId),
    ProviderTaskStepConfig
  );
