import { Cause, Effect } from "effect";

import type { HouseholdDomainWorkerMethods } from "../households/household-domain-worker.js";
import {
  decodeHouseholdBatchQueueMessage,
  householdBatchWorkflowInstanceId,
} from "./household-import-batch-transport.js";

interface HouseholdBatchWorkflowInstance<E, R> {
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
  | { readonly _tag: "NotStarted" }
  | { readonly _tag: "Started" };

export interface HouseholdBatchWorkflowLauncher<E, R> {
  readonly create: HouseholdBatchWorkflowBinding<E, R>["create"];
  readonly reconcile: (
    id: string
  ) => Effect.Effect<HouseholdBatchWorkflowReconciliation, E, R>;
}

/** Translate the native binding into a start/reconciliation boundary. */
export const makeHouseholdBatchWorkflowLauncher = <E, R>(
  workflow: HouseholdBatchWorkflowBinding<E, R>
): HouseholdBatchWorkflowLauncher<E, R> => ({
  create: workflow.create,
  reconcile: (id) =>
    workflow.get(id).pipe(
      Effect.flatMap((instance) => instance.status()),
      Effect.as({ _tag: "Started" as const })
    ),
});

/** Production Queue handler: validate the closed envelope and start or reconcile one stable Workflow. */
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
          () =>
            workflow.reconcile(workflowId).pipe(
              Effect.filterOrFail(
                (result) => result._tag === "Started",
                () => new Error("batch workflow did not start")
              )
            )
        ),
        Effect.as({ message, workflowId })
      );
    })
  );

/** Production DLQ handler: terminally settle only the immutable household-local item identity. */
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
          reconciliation._tag === "Started"
            ? Effect.void
            : household
                .failImportBatchItem({
                  admission: {
                    actor: { _tag: "System", purpose: "batch_item_dispatch" },
                    organizationId: message.organizationId,
                  },
                  batchId: message.batchId,
                  expectedGeneration: message.generation,
                  failureCode: "dispatch_exhausted",
                  itemId: message.itemId,
                })
                .pipe(Effect.asVoid)
        ),
        Effect.as({ message, workflowId })
      );
    })
  );
