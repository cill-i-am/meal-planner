import {
  ManualMealSwapRequest,
  MealPlan,
  MealPlanDecisionRequest,
  MealPlanDraftId,
  MealPlanPolicy,
  MealPlanRequest,
} from "@meal-planner/household-api";
import { Schema } from "effect";

import { HouseholdOrganizationId } from "./household.contract.js";

export const HouseholdMealPlanWire = Schema.toEncoded(MealPlan);
export type HouseholdMealPlanWire = typeof HouseholdMealPlanWire.Type;

const MealPlanPolicyWire = Schema.toEncoded(MealPlanPolicy);
const MealPlanRequestWire = Schema.toEncoded(MealPlanRequest);
const ManualMealSwapRequestWire = Schema.toEncoded(ManualMealSwapRequest);
const MealPlanDecisionRequestWire = Schema.toEncoded(MealPlanDecisionRequest);

export const HouseholdCreateMealPlanInput = Schema.Struct({
  organizationId: HouseholdOrganizationId,
  policy: MealPlanPolicyWire,
  request: MealPlanRequestWire,
});
export type HouseholdCreateMealPlanInput =
  typeof HouseholdCreateMealPlanInput.Type;

export const HouseholdReadMealPlanInput = Schema.Struct({
  draftId: MealPlanDraftId,
  organizationId: HouseholdOrganizationId,
});
export type HouseholdReadMealPlanInput = typeof HouseholdReadMealPlanInput.Type;

export const HouseholdSwapMealPlanInput = Schema.Struct({
  organizationId: HouseholdOrganizationId,
  request: ManualMealSwapRequestWire,
});
export type HouseholdSwapMealPlanInput = typeof HouseholdSwapMealPlanInput.Type;

export const HouseholdDecideMealPlanInput = Schema.Struct({
  organizationId: HouseholdOrganizationId,
  request: MealPlanDecisionRequestWire,
});
export type HouseholdDecideMealPlanInput =
  typeof HouseholdDecideMealPlanInput.Type;
