import { Data, Effect, Schema } from "effect";
import { v5 as uuidv5 } from "uuid";

import {
  ImportCorrelationId,
  ImportTraceContext,
} from "./import-observability.js";
import { ImportId } from "./import.contracts.js";

export const ImportWorkflowInput = Schema.Struct({
  importId: ImportId,
  trace: ImportTraceContext,
});

export const PreparedVisualRecoveryWorkflowInput = Schema.Struct({
  importId: ImportId,
  resume: Schema.Literal("prepared_visual_recovery"),
  trace: ImportTraceContext,
});

export const LegacyImportWorkflowInput = Schema.Struct({
  importId: ImportId,
});

const LegacyCorrelatedImportWorkflowInput = Schema.Struct({
  correlationId: ImportCorrelationId,
  importId: ImportId,
});

const LegacyCorrelatedPreparedVisualRecoveryWorkflowInput = Schema.Struct({
  correlationId: ImportCorrelationId,
  importId: ImportId,
  resume: Schema.Literal("prepared_visual_recovery"),
});

const AcceptedImportWorkflowInput = Schema.Union([
  PreparedVisualRecoveryWorkflowInput,
  ImportWorkflowInput,
  LegacyCorrelatedPreparedVisualRecoveryWorkflowInput,
  LegacyCorrelatedImportWorkflowInput,
  LegacyImportWorkflowInput,
]);

export class InvalidImportWorkflowInput extends Data.TaggedError(
  "InvalidImportWorkflowInput"
) {}

export const decodeImportWorkflowInput = (rawInput: unknown) =>
  Schema.decodeUnknownEffect(AcceptedImportWorkflowInput, {
    onExcessProperty: "error",
  })(rawInput).pipe(Effect.mapError(() => new InvalidImportWorkflowInput()));

const LegacyCorrelationNamespace = "d7342998-b4f0-5df2-8f6f-8c6b3195d98a";

/**
 * Derive a replay-stable UUIDv5 from the already opaque import identity.
 *
 * Legacy workflow histories have no correlation checkpoint. A fresh random
 * UUID would therefore change when Cloudflare reconstructs the workflow during
 * a restart. The namespaced derivation needs no new historical step, contains
 * no source or provider data, and remains stable across reconstruction.
 */
export const makeLegacyImportCorrelationId = (importId: ImportId) =>
  Effect.sync(() =>
    Schema.decodeUnknownSync(ImportCorrelationId)(
      uuidv5(
        `meal-planner/import-workflow/${importId}`,
        LegacyCorrelationNamespace
      )
    )
  );

export const resolveImportWorkflowInput = (rawInput: unknown) =>
  Effect.gen(function* resolveInput() {
    const input = yield* decodeImportWorkflowInput(rawInput);
    if ("trace" in input) {
      return input;
    }
    const correlationId =
      "correlationId" in input
        ? input.correlationId
        : yield* makeLegacyImportCorrelationId(input.importId);
    return {
      importId: input.importId,
      ...("resume" in input ? { resume: input.resume } : {}),
      trace: { correlationId },
    };
  });
