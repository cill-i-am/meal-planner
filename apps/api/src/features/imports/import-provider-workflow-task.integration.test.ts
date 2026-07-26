import * as Cloudflare from "alchemy/Cloudflare";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  ProviderTaskStepConfig,
  runProviderTask,
} from "./import-provider-workflow-task.js";

class TestWorkflowEntrypoint {
  run(_event: unknown, _step: unknown): Promise<unknown> {
    void this;
    return Promise.resolve();
  }
}

interface NativeStepContext {
  readonly attempt: number;
  readonly config: typeof ProviderTaskStepConfig;
  readonly step: {
    readonly count: number;
    readonly name: string;
  };
}

const makeCheckpointingNativeStep = () => {
  const checkpoints = new Map<string, unknown>();
  const observedConfigs: unknown[] = [];

  return {
    observedConfigs,
    step: {
      do: (
        name: string,
        config: typeof ProviderTaskStepConfig,
        runNativeAttempt: (context: NativeStepContext) => Promise<unknown>
      ) => {
        observedConfigs.push(config);
        if (checkpoints.has(name)) {
          return Promise.resolve(checkpoints.get(name));
        }

        const maximumAttempts = config.retries.limit + 1;
        const executeAttempt = async (attempt: number): Promise<unknown> => {
          try {
            const checkpoint = await runNativeAttempt({
              attempt,
              config,
              step: { count: 1, name },
            });
            checkpoints.set(name, checkpoint);
            return checkpoint;
          } catch (error: unknown) {
            if (attempt < maximumAttempts) {
              return executeAttempt(attempt + 1);
            }
            throw new Error("Native workflow task retries exhausted", {
              cause: error,
            });
          }
        };
        return executeAttempt(1);
      },
    },
  };
};

const makeBridgedWorkflow = (
  workflowClassName: string,
  workflowExport: unknown
) => {
  const entrypoint = Effect.succeed({
    RuntimeContext: {
      exports: Effect.succeed({ [workflowClassName]: workflowExport }),
      shape: () => ({}),
    },
  });
  const Bridge = Cloudflare.makeWorkflowBridge(TestWorkflowEntrypoint, {
    entrypoint,
    stack: { name: "meal-planner", stage: "test" },
  })(workflowClassName);
  return new Bridge({}, {});
};

const workflowEvent = {
  instanceId: "gaia-163",
  payload: {},
  timestamp: new Date("2026-07-26T00:00:00.000Z"),
  workflowName: "provider-retry-workflow",
};

describe("provider workflow task retry exhaustion", () => {
  it("checkpoints the exhausted native task and replays it with zero further provider calls", async () => {
    let providerCalls = 0;
    const workflowClassName = "ProviderRetryWorkflow";
    const workflowExport = {
      kind: "workflow" as const,
      make: () =>
        Effect.succeed(() =>
          runProviderTask(
            "transcribe-provider",
            "speech",
            Effect.sync(() => {
              providerCalls += 1;
            }).pipe(
              Effect.andThen(
                Effect.fail({
                  code: "provider_unavailable",
                  unsafeProviderBody: "must-not-cross-the-checkpoint",
                })
              )
            ),
            () => ({ _tag: "Succeeded" as const, stage: "speech" as const })
          )
        ),
    };
    const workflow = makeBridgedWorkflow(workflowClassName, workflowExport);
    const nativeStep = makeCheckpointingNativeStep();

    const firstRun = await workflow.run(workflowEvent, nativeStep.step);
    expect(firstRun).toEqual({
      _tag: "Failed",
      code: "retry_exhausted",
      stage: "speech",
    });
    expect(providerCalls).toBe(3);
    expect(nativeStep.observedConfigs).toEqual([ProviderTaskStepConfig]);

    const replay = await workflow.run(workflowEvent, nativeStep.step);
    expect(replay).toEqual(firstRun);
    expect(providerCalls).toBe(3);
    expect(nativeStep.observedConfigs).toEqual([
      ProviderTaskStepConfig,
      ProviderTaskStepConfig,
    ]);
  });

  it.each([
    {
      checkpointCode: "model_refusal",
      label: "refusal",
      providerCode: "model_refusal",
    },
    {
      checkpointCode: "invalid_schema",
      label: "malformed output",
      providerCode: "invalid_schema",
    },
    {
      checkpointCode: "insufficient_evidence",
      label: "insufficient evidence",
      providerCode: "insufficient_evidence",
    },
    {
      checkpointCode: "outcome_unknown",
      label: "unknown cost",
      providerCode: "outcome_unknown",
    },
    {
      checkpointCode: "provider_error",
      label: "non-retryable provider failure",
      providerCode: "provider_error",
    },
  ])(
    "preserves the terminal $label checkpoint and replays it without another provider call",
    async ({ checkpointCode, label, providerCode }) => {
      let providerCalls = 0;
      const workflowClassName = `Terminal${label.replaceAll(" ", "")}Workflow`;
      const workflow = makeBridgedWorkflow(workflowClassName, {
        kind: "workflow" as const,
        make: () =>
          Effect.succeed(() =>
            runProviderTask(
              "extract-recipe-provider",
              "recipe",
              Effect.sync(() => {
                providerCalls += 1;
              }).pipe(
                Effect.andThen(
                  Effect.fail({
                    code: providerCode,
                    unsafeProviderBody: "must-not-cross-the-checkpoint",
                  })
                )
              ),
              () => ({ _tag: "Succeeded" as const, stage: "recipe" as const })
            )
          ),
      });
      const nativeStep = makeCheckpointingNativeStep();

      const firstRun = await workflow.run(workflowEvent, nativeStep.step);
      expect(firstRun).toEqual({
        _tag: "Failed",
        code: checkpointCode,
        stage: "recipe",
      });
      expect(providerCalls).toBe(1);

      expect(await workflow.run(workflowEvent, nativeStep.step)).toEqual(
        firstRun
      );
      expect(providerCalls).toBe(1);
    }
  );

  it("preserves a successful checkpoint and replays it without another provider call", async () => {
    let providerCalls = 0;
    const workflow = makeBridgedWorkflow("SuccessfulProviderWorkflow", {
      kind: "workflow" as const,
      make: () =>
        Effect.succeed(() =>
          runProviderTask(
            "extract-visual-provider",
            "visual",
            Effect.sync(() => {
              providerCalls += 1;
              return "safe-evidence";
            }),
            (evidence) => ({
              _tag: "Succeeded" as const,
              evidence,
              stage: "visual" as const,
            })
          )
        ),
    });
    const nativeStep = makeCheckpointingNativeStep();

    const firstRun = await workflow.run(workflowEvent, nativeStep.step);
    expect(firstRun).toEqual({
      _tag: "Succeeded",
      evidence: "safe-evidence",
      stage: "visual",
    });
    expect(providerCalls).toBe(1);

    expect(await workflow.run(workflowEvent, nativeStep.step)).toEqual(
      firstRun
    );
    expect(providerCalls).toBe(1);
  });
});
