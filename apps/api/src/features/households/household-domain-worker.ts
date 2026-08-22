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
  HouseholdMutateEvidenceStageInput,
  HouseholdReadEvidenceStageInput,
  HouseholdReadEvidenceReferencesInput,
  HouseholdCommitAcquisitionEvidenceResult,
  HouseholdMutateEvidenceStageResult,
  HouseholdObserveEvidenceReferenceResult,
  HouseholdReadEvidenceReferencesResult,
  HouseholdReadEvidenceStageResult,
} from "./evidence/household-evidence.contract.js";
import {
  HouseholdCommitAcquisitionEvidenceInput as HouseholdCommitAcquisitionEvidenceInputSchema,
  HouseholdMutateEvidenceStageInput as HouseholdMutateEvidenceStageInputSchema,
  HouseholdObserveEvidenceReferenceInput as HouseholdObserveEvidenceReferenceInputSchema,
  HouseholdReadEvidenceReferencesInput as HouseholdReadEvidenceReferencesInputSchema,
  HouseholdReadEvidenceStageInput as HouseholdReadEvidenceStageInputSchema,
} from "./evidence/household-evidence.contract.js";
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
import type { HouseholdCommandAdmission } from "./rpc/command-envelope.js";
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
    input: HouseholdMutateEvidenceStageInput
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
  const route = <
    A extends { readonly admission: HouseholdCommandAdmission },
    I,
    B,
    E,
  >(
    schema: Schema.Codec<A, I, never>,
    input: A,
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
        locator.locate(command.admission.organizationId).pipe(
          Effect.mapError(() => HouseholdInvalidInput.make({})),
          Effect.flatMap((objectName) =>
            invoke(households.getByName(objectName), command).pipe(
              Effect.provideService(RuntimeContext, runtimeContext)
            )
          )
        )
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
        Schema.encodeEffect(HouseholdCommitAcquisitionEvidenceInputSchema)(
          command
        ).pipe(
          Effect.mapError(() => HouseholdInvalidInput.make({})),
          Effect.flatMap((encodedCommand) =>
            locator.locate(command.admission.organizationId).pipe(
              Effect.mapError(() => HouseholdInvalidInput.make({})),
              Effect.flatMap((objectName) =>
                households
                  .getByName(objectName)
                  .commitAcquisitionEvidence(encodedCommand)
                  .pipe(Effect.provideService(RuntimeContext, runtimeContext))
              )
            )
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
        Schema.encodeEffect(HouseholdObserveEvidenceReferenceInputSchema)(
          command
        ).pipe(
          Effect.mapError(() => HouseholdInvalidInput.make({})),
          Effect.flatMap((encodedCommand) =>
            locator.locate(command.admission.organizationId).pipe(
              Effect.mapError(() => HouseholdInvalidInput.make({})),
              Effect.flatMap((objectName) =>
                households
                  .getByName(objectName)
                  .observeEvidenceReference(encodedCommand)
                  .pipe(Effect.provideService(RuntimeContext, runtimeContext))
              )
            )
          )
        )
      )
    );
  const routeEvidenceStage = (input: HouseholdMutateEvidenceStageInput) =>
    Schema.decodeUnknownEffect(HouseholdMutateEvidenceStageInputSchema, {
      onExcessProperty: "error",
    })(input).pipe(
      Effect.mapError(() => HouseholdInvalidInput.make({})),
      Effect.flatMap((command) =>
        Schema.encodeEffect(HouseholdMutateEvidenceStageInputSchema)(
          command
        ).pipe(
          Effect.mapError(() => HouseholdInvalidInput.make({})),
          Effect.flatMap((encodedCommand) =>
            locator.locate(command.admission.organizationId).pipe(
              Effect.mapError(() => HouseholdInvalidInput.make({})),
              Effect.flatMap((objectName) =>
                households
                  .getByName(objectName)
                  .mutateEvidenceStage(encodedCommand)
                  .pipe(Effect.provideService(RuntimeContext, runtimeContext))
              )
            )
          )
        )
      )
    );
  return {
    admitRecipeImport: (input: HouseholdAdmitRecipeImportInput) =>
      route(
        HouseholdAdmitRecipeImportInputSchema,
        input,
        (household, command) => household.admitRecipeImport(command)
      ),
    answerRecipeImportAction: (input: HouseholdAnswerRecipeImportActionInput) =>
      route(
        HouseholdAnswerRecipeImportActionInputSchema,
        input,
        (household, command) => household.answerRecipeImportAction(command)
      ),
    approveMealPlan: (input: HouseholdDecideMealPlanInput) =>
      route(HouseholdDecideMealPlanInputSchema, input, (household, command) =>
        household.approveMealPlan(command)
      ),
    cancelRecipeImport: (input: HouseholdCancelRecipeImportInput) =>
      route(
        HouseholdCancelRecipeImportInputSchema,
        input,
        (household, command) => household.cancelRecipeImport(command)
      ),
    commitAcquisitionEvidence: (
      input: HouseholdCommitAcquisitionEvidenceInput
    ) => routeAcquisitionEvidence(input),
    commitRecipeImportDraft: (input: HouseholdCommitRecipeImportDraftInput) =>
      route(
        HouseholdCommitRecipeImportDraftInputSchema,
        input,
        (household, command) => household.commitRecipeImportDraft(command)
      ),
    confirmRecipeImportAction: (
      input: HouseholdConfirmRecipeImportActionInput
    ) =>
      route(
        HouseholdConfirmRecipeImportActionInputSchema,
        input,
        (household, command) => household.confirmRecipeImportAction(command)
      ),
    createMealPlan: (input: HouseholdCreateMealPlanInput) =>
      route(HouseholdCreateMealPlanInputSchema, input, (household, command) =>
        household.createMealPlan(command)
      ),
    createMealPlanFromRecipeBank: (
      input: HouseholdCreateMealPlanFromRecipeBankInput
    ) =>
      route(
        HouseholdCreateMealPlanFromRecipeBankInputSchema,
        input,
        (household, command) => household.createMealPlanFromRecipeBank(command)
      ),
    ensureHousehold: (input: HouseholdEnsureInput) =>
      route(HouseholdEnsureInputSchema, input, (household, command) =>
        household.ensureHousehold(command)
      ),
    listRecipeBank: (input: typeof HouseholdRecipePageInputSchema.Type) =>
      route(HouseholdRecipePageInputSchema, input, (household, command) =>
        household.listRecipeBank(command)
      ),
    mutateEvidenceStage: (input: HouseholdMutateEvidenceStageInput) =>
      routeEvidenceStage(input),
    observeEvidenceReference: (
      input: typeof HouseholdObserveEvidenceReferenceInputSchema.Encoded
    ) => routeEvidenceObservation(input),
    readEvidenceReferences: (input: HouseholdReadEvidenceReferencesInput) =>
      route(
        HouseholdReadEvidenceReferencesInputSchema,
        input,
        (household, command) => household.readEvidenceReferences(command)
      ),
    readEvidenceStage: (input: HouseholdReadEvidenceStageInput) =>
      route(
        HouseholdReadEvidenceStageInputSchema,
        input,
        (household, command) => household.readEvidenceStage(command)
      ),
    readMealPlan: (input: HouseholdReadMealPlanInput) =>
      route(HouseholdReadMealPlanInputSchema, input, (household, command) =>
        household.readMealPlan(command)
      ),
    readRecipe: (input: typeof HouseholdReadRecipeInputSchema.Type) =>
      route(HouseholdReadRecipeInputSchema, input, (household, command) =>
        household.readRecipe(command)
      ),
    readRecipeImport: (
      input: typeof HouseholdReadRecipeImportInputSchema.Type
    ) =>
      route(HouseholdReadRecipeImportInputSchema, input, (household, command) =>
        household.readRecipeImport(command)
      ),
    readRecipeImportAction: (
      input: typeof HouseholdReadRecipeImportActionInputSchema.Type
    ) =>
      route(
        HouseholdReadRecipeImportActionInputSchema,
        input,
        (household, command) => household.readRecipeImportAction(command)
      ),
    readRecipeImportExecution: (
      input: HouseholdReadRecipeImportExecutionInput
    ) =>
      route(
        HouseholdReadRecipeImportExecutionInputSchema,
        input,
        (household, command) => household.readRecipeImportExecution(command)
      ),
    readRecipeImportTimeline: (
      input: typeof HouseholdReadRecipeImportInputSchema.Type
    ) =>
      route(HouseholdReadRecipeImportInputSchema, input, (household, command) =>
        household.readRecipeImportTimeline(command)
      ),
    recordRecipeImportDispatch: (
      input: HouseholdRecordRecipeImportDispatchInput
    ) =>
      route(
        HouseholdRecordRecipeImportDispatchInputSchema,
        input,
        (household, command) => household.recordRecipeImportDispatch(command)
      ),
    rejectMealPlan: (input: HouseholdDecideMealPlanInput) =>
      route(HouseholdDecideMealPlanInputSchema, input, (household, command) =>
        household.rejectMealPlan(command)
      ),
    resolveRecipeImportSource: (
      input: HouseholdResolveRecipeImportSourceInput
    ) =>
      route(
        HouseholdResolveRecipeImportSourceInputSchema,
        input,
        (household, command) => household.resolveRecipeImportSource(command)
      ),
    swapMealPlan: (input: HouseholdSwapMealPlanInput) =>
      route(HouseholdSwapMealPlanInputSchema, input, (household, command) =>
        household.swapMealPlan(command)
      ),
    swapMealPlanFromRecipeBank: (
      input: HouseholdSwapMealPlanFromRecipeBankInput
    ) =>
      route(
        HouseholdSwapMealPlanFromRecipeBankInputSchema,
        input,
        (household, command) => household.swapMealPlanFromRecipeBank(command)
      ),
    transitionRecipeImportLifecycle: (
      input: HouseholdTransitionRecipeImportLifecycleInput
    ) =>
      route(
        HouseholdTransitionRecipeImportLifecycleInputSchema,
        input,
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
