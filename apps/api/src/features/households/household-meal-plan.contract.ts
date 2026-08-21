import {
  ManualMealSwapRequest,
  MealPlan,
  MealPlanDecisionRequest,
  MealPlanDraftId,
  MealPlanPolicy,
  MealPlanRecipeSnapshot,
  MealPlanRequest,
} from "@meal-planner/household-api";
import { Schema } from "effect";

import { HouseholdMemberAdmission } from "./rpc/command-envelope.js";

export const HouseholdMealPlanWire = Schema.toEncoded(MealPlan);
export type HouseholdMealPlanWire = typeof HouseholdMealPlanWire.Type;

const MealPlanPolicyWire = Schema.toEncoded(MealPlanPolicy);
const MealPlanRecipeSnapshotWire = Schema.toEncoded(MealPlanRecipeSnapshot);
const MealPlanRequestWire = Schema.toEncoded(MealPlanRequest);
const ManualMealSwapRequestWire = Schema.toEncoded(ManualMealSwapRequest);
const MealPlanDecisionRequestWire = Schema.toEncoded(MealPlanDecisionRequest);

export const HouseholdCreateMealPlanInput = Schema.Struct({
  admission: HouseholdMemberAdmission,
  approvedRecipes: Schema.Array(MealPlanRecipeSnapshotWire),
  policy: MealPlanPolicyWire,
  request: MealPlanRequestWire,
});
export type HouseholdCreateMealPlanInput =
  typeof HouseholdCreateMealPlanInput.Type;

export const HouseholdReadMealPlanInput = Schema.Struct({
  admission: HouseholdMemberAdmission,
  draftId: MealPlanDraftId,
});
export type HouseholdReadMealPlanInput = typeof HouseholdReadMealPlanInput.Type;

export const HouseholdSwapMealPlanInput = Schema.Struct({
  admission: HouseholdMemberAdmission,
  approvedRecipes: Schema.Array(MealPlanRecipeSnapshotWire),
  request: ManualMealSwapRequestWire,
});
export type HouseholdSwapMealPlanInput = typeof HouseholdSwapMealPlanInput.Type;

export const HouseholdDecideMealPlanInput = Schema.Struct({
  admission: HouseholdMemberAdmission,
  request: MealPlanDecisionRequestWire,
});
export type HouseholdDecideMealPlanInput =
  typeof HouseholdDecideMealPlanInput.Type;
