import { RecipeImportIntentId } from "@meal-planner/recipe-import-api";
import * as Cloudflare from "alchemy/Cloudflare";
import {
  WorkflowEvent,
  makeWorkflowBridge,
  sleep,
  task,
} from "alchemy/Cloudflare/Workflows";
import { WorkflowEntrypoint } from "cloudflare:workers";
import { Effect, Schema } from "effect";

import {
  HouseholdAdmitImportBatchInput,
  HouseholdAdmitImportBatchResult,
  HouseholdBatchQueueMessage,
  HouseholdClaimImportBatchItemResult,
  HouseholdReadImportBatchInput,
} from "../households/batches/household-import-batch.contract.js";
import type { HouseholdDomainWorkerMethods } from "../households/household-domain-worker.js";
import { HouseholdMemberAdmission } from "../households/rpc/command-envelope.js";
import {
  handleHouseholdImportBatchQueueMessage,
  makeHouseholdBatchWorkflowLauncher,
} from "./household-import-batch-queue.handlers.js";

interface TestKvNamespace {
  readonly get: (key: string) => Promise<string | null>;
  readonly put: (key: string, value: string) => Promise<void>;
}

interface NativeWorkflowInstance {
  readonly restart: () => Promise<void>;
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

const nativeWorkflowLauncher = (environment: Environment) =>
  makeHouseholdBatchWorkflowLauncher({
    create: (input) =>
      Effect.promise(() =>
        environment.BATCH_WORKFLOW.create({
          id: input.id,
          params: Schema.decodeUnknownSync(Schema.Json)(input.params),
        })
      ),
    get: (id) =>
      Effect.promise(() => environment.BATCH_WORKFLOW.get(id)).pipe(
        Effect.map((instance) => ({
          restart: () => Effect.promise(() => instance.restart()),
          status: () => Effect.promise(() => instance.status()),
        }))
      ),
  });

const workflowLauncher = (environment: Environment) => {
  const native = nativeWorkflowLauncher(environment);
  return {
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
        if (
          parameters.organizationId === "organization-batch-dlq-ambiguous-proof"
        ) {
          yield* Effect.promise(() =>
            environment.RESULTS.put(`ambiguous:${input.id}`, "true")
          );
          yield* native.create(input);
          return yield* Effect.die(
            new Error("workflow start response lost after commit")
          );
        }
        return yield* native.create(input);
      }),
    reconcile: (id: string) =>
      Effect.gen(function* reconcileWorkflow() {
        const ambiguous = yield* Effect.promise(() =>
          environment.RESULTS.get(`ambiguous:${id}`)
        );
        if (ambiguous === "true") {
          return yield* Effect.die(new Error("workflow status unavailable"));
        }
        return yield* native.reconcile(id);
      }),
  };
};

const workflowExport = {
  kind: "workflow" as const,
  make: (environment: Environment) =>
    Effect.succeed((rawInput: Schema.Json) =>
      Effect.gen(function* runHouseholdBatchWorkflow() {
        const event = yield* WorkflowEvent;
        const message = yield* Schema.decodeUnknownEffect(
          HouseholdBatchQueueMessage,
          { onExcessProperty: "error" }
        )(rawInput);
        const household = Cloudflare.makeRpcStub<HouseholdDomainWorkerMethods>(
          environment.HouseholdDomainWorker
        );
        yield* task(
          "record-household-batch-workflow-start",
          Effect.promise(async () => {
            const key = `workflow-runs:${event.instanceId}`;
            const runs = Number((await environment.RESULTS.get(key)) ?? "0");
            await environment.RESULTS.put(key, String(runs + 1));
          })
        );
        const attemptsKey = `workflow-attempts:${event.instanceId}`;
        const attempts =
          Number(
            (yield* Effect.promise(() =>
              environment.RESULTS.get(attemptsKey)
            )) ?? "0"
          ) + 1;
        yield* Effect.promise(() =>
          environment.RESULTS.put(attemptsKey, String(attempts))
        );
        if (
          message.organizationId ===
          "organization-batch-queue-send-ambiguous-proof"
        ) {
          yield* sleep("hold-household-batch-claim", "16 seconds");
        }
        const claim = yield* task(
          "claim-household-batch-item",
          household
            .claimImportBatchItem({
              admission: {
                actor: { _tag: "System", purpose: "batch_item_dispatch" },
                organizationId: message.organizationId,
              },
              message,
            })
            .pipe(
              Effect.flatMap(
                Schema.decodeUnknownEffect(HouseholdClaimImportBatchItemResult)
              ),
              Effect.orDie
            )
        );
        if (claim._tag === "Terminal") {
          return;
        }
        if (
          message.organizationId ===
            "organization-batch-workflow-redrive-proof" &&
          attempts === 1
        ) {
          return yield* Effect.die(
            new Error("outer batch Workflow failed after claiming its item")
          );
        }
        yield* task(
          "complete-household-batch-item",
          household
            .completeImportBatchItem({
              admission: {
                actor: { _tag: "System", purpose: "batch_item_dispatch" },
                organizationId: message.organizationId,
              },
              batchId: message.batchId,
              expectedGeneration: message.generation,
              intentId: Schema.decodeUnknownSync(RecipeImportIntentId)(
                message.itemId
              ),
              itemId: message.itemId,
            })
            .pipe(Effect.orDie)
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
    const requestUrl = new URL(request.url);
    if (requestUrl.pathname === "/reconcile") {
      const workflowId = Schema.decodeUnknownSync(Schema.String)(
        requestUrl.searchParams.get("workflowId")
      );
      const ambiguous = await environment.RESULTS.get(
        `ambiguous:${workflowId}`
      );
      if (ambiguous === "true") {
        const key = `dlq-probes:${workflowId}`;
        const probes = Number((await environment.RESULTS.get(key)) ?? "0") + 1;
        await environment.RESULTS.put(key, String(probes));
        if (probes < 3) {
          return new Response(null, { status: 503 });
        }
        await environment.RESULTS.put(`ambiguous:${workflowId}`, "false");
      }
      return Response.json(
        await Effect.runPromise(
          nativeWorkflowLauncher(environment).reconcile(workflowId)
        )
      );
    }
    if (requestUrl.pathname === "/batch") {
      const organizationId = Schema.decodeUnknownSync(Schema.String)(
        requestUrl.searchParams.get("organizationId")
      );
      const batchId = Schema.decodeUnknownSync(Schema.String)(
        requestUrl.searchParams.get("batchId")
      );
      const household = Cloudflare.makeRpcStub<HouseholdDomainWorkerMethods>(
        environment.HouseholdDomainWorker
      );
      const admission = Schema.decodeUnknownSync(HouseholdMemberAdmission)({
        actor: { _tag: "Member", actorId: "a".repeat(64) },
        organizationId,
      });
      return Response.json(
        await Effect.runPromise(
          household.readImportBatch(
            Schema.decodeUnknownSync(HouseholdReadImportBatchInput)({
              admission,
              batchId,
            })
          )
        )
      );
    }
    if (requestUrl.pathname === "/workflow") {
      const workflowId = Schema.decodeUnknownSync(Schema.String)(
        requestUrl.searchParams.get("workflowId")
      );
      const instance = await environment.BATCH_WORKFLOW.get(workflowId);
      return Response.json({
        attempts: Number(
          (await environment.RESULTS.get(`workflow-attempts:${workflowId}`)) ??
            "0"
        ),
        runs: Number(
          (await environment.RESULTS.get(`workflow-runs:${workflowId}`)) ?? "0"
        ),
        status: await instance.status(),
      });
    }
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
