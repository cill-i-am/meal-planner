import { RecipeImportBatch } from "@meal-planner/recipe-import-api";
import { RuntimeContext } from "alchemy";
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
} from "../households/batches/household-import-batch.contract.js";
import type { HouseholdDomainWorkerMethods } from "../households/household-domain-worker.js";
import {
  HouseholdAdmitRecipeImportInput,
  HouseholdAdmitRecipeImportResult,
  HouseholdRecordRecipeImportDispatchInput,
  HouseholdRecordRecipeImportDispatchResult,
} from "../households/recipe-import/household-recipe-import.contract.js";
import { HouseholdMemberAdmission } from "../households/rpc/command-envelope.js";
import { ImportWorkflowIdentity } from "../households/shared-kernel/workflow-identity.js";
import {
  coordinateHouseholdImportBatchItem,
  makeHouseholdImportBatchWorkflowPorts,
} from "./household-import-batch-item.workflow.js";
import { householdBatchWorkflowInstanceId } from "./household-import-batch-transport.js";
import {
  cloudflareWorkflowInstanceId,
  makeImportWorkflowStarter,
} from "./import.workflow.js";

const Scenario = Schema.Literals([
  "admission-lost-response",
  "dispatch-all-start-responses-lost",
  "dispatch-committed-reconcile-unavailable",
  "dispatch-lost-response",
  "dispatch-pre-start-refusal",
  "dispatch-reconcile-recovered",
]);
type Scenario = typeof Scenario.Type;

const Command = Schema.Struct({
  commandId: Schema.String,
  organizationId: Schema.String,
  scenario: Scenario,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));

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
  readonly createBatch: (
    input: readonly {
      readonly id?: string;
      readonly params?: Schema.Json;
    }[]
  ) => Promise<readonly NativeWorkflowInstance[]>;
  readonly get: (id: string) => Promise<NativeWorkflowInstance>;
  readonly unsafeStartIntrospection: () => Promise<string>;
  readonly unsafeStopIntrospection: (sessionId: string) => Promise<void>;
  readonly unsafeWaitForStatus: (
    id: string,
    status: "complete" | "errored"
  ) => Promise<void>;
}

interface TestEnvironment {
  readonly BATCH_WORKFLOW_STATE: TestKvNamespace;
  readonly HouseholdBatchTestWorkflow: NativeWorkflowBinding;
  readonly HouseholdDomainWorker: object;
  readonly ImportAcquisitionTestWorkflow: NativeWorkflowBinding;
}

const testRuntimeContext = RuntimeContext.of({
  Type: "HouseholdBatchWorkflowTestRuntimeContext",
  env: {},
  // eslint-disable-next-line unicorn/no-useless-undefined -- The native test runtime models a missing deployment context explicitly.
  get: <T>() => Effect.succeed<T | undefined>(undefined),
  id: "household-batch-workflow-test",
  set: (id) => Effect.succeed(id),
});

const stateKey = (instanceId: string, name: string) => `${instanceId}:${name}`;

const increment = (
  environment: TestEnvironment,
  instanceId: string,
  name: string
) =>
  Effect.promise(async () => {
    const key = stateKey(instanceId, name);
    const current = Number(
      (await environment.BATCH_WORKFLOW_STATE.get(key)) ?? "0"
    );
    const next = current + 1;
    await environment.BATCH_WORKFLOW_STATE.put(key, String(next));
    return next;
  });

const makeNativeStarter = (
  environment: TestEnvironment,
  injectNativePreStartRefusal: boolean
) =>
  makeImportWorkflowStarter({
    createBatch: (batch) =>
      Effect.promise(async () => {
        // Workerd rejects this invalid ID before engine initialization; the production starter retains the canonical ID for reconciliation.
        const instances =
          await environment.ImportAcquisitionTestWorkflow.createBatch(
            injectNativePreStartRefusal
              ? batch.map((input) => ({ ...input, id: `?${input.id}` }))
              : batch
          );
        return instances.map((instance) => ({
          restart: () => Effect.promise(() => instance.restart()),
          status: () => Effect.promise(() => instance.status()),
        }));
      }),
    get: (id) =>
      Effect.promise(() =>
        environment.ImportAcquisitionTestWorkflow.get(id)
      ).pipe(
        Effect.map((instance) => ({
          restart: () => Effect.promise(() => instance.restart()),
          status: () => Effect.promise(() => instance.status()),
        }))
      ),
  });

