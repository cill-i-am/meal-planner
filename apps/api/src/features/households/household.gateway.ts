import type {
  AssociateHouseholdAdultInvitationPayload,
  BootstrapHouseholdCreatorPayload,
  CancelHouseholdAdultDeparturePayload,
  CompleteHouseholdAdultLinkPayload,
  CreateHouseholdPersonPayload,
  DepartHouseholdAdultPayload,
  HouseholdAdultInvitationResult,
  HouseholdMemberDepartureOperation,
  HouseholdMemberDepartureOperationId,
  HouseholdPeopleFailure,
  HouseholdPeoplePrincipal,
  HouseholdPeopleRoster,
  HouseholdPerson,
  HouseholdPersonId,
  HouseholdPersonMutationId,
  InviteHouseholdAdultPayload,
  RepairHouseholdAdultLinkPayload,
  RetryHouseholdAdultDeparturePayload,
  ReturnHouseholdAdultPayload,
  CreateMealPlanPayload,
  DecideMealPlanPayload,
  HouseholdMealPlanPrincipal,
  HouseholdStatus,
  MealPlan,
  MealPlanDraftId,
  MealPlanMutationConflict,
  MealPlanNotFound,
  MealPlanPersistenceFailure,
  MealPlanRequestConflict,
  MealPlanSwapRejected,
  MealPlanTransitionRejected,
  MealPlanVersionConflict,
  SwapMealPlanPayload,
  TransitionHouseholdPersonPayload,
} from "@meal-planner/household-api";
import type { Effect } from "effect";
import { Context, Data } from "effect";

import type { HouseholdDomainFailure } from "./household.contract.js";
import type {
  HouseholdPeopleControlPlaneNotFound,
  HouseholdPeopleControlPlaneUnavailable,
} from "./people/household-people.control-plane.js";
import type { MemberDepartureWorkflowUnavailable } from "./people/member-departure.js";

export interface HouseholdDomainGateway {
  readonly ensure: (
    principal: HouseholdMealPlanPrincipal
  ) => Effect.Effect<HouseholdStatus, HouseholdDomainFailure>;
}

export const HouseholdDomainGateway = Context.Service<HouseholdDomainGateway>(
  "meal-planner/HouseholdDomainGateway"
);

export type MealPlanCreateFailure =
  | MealPlanPersistenceFailure
  | MealPlanRequestConflict;

export type MealPlanReadFailure = MealPlanNotFound | MealPlanPersistenceFailure;

export type MealPlanDecisionFailure =
  | MealPlanMutationConflict
  | MealPlanNotFound
  | MealPlanPersistenceFailure
  | MealPlanTransitionRejected
  | MealPlanVersionConflict;

export type MealPlanSwapFailure =
  | MealPlanDecisionFailure
  | MealPlanSwapRejected;

export type HouseholdMealPlanFailure =
  | MealPlanCreateFailure
  | MealPlanDecisionFailure
  | MealPlanReadFailure
  | MealPlanSwapFailure;

export interface HouseholdMealPlanGateway {
  readonly approve: (input: {
    readonly payload: DecideMealPlanPayload;
    readonly principal: HouseholdMealPlanPrincipal;
    readonly draftId: MealPlanDraftId;
  }) => Effect.Effect<MealPlan, MealPlanDecisionFailure>;
  readonly create: (input: {
    readonly payload: CreateMealPlanPayload;
    readonly principal: HouseholdMealPlanPrincipal;
  }) => Effect.Effect<MealPlan, MealPlanCreateFailure>;
  readonly read: (input: {
    readonly draftId: MealPlanDraftId;
    readonly principal: HouseholdMealPlanPrincipal;
  }) => Effect.Effect<MealPlan, MealPlanReadFailure>;
  readonly reject: (input: {
    readonly payload: DecideMealPlanPayload;
    readonly principal: HouseholdMealPlanPrincipal;
    readonly draftId: MealPlanDraftId;
  }) => Effect.Effect<MealPlan, MealPlanDecisionFailure>;
  readonly swap: (input: {
    readonly payload: SwapMealPlanPayload;
    readonly principal: HouseholdMealPlanPrincipal;
    readonly draftId: MealPlanDraftId;
  }) => Effect.Effect<MealPlan, MealPlanSwapFailure>;
}

export const HouseholdMealPlanGateway =
  Context.Service<HouseholdMealPlanGateway>(
    "meal-planner/HouseholdMealPlanGateway"
  );

/** The admitted member is not authorized to coordinate another adult. */
export class HouseholdPeopleOrganizerRequired extends Data.TaggedError(
  "HouseholdPeopleOrganizerRequired"
) {}

export type HouseholdPeopleGatewayFailure =
  | HouseholdPeopleControlPlaneNotFound
  | HouseholdPeopleControlPlaneUnavailable
  | HouseholdPeopleFailure
  | HouseholdPeopleOrganizerRequired
  | MemberDepartureWorkflowUnavailable;

