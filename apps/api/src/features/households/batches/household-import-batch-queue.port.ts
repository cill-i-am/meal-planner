import type { RuntimeContext } from "alchemy";
import { Context, Data } from "effect";
import type { Effect } from "effect";

import type { HouseholdBatchQueueMessage } from "./household-import-batch.contract.js";

export class HouseholdImportBatchQueueSendAmbiguous extends Data.TaggedError(
  "HouseholdImportBatchQueueSendAmbiguous"
) {}

export interface HouseholdImportBatchQueueWriterService {
  readonly send: (
    message: HouseholdBatchQueueMessage
  ) => Effect.Effect<
    void,
    HouseholdImportBatchQueueSendAmbiguous,
    RuntimeContext
  >;
}

export const HouseholdImportBatchQueueWriter =
  Context.Service<HouseholdImportBatchQueueWriterService>(
    "meal-planner/HouseholdImportBatchQueueWriter"
  );
