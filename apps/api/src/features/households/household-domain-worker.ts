import type {
  HouseholdProfileRejected,
  PersonProfile,
  ProfileVersionPage,
  HouseholdMemberDepartureOperation,
  HouseholdMemberDepartureStart,
  HouseholdPeopleRoster,
  HouseholdPerson,
  HouseholdPeopleFailure,
} from "@meal-planner/household-api";
import type {
  CancelledRecipeImportIntent,
  Recipe,
  RecipeImportBatch,
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
  HouseholdAdmitImportBatchInput,
  HouseholdBatchFailure,
  HouseholdClaimImportBatchItemInput,
  HouseholdCompleteImportBatchItemInput,
  HouseholdFailImportBatchItemInput,
  HouseholdReadImportBatchInput,
  HouseholdRecordImportBatchDispatchInput,
  HouseholdAdmitImportBatchResult as HouseholdAdmitImportBatchResultSchema,
  HouseholdClaimImportBatchItemResult as HouseholdClaimImportBatchItemResultSchema,
} from "./batches/household-import-batch.contract.js";
import {
  HouseholdAdmitImportBatchInput as HouseholdAdmitImportBatchInputSchema,
  HouseholdClaimImportBatchItemInput as HouseholdClaimImportBatchItemInputSchema,
  HouseholdCompleteImportBatchItemInput as HouseholdCompleteImportBatchItemInputSchema,
  HouseholdFailImportBatchItemInput as HouseholdFailImportBatchItemInputSchema,
  HouseholdReadImportBatchInput as HouseholdReadImportBatchInputSchema,
  HouseholdRecordImportBatchDispatchInput as HouseholdRecordImportBatchDispatchInputSchema,
} from "./batches/household-import-batch.contract.js";
import type {
  HouseholdClaimAcquisitionAttemptInput,
  HouseholdReadAcquisitionAttemptsInput,
  HouseholdReadEvidenceStageInput,
  HouseholdReadEvidenceReferencesInput,
  HouseholdReadImportTerminalCheckpointInput,
  HouseholdCommitAcquisitionEvidenceResult,
  HouseholdClaimAcquisitionAttemptResult,
  HouseholdReadAcquisitionAttemptsResult,
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
  HouseholdClaimAcquisitionAttemptInput as HouseholdClaimAcquisitionAttemptInputSchema,
  HouseholdMutateEvidenceStageInput as HouseholdMutateEvidenceStageInputSchema,
  HouseholdObserveEvidenceReferenceInput as HouseholdObserveEvidenceReferenceInputSchema,
  HouseholdReadEvidenceReferencesInput as HouseholdReadEvidenceReferencesInputSchema,
  HouseholdReadAcquisitionAttemptsInput as HouseholdReadAcquisitionAttemptsInputSchema,
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
  HouseholdAssociateAdultInvitationInput,
  HouseholdBootstrapCreatorPersonInput,
  HouseholdCancelMemberDepartureInput,
  HouseholdCompleteAcceptedAdultLinkInput,
  HouseholdConfirmAdultInvitationRecipientInput,
  HouseholdConfirmMemberAccessRevokedInput,
  HouseholdCreatePersonInput,
  HouseholdFinalizeMemberDepartureInput,
  HouseholdGetMemberDepartureByMutationInput,
  HouseholdGetMemberDepartureInput,
  HouseholdMemberDepartureSystemState,
  HouseholdGetPersonInput,
  HouseholdListPeopleInput,
  HouseholdMarkMemberDepartureRepairRequiredInput,
  HouseholdPrepareMemberDepartureInput,
  HouseholdReadMemberDepartureSystemInput,
  HouseholdRepairAdultAccountLinkInput,
  HouseholdRestoreReturningAdultLinkInput,
  HouseholdRetryMemberDepartureInput,
  HouseholdStartMemberDepartureInput,
  HouseholdTransitionPersonInput,
} from "./people/household-people.contract.js";
import {
  HouseholdAssociateAdultInvitationInput as HouseholdAssociateAdultInvitationInputSchema,
  HouseholdBootstrapCreatorPersonInput as HouseholdBootstrapCreatorPersonInputSchema,
  HouseholdCancelMemberDepartureInput as HouseholdCancelMemberDepartureInputSchema,
  HouseholdCompleteAcceptedAdultLinkInput as HouseholdCompleteAcceptedAdultLinkInputSchema,
  HouseholdConfirmAdultInvitationRecipientInput as HouseholdConfirmAdultInvitationRecipientInputSchema,
  HouseholdConfirmMemberAccessRevokedInput as HouseholdConfirmMemberAccessRevokedInputSchema,
  HouseholdCreatePersonInput as HouseholdCreatePersonInputSchema,
  HouseholdFinalizeMemberDepartureInput as HouseholdFinalizeMemberDepartureInputSchema,
  HouseholdGetMemberDepartureByMutationInput as HouseholdGetMemberDepartureByMutationInputSchema,
  HouseholdGetMemberDepartureInput as HouseholdGetMemberDepartureInputSchema,
  HouseholdGetPersonInput as HouseholdGetPersonInputSchema,
  HouseholdListPeopleInput as HouseholdListPeopleInputSchema,
  HouseholdMarkMemberDepartureRepairRequiredInput as HouseholdMarkMemberDepartureRepairRequiredInputSchema,
  HouseholdPrepareMemberDepartureInput as HouseholdPrepareMemberDepartureInputSchema,
  HouseholdReadMemberDepartureSystemInput as HouseholdReadMemberDepartureSystemInputSchema,
  HouseholdRepairAdultAccountLinkInput as HouseholdRepairAdultAccountLinkInputSchema,
  HouseholdRestoreReturningAdultLinkInput as HouseholdRestoreReturningAdultLinkInputSchema,
  HouseholdRetryMemberDepartureInput as HouseholdRetryMemberDepartureInputSchema,
  HouseholdStartMemberDepartureInput as HouseholdStartMemberDepartureInputSchema,
  HouseholdTransitionPersonInput as HouseholdTransitionPersonInputSchema,
} from "./people/household-people.contract.js";
import {
  HouseholdReadPersonProfileInput,
  HouseholdListProfileVersionsInput,
  HouseholdMutatePersonProfileInput,
} from "./profiles/household-profile.contract.js";
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
  readonly associateAdultInvitation: (
    input: HouseholdAssociateAdultInvitationInput
  ) => Effect.Effect<
    typeof HouseholdPerson.Encoded,
    HouseholdPeopleDomainFailure
  >;
  readonly archiveHouseholdPerson: (
    input: HouseholdTransitionPersonInput
  ) => Effect.Effect<
    typeof HouseholdPerson.Encoded,
    HouseholdPeopleDomainFailure
  >;
  readonly admitImportBatch: (
    input: HouseholdAdmitImportBatchInput
  ) => Effect.Effect<
    typeof HouseholdAdmitImportBatchResultSchema.Encoded,
    HouseholdBatchDomainFailure
  >;
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
  readonly bootstrapCreatorPerson: (
    input: HouseholdBootstrapCreatorPersonInput
  ) => Effect.Effect<
    typeof HouseholdPerson.Encoded,
    HouseholdPeopleDomainFailure
  >;
  readonly cancelMemberDeparture: (
    input: HouseholdCancelMemberDepartureInput
  ) => Effect.Effect<
    typeof HouseholdMemberDepartureOperation.Encoded,
    HouseholdPeopleDomainFailure
  >;
  readonly claimImportBatchItem: (
    input: HouseholdClaimImportBatchItemInput
  ) => Effect.Effect<
    typeof HouseholdClaimImportBatchItemResultSchema.Encoded,
    HouseholdBatchDomainFailure
  >;
  readonly completeImportBatchItem: (
    input: HouseholdCompleteImportBatchItemInput
  ) => Effect.Effect<
    typeof RecipeImportBatch.Encoded,
    HouseholdBatchDomainFailure
  >;
  readonly failImportBatchItem: (
    input: HouseholdFailImportBatchItemInput
  ) => Effect.Effect<
    typeof RecipeImportBatch.Encoded,
    HouseholdBatchDomainFailure
  >;
  readonly approveMealPlan: (
    input: HouseholdDecideMealPlanInput
  ) => Effect.Effect<HouseholdMealPlanWire, HouseholdMealPlanDomainFailure>;
  readonly createMealPlan: (
    input: HouseholdCreateMealPlanInput
  ) => Effect.Effect<HouseholdMealPlanWire, HouseholdMealPlanDomainFailure>;
  readonly createHouseholdPerson: (
    input: HouseholdCreatePersonInput
  ) => Effect.Effect<
    typeof HouseholdPerson.Encoded,
    HouseholdPeopleDomainFailure
  >;
  readonly completeAcceptedAdultLink: (
    input: HouseholdCompleteAcceptedAdultLinkInput
  ) => Effect.Effect<
    typeof HouseholdPerson.Encoded,
    HouseholdPeopleDomainFailure
  >;
  readonly confirmAdultInvitationRecipient: (
    input: HouseholdConfirmAdultInvitationRecipientInput
  ) => Effect.Effect<void, HouseholdPeopleDomainFailure>;
  readonly confirmMemberAccessRevoked: (
    input: HouseholdConfirmMemberAccessRevokedInput
  ) => Effect.Effect<
    typeof HouseholdMemberDepartureOperation.Encoded,
    HouseholdPeopleDomainFailure
  >;
  readonly finalizeMemberDeparture: (
    input: HouseholdFinalizeMemberDepartureInput
  ) => Effect.Effect<
    typeof HouseholdMemberDepartureOperation.Encoded,
    HouseholdPeopleDomainFailure
  >;
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
    input: typeof HouseholdCommitAcquisitionEvidenceInputSchema.Encoded
  ) => Effect.Effect<
    typeof HouseholdCommitAcquisitionEvidenceResult.Encoded,
    HouseholdRecipeImportDomainFailure
  >;
  readonly claimAcquisitionAttempt: (
    input: HouseholdClaimAcquisitionAttemptInput
  ) => Effect.Effect<
    typeof HouseholdClaimAcquisitionAttemptResult.Encoded,
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
  readonly getHouseholdPerson: (
    input: HouseholdGetPersonInput
  ) => Effect.Effect<
    typeof HouseholdPerson.Encoded,
    HouseholdPeopleDomainFailure
  >;
  readonly getMemberDeparture: (
    input:
      | HouseholdGetMemberDepartureInput
      | HouseholdReadMemberDepartureSystemInput
  ) => Effect.Effect<
    | typeof HouseholdMemberDepartureOperation.Encoded
    | typeof HouseholdMemberDepartureSystemState.Encoded,
    HouseholdPeopleDomainFailure
  >;
  readonly getMemberDepartureByMutation: (
    input: HouseholdGetMemberDepartureByMutationInput
  ) => Effect.Effect<
    typeof HouseholdMemberDepartureOperation.Encoded,
    HouseholdPeopleDomainFailure
  >;
  readonly readPersonProfile: (
    input: HouseholdReadPersonProfileInput
  ) => Effect.Effect<
    typeof PersonProfile.Encoded,
    HouseholdDomainFailure | HouseholdProfileRejected
  >;
  readonly listProfileVersions: (
    input: HouseholdListProfileVersionsInput
  ) => Effect.Effect<
    typeof ProfileVersionPage.Encoded,
    HouseholdDomainFailure | HouseholdProfileRejected
  >;
  readonly mutatePersonProfile: (
    input: HouseholdMutatePersonProfileInput
  ) => Effect.Effect<
    typeof PersonProfile.Encoded,
    HouseholdDomainFailure | HouseholdProfileRejected
  >;
  readonly listHouseholdPeople: (
    input: HouseholdListPeopleInput
  ) => Effect.Effect<
    typeof HouseholdPeopleRoster.Encoded,
    HouseholdPeopleDomainFailure
  >;
  readonly markMemberDepartureRepairRequired: (
    input: HouseholdMarkMemberDepartureRepairRequiredInput
  ) => Effect.Effect<
    typeof HouseholdMemberDepartureOperation.Encoded,
    HouseholdPeopleDomainFailure
  >;
  readonly prepareMemberDeparture: (
    input: HouseholdPrepareMemberDepartureInput
  ) => Effect.Effect<
    typeof HouseholdMemberDepartureOperation.Encoded,
    HouseholdPeopleDomainFailure
  >;
  readonly repairAdultAccountLink: (
    input: HouseholdRepairAdultAccountLinkInput
  ) => Effect.Effect<
    typeof HouseholdPerson.Encoded,
    HouseholdPeopleDomainFailure
  >;
  readonly readMealPlan: (
    input: HouseholdReadMealPlanInput
  ) => Effect.Effect<
    HouseholdMealPlanWire | null,
    HouseholdMealPlanDomainFailure
  >;
  readonly readImportBatch: (
    input: HouseholdReadImportBatchInput
  ) => Effect.Effect<
    typeof RecipeImportBatch.Encoded,
    HouseholdBatchDomainFailure
  >;
  readonly recordImportBatchDispatch: (
    input: HouseholdRecordImportBatchDispatchInput
  ) => Effect.Effect<void, HouseholdBatchDomainFailure>;
  readonly readEvidenceReferences: (
    input: HouseholdReadEvidenceReferencesInput
  ) => Effect.Effect<
    typeof HouseholdReadEvidenceReferencesResult.Encoded,
    HouseholdRecipeImportDomainFailure
  >;
  readonly readAcquisitionAttempts: (
    input: HouseholdReadAcquisitionAttemptsInput
  ) => Effect.Effect<
    typeof HouseholdReadAcquisitionAttemptsResult.Encoded,
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
  readonly restoreHouseholdPerson: (
    input: HouseholdTransitionPersonInput
  ) => Effect.Effect<
    typeof HouseholdPerson.Encoded,
    HouseholdPeopleDomainFailure
  >;
  readonly restoreReturningAdultLink: (
    input: HouseholdRestoreReturningAdultLinkInput
  ) => Effect.Effect<
    typeof HouseholdPerson.Encoded,
    HouseholdPeopleDomainFailure
  >;
  readonly retryMemberDeparture: (
    input: HouseholdRetryMemberDepartureInput
  ) => Effect.Effect<
    typeof HouseholdMemberDepartureStart.Encoded,
    HouseholdPeopleDomainFailure
  >;
  readonly startMemberDeparture: (
    input: HouseholdStartMemberDepartureInput
  ) => Effect.Effect<
    typeof HouseholdMemberDepartureStart.Encoded,
    HouseholdPeopleDomainFailure
  >;
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
export type HouseholdPeopleDomainFailure =
  | HouseholdDomainFailure
  | HouseholdPeopleFailure;
