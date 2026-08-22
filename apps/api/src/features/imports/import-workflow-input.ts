import { Data, Effect, Schema } from "effect";
import { flow } from "effect/Function";

import { HouseholdOrganizationId } from "../households/household.contract.js";
import { ImportIntentExecutionGeneration } from "./import-intent-transition.js";
import { ImportTraceContext } from "./import-observability.js";
import { ImportId } from "./import.contracts.js";

export const ImportWorkflowInput = Schema.Struct({
  executionGeneration: ImportIntentExecutionGeneration.pipe(
    Schema.check(Schema.isGreaterThanOrEqualTo(1))
  ),
  importId: ImportId,
  organizationId: HouseholdOrganizationId,
  trace: ImportTraceContext,
});
export type ImportWorkflowInput = typeof ImportWorkflowInput.Type;
export type ImportWorkflowInputEncoded = typeof ImportWorkflowInput.Encoded;

export class InvalidImportWorkflowInput extends Data.TaggedError(
  "InvalidImportWorkflowInput"
) {}

export const decodeImportWorkflowInput = flow(
  Schema.decodeUnknownEffect(ImportWorkflowInput, {
    onExcessProperty: "error",
  }),
  Effect.mapError(() => new InvalidImportWorkflowInput())
);
