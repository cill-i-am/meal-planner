import { RecipeImportBatch } from "@meal-planner/recipe-import-api";
import { RuntimeContext } from "alchemy";
import {
  WorkflowEvent,
  makeWorkflowBridge,
} from "alchemy/Cloudflare/Workflows";
import { WorkflowEntrypoint } from "cloudflare:workers";
import { Cause, Effect, Schema } from "effect";

import {
  HouseholdBatchQueueMessage,
  HouseholdClaimedImportBatchItem,
} from "../households/batches/household-import-batch.contract.js";
import { HouseholdAdmitRecipeImportResult } from "../households/recipe-import/household-recipe-import.contract.js";
import { coordinateHouseholdImportBatchItem } from "./household-import-batch-item.workflow.js";

interface TestKvNamespace {
  readonly get: (key: string) => Promise<string | null>;
  readonly put: (key: string, value: string) => Promise<void>;
}

interface TestEnvironment {
  readonly BATCH_WORKFLOW_STATE: TestKvNamespace;
  readonly HouseholdBatchTestWorkflow: {
    readonly create: (input: {
      readonly id: string;
      readonly params: Schema.Json;
    }) => Promise<void>;
    readonly get: (id: string) => Promise<{
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

const testRuntimeContext = RuntimeContext.of({
  Type: "HouseholdBatchWorkflowTestRuntimeContext",
  env: {},
  // eslint-disable-next-line unicorn/no-useless-undefined -- The test runtime models a missing Cloudflare context value explicitly.
  get: <T>() => Effect.succeed<T | undefined>(undefined),
  id: "household-batch-workflow-test",
  set: (id) => Effect.succeed(id),
});

const increment = (
  environment: TestEnvironment,
  instanceId: string,
  name: string
) =>
  Effect.promise(async () => {
    const key = `${instanceId}:${name}`;
    const current = Number(
      (await environment.BATCH_WORKFLOW_STATE.get(key)) ?? "0"
    );
    const next = current + 1;
    await environment.BATCH_WORKFLOW_STATE.put(key, String(next));
    return next;
  });

const failedBatch = (message: typeof HouseholdBatchQueueMessage.Type) =>
  Schema.encodeSync(RecipeImportBatch)(
    Schema.decodeUnknownSync(RecipeImportBatch)({
      counts: { failed: 1, queued: 0, running: 0, succeeded: 0, total: 1 },
      createdAt: "2026-08-24T00:00:00.000Z",
      id: message.batchId,
      items: [
        {
          failureCode: "import_admission_failed",
          id: message.itemId,
          status: "failed",
        },
      ],
      links: { self: `/v1/recipe-import-batches/${message.batchId}` },
      object: "recipe_import_batch",
      status: "failed",
      updatedAt: "2026-08-24T00:00:01.000Z",
      version: 3,
    })
  );

const admittedImport = Schema.decodeUnknownSync(
  HouseholdAdmitRecipeImportResult
)({
  dispatchId: "household-batch-workflow-dispatch",
  intent: {
    activity: { type: "working" },
    createdAt: "2026-08-24T00:00:00.000Z",
    id: "018f47ad-91aa-7c35-b6fe-000000000219",
    intentVersion: 1,
    links: {
      self: "/v1/recipe-import-intents/018f47ad-91aa-7c35-b6fe-000000000219",
      timeline:
        "/v1/recipe-import-intents/018f47ad-91aa-7c35-b6fe-000000000219/timeline",
    },
    object: "recipe_import_intent",
    processing: {
      startedAt: "2026-08-24T00:00:00.000Z",
      type: "resolving_source",
    },
    source: { kind: "tiktok", resolution: "pending" },
    status: "processing",
    updatedAt: "2026-08-24T00:00:00.000Z",
  },
  workflowIdentity: `import-acquisition:v1:${"b".repeat(64)}`,
});

const completedBatch = (message: typeof HouseholdBatchQueueMessage.Type) =>
  Schema.encodeSync(RecipeImportBatch)(
    Schema.decodeUnknownSync(RecipeImportBatch)({
      counts: { failed: 0, queued: 0, running: 0, succeeded: 1, total: 1 },
      createdAt: "2026-08-24T00:00:00.000Z",
      id: message.batchId,
      items: [
        {
          id: message.itemId,
          intentId: admittedImport.intent.id,
          status: "succeeded",
        },
      ],
      links: { self: `/v1/recipe-import-batches/${message.batchId}` },
      object: "recipe_import_batch",
      status: "completed",
      updatedAt: "2026-08-24T00:00:01.000Z",
      version: 3,
    })
  );

const workflowExport = {
  kind: "workflow" as const,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Alchemy's Workflow export erases the native binding type.
  make: (rawEnvironment: unknown) => {
    const environment = rawEnvironment as TestEnvironment;
    return Effect.succeed((rawInput: Schema.Json) =>
      Effect.gen(function* runBatchWorkflowProof() {
        const event = yield* WorkflowEvent;
        const message = yield* Schema.decodeUnknownEffect(
          HouseholdBatchQueueMessage,
          { onExcessProperty: "error" }
        )(rawInput);
        return yield* coordinateHouseholdImportBatchItem(message, {
          admit: () =>
            increment(environment, event.instanceId, "admit").pipe(
              Effect.as(
                message.generation === 1
                  ? ({ _tag: "Rejected" } as const)
                  : ({
                      _tag: "Admitted",
                      value: Schema.encodeSync(
                        HouseholdAdmitRecipeImportResult
                      )(admittedImport),
                    } as const)
              )
            ),
          claim: () =>
            increment(environment, event.instanceId, "claim").pipe(
              Effect.as(
                Schema.decodeUnknownSync(HouseholdClaimedImportBatchItem)({
                  _tag: "Claimed",
                  actorId: "a".repeat(64),
                  idempotencyKey: "batch-workflow-item-key",
                  source: {
                    kind: "tiktok",
                    url: "https://www.tiktok.com/@mealplanner/video/7510000000000000201",
                  },
                })
              )
            ),
          complete: () =>
            increment(environment, event.instanceId, "complete").pipe(
              Effect.as(completedBatch(message))
            ),
          dispatch: () =>
            increment(environment, event.instanceId, "dispatch").pipe(
              Effect.as(true)
            ),
          fail: () =>
            increment(environment, event.instanceId, "fail").pipe(
              Effect.as(failedBatch(message))
            ),
        }).pipe(
          Effect.provideService(RuntimeContext, testRuntimeContext),
          Effect.tapCause((cause) =>
            Effect.promise(() =>
              environment.BATCH_WORKFLOW_STATE.put(
                `${event.instanceId}:error`,
                Cause.pretty(cause)
              )
            )
          )
        );
      })
    );
  },
};

const AlchemyRuntimeContractKey = "shape";
const entrypoint = Effect.succeed({
  RuntimeContext: {
    exports: Effect.succeed({ HouseholdBatchTestWorkflow: workflowExport }),
    [AlchemyRuntimeContractKey]: () => ({}),
  },
});

const WorkflowBridge = makeWorkflowBridge(WorkflowEntrypoint, {
  entrypoint,
  stack: { name: "meal-planner", stage: "test" },
})("HouseholdBatchTestWorkflow");

export class HouseholdBatchTestWorkflow extends WorkflowBridge {}

export default {
  fetch: async (request: Request, environment: TestEnvironment) => {
    const command = (await request.json()) as {
      readonly id: string;
      readonly input: Schema.Json;
    };
    const sessionId =
      await environment.HouseholdBatchTestWorkflow.unsafeStartIntrospection();
    try {
      await environment.HouseholdBatchTestWorkflow.create({
        id: command.id,
        params: command.input,
      });
      try {
        await environment.HouseholdBatchTestWorkflow.unsafeWaitForStatus(
          command.id,
          "complete"
        );
      } catch {
        await environment.HouseholdBatchTestWorkflow.unsafeWaitForStatus(
          command.id,
          "errored"
        );
      }
      const read = (name: string) =>
        environment.BATCH_WORKFLOW_STATE.get(`${command.id}:${name}`);
      const workflowInstance = await environment.HouseholdBatchTestWorkflow.get(
        command.id
      );
      return Response.json({
        counts: {
          admit: Number((await read("admit")) ?? "0"),
          claim: Number((await read("claim")) ?? "0"),
          complete: Number((await read("complete")) ?? "0"),
          dispatch: Number((await read("dispatch")) ?? "0"),
          fail: Number((await read("fail")) ?? "0"),
        },
        error: await read("error"),
        status: await workflowInstance.status(),
      });
    } finally {
      await environment.HouseholdBatchTestWorkflow.unsafeStopIntrospection(
        sessionId
      );
    }
  },
};