const batchWorkflowExport = {
  kind: "workflow" as const,
  make: (environment: TestEnvironment) =>
    Effect.succeed((rawInput: Schema.Json) =>
      Effect.gen(function* runBatchWorkflowProof() {
        const event = yield* WorkflowEvent;
        const message = yield* Schema.decodeUnknownEffect(
          HouseholdBatchQueueMessage,
          { onExcessProperty: "error" }
        )(rawInput);
        const scenario = yield* Effect.promise(() =>
          environment.BATCH_WORKFLOW_STATE.get(
            stateKey(event.instanceId, "scenario")
          )
        ).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Scenario)));
        const household = Cloudflare.makeRpcStub<HouseholdDomainWorkerMethods>(
          environment.HouseholdDomainWorker
        );
        const starter = makeNativeStarter(
          environment,
          scenario === "dispatch-pre-start-refusal"
        );
        const faultedHousehold = {
          admitRecipeImport: (input) =>
            household
              .admitRecipeImport(input)
              .pipe(
                Effect.flatMap((result) =>
                  increment(environment, event.instanceId, "admit").pipe(
                    Effect.flatMap((attempt) =>
                      scenario === "admission-lost-response" && attempt === 1
                        ? Effect.die(
                            new Error("admission response lost after commit")
                          )
                        : Effect.succeed(result)
                    )
                  )
                )
              ),
          claimImportBatchItem: (input) =>
            increment(environment, event.instanceId, "claim").pipe(
              Effect.andThen(household.claimImportBatchItem(input))
            ),
          completeImportBatchItem: (input) =>
            increment(environment, event.instanceId, "complete").pipe(
              Effect.andThen(household.completeImportBatchItem(input))
            ),
          failImportBatchItem: (input) =>
            increment(environment, event.instanceId, "fail").pipe(
              Effect.andThen(household.failImportBatchItem(input))
            ),
          recordRecipeImportDispatch: (input) =>
            household
              .recordRecipeImportDispatch(input)
              .pipe(
                Effect.flatMap((result) =>
                  increment(
                    environment,
                    event.instanceId,
                    `record-${input.outcome}`
                  ).pipe(
                    Effect.flatMap((attempt) =>
                      scenario === "dispatch-lost-response" &&
                      input.outcome === "started" &&
                      attempt === 1
                        ? Effect.die(
                            new Error("dispatch response lost after commit")
                          )
                        : Effect.succeed(result)
                    )
                  )
                )
              ),
        } satisfies Pick<
          HouseholdDomainWorkerMethods,
          | "admitRecipeImport"
          | "claimImportBatchItem"
          | "completeImportBatchItem"
          | "failImportBatchItem"
          | "recordRecipeImportDispatch"
        >;
        const faultedStarter = {
          dispatchAdmission: (
            input: Parameters<typeof starter.dispatchAdmission>[0]
          ) =>
            increment(environment, event.instanceId, "dispatch").pipe(
              Effect.flatMap((attempt) =>
                starter
                  .dispatchAdmission(input)
                  .pipe(
                    Effect.flatMap((result) =>
                      scenario === "dispatch-all-start-responses-lost" ||
                      scenario === "dispatch-committed-reconcile-unavailable" ||
                      scenario === "dispatch-reconcile-recovered" ||
                      (scenario === "dispatch-lost-response" && attempt === 1)
                        ? Effect.die(
                            new Error(
                              "workflow start response lost after commit"
                            )
                          )
                        : Effect.succeed(result)
                    )
                  )
              )
            ),
          reconcileAdmission: (
            workflowIdentity: Parameters<typeof starter.reconcileAdmission>[0]
          ) =>
            increment(environment, event.instanceId, "reconcile").pipe(
              Effect.andThen(
                scenario === "dispatch-committed-reconcile-unavailable"
                  ? Effect.die(
                      new Error("workflow status unavailable after commit")
                    )
                  : starter.reconcileAdmission(workflowIdentity)
              )
            ),
        };
        const ports = makeHouseholdImportBatchWorkflowPorts({
          household: faultedHousehold,
          message,
          starter: faultedStarter,
        });
        return yield* coordinateHouseholdImportBatchItem(message, ports, {
          retries: {
            backoff: "exponential",
            delay: "10 milliseconds",
            limit: 5,
          },
          timeout: "30 seconds",
        }).pipe(
          Effect.provideService(RuntimeContext, testRuntimeContext),
          Effect.tapCause(() =>
            Effect.promise(() =>
              environment.BATCH_WORKFLOW_STATE.put(
                stateKey(event.instanceId, "error"),
                "true"
              )
            )
          )
        );
      })
    ),
};

