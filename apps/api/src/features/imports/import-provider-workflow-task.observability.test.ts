import { WorkflowStepContext } from "alchemy/Cloudflare/Workflows";
import { Effect, Schema } from "effect";
import { describe, expect, it, vi } from "vitest";

import { ImportCorrelationId } from "./import-observability.js";
import {
  ProviderTaskStepConfig,
  runProviderTaskAttempt,
} from "./import-provider-workflow-task.js";

const correlationId = Schema.decodeUnknownSync(ImportCorrelationId)(
  "019b37f2-1a6e-7f3a-8a5a-7f0d8f6c2b1a"
);

const captureAttempt = async (attempt: number) => {
  const log = vi.spyOn(console, "log").mockImplementation(vi.fn());
  const exit = await Effect.runPromiseExit(
    runProviderTaskAttempt(
      "speech",
      Effect.fail({ code: "timeout" }),
      () => "unused",
      correlationId
    ).pipe(
      Effect.provideService(WorkflowStepContext, {
        attempt,
        config: ProviderTaskStepConfig,
        step: { count: 1, name: "transcribe-video-v1" },
      })
    )
  );
  const entries = log.mock.calls;
  log.mockRestore();
  return { entries, exit };
};

describe("provider task observability", () => {
  it("allows the provider timeout to settle before the installed task deadline", () => {
    expect(ProviderTaskStepConfig.timeout).toBe("3 minutes");
  });

  it("emits a safe terminal success for the same correlation identifier", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(vi.fn());
    const result = await Effect.runPromise(
      runProviderTaskAttempt(
        "speech",
        Effect.succeed("private-provider-result"),
        () => "checkpointed",
        correlationId
      ).pipe(
        Effect.provideService(WorkflowStepContext, {
          attempt: 1,
          config: ProviderTaskStepConfig,
          step: { count: 1, name: "transcribe-video-v1" },
        })
      )
    );

    expect(result).toBe("checkpointed");
    expect(log.mock.calls).toEqual([
      [
        {
          correlationId,
          event: "provider.terminal",
          outcome: "succeeded",
          providerStage: "speech",
        },
      ],
    ]);
    expect(JSON.stringify(log.mock.calls)).not.toContain(
      "private-provider-result"
    );
    log.mockRestore();
  });

  it("emits a safe retry event before the native Workflow task retries", async () => {
    const { entries, exit } = await captureAttempt(1);

    expect(exit._tag).toBe("Failure");
    expect(entries).toEqual([
      [
        {
          attempt: 1,
          correlationId,
          event: "provider.retry",
          outcome: "retrying",
          providerStage: "speech",
        },
      ],
    ]);
  });

  it("emits a terminal event when the installed retry policy is exhausted", async () => {
    const { entries, exit } = await captureAttempt(3);

    expect(exit).toMatchObject({
      _tag: "Success",
      value: {
        _tag: "Failed",
        code: "retry_exhausted",
        stage: "speech",
      },
    });
    expect(entries).toEqual([
      [
        {
          attempt: 3,
          correlationId,
          event: "provider.retry_exhausted",
          outcome: "exhausted",
          providerStage: "speech",
        },
      ],
      [
        {
          attempt: 3,
          correlationId,
          event: "provider.terminal",
          outcome: "failed",
          providerStage: "speech",
        },
      ],
    ]);
    expect(JSON.stringify(entries)).not.toMatch(
      /https?:|prompt|transcript|cookie|authorization|credential|media|payload/iu
    );
  });
});
