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

const providerStepContext = (attempt: number) =>
  Effect.provideService(WorkflowStepContext, {
    attempt,
    config: ProviderTaskStepConfig,
    step: { count: 1, name: "transcribe-video-v1" },
  });

const captureAttempt = async (attempt: number) => {
  const log = vi.spyOn(console, "log").mockImplementation(vi.fn());
  const exit = await Effect.runPromiseExit(
    runProviderTaskAttempt(
      "speech",
      Effect.fail({ code: "timeout" }),
      () => "unused",
      { correlationId }
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
  it("emits a safe terminal success for the same correlation identifier", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(vi.fn());
    const result = await Effect.runPromise(
      runProviderTaskAttempt(
        "speech",
        Effect.succeed("private-provider-result"),
        () => "checkpointed",
        { correlationId }
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

  it("reports truthful retry recovery around the exact native Workflow attempt", async () => {
    const activity: string[] = [];
    const lifecycle = {
      retrying: (attempt: number) =>
        Effect.sync(() => activity.push(`retrying:${attempt}`)),
      working: (attempt: number) =>
        Effect.sync(() => activity.push(`working:${attempt}`)),
    };
    await Effect.runPromiseExit(
      runProviderTaskAttempt(
        "speech",
        Effect.fail({ code: "timeout" }),
        () => "unused",
        undefined,
        lifecycle
      ).pipe(providerStepContext(1))
    );
    await Effect.runPromise(
      runProviderTaskAttempt(
        "speech",
        Effect.succeed("private-provider-result"),
        () => "checkpointed",
        undefined,
        lifecycle
      ).pipe(providerStepContext(2))
    );

    expect(activity).toEqual(["retrying:1", "working:2"]);
  });

  it("preserves only a closed evidence reason on a terminal checkpoint", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(vi.fn());
    const checkpoint = await Effect.runPromise(
      runProviderTaskAttempt(
        "recipe",
        Effect.fail({
          code: "source_evidence_invalid",
          reasonCode: "visual_evidence_invalid",
          sourceUrl: "https://forbidden.example/private",
        }),
        () => "unused",
        { correlationId }
      ).pipe(
        Effect.provideService(WorkflowStepContext, {
          attempt: 1,
          config: ProviderTaskStepConfig,
          step: { count: 1, name: "extract-recipe-recovery-v1" },
        })
      )
    );

    expect(checkpoint).toEqual({
      _tag: "Failed",
      code: "source_evidence_invalid",
      reasonCode: "visual_evidence_invalid",
      stage: "recipe",
    });
    expect(log.mock.calls).toEqual([
      [
        {
          correlationId,
          event: "provider.terminal",
          outcome: "failed",
          providerStage: "recipe",
          reasonCode: "visual_evidence_invalid",
        },
      ],
    ]);
    expect(JSON.stringify({ checkpoint, logs: log.mock.calls })).not.toMatch(
      /forbidden|https?:|sourceUrl/iu
    );
    log.mockRestore();
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
