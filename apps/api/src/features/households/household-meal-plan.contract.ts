import {
  ManualMealSwapRequest,
  MealPlan,
  MealPlanDecisionRequest,
  MealPlanDraftId,
  MealPlanPolicy,
  MealPlanRequest,
} from "@meal-planner/household-api";
import { Schema } from "effect";

import { HouseholdMemberAdmission } from "./rpc/command-envelope.js";

export const HouseholdMealPlanWire = Schema.toEncoded(MealPlan);
export type HouseholdMealPlanWire = typeof HouseholdMealPlanWire.Type;

const MealPlanPolicyWire = Schema.toEncoded(MealPlanPolicy);
const MealPlanRequestWire = Schema.toEncoded(MealPlanRequest);
export const HouseholdManualMealSwapCommand = Schema.Struct({
  draftId: ManualMealSwapRequest.fields.draftId,
  expectedRevision: ManualMealSwapRequest.fields.expectedRevision,
  mutationId: ManualMealSwapRequest.fields.mutationId,
  reason: ManualMealSwapRequest.fields.reason,
  replacementImportId: ManualMealSwapRequest.fields.replacementImportId,
  slotId: ManualMealSwapRequest.fields.slotId,
});
export type HouseholdManualMealSwapCommand =
  typeof HouseholdManualMealSwapCommand.Type;

export const HouseholdMealPlanDecisionCommand = Schema.Struct({
  draftId: MealPlanDecisionRequest.fields.draftId,
  expectedRevision: MealPlanDecisionRequest.fields.expectedRevision,
  mutationId: MealPlanDecisionRequest.fields.mutationId,
  reason: MealPlanDecisionRequest.fields.reason,
});
export type HouseholdMealPlanDecisionCommand =
  typeof HouseholdMealPlanDecisionCommand.Type;

const HouseholdManualMealSwapCommandWire = Schema.toEncoded(
  HouseholdManualMealSwapCommand
);
const HouseholdMealPlanDecisionCommandWire = Schema.toEncoded(
  HouseholdMealPlanDecisionCommand
);

export const HouseholdCreateMealPlanFromRecipeBankInput = Schema.Struct({
  admission: HouseholdMemberAdmission,
  policy: MealPlanPolicyWire,
  request: MealPlanRequestWire,
});
export type HouseholdCreateMealPlanFromRecipeBankInput =
  typeof HouseholdCreateMealPlanFromRecipeBankInput.Type;

export const HouseholdReadMealPlanInput = Schema.Struct({
  admission: HouseholdMemberAdmission,
  draftId: MealPlanDraftId,
});
export type HouseholdReadMealPlanInput = typeof HouseholdReadMealPlanInput.Type;

export const HouseholdSwapMealPlanFromRecipeBankInput = Schema.Struct({
  admission: HouseholdMemberAdmission,
  request: HouseholdManualMealSwapCommandWire,
});
export type HouseholdSwapMealPlanFromRecipeBankInput =
  typeof HouseholdSwapMealPlanFromRecipeBankInput.Type;

export const HouseholdDecideMealPlanInput = Schema.Struct({
  admission: HouseholdMemberAdmission,
  request: HouseholdMealPlanDecisionCommandWire,
});
export type HouseholdDecideMealPlanInput =
  typeof HouseholdDecideMealPlanInput.Type;
