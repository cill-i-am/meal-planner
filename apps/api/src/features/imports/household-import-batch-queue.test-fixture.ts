import * as Cloudflare from "alchemy/Cloudflare";
import {
  WorkflowEvent,
  makeWorkflowBridge,
  task,
} from "alchemy/Cloudflare/Workflows";
import { WorkflowEntrypoint } from "cloudflare:workers";
import { Effect, Schema } from "effect";

import {
  HouseholdAdmitImportBatchInput,
  HouseholdAdmitImportBatchResult,
} from "../households/batches/household-import-batch.contract.js";
import type { HouseholdDomainWorkerMethods } from "../households/household-domain-worker.js";
import { HouseholdMemberAdmission } from "../households/rpc/command-envelope.js";
import { handleHouseholdImportBatchQueueMessage } from "./household-import-batch-queue.handlers.js";

interface TestKvNamespace {
  readonly get: (key: string) => Promise<string | null>;
  readonly put: (key: string, value: string) => Promise<void>;
}

interface NativeWorkflowInstance {
  readonly status: () => Promise<{ readonly status: string }>;
}

interface NativeWorkflowBinding {
  readonly create: (input: {
    readonly id: string;
    readonly params: Schema.Json;
  }) => Promise<void>;
  readonly get: (id: string) => Promise<NativeWorkflowInstance>;
}

interface TestMessageBatch {
  readonly messages: readonly { readonly body: unknown }[];
}

interface Environment {
  readonly BATCH_WORKFLOW: NativeWorkflowBinding;
  readonly HouseholdDomainWorker: object;
  readonly RESULTS: TestKvNamespace;
}

const RefusalParameters = Schema.Struct({ organizationId: Schema.String });

const workflowLauncher = (environment: Environment) => ({
  create: (input: { readonly id: string; readonly params: unknown }) =>
    Effect.gen(function* createWorkflow() {
      const parameters = yield* Schema.decodeUnknownEffect(RefusalParameters)(
        input.params
      );
      if (parameters.organizationId === "organization-batch-dlq-proof") {
        yield* Effect.promise(() =>
          environment.RESULTS.put(`refused:${input.id}`, "true")
        );
        return yield* Effect.die(
          new Error("workflow start refused before commit")
        );
      }
      return yield* Effect.promise(() =>
        environment.BATCH_WORKFLOW.create({
          id: input.id,
          params: Schema.decodeUnknownSync(Schema.Json)(input.params),
        })
      );
    }),
  get: (id: string) =>
    Effect.gen(function* getWorkflow() {
      const refused = yield* Effect.promise(() =>
        environment.RESULTS.get(`refused:${id}`)
      );
      if (refused === "true") {
        return yield* Effect.die(new Error("workflow does not exist"));
      }
      const instance = yield* Effect.promise(() =>
        environment.BATCH_WORKFLOW.get(id)
      );
      return {
        status: () => Effect.promise(() => instance.status()),
      };
    }),
});

const workflowExport = {
  kind: "workflow" as const,
  make: (environment: Environment) =>
    Effect.succeed(() =>
      Effect.gen(function* recordWorkflowStart() {
        const event = yield* WorkflowEvent;
        yield* task(
          "record-household-batch-workflow-start",
          Effect.promise(async () => {
            const key = `workflow-runs:${event.instanceId}`;
            const runs = Number((await environment.RESULTS.get(key)) ?? "0");
            await environment.RESULTS.put(key, String(runs + 1));
          })
        );
      })
    ),
};

const AlchemyRuntimeContractKey = "shape";
const entrypoint = Effect.succeed({
  RuntimeContext: {
    exports: Effect.succeed({ BATCH_WORKFLOW: workflowExport }),
    [AlchemyRuntimeContractKey]: () => ({}),
  },
});
const bridge = { entrypoint, stack: { name: "meal-planner", stage: "test" } };
const BatchWorkflowBridge = makeWorkflowBridge(
  WorkflowEntrypoint,
  bridge
)("BATCH_WORKFLOW");

export class HouseholdBatchQueueTestWorkflow extends BatchWorkflowBridge {}

export default {
  async fetch(request: Request, environment: Environment) {
    const command = Schema.decodeUnknownSync(
      Schema.Struct({ commandId: Schema.String, organizationId: Schema.String })
    )(await request.json());
    const household = Cloudflare.makeRpcStub<HouseholdDomainWorkerMethods>(
      environment.HouseholdDomainWorker
    );
    const admission = Schema.decodeUnknownSync(HouseholdMemberAdmission)({
      actor: { _tag: "Member", actorId: "a".repeat(64) },
      organizationId: command.organizationId,
    });
    await Effect.runPromise(household.ensureHousehold({ admission }));
    const admitted = await Effect.runPromise(
      household
        .admitImportBatch(
          Schema.decodeUnknownSync(HouseholdAdmitImportBatchInput)({
            admission,
            idempotencyKey: `batch-${command.commandId}`,
            request: {
              items: [
                {
                  idempotencyKey: `item-${command.commandId}`,
                  source: {
                    kind: "tiktok",
                    url: `https://www.tiktok.com/@mealplanner/video/${command.commandId}`,
                  },
                },
              ],
            },
          })
        )
        .pipe(
          Effect.flatMap(
            Schema.decodeUnknownEffect(HouseholdAdmitImportBatchResult)
          )
        )
    );
    const [message] = admitted.messages;
    if (message === undefined) {
      throw new Error("Expected one newly admitted Queue message.");
    }
    return Response.json({ admission, batch: admitted.batch, message });
  },
  async queue(batch: TestMessageBatch, environment: Environment) {
    await Promise.all(
      batch.messages.map(async ({ body }) => {
        const attempts = Number(
          (await environment.RESULTS.get("attempts")) ?? "0"
        );
        await environment.RESULTS.put("attempts", String(attempts + 1));
        const receipt = await Effect.runPromise(
          handleHouseholdImportBatchQueueMessage(
            body,
            workflowLauncher(environment)
          )
        );
        await environment.RESULTS.put("last", JSON.stringify(receipt));
      })
    );
  },
};
