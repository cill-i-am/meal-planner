import type {
  CancelledRecipeImportIntent,
  Recipe,
  RecipeImportAction,
  RecipeImportIntent,
  RecipeImportTimeline,
  SucceededRecipeImportIntent,
} from "@meal-planner/recipe-import-api";
import { RuntimeContext } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect, Schema } from "effect";

import type { MealPlanServiceError } from "../meal-planning/meal-plan.js";
import type {
  HouseholdCommitAcquisitionEvidenceInput,
  HouseholdReadEvidenceStageInput,
  HouseholdReadEvidenceReferencesInput,
  HouseholdReadImportTerminalCheckpointInput,
  HouseholdCommitAcquisitionEvidenceResult,
  HouseholdMutateEvidenceStageResult,
  HouseholdObserveEvidenceReferenceResult,
  HouseholdReadEvidenceReferencesResult,
  HouseholdReadEvidenceStageResult,
  HouseholdReadImportTerminalCheckpointResult,
  HouseholdPrepareRecipeRecoveryResult,
  HouseholdReadRecipeRecoveryAttemptInput,
  HouseholdReadRecipeRecoveryAttemptResult,
} from "./evidence/household-evidence.contract.js";
import {
  HouseholdCommitAcquisitionEvidenceInput as HouseholdCommitAcquisitionEvidenceInputSchema,
  HouseholdMutateEvidenceStageInput as HouseholdMutateEvidenceStageInputSchema,
  HouseholdObserveEvidenceReferenceInput as HouseholdObserveEvidenceReferenceInputSchema,
  HouseholdReadEvidenceReferencesInput as HouseholdReadEvidenceReferencesInputSchema,
  HouseholdReadEvidenceStageInput as HouseholdReadEvidenceStageInputSchema,
  HouseholdReadImportTerminalCheckpointInput as HouseholdReadImportTerminalCheckpointInputSchema,
  HouseholdPrepareRecipeRecoveryInput as HouseholdPrepareRecipeRecoveryInputSchema,
  HouseholdReadRecipeRecoveryAttemptInput as HouseholdReadRecipeRecoveryAttemptInputSchema,
} from "./evidence/household-evidence.contract.js";
import { routeAdmittedHouseholdCommand } from "./household-command-router.js";
import { HouseholdDomainWorker } from "./household-domain-binding.js";
import type {
  HouseholdCreateMealPlanFromRecipeBankInput,
  HouseholdCreateMealPlanInput,
  HouseholdDecideMealPlanInput,
  HouseholdMealPlanWire,
  HouseholdReadMealPlanInput,
  HouseholdSwapMealPlanInput,
  HouseholdSwapMealPlanFromRecipeBankInput,
} from "./household-meal-plan.contract.js";
import {
  HouseholdCreateMealPlanFromRecipeBankInput as HouseholdCreateMealPlanFromRecipeBankInputSchema,
  HouseholdCreateMealPlanInput as HouseholdCreateMealPlanInputSchema,
  HouseholdDecideMealPlanInput as HouseholdDecideMealPlanInputSchema,
  HouseholdReadMealPlanInput as HouseholdReadMealPlanInputSchema,
  HouseholdSwapMealPlanInput as HouseholdSwapMealPlanInputSchema,
  HouseholdSwapMealPlanFromRecipeBankInput as HouseholdSwapMealPlanFromRecipeBankInputSchema,
} from "./household-meal-plan.contract.js";
import { HouseholdObjectLocator } from "./household-object-locator.js";
import HouseholdObject from "./household-object.js";
import type {
  HouseholdDomainFailure,
  HouseholdEnsureInput,
  HouseholdMetadata,
} from "./household.contract.js";
import {
  HouseholdInvalidInput,
  HouseholdEnsureInput as HouseholdEnsureInputSchema,
} from "./household.contract.js";
import type {
  HouseholdAdmitRecipeImportInput,
  HouseholdAnswerRecipeImportActionInput,
  HouseholdCancelRecipeImportInput,
  HouseholdCommitRecipeImportDraftInput,
  HouseholdConfirmRecipeImportActionInput,
  HouseholdReadRecipeImportExecutionInput,
  HouseholdRecordRecipeImportDispatchInput,
  HouseholdRecipeImportFailure,
  HouseholdResolveRecipeImportSourceInput,
  HouseholdTransitionRecipeImportLifecycleInput,
  HouseholdAdmitRecipeImportResult as HouseholdAdmitRecipeImportResultSchema,
  HouseholdActiveRecipeImportActionResult as HouseholdActiveRecipeImportActionResultSchema,
  HouseholdRecordRecipeImportDispatchResult,
  HouseholdRecipeImportExecutionView,
  HouseholdRecipePage,
} from "./recipe-import/household-recipe-import.contract.js";
import {
  HouseholdAdmitRecipeImportInput as HouseholdAdmitRecipeImportInputSchema,
  HouseholdAnswerRecipeImportActionInput as HouseholdAnswerRecipeImportActionInputSchema,
  HouseholdCancelRecipeImportInput as HouseholdCancelRecipeImportInputSchema,
  HouseholdCommitRecipeImportDraftInput as HouseholdCommitRecipeImportDraftInputSchema,
  HouseholdConfirmRecipeImportActionInput as HouseholdConfirmRecipeImportActionInputSchema,
  HouseholdReadRecipeImportActionInput as HouseholdReadRecipeImportActionInputSchema,
  HouseholdReadRecipeImportInput as HouseholdReadRecipeImportInputSchema,
  HouseholdReadRecipeImportExecutionInput as HouseholdReadRecipeImportExecutionInputSchema,
  HouseholdReadRecipeInput as HouseholdReadRecipeInputSchema,
  HouseholdRecordRecipeImportDispatchInput as HouseholdRecordRecipeImportDispatchInputSchema,
  HouseholdRecipePageInput as HouseholdRecipePageInputSchema,
  HouseholdResolveRecipeImportSourceInput as HouseholdResolveRecipeImportSourceInputSchema,
  HouseholdTransitionRecipeImportLifecycleInput as HouseholdTransitionRecipeImportLifecycleInputSchema,
} from "./recipe-import/household-recipe-import.contract.js";
import { requireHouseholdCommandAdmission } from "./rpc/command-envelope.js";
import type {
  HouseholdCommandAdmission,
  HouseholdCommandPurpose,
} from "./rpc/command-envelope.js";
import { HouseholdAuthorityServicesLive } from "./shared-kernel/authority-services.live.js";