const acquisitionWorkflowExport = {
  kind: "workflow" as const,
  make: (environment: TestEnvironment) =>
    Effect.succeed(() =>
      Effect.gen(function* holdProviderFreeAcquisition() {
        const event = yield* WorkflowEvent;
        yield* task(
          "record-provider-free-acquisition",
          increment(environment, event.instanceId, "acquisition-runs")
        );
        yield* sleep("hold-provider-free-acquisition", "1 minute");
      })
    ),
};

const AlchemyRuntimeContractKey = "shape";
const entrypoint = Effect.succeed({
  RuntimeContext: {
    exports: Effect.succeed({
      HouseholdBatchTestWorkflow: batchWorkflowExport,
      ImportAcquisitionTestWorkflow: acquisitionWorkflowExport,
    }),
    [AlchemyRuntimeContractKey]: () => ({}),
  },
});

const bridge = {
  entrypoint,
  stack: { name: "meal-planner", stage: "test" },
};
const HouseholdBatchWorkflowBridge = makeWorkflowBridge(
  WorkflowEntrypoint,
  bridge
)("HouseholdBatchTestWorkflow");
const ImportAcquisitionWorkflowBridge = makeWorkflowBridge(
  WorkflowEntrypoint,
  bridge
)("ImportAcquisitionTestWorkflow");

export class HouseholdBatchTestWorkflow extends HouseholdBatchWorkflowBridge {}
export class ImportAcquisitionTestWorkflow extends ImportAcquisitionWorkflowBridge {}

const waitForTerminalStatus = async (
  workflow: NativeWorkflowBinding,
  id: string
) => {
  try {
    await workflow.unsafeWaitForStatus(id, "complete");
  } catch {
    await workflow.unsafeWaitForStatus(id, "errored");
  }
  return workflow.get(id).then((instance) => instance.status());
};

const readEventually = async (
  environment: TestEnvironment,
  key: string,
  remaining = 20
): Promise<string | null> => {
  const value = await environment.BATCH_WORKFLOW_STATE.get(key);
  if (value !== null || remaining === 0) {
    return value;
  }
  await Effect.runPromise(Effect.sleep(10));
  return readEventually(environment, key, remaining - 1);
};

