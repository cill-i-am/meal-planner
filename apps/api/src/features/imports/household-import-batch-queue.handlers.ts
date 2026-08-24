import { Cause, Effect } from "effect";

import type { HouseholdDomainWorkerMethods } from "../households/household-domain-worker.js";
import {
  decodeHouseholdBatchQueueMessage,
  householdBatchWorkflowInstanceId,
} from "./household-import-batch-transport.js";

interface HouseholdBatchWorkflowInstance<E, R> {
  readonly status: () => Effect.Effect<{ readonly status: string }, E, R>;
}

export interface HouseholdBatchWorkflowLauncher<E, R> {
  readonly create: (input: {
    readonly id: string;
    readonly params: unknown;
  }) => Effect.Effect<unknown, E, R>;
  readonly get: (
    id: string
  ) => Effect.Effect<HouseholdBatchWorkflowInstance<E, R>, E, R>;
}

const isAcceptedWorkflowStatus = (status: string) =>
  status === "queued" ||
  status === "running" ||
  status === "waiting" ||
  status === "waitingForPause" ||
  status === "complete";

/** Production Queue handler: validate the closed envelope and start or reconcile one stable Workflow. */
export const handleHouseholdImportBatchQueueMessage = <E, R>(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- The untrusted Queue body is immediately parsed by the production closed-envelope decoder.
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
            workflow.get(workflowId).pipe(
              Effect.flatMap((instance) => instance.status()),
              Effect.filterOrFail(
                ({ status }) => isAcceptedWorkflowStatus(status),
                () => new Error("batch workflow start unavailable")
              )
            )
        ),
        Effect.as({ message, workflowId })
      );
    })
  );

/** Production DLQ handler: terminally settle only the immutable household-local item identity. */
export const handleHouseholdImportBatchDeadLetterMessage = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- The untrusted DLQ body is immediately parsed by the production closed-envelope decoder.
  body: unknown,
  household: Pick<HouseholdDomainWorkerMethods, "failImportBatchItem">
) =>
  decodeHouseholdBatchQueueMessage(body).pipe(
    Effect.flatMap((message) =>
      household.failImportBatchItem({
        admission: {
          actor: { _tag: "System", purpose: "batch_item_dispatch" },
          organizationId: message.organizationId,
        },
        batchId: message.batchId,
        expectedGeneration: message.generation,
        failureCode: "dispatch_exhausted",
        itemId: message.itemId,
      })
    )
  );
