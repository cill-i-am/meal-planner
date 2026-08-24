import type { RecipeImportBatch } from "@meal-planner/recipe-import-api";
import type { RuntimeContext } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import type { AnyD1Database } from "drizzle-orm/d1";
import { Cause, Effect, Schema } from "effect";

import { MealPlannerDatabase } from "../../infrastructure/meal-planner-database.js";
import type {
  HouseholdClaimImportBatchItemResult,
  HouseholdFailImportBatchItemInput,
} from "../households/batches/household-import-batch.contract.js";
import {
  HouseholdBatchQueueMessage,
  HouseholdClaimedImportBatchItem,
} from "../households/batches/household-import-batch.contract.js";
import { HouseholdDispatchId } from "../households/foundation/import-workflow-admission.contract.js";
import { HouseholdDomainWorker } from "../households/household-domain-binding.js";
import type {
  HouseholdDomainWorkerMethods,
  HouseholdRecipeImportDomainFailure,
} from "../households/household-domain-worker.js";
import {
  HouseholdAdmitRecipeImportResult,
  HouseholdRecipeImportFailure,
  HouseholdRecordRecipeImportDispatchResult,
} from "../households/recipe-import/household-recipe-import.contract.js";
import { ImportWorkflowIdentity } from "../households/shared-kernel/workflow-identity.js";
import { makeD1ImportEvidenceRouteRepository } from "./import-evidence-route.repository.d1.js";
import { ImportIntentExecutionGeneration } from "./import-intent-transition.js";
import { ImportTraceContext } from "./import-observability.js";
import { ImportId } from "./import.contracts.js";
import type { ImportWorkflowReconciler } from "./import.workflow.js";
import ImportAcquisitionWorkflow, {
  makeImportWorkflowStarter,
} from "./import.workflow.js";

const StepOptions = {
  retries: { backoff: "exponential", delay: "2 seconds", limit: 5 },
  timeout: "30 seconds",
} as const;

const BatchImportAdmissionStep = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("Admitted"),
    value: HouseholdAdmitRecipeImportResult,
  }),
  Schema.Struct({ _tag: Schema.Literal("Rejected") }),
]);

interface HouseholdImportBatchWorkflowPorts {
  readonly admit: (
    claimed: typeof HouseholdClaimedImportBatchItem.Type,
    message: typeof HouseholdBatchQueueMessage.Type
  ) => Effect.Effect<
    typeof BatchImportAdmissionStep.Encoded,
    never,
    RuntimeContext
  >;
  readonly claim: (
    message: typeof HouseholdBatchQueueMessage.Type
  ) => Effect.Effect<
    typeof HouseholdClaimImportBatchItemResult.Encoded,
    never,
    RuntimeContext
  >;
  readonly complete: (
    admitted: typeof HouseholdAdmitRecipeImportResult.Type,
    message: typeof HouseholdBatchQueueMessage.Type
  ) => Effect.Effect<typeof RecipeImportBatch.Encoded, never, RuntimeContext>;
  readonly dispatch: (
    admitted: typeof HouseholdAdmitRecipeImportResult.Type,
    message: typeof HouseholdBatchQueueMessage.Type
  ) => Effect.Effect<boolean, never, RuntimeContext>;
  readonly fail: (
    message: typeof HouseholdBatchQueueMessage.Type,
    failureCode: (typeof HouseholdFailImportBatchItemInput.Type)["failureCode"]
  ) => Effect.Effect<typeof RecipeImportBatch.Encoded, never, RuntimeContext>;
}

const isAuthoritativeAdmissionRejection = (
  error: HouseholdRecipeImportDomainFailure
) =>
  Schema.is(HouseholdRecipeImportFailure)(error) &&
  error.reason !== "persistence_unavailable";

