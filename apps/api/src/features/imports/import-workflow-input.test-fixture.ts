import {
  WorkflowEvent,
  makeWorkflowBridge,
  task,
} from "alchemy/Cloudflare/Workflows";
import { WorkflowEntrypoint } from "cloudflare:workers";
import { Effect } from "effect";

import {
  ImportObservabilityTraceStore,
  observeImportWorkflowStart,
} from "./import-observability.js";
import { decodeImportWorkflowInput } from "./import-workflow-input.js";

interface CurrentInputWorkflowTestEnv {
  readonly CURRENT_WORKFLOW_STATE: {
    readonly get: (key: string) => Promise<string | null>;
    readonly put: (key: string, value: string) => Promise<void>;
  };
  readonly CurrentInputWorkflow: {
    readonly create: (options: {
      readonly id: string;
      readonly params: unknown;
    }) => Promise<void>;
    readonly get: (id: string) => Promise<{
      readonly restart: (options: {
        readonly from: { readonly name: string; readonly type: "do" };
      }) => Promise<void>;
      readonly status: () => Promise<unknown>;
    }>;
    readonly unsafeStartIntrospection: () => Promise<string>;
    readonly unsafeStopIntrospection: (sessionId: string) => Promise<void>;
    readonly unsafeWaitForStatus: (
      id: string,
      status: "complete" | "errored"
    ) => Promise<void>;
  };
}

const stateKey = (instanceId: string, name: string) => `${instanceId}:${name}`;

const incrementStoredValue = async (
  env: CurrentInputWorkflowTestEnv,
  instanceId: string,
  name: string
) => {
  const key = stateKey(instanceId, name);
  const value = Number((await env.CURRENT_WORKFLOW_STATE.get(key)) ?? "0");
  const next = value + 1;
  await env.CURRENT_WORKFLOW_STATE.put(key, String(next));
  return next;
};

const increment = (
  env: CurrentInputWorkflowTestEnv,
  instanceId: string,
  name: string
) => Effect.promise(() => incrementStoredValue(env, instanceId, name));

const workflowExport = {
  kind: "workflow" as const,
  make: (rawEnv: unknown) => {
    const env = rawEnv as CurrentInputWorkflowTestEnv;
    return Effect.succeed((rawInput: unknown) =>
      Effect.gen(function* runCurrentInputWorkflow() {
        const event = yield* WorkflowEvent;
        const workflowRun = yield* increment(
          env,
          event.instanceId,
          "workflow-runs"
        );
        const input = yield* decodeImportWorkflowInput(rawInput);
        const traceStore = ImportObservabilityTraceStore.of({
          append: (observabilityEvent) =>
            Effect.promise(() =>
              env.CURRENT_WORKFLOW_STATE.put(
                stateKey(event.instanceId, `event:${String(workflowRun)}`),
                JSON.stringify(observabilityEvent)
              )
            ),
          read: () => Effect.succeed([]),
        });
        yield* observeImportWorkflowStart(input.trace).pipe(
          Effect.provideService(ImportObservabilityTraceStore, traceStore)
        );
        return yield* task(
          "requested-provider-boundary-v1",
          Effect.promise(async () => {
            await incrementStoredValue(
              env,
              event.instanceId,
              "provider-boundary-runs"
            );
            await env.CURRENT_WORKFLOW_STATE.put(
              stateKey(event.instanceId, `correlation:${String(workflowRun)}`),
              input.trace.correlationId
            );
            return input;
          })
        );
      })
    );
  },
};

const entrypoint = Effect.succeed({
  RuntimeContext: {
    exports: Effect.succeed({ CurrentInputWorkflow: workflowExport }),
    shape: () => ({}),
  },
});

const CurrentInputWorkflowBridge = makeWorkflowBridge(WorkflowEntrypoint, {
  entrypoint,
  stack: { name: "meal-planner", stage: "test" },
})("CurrentInputWorkflow");

export class CurrentInputWorkflow extends CurrentInputWorkflowBridge {}

const readRequest = (request: Request) =>
  request.json() as Promise<
    | {
        readonly action: "read";
        readonly id: string;
      }
    | {
        readonly action: "restart";
        readonly id: string;
      }
    | {
        readonly action: "run";
        readonly expectedStatus: "complete" | "errored";
        readonly id: string;
        readonly input: unknown;
      }
  >;

export default {
  fetch: async (request: Request, rawEnv: unknown) => {
    const env = rawEnv as CurrentInputWorkflowTestEnv;
    const command = await readRequest(request);
    if (command.action === "read") {
      const read = (name: string) =>
        env.CURRENT_WORKFLOW_STATE.get(stateKey(command.id, name));
      return Response.json({
        correlations: await Promise.all([
          read("correlation:1"),
          read("correlation:2"),
        ]),
        events: await Promise.all([read("event:1"), read("event:2")]),
        providerBoundaryRuns: Number(
          (await read("provider-boundary-runs")) ?? "0"
        ),
        workflowRuns: Number((await read("workflow-runs")) ?? "0"),
      });
    }

    const workflow = env.CurrentInputWorkflow;
    const sessionId = await workflow.unsafeStartIntrospection();
    try {
      if (command.action === "run") {
        await workflow.create({ id: command.id, params: command.input });
        await workflow.unsafeWaitForStatus(command.id, command.expectedStatus);
      } else {
        const instance = await workflow.get(command.id);
        await instance.restart({
          from: { name: "requested-provider-boundary-v1", type: "do" },
        });
        await workflow.unsafeWaitForStatus(command.id, "complete");
      }
      const instance = await workflow.get(command.id);
      return Response.json(await instance.status());
    } finally {
      await workflow.unsafeStopIntrospection(sessionId);
    }
  },
};
