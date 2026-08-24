import {
  CreateRecipeImportBatchRequest,
  CreateRecipeImportBatchItemRequest,
  IdempotencyKey,
  RecipeImportBatch,
  RecipeImportBatchId,
  RecipeImportBatchItemId,
  RecipeImportIntentId,
} from "@meal-planner/recipe-import-api";
import { Schema } from "effect";

import {
  HouseholdMemberAdmission,
  HouseholdSystemAdmission,
} from "../rpc/command-envelope.js";

const PositiveSafeInteger = Schema.Int.pipe(
  Schema.check(
    Schema.isGreaterThanOrEqualTo(1),
    Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)
  )
);

export const HouseholdBatchFailure = Schema.TaggedStruct(
  "HouseholdBatchFailure",
  {
    reason: Schema.Literals([
      "batch_not_found",
      "idempotency_conflict",
      "generation_conflict",
      "illegal_transition",
      "invalid_input",
      "persistence_unavailable",
    ]),
  }
);
export type HouseholdBatchFailure = typeof HouseholdBatchFailure.Type;

export const HouseholdAdmitImportBatchInput = Schema.Struct({
  admission: HouseholdMemberAdmission,
  idempotencyKey: IdempotencyKey,
  request: CreateRecipeImportBatchRequest,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type HouseholdAdmitImportBatchInput =
  typeof HouseholdAdmitImportBatchInput.Type;

export const HouseholdBatchQueueMessage = Schema.Struct({
  batchId: RecipeImportBatchId,
  generation: PositiveSafeInteger,
  itemId: RecipeImportBatchItemId,
  organizationId: HouseholdMemberAdmission.fields.organizationId,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type HouseholdBatchQueueMessage = typeof HouseholdBatchQueueMessage.Type;

export const HouseholdAdmitImportBatchResult = Schema.Struct({
  batch: RecipeImportBatch,
  messages: Schema.Array(HouseholdBatchQueueMessage),
});
export type HouseholdAdmitImportBatchResult =
  typeof HouseholdAdmitImportBatchResult.Type;

export const HouseholdReadImportBatchInput = Schema.Struct({
  admission: HouseholdMemberAdmission,
  batchId: RecipeImportBatchId,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type HouseholdReadImportBatchInput =
  typeof HouseholdReadImportBatchInput.Type;

export const HouseholdClaimImportBatchItemInput = Schema.Struct({
  admission: HouseholdSystemAdmission,
  message: HouseholdBatchQueueMessage,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type HouseholdClaimImportBatchItemInput =
  typeof HouseholdClaimImportBatchItemInput.Type;

export const HouseholdClaimedImportBatchItem = Schema.Struct({
  _tag: Schema.Literal("Claimed"),
  actorId: HouseholdMemberAdmission.fields.actor.fields.actorId,
  idempotencyKey: IdempotencyKey,
  source: CreateRecipeImportBatchItemRequest.fields.source,
});
export const HouseholdTerminalImportBatchItem = Schema.Struct({
  _tag: Schema.Literal("Terminal"),
  batch: RecipeImportBatch,
});
export const HouseholdClaimImportBatchItemResult = Schema.Union([
  HouseholdClaimedImportBatchItem,
  HouseholdTerminalImportBatchItem,
]);
export type HouseholdClaimImportBatchItemResult =
  typeof HouseholdClaimImportBatchItemResult.Type;

const HouseholdBatchItemMutationCommon = {
  admission: HouseholdSystemAdmission,
  batchId: RecipeImportBatchId,
  expectedGeneration: PositiveSafeInteger,
  itemId: RecipeImportBatchItemId,
};

export const HouseholdCompleteImportBatchItemInput = Schema.Struct({
  ...HouseholdBatchItemMutationCommon,
  intentId: RecipeImportIntentId,
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type HouseholdCompleteImportBatchItemInput =
  typeof HouseholdCompleteImportBatchItemInput.Type;

export const HouseholdFailImportBatchItemInput = Schema.Struct({
  ...HouseholdBatchItemMutationCommon,
  failureCode: Schema.Literals([
    "dispatch_exhausted",
    "import_admission_failed",
  ]),
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type HouseholdFailImportBatchItemInput =
  typeof HouseholdFailImportBatchItemInput.Type;

export const HouseholdRecordImportBatchDispatchInput = Schema.Struct({
  admission: HouseholdSystemAdmission,
  batchId: RecipeImportBatchId,
  expectedGeneration: PositiveSafeInteger,
  itemId: RecipeImportBatchItemId,
  outcome: Schema.Literals(["delivered", "retry", "exhausted"]),
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type HouseholdRecordImportBatchDispatchInput =
  typeof HouseholdRecordImportBatchDispatchInput.Type;