/** Production runtime ports, exported so native tests exercise the installed composition. */
export const makeHouseholdImportBatchWorkflowPorts = (input: {
  readonly database: Effect.Effect<AnyD1Database, never, RuntimeContext>;
  readonly household: Pick<
    HouseholdDomainWorkerMethods,
    | "admitRecipeImport"
    | "claimImportBatchItem"
    | "completeImportBatchItem"
    | "failImportBatchItem"
    | "recordRecipeImportDispatch"
  >;
  readonly message: typeof HouseholdBatchQueueMessage.Type;
  readonly starter: Pick<
    ImportWorkflowReconciler,
    "dispatchAdmission" | "reconcileAdmission"
  >;
}): HouseholdImportBatchWorkflowPorts => {
  const { household, message, starter } = input;
  const systemAdmission = {
    actor: {
      _tag: "System" as const,
      purpose: "batch_item_dispatch" as const,
    },
    organizationId: message.organizationId,
  };
  return {
    admit: (claimed) =>
      household
        .admitRecipeImport({
          admission: {
            actor: { _tag: "Member", actorId: claimed.actorId },
            organizationId: message.organizationId,
          },
          idempotencyKey: claimed.idempotencyKey,
          source: claimed.source,
        })
        .pipe(
          Effect.map((value) => ({ _tag: "Admitted" as const, value })),
          Effect.catchIf(isAuthoritativeAdmissionRejection, () =>
            Effect.succeed({ _tag: "Rejected" as const })
          ),
          Effect.flatMap(Schema.decodeUnknownEffect(BatchImportAdmissionStep)),
          Effect.flatMap(Schema.encodeEffect(BatchImportAdmissionStep)),
          Effect.orDie
        ),
    claim: (queueMessage) =>
      household
        .claimImportBatchItem({
          admission: systemAdmission,
          message: queueMessage,
        })
        .pipe(Effect.orDie),
    complete: (admitted, queueMessage) =>
      household
        .completeImportBatchItem({
          admission: systemAdmission,
          batchId: queueMessage.batchId,
          expectedGeneration: queueMessage.generation,
          intentId: admitted.intent.id,
          itemId: queueMessage.itemId,
        })
        .pipe(Effect.orDie),
    dispatch: (admitted, queueMessage) =>
      Effect.gen(function* dispatchRecipeImportWorkflow() {
        const database = yield* input.database;
        const importId = yield* Schema.decodeUnknownEffect(ImportId)(
          admitted.intent.id
        );
        const executionGeneration = yield* Schema.decodeUnknownEffect(
          ImportIntentExecutionGeneration
        )(1);
        const dispatchId = yield* Schema.decodeUnknownEffect(
          HouseholdDispatchId
        )(admitted.dispatchId);
        const workflowIdentity = yield* Schema.decodeUnknownEffect(
          ImportWorkflowIdentity
        )(admitted.workflowIdentity);
        const trace = yield* Schema.decodeUnknownEffect(ImportTraceContext)({
          correlationId: queueMessage.itemId,
        });
        const record = (outcome: "prepared" | "started" | "unavailable") =>
          household
            .recordRecipeImportDispatch({
              admission: {
                actor: {
                  _tag: "System",
                  purpose: "import_workflow_dispatch",
                },
                organizationId: queueMessage.organizationId,
              },
              dispatchId,
              originalTrace: trace,
              outcome,
              workflowIdentity,
            })
            .pipe(
              Effect.flatMap(
                Schema.decodeUnknownEffect(
                  HouseholdRecordRecipeImportDispatchResult
                )
              )
            );
        const registered = yield* makeD1ImportEvidenceRouteRepository(
          database
        ).register({
          executionGeneration,
          importId,
          organizationId: queueMessage.organizationId,
          routeVersion: 1,
        });
        if (registered !== "Registered") {
          return yield* Effect.die(
            new Error("Import evidence route conflicts with batch authority.")
          );
        }
        const prepared = yield* record("prepared");
        if (prepared.state === "dispatched") {
          return true;
        }
        if (prepared.state === "exhausted") {
          return false;
        }
        return yield* starter
          .dispatchAdmission({
            executionGeneration,
            importId,
            organizationId: message.organizationId,
            trace,
            workflowIdentity,
          })
          .pipe(
            Effect.andThen(record("started")),
            Effect.as(true),
            Effect.catchCauseIf(
              (cause) => !Cause.hasInterrupts(cause),
              (cause) =>
                starter.reconcileAdmission(workflowIdentity).pipe(
                  Effect.andThen(record("started")),
                  Effect.as(true),
                  Effect.catchCauseIf(
                    (reconciliationCause) =>
                      !Cause.hasInterrupts(reconciliationCause),
                    () =>
                      record("unavailable").pipe(
                        Effect.flatMap((view) =>
                          view.state === "exhausted"
                            ? Effect.succeed(false)
                            : Effect.failCause(cause)
                        )
                      )
                  )
                )
            )
          );
      }).pipe(Effect.orDie),
    fail: (queueMessage, failureCode) =>
      household
        .failImportBatchItem({
          admission: systemAdmission,
          batchId: queueMessage.batchId,
          expectedGeneration: queueMessage.generation,
          failureCode,
          itemId: queueMessage.itemId,
        })
        .pipe(Effect.orDie),
  };
};

