import type { RecipeImportIntentId } from "@meal-planner/recipe-import-api";
import { Effect, Schema } from "effect";

import {
  HouseholdReadEvidenceStageResult,
  HouseholdReadImportTerminalCheckpointResult,
} from "../households/evidence/household-evidence.contract.js";
import type { HouseholdDomainWorkerMethods } from "../households/household-domain-worker.js";
import type { HouseholdSystemAdmission } from "../households/rpc/command-envelope.js";
import type { ImportIntentExecutionGeneration } from "./import-intent-transition.js";
import type { AcquisitionGeneration } from "./import-media.model.js";
import type { ProviderTaskFailureCheckpoint } from "./import-provider-workflow-checkpoint.js";
import { ImportId } from "./import.contracts.js";
import type { ImportTimestamp } from "./import.contracts.js";

export const isAmbiguousProviderTerminalFailure = (code: string) =>
  code === "outcome_unknown" ||
  code === "provider_unavailable" ||
  code === "retry_exhausted" ||
  code === "throttled" ||
  code === "timeout" ||
  code === "transcript_evidence_unknown";

interface AmbiguousProviderTerminalFailureInput {
  readonly completedAt: ImportTimestamp;
  readonly dispatchId: string;
  readonly failureCode: "outcome_unknown";
  readonly generation: AcquisitionGeneration;
  readonly importId: ImportId;
  readonly sourceMediaSha256: string;
}

export const persistHouseholdProviderTerminalAuthority = <Failure>(input: {
  readonly acquisitionGeneration: AcquisitionGeneration;
  readonly admission: HouseholdSystemAdmission;
  readonly failAmbiguous: (
    failure: AmbiguousProviderTerminalFailureInput
  ) => Effect.Effect<void, Failure>;
  readonly failure: ProviderTaskFailureCheckpoint;
  readonly executionGeneration: ImportIntentExecutionGeneration;
  readonly householdDomain: Pick<
    HouseholdDomainWorkerMethods,
    "readEvidenceStage" | "readImportTerminalCheckpoint"
  >;
  readonly intentId: RecipeImportIntentId;
  readonly now: () => ImportTimestamp;
}) =>
  Effect.gen(function* persistTerminalAuthority() {
    const terminalStage =
      input.failure.stage === "recipe" ? "extraction" : input.failure.stage;
    const readStage = () =>
      input.householdDomain
        .readEvidenceStage({
          admission: input.admission,
          expectedGeneration: input.executionGeneration,
          intentId: input.intentId,
          stage: terminalStage,
        })
        .pipe(
          Effect.flatMap(
            Schema.decodeUnknownEffect(HouseholdReadEvidenceStageResult, {
              onExcessProperty: "error",
            })
          )
        );
    let stage = yield* readStage();
    if (
      stage?.outcome === "Dispatching" &&
      (input.failure.stage === "speech" || input.failure.stage === "visual") &&
      isAmbiguousProviderTerminalFailure(input.failure.code)
    ) {
      yield* input.failAmbiguous({
        completedAt: input.now(),
        dispatchId: stage.dispatchId,
        failureCode: "outcome_unknown",
        generation: input.acquisitionGeneration,
        importId: Schema.decodeUnknownSync(ImportId)(input.intentId),
        sourceMediaSha256: stage.inputFingerprint,
      });
      stage = yield* readStage();
    }
    if (stage === null || stage.outcome !== "Failed") {
      return yield* Effect.die(
        "Expected household terminal evidence stage authority"
      );
    }
    const checkpoint = yield* input.householdDomain
      .readImportTerminalCheckpoint({
        admission: input.admission,
        expectedGeneration: input.executionGeneration,
        intentId: input.intentId,
        ownershipId: stage.dispatchId,
        stage: terminalStage,
      })
      .pipe(
        Effect.flatMap(
          Schema.decodeUnknownEffect(
            HouseholdReadImportTerminalCheckpointResult,
            { onExcessProperty: "error" }
          )
        )
      );
    const expectedFailureCode = isAmbiguousProviderTerminalFailure(
      input.failure.code
    )
      ? "outcome_unknown"
      : input.failure.code;
    if (
      checkpoint === null ||
      checkpoint.failureCode !== expectedFailureCode ||
      checkpoint.inputFingerprint !== stage.inputFingerprint
    ) {
      return yield* Effect.die(
        "Expected matching household terminal checkpoint authority"
      );
    }
    return checkpoint;
  });
