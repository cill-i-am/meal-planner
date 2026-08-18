import {
  WorkflowEvent,
  makeWorkflowBridge,
  task,
} from "alchemy/Cloudflare/Workflows";
import { WorkflowEntrypoint } from "cloudflare:workers";
import { Effect, Schema } from "effect";

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
      readonly params: Schema.Json;
    }) => Promise<void>;
    readonly get: (id: string) => Promise<{
      readonly restart: (options: {
        readonly from: { readonly name: string; readonly type: "do" };
      }) => Promise<void>;
      readonly status: () => Promise<Schema.Json>;
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
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- TODO(ASU004 alchemy@2.0.0-beta.72): WorkflowExport.make(env: unknown) erases behaviorful KV/D1 bindings; Schema cannot reconstruct branded host handles or their runtime behavior. Remove when Alchemy provides a precise env generic or supported real-runtime harness.
  make: (rawEnv: unknown) => {
    const env = rawEnv as CurrentInputWorkflowTestEnv;
    return Effect.succeed((rawInput: Schema.Json) =>
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

const AlchemyRuntimeContractKey = "shape";
const entrypoint = Effect.succeed({
  RuntimeContext: {
    exports: Effect.succeed({ CurrentInputWorkflow: workflowExport }),
    [AlchemyRuntimeContractKey]: () => ({}),
  },
});

const CurrentInputWorkflowBridge = makeWorkflowBridge(WorkflowEntrypoint, {
  entrypoint,
  stack: { name: "meal-planner", stage: "test" },
})("CurrentInputWorkflow");

export class CurrentInputWorkflow extends CurrentInputWorkflowBridge {}

const WorkflowCommand = Schema.Union([
  Schema.Struct({ action: Schema.Literal("read"), id: Schema.String }),
  Schema.Struct({ action: Schema.Literal("restart"), id: Schema.String }),
  Schema.Struct({
    action: Schema.Literal("run"),
    expectedStatus: Schema.Literals(["complete", "errored"]),
    id: Schema.String,
    input: Schema.Json,
  }),
]);

const readRequest = (request: Request) =>
  Effect.runPromise(
    Effect.promise(() => request.json()).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(WorkflowCommand))
    )
  );

export default {
  fetch: async (request: Request, env: CurrentInputWorkflowTestEnv) => {
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
