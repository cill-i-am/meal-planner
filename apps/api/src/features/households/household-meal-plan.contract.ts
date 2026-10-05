import {
  ChangeMealPlanPayload,
  DecideMealPlanPayload,
  MealPlan,
  MealPlanId,
  MealPlanRequest,
  MealPlanSummary,
  MutatePlanningContentPayload,
  PlanningContentSnapshot,
  SavedRecipePage,
  SavedRecipePageQuery,
} from "@meal-planner/household-api";
import { Schema } from "effect";

import { HouseholdPeopleMemberAdmission } from "./rpc/command-envelope.js";

export const HouseholdMealPlanWire = Schema.toEncoded(MealPlan);
export type HouseholdMealPlanWire = typeof HouseholdMealPlanWire.Type;
export const HouseholdMealPlanSummaryListWire = Schema.toEncoded(
  Schema.Array(MealPlanSummary)
);
export type HouseholdMealPlanSummaryListWire =
  typeof HouseholdMealPlanSummaryListWire.Type;
export const HouseholdPlanningContentWire = Schema.toEncoded(
  PlanningContentSnapshot
);
export type HouseholdPlanningContentWire =
  typeof HouseholdPlanningContentWire.Type;
export const HouseholdSavedRecipePageWire = Schema.toEncoded(SavedRecipePage);
export type HouseholdSavedRecipePageWire =
  typeof HouseholdSavedRecipePageWire.Type;

export const HouseholdCreateMealPlanInput = Schema.Struct({
  admission: HouseholdPeopleMemberAdmission,
  request: Schema.toEncoded(MealPlanRequest),
});
export type HouseholdCreateMealPlanInput =
  typeof HouseholdCreateMealPlanInput.Type;

export const HouseholdReadMealPlanInput = Schema.Struct({
  admission: HouseholdPeopleMemberAdmission,
  planId: MealPlanId,
});
export type HouseholdReadMealPlanInput = typeof HouseholdReadMealPlanInput.Type;

export const HouseholdChangeMealPlanInput = Schema.Struct({
  admission: HouseholdPeopleMemberAdmission,
  payload: Schema.toEncoded(ChangeMealPlanPayload),
  planId: MealPlanId,
});
export type HouseholdChangeMealPlanInput =
  typeof HouseholdChangeMealPlanInput.Type;

export const HouseholdDecideMealPlanInput = Schema.Struct({
  admission: HouseholdPeopleMemberAdmission,
  payload: Schema.toEncoded(DecideMealPlanPayload),
  planId: MealPlanId,
});
export type HouseholdDecideMealPlanInput =
  typeof HouseholdDecideMealPlanInput.Type;

export const HouseholdReadPlanningContentInput = Schema.Struct({
  admission: HouseholdPeopleMemberAdmission,
});
export type HouseholdReadPlanningContentInput =
  typeof HouseholdReadPlanningContentInput.Type;

export const HouseholdListSavedRecipesInput = Schema.Struct({
  admission: HouseholdPeopleMemberAdmission,
  query: Schema.toEncoded(SavedRecipePageQuery),
});
export type HouseholdListSavedRecipesInput =
  typeof HouseholdListSavedRecipesInput.Type;

export const HouseholdMutatePlanningContentInput = Schema.Struct({
  admission: HouseholdPeopleMemberAdmission,
  payload: Schema.toEncoded(MutatePlanningContentPayload),
});
export type HouseholdMutatePlanningContentInput =
  typeof HouseholdMutatePlanningContentInput.Type;
