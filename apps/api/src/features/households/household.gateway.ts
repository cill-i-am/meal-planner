import type {
  HouseholdProfileRejected,
  MutatePersonProfilePayload,
  PersonProfile,
  ProfileVersionPage,
  AssociateHouseholdAdultInvitationPayload,
  BootstrapHouseholdCreatorPayload,
  CancelHouseholdAdultDeparturePayload,
  CompleteHouseholdAdultLinkPayload,
  CreateHouseholdPersonPayload,
  RenameHouseholdPersonPayload,
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
  ChangeMealPlanPayload,
  DecideMealPlanPayload,
  HouseholdMealPlanPrincipal,
  HouseholdStatus,
  MealPlan,
  MealPlanId,
  MealPlanSummary,
  MealPlanMutationConflict,
  MealPlanNotFound,
  MealPlanPersistenceFailure,
  MealPlanRequestConflict,
  MealPlanRuleViolation,
  MealPlanTransitionRejected,
  MealPlanVersionConflict,
  MealPlanRequest,
  MutatePlanningContentPayload,
  PlanningContentRejected,
  PlanningContentSnapshot,
  SavedRecipePage,
  SavedRecipePageQuery,
  TransitionHouseholdPersonPayload,
} from "@meal-planner/household-api";
import type { Effect } from "effect";
import { Context, Data } from "effect";

import type { HouseholdDomainFailure } from "./household.contract.js";
import type {
  HouseholdPeopleControlPlaneNotFound,
  HouseholdInvitationRejected,
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

export type HouseholdMealPlanFailure =
  | MealPlanMutationConflict
  | MealPlanNotFound
  | MealPlanPersistenceFailure
  | MealPlanRequestConflict
  | MealPlanRuleViolation
  | MealPlanTransitionRejected
  | MealPlanVersionConflict;

export interface HouseholdMealPlanGateway {
  readonly create: (input: {
    readonly payload: MealPlanRequest;
    readonly principal: HouseholdPeoplePrincipal;
  }) => Effect.Effect<MealPlan, HouseholdMealPlanFailure>;
  readonly read: (input: {
    readonly planId: MealPlanId;
    readonly principal: HouseholdPeoplePrincipal;
  }) => Effect.Effect<MealPlan, HouseholdMealPlanFailure>;
  readonly list: (input: {
    readonly principal: HouseholdPeoplePrincipal;
  }) => Effect.Effect<readonly MealPlanSummary[], HouseholdMealPlanFailure>;
  readonly change: (input: {
    readonly planId: MealPlanId;
    readonly payload: ChangeMealPlanPayload;
    readonly principal: HouseholdPeoplePrincipal;
  }) => Effect.Effect<MealPlan, HouseholdMealPlanFailure>;
  readonly approve: (input: {
    readonly planId: MealPlanId;
    readonly payload: DecideMealPlanPayload;
    readonly principal: HouseholdPeoplePrincipal;
  }) => Effect.Effect<MealPlan, HouseholdMealPlanFailure>;
  readonly proposeRevision: (input: {
    readonly planId: MealPlanId;
    readonly payload: DecideMealPlanPayload;
    readonly principal: HouseholdPeoplePrincipal;
  }) => Effect.Effect<MealPlan, HouseholdMealPlanFailure>;
  readonly acceptRevision: (input: {
    readonly planId: MealPlanId;
    readonly payload: DecideMealPlanPayload;
    readonly principal: HouseholdPeoplePrincipal;
  }) => Effect.Effect<MealPlan, HouseholdMealPlanFailure>;
  readonly rejectRevision: (input: {
    readonly planId: MealPlanId;
    readonly payload: DecideMealPlanPayload;
    readonly principal: HouseholdPeoplePrincipal;
  }) => Effect.Effect<MealPlan, HouseholdMealPlanFailure>;
}

export const HouseholdMealPlanGateway =
  Context.Service<HouseholdMealPlanGateway>(
    "meal-planner/HouseholdMealPlanGateway"
  );

export interface HouseholdPlanningContentGateway {
  readonly read: (
    principal: HouseholdPeoplePrincipal
  ) => Effect.Effect<PlanningContentSnapshot, PlanningContentRejected>;
  readonly mutate: (input: {
    readonly principal: HouseholdPeoplePrincipal;
    readonly payload: MutatePlanningContentPayload;
  }) => Effect.Effect<PlanningContentSnapshot, PlanningContentRejected>;
  readonly listSavedRecipes: (input: {
    readonly principal: HouseholdPeoplePrincipal;
    readonly query: SavedRecipePageQuery;
  }) => Effect.Effect<SavedRecipePage, PlanningContentRejected>;
}
export const HouseholdPlanningContentGateway =
  Context.Service<HouseholdPlanningContentGateway>(
    "meal-planner/HouseholdPlanningContentGateway"
  );

/** The admitted member is not authorized to coordinate another adult. */
export class HouseholdPeopleOrganizerRequired extends Data.TaggedError(
  "HouseholdPeopleOrganizerRequired"
) {}

export type HouseholdPeopleGatewayFailure =
  | HouseholdInvitationRejected
  | HouseholdPeopleControlPlaneNotFound
  | HouseholdPeopleControlPlaneUnavailable
  | HouseholdPeopleFailure
  | HouseholdPeopleOrganizerRequired
  | MemberDepartureWorkflowUnavailable;

/** Admitted application boundary for household people. */
export interface HouseholdPeopleGateway {
  readonly getProfile: (input: {
    readonly personId: HouseholdPersonId;
    readonly principal: HouseholdPeoplePrincipal;
    readonly version?: number;
  }) => Effect.Effect<PersonProfile, HouseholdProfileRejected>;
  readonly listProfileVersions: (input: {
    readonly beforeVersion: number | null;
    readonly personId: HouseholdPersonId;
    readonly principal: HouseholdPeoplePrincipal;
  }) => Effect.Effect<ProfileVersionPage, HouseholdProfileRejected>;
  readonly mutateProfile: (input: {
    readonly payload: MutatePersonProfilePayload;
    readonly personId: HouseholdPersonId;
    readonly principal: HouseholdPeoplePrincipal;
  }) => Effect.Effect<PersonProfile, HouseholdProfileRejected>;
  readonly rename: (input: {
    readonly payload: RenameHouseholdPersonPayload;
    readonly personId: HouseholdPersonId;
    readonly principal: HouseholdPeoplePrincipal;
  }) => Effect.Effect<HouseholdPerson, HouseholdPeopleFailure>;
  readonly remove: (input: {
    readonly headers: Headers;
    readonly payload: TransitionHouseholdPersonPayload;
    readonly personId: HouseholdPersonId;
    readonly principal: HouseholdPeoplePrincipal;
  }) => Effect.Effect<HouseholdPerson, HouseholdPeopleGatewayFailure>;
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
