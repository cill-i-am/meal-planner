import { Context, Effect, Schema } from "effect";

import { HouseholdDispatchId } from "../households/foundation/import-workflow-admission.contract.js";
import { HouseholdOrganizationId } from "../households/household.contract.js";
import { ImportIntentExecutionGeneration } from "./import-intent-transition.js";
import { AcquisitionGeneration, Sha256Hex } from "./import-media.model.js";
import {
  hasHouseholdProviderRecoveryProgress,
  prepareHouseholdProviderRecovery,
  prepareHouseholdRecipeRecovery,
  readHouseholdRecipeRecovery,
  resolveHouseholdRecoveryAuthority,
} from "./import-recipe-recovery.household.js";
import type { RecipeRecoveryPreparationHouseholdAuthority } from "./import-recipe-recovery.household.js";
import { RecipeRecoveryOrdinal } from "./import-recipe-recovery.js";
import type { RecipeRecoveryWorkflowStarter } from "./import-recipe-recovery.js";
import { ImportId } from "./import.contracts.js";
import type { ImportWorkflowStarter } from "./import.workflow.js";

const recoveryRequest = {
  acquisitionGeneration: AcquisitionGeneration,
  dispatchId: HouseholdDispatchId,
  executionGeneration: ImportIntentExecutionGeneration,
  importId: ImportId,
  organizationId: HouseholdOrganizationId,
};
export const ProviderRecoveryRequest = Schema.Union([
  Schema.Struct({
    ...recoveryRequest,
    operation: Schema.Literal("prepare_speech_recovery"),
  }),
  Schema.Struct({
    ...recoveryRequest,
    operation: Schema.Literal("prepare_visual_recovery"),
  }),
  Schema.Struct({
    ...recoveryRequest,
    operation: Schema.Literal("prepare_recipe_recovery"),
  }),
  Schema.Struct({
    ...recoveryRequest,
    operation: Schema.Literal("resume_recipe_recovery"),
  }),
]);
export type ProviderRecoveryRequest = typeof ProviderRecoveryRequest.Type;

const baseResponse = {
  acquisitionGeneration: AcquisitionGeneration,
  dispatchId: HouseholdDispatchId,
  importId: ImportId,
  recoveryDispatchId: HouseholdDispatchId,
};
export const ProviderRecoveryResponse = Schema.Union([
  Schema.Struct({
    ...baseResponse,
    outcome: Schema.Literals([
      "speech_recovery_activated",
      "visual_recovery_activated",
    ]),
  }),
  Schema.Struct({
    ...baseResponse,
    outcome: Schema.Literals([
      "recipe_recovery_prepared",
      "recipe_recovery_resumed",
    ]),
    recoveryExtractionFingerprint: Sha256Hex,
    recoveryOrdinal: RecipeRecoveryOrdinal,
  }),
]);
export type ProviderRecoveryResponse = typeof ProviderRecoveryResponse.Type;

export type ProviderRecoveryErrorCode =
  | "not_allowed"
  | "persistence_corrupt"
  | "persistence_unavailable";
export interface ProviderRecoveryError {
  readonly _tag: "ProviderRecoveryError";
  readonly code: ProviderRecoveryErrorCode;
}
const failure = (code: ProviderRecoveryErrorCode): ProviderRecoveryError => ({
  _tag: "ProviderRecoveryError",
  code,
});
const mapHouseholdError = (error: {
  readonly _tag: "ImportPersistenceUnavailable" | "ImportTransitionRejected";
}) =>
  failure(
    error._tag === "ImportPersistenceUnavailable"
      ? "persistence_unavailable"
      : "not_allowed"
  );

export interface ProviderRecoveryService {
  readonly recover: (
    input: ProviderRecoveryRequest
  ) => Effect.Effect<ProviderRecoveryResponse, ProviderRecoveryError>;
}
export const ProviderRecoveryService = Context.Service<ProviderRecoveryService>(
  "meal-planner/ProviderRecoveryService"
);

interface ProviderRecoveryServiceInput {
  readonly householdDomain: RecipeRecoveryPreparationHouseholdAuthority;
  readonly recipeRecoveryStarter: RecipeRecoveryWorkflowStarter;
  readonly workflowStarter: Pick<
    ImportWorkflowStarter,
    "restartFromSpeech" | "restartFromVisual"
  >;
}