export { HouseholdDomainWorker } from "./household-domain-binding.js";

export interface HouseholdDomainWorkerMethods {
  readonly admitRecipeImport: (
    input: HouseholdAdmitRecipeImportInput
  ) => Effect.Effect<
    typeof HouseholdAdmitRecipeImportResultSchema.Encoded,
    HouseholdRecipeImportDomainFailure
  >;
  readonly answerRecipeImportAction: (
    input: HouseholdAnswerRecipeImportActionInput
  ) => Effect.Effect<
    typeof RecipeImportIntent.Encoded,
    HouseholdRecipeImportDomainFailure
  >;
  readonly approveMealPlan: (
    input: HouseholdDecideMealPlanInput
  ) => Effect.Effect<HouseholdMealPlanWire, HouseholdMealPlanDomainFailure>;
  readonly createMealPlan: (
    input: HouseholdCreateMealPlanInput
  ) => Effect.Effect<HouseholdMealPlanWire, HouseholdMealPlanDomainFailure>;
  readonly createMealPlanFromRecipeBank: (
    input: HouseholdCreateMealPlanFromRecipeBankInput
  ) => Effect.Effect<
    HouseholdMealPlanWire,
    HouseholdMealPlanDomainFailure | HouseholdRecipeImportFailure
  >;
  readonly cancelRecipeImport: (
    input: HouseholdCancelRecipeImportInput
  ) => Effect.Effect<
    typeof CancelledRecipeImportIntent.Encoded,
    HouseholdRecipeImportDomainFailure
  >;
  readonly commitAcquisitionEvidence: (
    input: HouseholdCommitAcquisitionEvidenceInput
  ) => Effect.Effect<
    typeof HouseholdCommitAcquisitionEvidenceResult.Encoded,
    HouseholdRecipeImportDomainFailure
  >;
  readonly mutateEvidenceStage: (
    input: typeof HouseholdMutateEvidenceStageInputSchema.Encoded
  ) => Effect.Effect<
    typeof HouseholdMutateEvidenceStageResult.Encoded,
    HouseholdRecipeImportDomainFailure
  >;
  readonly observeEvidenceReference: (
    input: typeof HouseholdObserveEvidenceReferenceInputSchema.Encoded
  ) => Effect.Effect<
    typeof HouseholdObserveEvidenceReferenceResult.Encoded,
    HouseholdRecipeImportDomainFailure
  >;
  readonly prepareRecipeRecovery: (
    input: typeof HouseholdPrepareRecipeRecoveryInputSchema.Encoded
  ) => Effect.Effect<
    typeof HouseholdPrepareRecipeRecoveryResult.Encoded,
    HouseholdRecipeImportDomainFailure
  >;
  readonly commitRecipeImportDraft: (
    input: HouseholdCommitRecipeImportDraftInput
  ) => Effect.Effect<
    typeof HouseholdActiveRecipeImportActionResultSchema.Encoded,
    HouseholdRecipeImportDomainFailure
  >;
  readonly confirmRecipeImportAction: (
    input: HouseholdConfirmRecipeImportActionInput
  ) => Effect.Effect<
    typeof SucceededRecipeImportIntent.Encoded,
    HouseholdRecipeImportDomainFailure
  >;
  readonly ensureHousehold: (
    input: HouseholdEnsureInput
  ) => Effect.Effect<HouseholdMetadata, HouseholdDomainFailure>;
  readonly readMealPlan: (
    input: HouseholdReadMealPlanInput
  ) => Effect.Effect<
    HouseholdMealPlanWire | null,
    HouseholdMealPlanDomainFailure
  >;
  readonly readEvidenceReferences: (
    input: HouseholdReadEvidenceReferencesInput
  ) => Effect.Effect<
    typeof HouseholdReadEvidenceReferencesResult.Encoded,
    HouseholdRecipeImportDomainFailure
  >;
  readonly readEvidenceStage: (
    input: HouseholdReadEvidenceStageInput
  ) => Effect.Effect<
    typeof HouseholdReadEvidenceStageResult.Encoded,
    HouseholdRecipeImportDomainFailure
  >;
  readonly readImportTerminalCheckpoint: (
    input: HouseholdReadImportTerminalCheckpointInput
  ) => Effect.Effect<
    typeof HouseholdReadImportTerminalCheckpointResult.Encoded,
    HouseholdRecipeImportDomainFailure
  >;
  readonly readRecipeRecoveryAttempt: (
    input: HouseholdReadRecipeRecoveryAttemptInput
  ) => Effect.Effect<
    typeof HouseholdReadRecipeRecoveryAttemptResult.Encoded,
    HouseholdRecipeImportDomainFailure
  >;
  readonly readRecipe: (
    input: typeof HouseholdReadRecipeInputSchema.Type
  ) => Effect.Effect<typeof Recipe.Encoded, HouseholdRecipeImportDomainFailure>;
  readonly readRecipeImport: (
    input: typeof HouseholdReadRecipeImportInputSchema.Type
  ) => Effect.Effect<
    typeof RecipeImportIntent.Encoded,
    HouseholdRecipeImportDomainFailure
  >;
  readonly readRecipeImportExecution: (
    input: HouseholdReadRecipeImportExecutionInput
  ) => Effect.Effect<
    typeof HouseholdRecipeImportExecutionView.Encoded,
    HouseholdRecipeImportDomainFailure
  >;
  readonly readRecipeImportAction: (
    input: typeof HouseholdReadRecipeImportActionInputSchema.Type
  ) => Effect.Effect<
    typeof RecipeImportAction.Encoded,
    HouseholdRecipeImportDomainFailure
  >;
  readonly readRecipeImportTimeline: (
    input: typeof HouseholdReadRecipeImportInputSchema.Type
  ) => Effect.Effect<
    typeof RecipeImportTimeline.Encoded,
    HouseholdRecipeImportDomainFailure
  >;
  readonly recordRecipeImportDispatch: (
    input: HouseholdRecordRecipeImportDispatchInput
  ) => Effect.Effect<
    typeof HouseholdRecordRecipeImportDispatchResult.Encoded,
    HouseholdRecipeImportDomainFailure
  >;
  readonly listRecipeBank: (
    input: typeof HouseholdRecipePageInputSchema.Type
  ) => Effect.Effect<
    typeof HouseholdRecipePage.Encoded,
    HouseholdRecipeImportDomainFailure
  >;
  readonly rejectMealPlan: (
    input: HouseholdDecideMealPlanInput
  ) => Effect.Effect<HouseholdMealPlanWire, HouseholdMealPlanDomainFailure>;
  readonly swapMealPlan: (
    input: HouseholdSwapMealPlanInput
  ) => Effect.Effect<HouseholdMealPlanWire, HouseholdMealPlanDomainFailure>;
  readonly swapMealPlanFromRecipeBank: (
    input: HouseholdSwapMealPlanFromRecipeBankInput
  ) => Effect.Effect<
    HouseholdMealPlanWire,
    HouseholdMealPlanDomainFailure | HouseholdRecipeImportFailure
  >;
  readonly resolveRecipeImportSource: (
    input: HouseholdResolveRecipeImportSourceInput
  ) => Effect.Effect<
    typeof RecipeImportIntent.Encoded,
    HouseholdRecipeImportDomainFailure
  >;
  readonly transitionRecipeImportLifecycle: (
    input: HouseholdTransitionRecipeImportLifecycleInput
  ) => Effect.Effect<
    typeof RecipeImportIntent.Encoded,
    HouseholdRecipeImportDomainFailure
  >;
}