export type HouseholdRecipeImportDomainFailure =
  | HouseholdDomainFailure
  | HouseholdRecipeImportFailure;
export type HouseholdBatchDomainFailure =
  | HouseholdDomainFailure
  | HouseholdBatchFailure;

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
    input: typeof HouseholdCommitAcquisitionEvidenceInputSchema.Encoded
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
    admitImportBatch: (input: HouseholdAdmitImportBatchInput) =>
      route(
        HouseholdAdmitImportBatchInputSchema,
        input,
        "admit_import_batch",
        (household, command) => household.admitImportBatch(command)
      ),
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
    archiveHouseholdPerson: (input: HouseholdTransitionPersonInput) =>
      route(
        HouseholdTransitionPersonInputSchema,
        input,
        "archive_household_person",
        (household, command) => household.archiveHouseholdPerson(command)
      ),
    associateAdultInvitation: (input: HouseholdAssociateAdultInvitationInput) =>
      route(
        HouseholdAssociateAdultInvitationInputSchema,
        input,
        "associate_adult_invitation",
        (household, command) => household.associateAdultInvitation(command)
      ),
    bootstrapCreatorPerson: (input: HouseholdBootstrapCreatorPersonInput) =>
      route(
        HouseholdBootstrapCreatorPersonInputSchema,
        input,
        "bootstrap_creator_person",
        (household, command) => household.bootstrapCreatorPerson(command)
      ),
    cancelMemberDeparture: (input: HouseholdCancelMemberDepartureInput) =>
      route(
        HouseholdCancelMemberDepartureInputSchema,
        input,
        "cancel_member_departure",
        (household, command) => household.cancelMemberDeparture(command)
      ),
    cancelRecipeImport: (input: HouseholdCancelRecipeImportInput) =>
      route(
        HouseholdCancelRecipeImportInputSchema,
        input,
        "cancel_recipe_import",
        (household, command) => household.cancelRecipeImport(command)
      ),
    claimAcquisitionAttempt: (input: HouseholdClaimAcquisitionAttemptInput) =>
      route(
        HouseholdClaimAcquisitionAttemptInputSchema,
        input,
        "claim_acquisition_attempt",
        (household, command) => household.claimAcquisitionAttempt(command)
      ),
    claimImportBatchItem: (input: HouseholdClaimImportBatchItemInput) =>
      route(
        HouseholdClaimImportBatchItemInputSchema,
        input,
        "claim_import_batch_item",
        (household, command) => household.claimImportBatchItem(command)
      ),
    commitAcquisitionEvidence: (
      input: typeof HouseholdCommitAcquisitionEvidenceInputSchema.Encoded
    ) => routeAcquisitionEvidence(input),
    commitRecipeImportDraft: (input: HouseholdCommitRecipeImportDraftInput) =>
      route(
        HouseholdCommitRecipeImportDraftInputSchema,
        input,
        "commit_recipe_import_draft",
        (household, command) => household.commitRecipeImportDraft(command)
      ),
    completeAcceptedAdultLink: (
      input: HouseholdCompleteAcceptedAdultLinkInput
    ) =>
      route(
        HouseholdCompleteAcceptedAdultLinkInputSchema,
        input,
        "complete_accepted_adult_link",
        (household, command) => household.completeAcceptedAdultLink(command)
      ),
    completeImportBatchItem: (input: HouseholdCompleteImportBatchItemInput) =>
      route(
        HouseholdCompleteImportBatchItemInputSchema,
        input,
        "complete_import_batch_item",
        (household, command) => household.completeImportBatchItem(command)
      ),
    confirmAdultInvitationRecipient: (
      input: HouseholdConfirmAdultInvitationRecipientInput
    ) =>
      route(
        HouseholdConfirmAdultInvitationRecipientInputSchema,
        input,
        "confirm_adult_invitation_recipient",
        (household, command) =>
          household.confirmAdultInvitationRecipient(command)
      ),
    confirmMemberAccessRevoked: (
      input: HouseholdConfirmMemberAccessRevokedInput
    ) =>
      route(
        HouseholdConfirmMemberAccessRevokedInputSchema,
        input,
        "confirm_member_access_revoked",
        (household, command) => household.confirmMemberAccessRevoked(command)
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
    createHouseholdPerson: (input: HouseholdCreatePersonInput) =>
      route(
        HouseholdCreatePersonInputSchema,
        input,
        "create_household_person",
        (household, command) => household.createHouseholdPerson(command)
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
    failImportBatchItem: (input: HouseholdFailImportBatchItemInput) =>
      route(
        HouseholdFailImportBatchItemInputSchema,
        input,
        "fail_import_batch_item",
        (household, command) => household.failImportBatchItem(command)
      ),
    finalizeMemberDeparture: (input: HouseholdFinalizeMemberDepartureInput) =>
      route(
        HouseholdFinalizeMemberDepartureInputSchema,
        input,
        "finalize_member_departure",
        (household, command) => household.finalizeMemberDeparture(command)
      ),
    getHouseholdPerson: (input: HouseholdGetPersonInput) =>
      route(
        HouseholdGetPersonInputSchema,
        input,
        "get_household_person",
        (household, command) => household.getHouseholdPerson(command)
      ),
    getMemberDeparture: (
      input:
        | HouseholdGetMemberDepartureInput
        | HouseholdReadMemberDepartureSystemInput
    ) =>
      input.admission.actor._tag === "System"
        ? route(
            HouseholdReadMemberDepartureSystemInputSchema,
            input,
            "get_member_departure",
            (household, command) => household.getMemberDeparture(command)
          )
        : route(
            HouseholdGetMemberDepartureInputSchema,
            input,
            "get_member_departure",
            (household, command) => household.getMemberDeparture(command)
          ),
    getMemberDepartureByMutation: (
      input: HouseholdGetMemberDepartureByMutationInput
    ) =>
      route(
        HouseholdGetMemberDepartureByMutationInputSchema,
        input,
        "get_member_departure",
        (household, command) => household.getMemberDepartureByMutation(command)
      ),
    listHouseholdPeople: (input: HouseholdListPeopleInput) =>
      route(
        HouseholdListPeopleInputSchema,
        input,
        "list_household_people",
        (household, command) => household.listHouseholdPeople(command)
      ),
    listProfileVersions: (input: HouseholdListProfileVersionsInput) =>
      route(
        HouseholdListProfileVersionsInput,
        input,
        "read_person_profile",
        (household, command) => household.listProfileVersions(command)
      ),
    listRecipeBank: (input: typeof HouseholdRecipePageInputSchema.Type) =>
      route(
        HouseholdRecipePageInputSchema,
        input,
        "list_recipe_bank",
        (household, command) => household.listRecipeBank(command)
      ),
    markMemberDepartureRepairRequired: (
      input: HouseholdMarkMemberDepartureRepairRequiredInput
    ) =>
      route(
        HouseholdMarkMemberDepartureRepairRequiredInputSchema,
        input,
        "mark_member_departure_repair_required",
        (household, command) =>
          household.markMemberDepartureRepairRequired(command)
      ),
    mutateEvidenceStage: (
      input: typeof HouseholdMutateEvidenceStageInputSchema.Encoded
    ) => routeEvidenceStage(input),
    mutatePersonProfile: (input: HouseholdMutatePersonProfileInput) =>
      route(
        HouseholdMutatePersonProfileInput,
        input,
        "mutate_person_profile",
        (household, command) => household.mutatePersonProfile(command)
      ),
    observeEvidenceReference: (
      input: typeof HouseholdObserveEvidenceReferenceInputSchema.Encoded
    ) => routeEvidenceObservation(input),
    prepareMemberDeparture: (input: HouseholdPrepareMemberDepartureInput) =>
      route(
        HouseholdPrepareMemberDepartureInputSchema,
        input,
        "prepare_member_departure",
        (household, command) => household.prepareMemberDeparture(command)
      ),
    prepareRecipeRecovery: (
      input: typeof HouseholdPrepareRecipeRecoveryInputSchema.Encoded
    ) => routeRecipeRecovery(input),
    readAcquisitionAttempts: (input: HouseholdReadAcquisitionAttemptsInput) =>
      route(
        HouseholdReadAcquisitionAttemptsInputSchema,
        input,
        "read_acquisition_attempts",
        (household, command) => household.readAcquisitionAttempts(command)
      ),
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
    readImportBatch: (input: HouseholdReadImportBatchInput) =>
      route(
        HouseholdReadImportBatchInputSchema,
        input,
        "read_import_batch",
        (household, command) => household.readImportBatch(command)
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
    readPersonProfile: (input: HouseholdReadPersonProfileInput) =>
      route(
        HouseholdReadPersonProfileInput,
        input,
        "read_person_profile",
        (household, command) => household.readPersonProfile(command)
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
    recordImportBatchDispatch: (
      input: HouseholdRecordImportBatchDispatchInput
    ) =>
      route(
        HouseholdRecordImportBatchDispatchInputSchema,
        input,
        "record_import_batch_dispatch",
        (household, command) => household.recordImportBatchDispatch(command)
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
    repairAdultAccountLink: (input: HouseholdRepairAdultAccountLinkInput) =>
      route(
        HouseholdRepairAdultAccountLinkInputSchema,
        input,
        "repair_adult_account_link",
        (household, command) => household.repairAdultAccountLink(command)
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
    restoreHouseholdPerson: (input: HouseholdTransitionPersonInput) =>
      route(
        HouseholdTransitionPersonInputSchema,
        input,
        "restore_household_person",
        (household, command) => household.restoreHouseholdPerson(command)
      ),
    restoreReturningAdultLink: (
      input: HouseholdRestoreReturningAdultLinkInput
    ) =>
      route(
        HouseholdRestoreReturningAdultLinkInputSchema,
        input,
        "restore_returning_adult_link",
        (household, command) => household.restoreReturningAdultLink(command)
      ),
    retryMemberDeparture: (input: HouseholdRetryMemberDepartureInput) =>
      route(
        HouseholdRetryMemberDepartureInputSchema,
        input,
        "retry_member_departure",
        (household, command) => household.retryMemberDeparture(command)
      ),
    startMemberDeparture: (input: HouseholdStartMemberDepartureInput) =>
      route(
        HouseholdStartMemberDepartureInputSchema,
        input,
        "start_member_departure",
        (household, command) => household.startMemberDeparture(command)
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