/** Production coordination core, exercised under native Workflow in runtime tests. */
export const coordinateHouseholdImportBatchItem = Effect.fn(
  function* coordinateHouseholdImportBatchItem(
    message: typeof HouseholdBatchQueueMessage.Type,
    ports: HouseholdImportBatchWorkflowPorts,
    stepOptions = StepOptions
  ) {
    const claimedStep = yield* Cloudflare.Workflows.task(
      "claim-household-batch-item",
      ports.claim(message),
      stepOptions
    );
    if (claimedStep._tag === "Terminal") {
      return claimedStep.batch;
    }
    const claimed = yield* Schema.decodeUnknownEffect(
      HouseholdClaimedImportBatchItem
    )(claimedStep).pipe(Effect.orDie);
    const admissionStep = yield* Cloudflare.Workflows.task(
      "admit-household-recipe-import",
      ports.admit(claimed, message),
      stepOptions
    );
    if (admissionStep._tag === "Rejected") {
      return yield* Cloudflare.Workflows.task(
        "settle-rejected-household-batch-item",
        ports.fail(message, "import_admission_failed"),
        stepOptions
      );
    }
    const admitted = yield* Schema.decodeUnknownEffect(
      HouseholdAdmitRecipeImportResult
    )(admissionStep.value).pipe(Effect.orDie);
    const dispatched = yield* Cloudflare.Workflows.task(
      "dispatch-recipe-import-workflow",
      ports.dispatch(admitted, message),
      stepOptions
    );
    return yield* Cloudflare.Workflows.task(
      "settle-household-batch-item",
      dispatched
        ? ports.complete(admitted, message)
        : ports.fail(message, "dispatch_exhausted"),
      stepOptions
    );
  }
);

/** Coordinates one household batch item; Queue remains transport-only. */
export default class HouseholdImportBatchItemWorkflow extends Cloudflare.Workflow<HouseholdImportBatchItemWorkflow>()(
  "HouseholdImportBatchItemWorkflow",
  Effect.gen(function* initializeHouseholdBatchItemWorkflow() {
    const household = yield* Cloudflare.Workers.bindWorker(
      HouseholdDomainWorker
    );
    const acquisitionWorkflow = yield* ImportAcquisitionWorkflow;
    const queryDatabase =
      yield* Cloudflare.D1.QueryDatabase(MealPlannerDatabase);
    const starter = makeImportWorkflowStarter(acquisitionWorkflow);
    return Effect.fn(function* runHouseholdBatchItem(untrustedInput) {
      const message = yield* Schema.decodeUnknownEffect(
        HouseholdBatchQueueMessage,
        { onExcessProperty: "error" }
      )(untrustedInput).pipe(Effect.orDie);
      const ports = makeHouseholdImportBatchWorkflowPorts({
        database: queryDatabase.raw,
        household,
        message,
        starter,
      });
      return yield* coordinateHouseholdImportBatchItem(message, ports);
    });
  }).pipe(Effect.provide(Cloudflare.D1.QueryDatabaseBinding))
) {}
