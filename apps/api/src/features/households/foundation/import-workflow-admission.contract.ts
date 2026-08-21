import { Schema } from "effect";

import { ImportIntentExecutionGeneration } from "../../imports/import-intent-transition.js";
import { ImportId } from "../../imports/import.contracts.js";
import { HouseholdSystemAdmission } from "../rpc/command-envelope.js";
import { ImportWorkflowIdentity } from "../shared-kernel/workflow-identity.js";

const Sha256Hex = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-f\d]{64}$/u))
);

export const HouseholdWorkflowAdmissionMutationId = Sha256Hex.pipe(
  Schema.brand("HouseholdWorkflowAdmissionMutationId")
);
export type HouseholdWorkflowAdmissionMutationId =
  typeof HouseholdWorkflowAdmissionMutationId.Type;

export const HouseholdWorkflowAdmissionCommandDigest = Sha256Hex.pipe(
  Schema.brand("HouseholdWorkflowAdmissionCommandDigest")
);
export type HouseholdWorkflowAdmissionCommandDigest =
  typeof HouseholdWorkflowAdmissionCommandDigest.Type;

export const HouseholdDispatchId = Schema.String.pipe(
  Schema.check(
    Schema.isTrimmed(),
    Schema.isNonEmpty(),
    Schema.isMaxLength(128)
  ),
  Schema.brand("HouseholdDispatchId")
);
export type HouseholdDispatchId = typeof HouseholdDispatchId.Type;

export const HouseholdAdmitImportWorkflowInput = Schema.Struct({
  admission: HouseholdSystemAdmission,
  executionGeneration: ImportIntentExecutionGeneration,
  importId: ImportId,
  mutationId: HouseholdWorkflowAdmissionMutationId,
});
export type HouseholdAdmitImportWorkflowInput =
  typeof HouseholdAdmitImportWorkflowInput.Type;

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
 * Compact, privacy-safe input for the future Workflow dispatcher. The
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

export const HouseholdOutboxState = Schema.Literals(["pending", "exhausted"]);
export type HouseholdOutboxState = typeof HouseholdOutboxState.Type;

export const HouseholdImportWorkflowDispatchView = Schema.Struct({
  admission: HouseholdImportWorkflowAdmissionResult,
  attempts: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  exhaustedAtEpochMs: Schema.NullOr(
    Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))
  ),
  state: HouseholdOutboxState,
});
export type HouseholdImportWorkflowDispatchView =
  typeof HouseholdImportWorkflowDispatchView.Type;

export const HouseholdWorkflowAdmissionConflict = Schema.TaggedStruct(
  "HouseholdWorkflowAdmissionConflict",
  {}
);
export type HouseholdWorkflowAdmissionConflict =
  typeof HouseholdWorkflowAdmissionConflict.Type;

export const HouseholdWorkflowAdmissionPersistenceFailure = Schema.TaggedStruct(
  "HouseholdWorkflowAdmissionPersistenceFailure",
  {}
);
export type HouseholdWorkflowAdmissionPersistenceFailure =
  typeof HouseholdWorkflowAdmissionPersistenceFailure.Type;

export const HouseholdWorkflowAdmissionInvalidInput = Schema.TaggedStruct(
  "HouseholdWorkflowAdmissionInvalidInput",
  {}
);
export type HouseholdWorkflowAdmissionInvalidInput =
  typeof HouseholdWorkflowAdmissionInvalidInput.Type;
