import { Cause, Effect } from "effect";

import type { HouseholdDomainWorkerMethods } from "../households/household-domain-worker.js";
import {
  decodeHouseholdBatchQueueMessage,
  householdBatchWorkflowInstanceId,
} from "./household-import-batch-transport.js";

interface HouseholdBatchWorkflowInstance<E, R> {
  readonly restart: () => Effect.Effect<unknown, E, R>;
  readonly status: () => Effect.Effect<{ readonly status: string }, E, R>;
}

interface HouseholdBatchWorkflowBinding<E, R> {
  readonly create: (input: {
    readonly id: string;
    readonly params: unknown;
  }) => Effect.Effect<unknown, E, R>;
  readonly get: (
    id: string
  ) => Effect.Effect<HouseholdBatchWorkflowInstance<E, R>, E, R>;
}

export type HouseholdBatchWorkflowReconciliation =
  | { readonly _tag: "Active" }
  | { readonly _tag: "Complete" }
  | { readonly _tag: "NotStarted" }
  | { readonly _tag: "Redriven" };

export interface HouseholdBatchWorkflowLauncher<E, R> {
  readonly create: HouseholdBatchWorkflowBinding<E, R>["create"];
  readonly reconcile: (
    id: string
  ) => Effect.Effect<HouseholdBatchWorkflowReconciliation, E, R>;
}

const activeWorkflowStatuses: ReadonlySet<string> = new Set([
  "paused",
  "queued",
  "running",
  "waiting",
  "waitingForPause",
]);

/** Translate the native binding into a status-aware start/redrive boundary. */
export const makeHouseholdBatchWorkflowLauncher = <E, R>(
  workflow: HouseholdBatchWorkflowBinding<E, R>
): HouseholdBatchWorkflowLauncher<E | Error, R> => ({
  create: workflow.create,
  reconcile: (id) =>
    Effect.gen(function* reconcileHouseholdBatchWorkflow() {
      const instance = yield* workflow.get(id);
      const { status } = yield* instance.status();
      if (activeWorkflowStatuses.has(status)) {
        return { _tag: "Active" as const };
      }
      if (status === "complete") {
        return { _tag: "Complete" as const };
      }
      if (status === "errored" || status === "terminated") {
        yield* instance.restart();
        return { _tag: "Redriven" as const };
      }
      return yield* Effect.fail(
        new Error(`batch workflow status is unavailable: ${status}`)
      );
    }),
});

/** Production Queue handler: start or status-aware redrive one stable Workflow. */
export const handleHouseholdImportBatchQueueMessage = <E, R>(
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- The untrusted Queue body is immediately parsed by the production closed-envelope decoder.
  body: unknown,
  workflow: HouseholdBatchWorkflowLauncher<E, R>
) =>
  decodeHouseholdBatchQueueMessage(body).pipe(
    Effect.flatMap((message) => {
      const workflowId = householdBatchWorkflowInstanceId(message);
      return workflow.create({ id: workflowId, params: message }).pipe(
        Effect.catchCauseIf(
          (cause) => !Cause.hasInterrupts(cause),
          () => Effect.void
        ),
        Effect.andThen(
          workflow.reconcile(workflowId).pipe(
            Effect.filterOrFail(
              (result) => result._tag !== "NotStarted",
              () => new Error("batch workflow did not start")
            )
          )
        ),
        Effect.as({ message, workflowId })
      );
    })
  );

/** Production DLQ handler: settle only a proven pre-start refusal; preserve every ambiguity. */
export const handleHouseholdImportBatchDeadLetterMessage = <E, R>(
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- The untrusted DLQ body is immediately parsed by the production closed-envelope decoder.
  body: unknown,
  household: Pick<HouseholdDomainWorkerMethods, "failImportBatchItem">,
  workflow: HouseholdBatchWorkflowLauncher<E, R>
) =>
  decodeHouseholdBatchQueueMessage(body).pipe(
    Effect.flatMap((message) => {
      const workflowId = householdBatchWorkflowInstanceId(message);
      return workflow.reconcile(workflowId).pipe(
        Effect.flatMap((reconciliation) =>
          reconciliation._tag === "NotStarted"
            ? household
                .failImportBatchItem({
                  admission: {
                    actor: {
                      _tag: "System",
                      purpose: "batch_item_dispatch",
                    },
                    organizationId: message.organizationId,
                  },
                  batchId: message.batchId,
                  expectedGeneration: message.generation,
                  failureCode: "dispatch_exhausted",
                  itemId: message.itemId,
                })
                .pipe(Effect.asVoid)
            : Effect.void
        ),
        Effect.as({ message, workflowId })
      );
    })
  );