const prepareProviderRecovery = (
  service: ProviderRecoveryServiceInput,
  request: Extract<
    ProviderRecoveryRequest,
    {
      readonly operation: "prepare_speech_recovery" | "prepare_visual_recovery";
    }
  >,
  stage: "speech" | "visual"
) =>
  Effect.gen(function* prepareHouseholdOwnedProviderRecovery() {
    const recovery = yield* prepareHouseholdProviderRecovery({
      acquisitionGeneration: request.acquisitionGeneration,
      executionGeneration: request.executionGeneration,
      householdDomain: service.householdDomain,
      importId: request.importId,
      organizationId: request.organizationId,
      originalDispatchId: request.dispatchId,
      stage,
    }).pipe(Effect.mapError(mapHouseholdError));
    if (recovery.requiresWorkflowActivation) {
      const restart =
        stage === "speech"
          ? service.workflowStarter.restartFromSpeech
          : service.workflowStarter.restartFromVisual;
      if (restart === undefined) {
        return yield* Effect.fail(failure("persistence_unavailable"));
      }
      const restartOutcome = yield* restart(recovery.workflowIdentity).pipe(
        Effect.catchCause(() => Effect.succeed("RestartAmbiguous" as const))
      );
      if (restartOutcome === "RestartAmbiguous") {
        const hasProgress = yield* hasHouseholdProviderRecoveryProgress({
          acquisitionGeneration: request.acquisitionGeneration,
          executionGeneration: request.executionGeneration,
          householdDomain: service.householdDomain,
          importId: request.importId,
          inputFingerprint: recovery.inputFingerprint,
          organizationId: request.organizationId,
          recoveryDispatchId: recovery.recoveryDispatchId,
          stage,
        }).pipe(Effect.mapError(mapHouseholdError));
        if (!hasProgress) {
          return yield* Effect.fail(failure("persistence_unavailable"));
        }
      }
    }
    return yield* Schema.decodeUnknownEffect(ProviderRecoveryResponse)({
      acquisitionGeneration: recovery.acquisitionGeneration,
      dispatchId: recovery.originalDispatchId,
      importId: recovery.importId,
      outcome:
        stage === "speech"
          ? "speech_recovery_activated"
          : "visual_recovery_activated",
      recoveryDispatchId: recovery.recoveryDispatchId,
    }).pipe(Effect.mapError(() => failure("persistence_corrupt")));
  });

export const makeProviderRecoveryService = (
  input: ProviderRecoveryServiceInput
): ProviderRecoveryService => ({
  recover: Effect.fn("ProviderRecoveryService.recover")(
    function* recoverFromHouseholdTerminal(request) {
      if (request.operation === "prepare_speech_recovery") {
        return yield* prepareProviderRecovery(input, request, "speech");
      }
      if (request.operation === "prepare_visual_recovery") {
        return yield* prepareProviderRecovery(input, request, "visual");
      }
      if (request.operation === "prepare_recipe_recovery") {
        const recovery = yield* prepareHouseholdRecipeRecovery({
          acquisitionGeneration: request.acquisitionGeneration,
          executionGeneration: request.executionGeneration,
          householdDomain: input.householdDomain,
          importId: request.importId,
          organizationId: request.organizationId,
          predecessorDispatchId: request.dispatchId,
        }).pipe(Effect.mapError(mapHouseholdError));
        const authority = yield* resolveHouseholdRecoveryAuthority({
          acquisitionGeneration: request.acquisitionGeneration,
          executionGeneration: request.executionGeneration,
          householdDomain: input.householdDomain,
          importId: request.importId,
          organizationId: request.organizationId,
        }).pipe(Effect.mapError(mapHouseholdError));
        yield* input.recipeRecoveryStarter
          .start(
            recovery.attempt,
            authority.originalTrace,
            request.organizationId,
            recovery.outcome
          )
          .pipe(Effect.mapError(() => failure("persistence_unavailable")));
        return yield* Schema.decodeUnknownEffect(ProviderRecoveryResponse)({
          acquisitionGeneration: recovery.attempt.acquisitionGeneration,
          dispatchId: recovery.attempt.predecessorDispatchId,
          importId: recovery.attempt.importId,
          outcome: "recipe_recovery_prepared",
          recoveryDispatchId: recovery.attempt.currentDispatchId,
          recoveryExtractionFingerprint:
            recovery.attempt.currentExtractionFingerprint,
          recoveryOrdinal: recovery.attempt.ordinal,
        }).pipe(Effect.mapError(() => failure("persistence_corrupt")));
      }
      const recovery = yield* readHouseholdRecipeRecovery({
        acquisitionGeneration: request.acquisitionGeneration,
        executionGeneration: request.executionGeneration,
        householdDomain: input.householdDomain,
        importId: request.importId,
        organizationId: request.organizationId,
        selector: { _tag: "Latest", rootDispatchId: request.dispatchId },
      }).pipe(Effect.mapError(mapHouseholdError));
      if (recovery === null) {
        return yield* Effect.fail(failure("not_allowed"));
      }
      const authority = yield* resolveHouseholdRecoveryAuthority({
        acquisitionGeneration: request.acquisitionGeneration,
        executionGeneration: request.executionGeneration,
        householdDomain: input.householdDomain,
        importId: request.importId,
        organizationId: request.organizationId,
      }).pipe(Effect.mapError(mapHouseholdError));
      yield* input.recipeRecoveryStarter
        .start(
          recovery,
          authority.originalTrace,
          request.organizationId,
          "Replay"
        )
        .pipe(Effect.mapError(() => failure("persistence_unavailable")));
      return yield* Schema.decodeUnknownEffect(ProviderRecoveryResponse)({
        acquisitionGeneration: recovery.acquisitionGeneration,
        dispatchId: recovery.rootDispatchId,
        importId: recovery.importId,
        outcome: "recipe_recovery_resumed",
        recoveryDispatchId: recovery.currentDispatchId,
        recoveryExtractionFingerprint: recovery.currentExtractionFingerprint,
        recoveryOrdinal: recovery.ordinal,
      }).pipe(Effect.mapError(() => failure("persistence_corrupt")));
    }
  ),
});
