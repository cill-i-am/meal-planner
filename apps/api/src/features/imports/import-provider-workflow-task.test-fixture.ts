import {
  WorkflowEvent,
  makeWorkflowBridge,
  task,
} from "alchemy/Cloudflare/Workflows";
import { WorkflowEntrypoint } from "cloudflare:workers";
import type { AnyD1Database } from "drizzle-orm/d1";
import { Effect, Schema } from "effect";

import {
  PilotBudgetDispatchId,
  PilotBudgetProviderStageId,
  PilotBudgetRunId,
  PilotBudgetTimestamp,
  PilotProviderBudgetRuntime,
  makePilotProviderBudgetRuntime,
  runPilotProviderDispatch,
} from "../pilots/pilot-provider-budget.js";
import { makeD1PilotProviderBudgetRepository } from "../pilots/pilot-provider-budget.repository.d1.js";
import { runProviderTask } from "./import-provider-workflow-task.js";

interface ProviderWorkflowInput {
  readonly failureCode?: string;
  readonly scenario: "retry_exhausted" | "success" | "terminal" | "unknown";
}

interface ProviderWorkflowTestEnv {
  readonly MealPlannerDatabase: AnyD1Database;
  readonly PROVIDER_WORKFLOW_STATE: {
    readonly get: (key: string) => Promise<string | null>;
    readonly put: (key: string, value: string) => Promise<void>;
  };
  readonly ProviderRetryWorkflow: {
    readonly create: (options: {
      readonly id: string;
      readonly params: ProviderWorkflowInput;
    }) => Promise<void>;
    readonly get: (id: string) => Promise<{
      readonly restart: (options: {
        readonly from: { readonly name: string; readonly type: "do" };
      }) => Promise<void>;
      readonly status: () => Promise<unknown>;
    }>;
    readonly unsafeSetIntrospectionOperations: (
      sessionId: string,
      operations: readonly unknown[]
    ) => Promise<void>;
    readonly unsafeStartIntrospection: () => Promise<string>;
    readonly unsafeStopIntrospection: (sessionId: string) => Promise<void>;
    readonly unsafeWaitForStatus: (
      id: string,
      status: "complete"
    ) => Promise<void>;
  };
}

const decodeRunId = Schema.decodeUnknownSync(PilotBudgetRunId);
const decodeProviderStageId = Schema.decodeUnknownSync(
  PilotBudgetProviderStageId
);
const decodeDispatchId = Schema.decodeUnknownSync(PilotBudgetDispatchId);
const decodeTimestamp = Schema.decodeUnknownSync(PilotBudgetTimestamp);

const stateKey = (instanceId: string, name: string) => `${instanceId}:${name}`;

const increment = (
  env: ProviderWorkflowTestEnv,
  instanceId: string,
  name: string
) =>
  Effect.promise(async () => {
    const key = stateKey(instanceId, name);
    const value = Number((await env.PROVIDER_WORKFLOW_STATE.get(key)) ?? "0");
    await env.PROVIDER_WORKFLOW_STATE.put(key, String(value + 1));
  });

const unknownCostDispatch = (
  env: ProviderWorkflowTestEnv,
  instanceId: string
) => {
  const reservation = {
    dispatchId: decodeDispatchId("dispatch_gaia_163_unknown"),
    maximumCostMicroUsd: 100,
    providerStageId: decodeProviderStageId("recipe_extraction"),
    runId: decodeRunId("run_gaia_163_unknown"),
    timestamp: decodeTimestamp("2026-07-26T06:00:00.000Z"),
  };
  const repository = makeD1PilotProviderBudgetRepository(
    env.MealPlannerDatabase,
    "pilot-gaia-118"
  );

  return increment(env, instanceId, "task-attempts").pipe(
    Effect.andThen(
      runPilotProviderDispatch({
        invoke: increment(env, instanceId, "provider-calls").pipe(
          Effect.andThen(
            Effect.fail({
              code: "provider_unavailable",
              unsafeProviderBody: "must-not-cross-the-checkpoint",
            })
          )
        ),
        repository,
        reservation,
      })
    ),
    Effect.provideService(
      PilotProviderBudgetRuntime,
      makePilotProviderBudgetRuntime("pilot-gaia-118")
    )
  );
};