/** Admitted application boundary for household people. */
export interface HouseholdPeopleGateway {
  readonly archive: (input: {
    readonly payload: TransitionHouseholdPersonPayload;
    readonly personId: HouseholdPersonId;
    readonly principal: HouseholdPeoplePrincipal;
  }) => Effect.Effect<HouseholdPerson, HouseholdPeopleFailure>;
  readonly bootstrapCreator: (input: {
    readonly payload: BootstrapHouseholdCreatorPayload;
    readonly principal: HouseholdPeoplePrincipal;
  }) => Effect.Effect<HouseholdPerson, HouseholdPeopleFailure>;
  readonly create: (input: {
    readonly payload: CreateHouseholdPersonPayload;
    readonly principal: HouseholdPeoplePrincipal;
  }) => Effect.Effect<HouseholdPerson, HouseholdPeopleFailure>;
  readonly associateInvitation: (input: {
    readonly payload: AssociateHouseholdAdultInvitationPayload;
    readonly principal: HouseholdPeoplePrincipal;
  }) => Effect.Effect<HouseholdPerson, HouseholdPeopleGatewayFailure>;
  readonly cancelDeparture: (input: {
    readonly operationId: HouseholdMemberDepartureOperationId;
    readonly payload: CancelHouseholdAdultDeparturePayload;
    readonly principal: HouseholdPeoplePrincipal;
  }) => Effect.Effect<
    HouseholdMemberDepartureOperation,
    HouseholdPeopleGatewayFailure
  >;
  readonly completeAdultLink: (input: {
    readonly payload: CompleteHouseholdAdultLinkPayload;
    readonly principal: HouseholdPeoplePrincipal;
  }) => Effect.Effect<HouseholdPerson, HouseholdPeopleGatewayFailure>;
  readonly departAdult: (input: {
    readonly headers: Headers;
    readonly payload: DepartHouseholdAdultPayload;
    readonly principal: HouseholdPeoplePrincipal;
  }) => Effect.Effect<
    HouseholdMemberDepartureOperation,
    HouseholdPeopleGatewayFailure
  >;
  readonly get: (input: {
    readonly personId: HouseholdPersonId;
    readonly principal: HouseholdPeoplePrincipal;
  }) => Effect.Effect<HouseholdPerson, HouseholdPeopleFailure>;
  readonly list: (input: {
    readonly includeArchived: boolean;
    readonly principal: HouseholdPeoplePrincipal;
  }) => Effect.Effect<HouseholdPeopleRoster, HouseholdPeopleFailure>;
  readonly getDeparture: (input: {
    readonly operationId: HouseholdMemberDepartureOperationId;
    readonly principal: HouseholdPeoplePrincipal;
  }) => Effect.Effect<
    HouseholdMemberDepartureOperation,
    HouseholdPeopleGatewayFailure
  >;
  readonly getDepartureByMutation: (input: {
    readonly mutationId: HouseholdPersonMutationId;
    readonly principal: HouseholdPeoplePrincipal;
  }) => Effect.Effect<
    HouseholdMemberDepartureOperation,
    HouseholdPeopleGatewayFailure
  >;
  readonly inviteAdult: (input: {
    readonly headers: Headers;
    readonly payload: InviteHouseholdAdultPayload;
    readonly principal: HouseholdPeoplePrincipal;
  }) => Effect.Effect<
    HouseholdAdultInvitationResult,
    HouseholdPeopleGatewayFailure
  >;
  readonly repairAdultLink: (input: {
    readonly payload: RepairHouseholdAdultLinkPayload;
    readonly principal: HouseholdPeoplePrincipal;
  }) => Effect.Effect<HouseholdPerson, HouseholdPeopleGatewayFailure>;
  readonly restore: (input: {
    readonly payload: TransitionHouseholdPersonPayload;
    readonly personId: HouseholdPersonId;
    readonly principal: HouseholdPeoplePrincipal;
  }) => Effect.Effect<HouseholdPerson, HouseholdPeopleFailure>;
  readonly retryDeparture: (input: {
    readonly headers: Headers;
    readonly operationId: HouseholdMemberDepartureOperationId;
    readonly payload: RetryHouseholdAdultDeparturePayload;
    readonly principal: HouseholdPeoplePrincipal;
  }) => Effect.Effect<
    HouseholdMemberDepartureOperation,
    HouseholdPeopleGatewayFailure
  >;
  readonly returnAdult: (input: {
    readonly payload: ReturnHouseholdAdultPayload;
    readonly principal: HouseholdPeoplePrincipal;
  }) => Effect.Effect<HouseholdPerson, HouseholdPeopleGatewayFailure>;
}

/** Injectable admitted household people boundary. */
export const HouseholdPeopleGateway = Context.Service<HouseholdPeopleGateway>(
  "meal-planner/HouseholdPeopleGateway"
);
