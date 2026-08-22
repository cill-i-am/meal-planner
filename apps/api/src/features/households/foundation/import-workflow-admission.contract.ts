import { Schema } from "effect";

import { ImportIntentExecutionGeneration } from "../../imports/import-intent-transition.js";
import { ImportId } from "../../imports/import.contracts.js";
import { ImportWorkflowIdentity } from "../shared-kernel/workflow-identity.js";

export const HouseholdDispatchId = Schema.String.pipe(
  Schema.check(
    Schema.isTrimmed(),
    Schema.isNonEmpty(),
    Schema.isMaxLength(128)
  ),
  Schema.brand("HouseholdDispatchId")
);
export type HouseholdDispatchId = typeof HouseholdDispatchId.Type;

export const HouseholdImportWorkflowAdmissionResult = Schema.Struct({
  committedAtEpochMs: Schema.Int.pipe(
    Schema.check(Schema.isGreaterThanOrEqualTo(0))
  ),
  dispatchId: HouseholdDispatchId,
  workflowIdentity: ImportWorkflowIdentity,
});
export type HouseholdImportWorkflowAdmissionResult =
  typeof HouseholdImportWorkflowAdmissionResult.Type;

/**
 * Compact, privacy-safe input for the Workflow dispatcher. The
 * HouseholdObject already supplies the organization authority boundary, so
 * organization identifiers are deliberately absent from the durable payload.
 */
export const HouseholdImportWorkflowOutboxPayload = Schema.Struct({
  executionGeneration: ImportIntentExecutionGeneration,
  importId: ImportId,
  workflowIdentity: ImportWorkflowIdentity,
});
export type HouseholdImportWorkflowOutboxPayload =
  typeof HouseholdImportWorkflowOutboxPayload.Type;

const HouseholdOutboxAttempts = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(0))
);
const HouseholdOutboxEpochMs = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(0))
);

export const HouseholdImportWorkflowDispatchView = Schema.Union([
  Schema.Struct({
    admission: HouseholdImportWorkflowAdmissionResult,
    attempts: HouseholdOutboxAttempts,
    exhaustedAtEpochMs: Schema.Null,
    state: Schema.Literal("pending"),
  }),
  Schema.Struct({
    admission: HouseholdImportWorkflowAdmissionResult,
    attempts: HouseholdOutboxAttempts,
    exhaustedAtEpochMs: HouseholdOutboxEpochMs,
    state: Schema.Literal("exhausted"),
  }),
  Schema.Struct({
    admission: HouseholdImportWorkflowAdmissionResult,
    attempts: HouseholdOutboxAttempts,
    exhaustedAtEpochMs: Schema.Null,
    state: Schema.Literal("dispatched"),
  }),
]);
export type HouseholdImportWorkflowDispatchView =
  typeof HouseholdImportWorkflowDispatchView.Type;

export const HouseholdWorkflowAdmissionPersistenceFailure = Schema.TaggedStruct(
  "HouseholdWorkflowAdmissionPersistenceFailure",
  {}
);
export type HouseholdWorkflowAdmissionPersistenceFailure =
  typeof HouseholdWorkflowAdmissionPersistenceFailure.Type;