const directProviderEffect = (
  env: ProviderWorkflowTestEnv,
  instanceId: string,
  input: ProviderWorkflowInput
) =>
  increment(env, instanceId, "task-attempts").pipe(
    Effect.andThen(increment(env, instanceId, "provider-calls")),
    Effect.andThen(
      input.scenario === "success"
        ? Effect.succeed("safe-evidence")
        : Effect.fail({
            code:
              input.scenario === "retry_exhausted"
                ? "provider_unavailable"
                : (input.failureCode ?? "provider_error"),
            unsafeProviderBody: "must-not-cross-the-checkpoint",
          })
    )
  );

const providerStageByScenario = {
  retry_exhausted: "speech",
  success: "visual",
  terminal: "visual",
  unknown: "recipe",
} as const satisfies Record<
  ProviderWorkflowInput["scenario"],
  "recipe" | "speech" | "visual"
>;

const providerWorkflowExport = {
  kind: "workflow" as const,
  make: (rawEnv: unknown) => {
    const env = rawEnv as ProviderWorkflowTestEnv;
    return Effect.succeed((input: ProviderWorkflowInput) =>
      Effect.gen(function* runProviderWorkflow() {
        const event = yield* WorkflowEvent;
        yield* increment(env, event.instanceId, "workflow-runs");
        const stage = providerStageByScenario[input.scenario];
        const provider =
          input.scenario === "unknown"
            ? unknownCostDispatch(env, event.instanceId).pipe(
                Effect.as("unexpected-success")
              )
            : directProviderEffect(env, event.instanceId, input);
        const checkpoint = yield* runProviderTask(
          "provider-dispatch",
          stage,
          provider,
          (value) => ({
            _tag: "Succeeded" as const,
            evidence:
              input.scenario === "success" ? value : "unexpected-success",
            stage,
          })
        );
        return yield* task("finalize-terminal", Effect.succeed(checkpoint));
      })
    );
  },
};

const entrypoint = Effect.succeed({
  RuntimeContext: {
    exports: Effect.succeed({ ProviderRetryWorkflow: providerWorkflowExport }),
    shape: () => ({}),
  },
});

const ProviderRetryWorkflowBridge = makeWorkflowBridge(WorkflowEntrypoint, {
  entrypoint,
  stack: { name: "meal-planner", stage: "test" },
})("ProviderRetryWorkflow");

/** Installed Alchemy bridge hosted by the same native WorkflowEntrypoint used in deployment. */
export class ProviderRetryWorkflow extends ProviderRetryWorkflowBridge {}

const readRequest = (request: Request) =>
  request.json() as Promise<
    | { readonly action: "restart"; readonly id: string }
    | {
        readonly action: "run";
        readonly id: string;
        readonly input: ProviderWorkflowInput;
      }
  >;

export default {
  fetch: async (request: Request, rawEnv: unknown) => {
    const env = rawEnv as ProviderWorkflowTestEnv;
    const command = await readRequest(request);
    const workflow = env.ProviderRetryWorkflow;
    const sessionId = await workflow.unsafeStartIntrospection();

    try {
      if (command.action === "run") {
        await workflow.unsafeSetIntrospectionOperations(sessionId, [
          {
            steps: [{ name: "provider-dispatch" }],
            type: "disableRetryDelays",
          },
        ]);
        await workflow.create({ id: command.id, params: command.input });
      } else {
        const instance = await workflow.get(command.id);
        await instance.restart({
          from: { name: "finalize-terminal", type: "do" },
        });
      }

      await workflow.unsafeWaitForStatus(command.id, "complete");
      const instance = await workflow.get(command.id);
      return Response.json(await instance.status());
    } finally {
      await workflow.unsafeStopIntrospection(sessionId);
    }
  },
};
