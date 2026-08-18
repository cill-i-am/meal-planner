import { Effect, Schema } from "effect";
import { flow } from "effect/Function";

import { AcquisitionTaskOutcome } from "../imports/import-media.model.js";

export const PilotWorkflowInstanceStatus = Schema.Literals([
  "complete",
  "errored",
  "paused",
  "queued",
  "running",
  "terminated",
  "waiting",
  "waitingForPause",
]);
export type PilotWorkflowInstanceStatus =
  typeof PilotWorkflowInstanceStatus.Type;

const ProviderTaskCheckpoint = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("Failed"),
    code: Schema.String,
    stage: Schema.Literals(["recipe", "speech", "visual"]),
  }),
  Schema.Struct({
    _tag: Schema.Literal("Succeeded"),
    stage: Schema.Literals(["recipe", "speech", "visual"]),
  }),
]);

const PilotWorkflowOutput = Schema.Union([
  AcquisitionTaskOutcome,
  ProviderTaskCheckpoint,
  Schema.Struct({ _tag: Schema.Literal("NoAcquisitionRequired") }),
]);
type PilotWorkflowOutput = typeof PilotWorkflowOutput.Type;

const CurrentWorkflowInstanceResponse = Schema.Struct({
  output: Schema.optionalKey(
    Schema.NullOr(Schema.Union([Schema.String, Schema.Number]))
  ),
  status: PilotWorkflowInstanceStatus,
});

export interface PilotWorkflowOutputStatus {
  readonly code: string | null;
  readonly stage: string | null;
  readonly tag: PilotWorkflowOutput["_tag"];
}

export interface RecipeQualityPilotWorkflowStatus {
  readonly output: PilotWorkflowOutputStatus | null;
  readonly status: PilotWorkflowInstanceStatus;
}

export interface PilotWorkflowInspectionError {
  readonly _tag: "PilotWorkflowInspectionError";
  readonly code: "invalid_workflow_response";
}

const inspectionError = (): PilotWorkflowInspectionError => ({
  _tag: "PilotWorkflowInspectionError",
  code: "invalid_workflow_response",
});

const safeOutputStatus = (
  output: PilotWorkflowOutput
): PilotWorkflowOutputStatus => ({
  code: "code" in output ? output.code : null,
  stage: "stage" in output ? output.stage : null,
  tag: output._tag,
});

const decodeCompleteOutput = (output: string) =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(PilotWorkflowOutput), {
    onExcessProperty: "error",
  })(output).pipe(
    Effect.mapError(inspectionError),
    Effect.map(safeOutputStatus)
  );

const inspectRecipeQualityPilotWorkflowStatus = (
  instance: typeof CurrentWorkflowInstanceResponse.Type
): Effect.Effect<
  RecipeQualityPilotWorkflowStatus,
  PilotWorkflowInspectionError
> =>
  Effect.gen(function* decodeWorkflowStatus() {
    if (instance.status === "complete") {
      if (typeof instance.output !== "string") {
        return yield* Effect.fail(inspectionError());
      }
      return {
        output: yield* decodeCompleteOutput(instance.output),
        status: instance.status,
      };
    }
    if (instance.output !== undefined && instance.output !== null) {
      return yield* Effect.fail(inspectionError());
    }
    return {
      output: null,
      status: instance.status,
    };
  });

export const decodeRecipeQualityPilotWorkflowStatus = flow(
  Schema.decodeUnknownEffect(CurrentWorkflowInstanceResponse, {
    onExcessProperty: "ignore",
  }),
  Effect.mapError(inspectionError),
  Effect.flatMap(inspectRecipeQualityPilotWorkflowStatus)
);
