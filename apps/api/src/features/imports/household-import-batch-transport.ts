import { Schema } from "effect";

import { HouseholdBatchQueueMessage } from "../households/batches/household-import-batch.contract.js";

/** Closed transport decoder shared by Queue consumers and runtime probes. */
// eslint-disable-next-line anti-slop/no-unknown-parameters -- A Queue body is untrusted until this boundary decoder succeeds.
export const decodeHouseholdBatchQueueMessage = (input: unknown) =>
  Schema.decodeUnknownEffect(HouseholdBatchQueueMessage, {
    onExcessProperty: "error",
  })(input);

/** One immutable Workflow execution per household batch item generation. */
export const householdBatchWorkflowInstanceId = (
  message: typeof HouseholdBatchQueueMessage.Type
) => `household-batch-v1-${message.itemId}-g${message.generation}`;
