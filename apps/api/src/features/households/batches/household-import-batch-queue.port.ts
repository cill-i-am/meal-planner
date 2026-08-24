import type { RuntimeContext } from "alchemy";
import { Context, Data } from "effect";
import type { Effect } from "effect";

import type { HouseholdBatchQueueMessage } from "./household-import-batch.contract.js";

export class HouseholdImportBatchQueueSendFailure extends Data.TaggedError(
  "HouseholdImportBatchQueueSendFailure"
) {}

export interface HouseholdImportBatchQueueWriterService {
  readonly send: (
    message: HouseholdBatchQueueMessage
  ) => Effect.Effect<
    void,
    HouseholdImportBatchQueueSendFailure,
    RuntimeContext
  >;
}

export const HouseholdImportBatchQueueWriter =
  Context.Service<HouseholdImportBatchQueueWriterService>(
    "meal-planner/HouseholdImportBatchQueueWriter"
  );
