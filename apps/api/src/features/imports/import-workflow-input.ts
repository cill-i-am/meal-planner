import { Data, Effect, Schema } from "effect";

import { ImportIntentExecutionGeneration } from "./import-intent-transition.js";
import { ImportTraceContext } from "./import-observability.js";
import { ImportId } from "./import.contracts.js";

export const ImportWorkflowInput = Schema.Struct({
  executionGeneration: ImportIntentExecutionGeneration.pipe(
    Schema.check(Schema.isGreaterThanOrEqualTo(1))
  ),
  importId: ImportId,
  trace: ImportTraceContext,
});

export class InvalidImportWorkflowInput extends Data.TaggedError(
  "InvalidImportWorkflowInput"
) {}

export const decodeImportWorkflowInput = (rawInput: unknown) =>
  Schema.decodeUnknownEffect(ImportWorkflowInput, {
    onExcessProperty: "error",
  })(rawInput).pipe(Effect.mapError(() => new InvalidImportWorkflowInput()));