export type HouseholdMealPlanDomainFailure =
  | HouseholdDomainFailure
  | MealPlanServiceError;
export type HouseholdRecipeImportDomainFailure =
  | HouseholdDomainFailure
  | HouseholdRecipeImportFailure;

/** Private RPC boundary for organization-scoped household state. */
const HouseholdDomainWorkerRuntime = Effect.gen(function* makeDomainWorker() {
  const households = yield* HouseholdObject;
  const locator = yield* HouseholdObjectLocator;
  const runtimeContext = yield* Cloudflare.Worker;
  const locate = (
    organizationId: HouseholdCommandAdmission["organizationId"]
  ) =>
    locator
      .locate(organizationId)
      .pipe(Effect.mapError(() => HouseholdInvalidInput.make({})));
  const route = <
    A extends { readonly admission: HouseholdCommandAdmission },
    I,
    B,
    E,
  >(
    schema: Schema.Codec<A, I, never>,
    input: A,
    purpose: HouseholdCommandPurpose,
    invoke: (
      household: ReturnType<typeof households.getByName>,
      command: A
    ) => Effect.Effect<B, E, RuntimeContext>
  ) =>
    Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })(
      input
    ).pipe(
      Effect.mapError(() => HouseholdInvalidInput.make({})),
      Effect.flatMap((command) =>
        routeAdmittedHouseholdCommand({
          admission: command.admission,
          getByName: households.getByName,
          invoke: (household) => invoke(household, command),
          locate,
          purpose,
        }).pipe(Effect.provideService(RuntimeContext, runtimeContext))
      )
    );
  const routeAcquisitionEvidence = (
    input: HouseholdCommitAcquisitionEvidenceInput
  ) =>
    Schema.decodeUnknownEffect(HouseholdCommitAcquisitionEvidenceInputSchema, {
      onExcessProperty: "error",
    })(input).pipe(
      Effect.mapError(() => HouseholdInvalidInput.make({})),
      Effect.flatMap((command) =>
        requireHouseholdCommandAdmission(
          command.admission,
          "commit_acquisition_evidence"
        ).pipe(
          Effect.mapError(() => HouseholdInvalidInput.make({})),
          Effect.andThen(
            Schema.encodeEffect(HouseholdCommitAcquisitionEvidenceInputSchema)(
              command
            )
          ),
          Effect.mapError(() => HouseholdInvalidInput.make({})),
          Effect.flatMap((encodedCommand) =>
            routeAdmittedHouseholdCommand({
              admission: command.admission,
              getByName: households.getByName,
              invoke: (household) =>
                household.commitAcquisitionEvidence(encodedCommand),
              locate,
              purpose: "commit_acquisition_evidence",
            }).pipe(Effect.provideService(RuntimeContext, runtimeContext))
          )
        )
      )
    );
  const routeEvidenceObservation = (
    input: typeof HouseholdObserveEvidenceReferenceInputSchema.Encoded
  ) =>
    Schema.decodeUnknownEffect(HouseholdObserveEvidenceReferenceInputSchema, {
      onExcessProperty: "error",
    })(input).pipe(
      Effect.mapError(() => HouseholdInvalidInput.make({})),
      Effect.flatMap((command) =>
        requireHouseholdCommandAdmission(
          command.admission,
          "observe_evidence_reference"
        ).pipe(
          Effect.mapError(() => HouseholdInvalidInput.make({})),
          Effect.andThen(
            Schema.encodeEffect(HouseholdObserveEvidenceReferenceInputSchema)(
              command
            )
          ),
          Effect.mapError(() => HouseholdInvalidInput.make({})),
          Effect.flatMap((encodedCommand) =>
            routeAdmittedHouseholdCommand({
              admission: command.admission,
              getByName: households.getByName,
              invoke: (household) =>
                household.observeEvidenceReference(encodedCommand),
              locate,
              purpose: "observe_evidence_reference",
            }).pipe(Effect.provideService(RuntimeContext, runtimeContext))
          )
        )
      )
    );
  const routeEvidenceStage = (
    input: typeof HouseholdMutateEvidenceStageInputSchema.Encoded
  ) =>
    Schema.decodeUnknownEffect(HouseholdMutateEvidenceStageInputSchema, {
      onExcessProperty: "error",
    })(input).pipe(
      Effect.mapError(() => HouseholdInvalidInput.make({})),
      Effect.flatMap((command) =>
        requireHouseholdCommandAdmission(
          command.admission,
          "mutate_evidence_stage"
        ).pipe(
          Effect.mapError(() => HouseholdInvalidInput.make({})),
          Effect.andThen(
            Schema.encodeEffect(HouseholdMutateEvidenceStageInputSchema)(
              command
            )
          ),
          Effect.mapError(() => HouseholdInvalidInput.make({})),
          Effect.flatMap((encodedCommand) =>
            routeAdmittedHouseholdCommand({
              admission: command.admission,
              getByName: households.getByName,
              invoke: (household) =>
                household.mutateEvidenceStage(encodedCommand),
              locate,
              purpose: "mutate_evidence_stage",
            }).pipe(Effect.provideService(RuntimeContext, runtimeContext))
          )
        )
      )
    );
  const routeRecipeRecovery = (
    input: typeof HouseholdPrepareRecipeRecoveryInputSchema.Encoded
  ) =>
    Schema.decodeUnknownEffect(HouseholdPrepareRecipeRecoveryInputSchema, {
      onExcessProperty: "error",
    })(input).pipe(
      Effect.mapError(() => HouseholdInvalidInput.make({})),
      Effect.flatMap((command) =>
        requireHouseholdCommandAdmission(
          command.admission,
          "prepare_recipe_recovery"
        ).pipe(
          Effect.mapError(() => HouseholdInvalidInput.make({})),
          Effect.andThen(
            Schema.encodeEffect(HouseholdPrepareRecipeRecoveryInputSchema)(
              command
            )
          ),
          Effect.mapError(() => HouseholdInvalidInput.make({})),
          Effect.flatMap((encodedCommand) =>
            routeAdmittedHouseholdCommand({
              admission: command.admission,
              getByName: households.getByName,
              invoke: (household) =>
                household.prepareRecipeRecovery(encodedCommand),
              locate,
              purpose: "prepare_recipe_recovery",
            }).pipe(Effect.provideService(RuntimeContext, runtimeContext))
          )
        )
      )
    );
  return {
    admitRecipeImport: (input: HouseholdAdmitRecipeImportInput) =>
      route(
        HouseholdAdmitRecipeImportInputSchema,
        input,
        "admit_recipe_import",
        (household, command) => household.admitRecipeImport(command)
      ),
    answerRecipeImportAction: (input: HouseholdAnswerRecipeImportActionInput) =>
      route(
        HouseholdAnswerRecipeImportActionInputSchema,
        input,
        "answer_recipe_import_action",
        (household, command) => household.answerRecipeImportAction(command)
      ),
    approveMealPlan: (input: HouseholdDecideMealPlanInput) =>
      route(
        HouseholdDecideMealPlanInputSchema,
        input,
        "approve_meal_plan",
        (household, command) => household.approveMealPlan(command)
      ),
    cancelRecipeImport: (input: HouseholdCancelRecipeImportInput) =>
      route(
        HouseholdCancelRecipeImportInputSchema,
        input,
        "cancel_recipe_import",
        (household, command) => household.cancelRecipeImport(command)
      ),
    commitAcquisitionEvidence: (
      input: HouseholdCommitAcquisitionEvidenceInput
    ) => routeAcquisitionEvidence(input),
    commitRecipeImportDraft: (input: HouseholdCommitRecipeImportDraftInput) =>
      route(
        HouseholdCommitRecipeImportDraftInputSchema,
        input,
        "commit_recipe_import_draft",
        (household, command) => household.commitRecipeImportDraft(command)
      ),
    confirmRecipeImportAction: (
      input: HouseholdConfirmRecipeImportActionInput
    ) =>
      route(
        HouseholdConfirmRecipeImportActionInputSchema,
        input,
        "confirm_recipe_import_action",
        (household, command) => household.confirmRecipeImportAction(command)
      ),
    createMealPlan: (input: HouseholdCreateMealPlanInput) =>
      route(
        HouseholdCreateMealPlanInputSchema,
        input,
        "create_meal_plan",
        (household, command) => household.createMealPlan(command)
      ),
    createMealPlanFromRecipeBank: (
      input: HouseholdCreateMealPlanFromRecipeBankInput
    ) =>
      route(
        HouseholdCreateMealPlanFromRecipeBankInputSchema,
        input,
        "create_meal_plan_from_recipe_bank",
        (household, command) => household.createMealPlanFromRecipeBank(command)
      ),
    ensureHousehold: (input: HouseholdEnsureInput) =>
      route(
        HouseholdEnsureInputSchema,
        input,
        "ensure_household",
        (household, command) => household.ensureHousehold(command)
      ),
    listRecipeBank: (input: typeof HouseholdRecipePageInputSchema.Type) =>
      route(
        HouseholdRecipePageInputSchema,
        input,
        "list_recipe_bank",
        (household, command) => household.listRecipeBank(command)
      ),
    mutateEvidenceStage: (
      input: typeof HouseholdMutateEvidenceStageInputSchema.Encoded
    ) => routeEvidenceStage(input),
    observeEvidenceReference: (
      input: typeof HouseholdObserveEvidenceReferenceInputSchema.Encoded
    ) => routeEvidenceObservation(input),
    prepareRecipeRecovery: (
      input: typeof HouseholdPrepareRecipeRecoveryInputSchema.Encoded
    ) => routeRecipeRecovery(input),
    readEvidenceReferences: (input: HouseholdReadEvidenceReferencesInput) =>
      route(
        HouseholdReadEvidenceReferencesInputSchema,
        input,
        "read_evidence_references",
        (household, command) => household.readEvidenceReferences(command)
      ),
    readEvidenceStage: (input: HouseholdReadEvidenceStageInput) =>
      route(
        HouseholdReadEvidenceStageInputSchema,
        input,
        "read_evidence_stage",
        (household, command) => household.readEvidenceStage(command)
      ),
    readImportTerminalCheckpoint: (
      input: HouseholdReadImportTerminalCheckpointInput
    ) =>
      route(
        HouseholdReadImportTerminalCheckpointInputSchema,
        input,
        "read_import_terminal_checkpoint",
        (household, command) => household.readImportTerminalCheckpoint(command)
      ),
    readMealPlan: (input: HouseholdReadMealPlanInput) =>
      route(
        HouseholdReadMealPlanInputSchema,
        input,
        "read_meal_plan",
        (household, command) => household.readMealPlan(command)
      ),
    readRecipe: (input: typeof HouseholdReadRecipeInputSchema.Type) =>
      route(
        HouseholdReadRecipeInputSchema,
        input,
        "read_recipe",
        (household, command) => household.readRecipe(command)
      ),
    readRecipeImport: (
      input: typeof HouseholdReadRecipeImportInputSchema.Type
    ) =>
      route(
        HouseholdReadRecipeImportInputSchema,
        input,
        "read_recipe_import",
        (household, command) => household.readRecipeImport(command)
      ),
    readRecipeImportAction: (
      input: typeof HouseholdReadRecipeImportActionInputSchema.Type
    ) =>
      route(
        HouseholdReadRecipeImportActionInputSchema,
        input,
        "read_recipe_import_action",
        (household, command) => household.readRecipeImportAction(command)
      ),
    readRecipeImportExecution: (
      input: HouseholdReadRecipeImportExecutionInput
    ) =>
      route(
        HouseholdReadRecipeImportExecutionInputSchema,
        input,
        "read_recipe_import_execution",
        (household, command) => household.readRecipeImportExecution(command)
      ),
    readRecipeImportTimeline: (
      input: typeof HouseholdReadRecipeImportInputSchema.Type
    ) =>
      route(
        HouseholdReadRecipeImportInputSchema,
        input,
        "read_recipe_import_timeline",
        (household, command) => household.readRecipeImportTimeline(command)
      ),
    readRecipeRecoveryAttempt: (
      input: HouseholdReadRecipeRecoveryAttemptInput
    ) =>
      route(
        HouseholdReadRecipeRecoveryAttemptInputSchema,
        input,
        "read_recipe_recovery_attempt",
        (household, command) => household.readRecipeRecoveryAttempt(command)
      ),
    recordRecipeImportDispatch: (
      input: HouseholdRecordRecipeImportDispatchInput
    ) =>
      route(
        HouseholdRecordRecipeImportDispatchInputSchema,
        input,
        "record_recipe_import_dispatch",
        (household, command) => household.recordRecipeImportDispatch(command)
      ),
    rejectMealPlan: (input: HouseholdDecideMealPlanInput) =>
      route(
        HouseholdDecideMealPlanInputSchema,
        input,
        "reject_meal_plan",
        (household, command) => household.rejectMealPlan(command)
      ),
    resolveRecipeImportSource: (
      input: HouseholdResolveRecipeImportSourceInput
    ) =>
      route(
        HouseholdResolveRecipeImportSourceInputSchema,
        input,
        "resolve_recipe_import_source",
        (household, command) => household.resolveRecipeImportSource(command)
      ),
    swapMealPlan: (input: HouseholdSwapMealPlanInput) =>
      route(
        HouseholdSwapMealPlanInputSchema,
        input,
        "swap_meal_plan",
        (household, command) => household.swapMealPlan(command)
      ),
    swapMealPlanFromRecipeBank: (
      input: HouseholdSwapMealPlanFromRecipeBankInput
    ) =>
      route(
        HouseholdSwapMealPlanFromRecipeBankInputSchema,
        input,
        "swap_meal_plan_from_recipe_bank",
        (household, command) => household.swapMealPlanFromRecipeBank(command)
      ),
    transitionRecipeImportLifecycle: (
      input: HouseholdTransitionRecipeImportLifecycleInput
    ) =>
      route(
        HouseholdTransitionRecipeImportLifecycleInputSchema,
        input,
        "transition_recipe_import_lifecycle",
        (household, command) =>
          household.transitionRecipeImportLifecycle(command)
      ),
  } satisfies HouseholdDomainWorkerMethods;
});

export default HouseholdDomainWorker.make(
  {
    main: import.meta.url,
    observability: {
      enabled: true,
      headSamplingRate: 1,
      logs: {
        enabled: true,
        headSamplingRate: 1,
        invocationLogs: false,
        persist: true,
      },
      traces: { enabled: false },
    },
    workersDev: false,
  },
  HouseholdDomainWorkerRuntime.pipe(
    Effect.provide(HouseholdObjectLocator.layer),
    Effect.provide(HouseholdAuthorityServicesLive)
  )
);
