import * as Cloudflare from "alchemy/Cloudflare";
import { Effect, Schema } from "effect";

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
  onSuccess: (value: Value) => Success
) =>
  effect.pipe(
    Effect.matchEffect({
      onFailure: (error) => {
        const code = providerTaskFailureCode(error);
        if (!isRetryableProviderTaskFailure(code)) {
          return Effect.succeed(terminalFailureCheckpoint(stage, code));
        }

        return Effect.gen(function* handleRetryableProviderFailure() {
          const context = yield* Cloudflare.Workflows.WorkflowStepContext;
          const retryLimit =
            context.config.retries?.limit ??
            ProviderTaskStepConfig.retries.limit;
          if (context.attempt >= retryLimit + 1) {
            return retryExhaustedCheckpoint(stage);
          }

          return yield* Effect.die(
            new Error(`Retryable provider task failure: ${code}`)
          );
        });
      },
      onSuccess: (value) => Effect.succeed(onSuccess(value)),
    })
  );

export const runProviderTask = <Value, Failure, Success>(
  name: string,
  stage: ProviderTaskStage,
  effect: Effect.Effect<Value, Failure>,
  onSuccess: (value: Value) => Success
) =>
  Cloudflare.Workflows.task(
    name,
    runProviderTaskAttempt(stage, effect, onSuccess),
    ProviderTaskStepConfig
  );
