import type {
  BootstrapHouseholdCreatorPayload,
  CreateHouseholdPersonPayload,
  HouseholdPeopleFailure,
  HouseholdPeoplePrincipal,
  HouseholdPeopleRoster,
  HouseholdPerson,
  HouseholdPersonId,
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
import { Context } from "effect";

import type { HouseholdDomainFailure } from "./household.contract.js";

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
  readonly get: (input: {
    readonly personId: HouseholdPersonId;
    readonly principal: HouseholdPeoplePrincipal;
  }) => Effect.Effect<HouseholdPerson, HouseholdPeopleFailure>;
  readonly list: (input: {
    readonly includeArchived: boolean;
    readonly principal: HouseholdPeoplePrincipal;
  }) => Effect.Effect<HouseholdPeopleRoster, HouseholdPeopleFailure>;
  readonly restore: (input: {
    readonly payload: TransitionHouseholdPersonPayload;
    readonly personId: HouseholdPersonId;
    readonly principal: HouseholdPeoplePrincipal;
  }) => Effect.Effect<HouseholdPerson, HouseholdPeopleFailure>;
}

/** Injectable admitted household people boundary. */
export const HouseholdPeopleGateway = Context.Service<HouseholdPeopleGateway>(
  "meal-planner/HouseholdPeopleGateway"
);