export default {
  fetch: async (request: Request, environment: TestEnvironment) => {
    const command = await Effect.runPromise(
      Effect.promise(() => request.json()).pipe(
        Effect.flatMap(
          Schema.decodeUnknownEffect(Command, { onExcessProperty: "error" })
        )
      )
    );
    const household = Cloudflare.makeRpcStub<HouseholdDomainWorkerMethods>(
      environment.HouseholdDomainWorker
    );
    const memberAdmission = Schema.decodeUnknownSync(HouseholdMemberAdmission)({
      actor: { _tag: "Member", actorId: "a".repeat(64) },
      organizationId: command.organizationId,
    });
    await Effect.runPromise(
      household.ensureHousehold({ admission: memberAdmission })
    );
    const admittedBatch = await Effect.runPromise(
      household
        .admitImportBatch(
          Schema.decodeUnknownSync(HouseholdAdmitImportBatchInput)({
            admission: memberAdmission,
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
    let [message] = admittedBatch.messages;
    const messageKey = stateKey(command.commandId, "message");
    if (message === undefined) {
      const storedMessage =
        await environment.BATCH_WORKFLOW_STATE.get(messageKey);
      if (storedMessage === null) {
        throw new Error("Expected one admitted or previously stored message.");
      }
      message = Schema.decodeUnknownSync(HouseholdBatchQueueMessage)(
        JSON.parse(storedMessage)
      );
    } else {
      await environment.BATCH_WORKFLOW_STATE.put(
        messageKey,
        JSON.stringify(Schema.encodeSync(HouseholdBatchQueueMessage)(message))
      );
    }
    const workflowId = householdBatchWorkflowInstanceId(message);
    await environment.BATCH_WORKFLOW_STATE.put(
      stateKey(workflowId, "scenario"),
      command.scenario
    );
    const sessionId =
      await environment.HouseholdBatchTestWorkflow.unsafeStartIntrospection();
    let status: { readonly status: string };
    try {
      const created = await environment.BATCH_WORKFLOW_STATE.get(
        stateKey(workflowId, "created")
      );
      if (created === null) {
        await environment.HouseholdBatchTestWorkflow.create({
          id: workflowId,
          params: Schema.encodeSync(HouseholdBatchQueueMessage)(message),
        });
        await environment.BATCH_WORKFLOW_STATE.put(
          stateKey(workflowId, "created"),
          "true"
        );
      } else {
        const instance =
          await environment.HouseholdBatchTestWorkflow.get(workflowId);
        const existingStatus = await instance.status();
        if (
          command.scenario === "dispatch-reconcile-recovered" &&
          existingStatus.status === "errored"
        ) {
          await instance.restart();
        }
      }
      status = await waitForTerminalStatus(
        environment.HouseholdBatchTestWorkflow,
        workflowId
      );
    } finally {
      await environment.HouseholdBatchTestWorkflow.unsafeStopIntrospection(
        sessionId
      );
    }
    const batch = await Effect.runPromise(
      household
        .readImportBatch({
          admission: memberAdmission,
          batchId: message.batchId,
        })
        .pipe(Effect.flatMap(Schema.decodeUnknownEffect(RecipeImportBatch)))
    );
    const replay = await Effect.runPromise(
      household
        .admitRecipeImport(
          Schema.decodeUnknownSync(HouseholdAdmitRecipeImportInput)({
            admission: memberAdmission,
            idempotencyKey: `item-${command.commandId}`,
            source: {
              kind: "tiktok",
              url: `https://www.tiktok.com/@mealplanner/video/${command.commandId}`,
            },
          })
        )
        .pipe(
          Effect.flatMap(
            Schema.decodeUnknownEffect(HouseholdAdmitRecipeImportResult)
          )
        )
    );
    const outbox = await Effect.runPromise(
      household
        .recordRecipeImportDispatch(
          Schema.decodeUnknownSync(HouseholdRecordRecipeImportDispatchInput)({
            admission: {
              actor: {
                _tag: "System",
                purpose: "import_workflow_dispatch",
              },
              organizationId: message.organizationId,
            },
            dispatchId: replay.dispatchId,
            originalTrace: { correlationId: message.itemId },
            outcome: "prepared",
            workflowIdentity: replay.workflowIdentity,
          })
        )
        .pipe(
          Effect.flatMap(
            Schema.decodeUnknownEffect(
              HouseholdRecordRecipeImportDispatchResult
            )
          ),
          Effect.option
        )
    );
    const read = (name: string) =>
      environment.BATCH_WORKFLOW_STATE.get(stateKey(workflowId, name));
    const acquisitionRuns = await readEventually(
      environment,
      stateKey(
        cloudflareWorkflowInstanceId(
          Schema.decodeUnknownSync(ImportWorkflowIdentity)(
            replay.workflowIdentity
          )
        ),
        "acquisition-runs"
      )
    );
    return Response.json({
      acquisitionRuns: Number(acquisitionRuns ?? "0"),
      batch,
      counts: {
        admit: Number((await read("admit")) ?? "0"),
        claim: Number((await read("claim")) ?? "0"),
        complete: Number((await read("complete")) ?? "0"),
        dispatch: Number((await read("dispatch")) ?? "0"),
        fail: Number((await read("fail")) ?? "0"),
        prepared: Number((await read("record-prepared")) ?? "0"),
        reconcile: Number((await read("reconcile")) ?? "0"),
        started: Number((await read("record-started")) ?? "0"),
        unavailable: Number((await read("record-unavailable")) ?? "0"),
      },
      error: (await read("error")) === "true",
      outbox: outbox._tag === "Some" ? outbox.value : null,
      replay: {
        intentId: replay.intent.id,
        workflowIdentity: replay.workflowIdentity,
      },
      status,
      workflowId,
    });
  },
};
