import { Context, Schema } from "effect";

import { HouseholdOrganizationId } from "./household-principal.js";
import type { MealPlan } from "./meal-plan.js";
import {
  ManualSwapAudit,
  MealPlanActorId,
  MealPlanApproved,
  MealPlanDraft,
} from "./meal-plan.js";
import { ProblemDetails } from "./problem-details.js";

export const HouseholdMealPlanPrincipal = Schema.Struct({
  actorId: MealPlanActorId,
  organizationId: HouseholdOrganizationId,
});
export type HouseholdMealPlanPrincipal = typeof HouseholdMealPlanPrincipal.Type;

export class HouseholdMealPlanCurrentPrincipal extends Context.Service<
  HouseholdMealPlanCurrentPrincipal,
  HouseholdMealPlanPrincipal
>()("meal-planner/HouseholdMealPlanCurrentPrincipal") {}

const HouseholdMealPlanAuditEntry = Schema.Struct({
  fromRecipe: ManualSwapAudit.fields.fromRecipe,
  mutationId: ManualSwapAudit.fields.mutationId,
  reason: ManualSwapAudit.fields.reason,
  slotId: ManualSwapAudit.fields.slotId,
  swappedAt: ManualSwapAudit.fields.swappedAt,
  toRecipe: ManualSwapAudit.fields.toRecipe,
});

const HouseholdMealPlanResponseFields = {
  audit: Schema.Array(HouseholdMealPlanAuditEntry),
  draftId: MealPlanDraft.fields.draftId,
  gaps: MealPlanDraft.fields.gaps,
  meals: MealPlanDraft.fields.meals,
  policy: MealPlanDraft.fields.policy,
  request: MealPlanDraft.fields.request,
  revision: MealPlanDraft.fields.revision,
} as const;

const HouseholdMealPlanDecisionFields = {
  decidedAt: MealPlanApproved.fields.decision.fields.decidedAt,
  mutationId: MealPlanApproved.fields.decision.fields.mutationId,
  reason: MealPlanApproved.fields.decision.fields.reason,
} as const;

/** Browser-safe meal-plan response with internal actor attribution removed. */
export const HouseholdMealPlanResponse = Schema.Union([
  Schema.Struct({
    ...HouseholdMealPlanResponseFields,
    _tag: Schema.Literal("Draft"),
  }),
  Schema.Struct({
    ...HouseholdMealPlanResponseFields,
    _tag: Schema.Literal("Approved"),
    decision: Schema.Struct({
      ...HouseholdMealPlanDecisionFields,
      outcome: Schema.Literal("approved"),
    }),
  }),
  Schema.Struct({
    ...HouseholdMealPlanResponseFields,
    _tag: Schema.Literal("Rejected"),
    decision: Schema.Struct({
      ...HouseholdMealPlanDecisionFields,
      outcome: Schema.Literal("rejected"),
    }),
  }),
]);
export type HouseholdMealPlanResponse = typeof HouseholdMealPlanResponse.Type;

const projectAuditEntry = (entry: ManualSwapAudit) => ({
  fromRecipe: entry.fromRecipe,
  mutationId: entry.mutationId,
  reason: entry.reason,
  slotId: entry.slotId,
  swappedAt: entry.swappedAt,
  toRecipe: entry.toRecipe,
});

/** Project the internal household aggregate onto its public HTTP contract. */
export const toHouseholdMealPlanResponse = (
  plan: MealPlan
): HouseholdMealPlanResponse => {
  const record = {
    audit: plan.audit.map(projectAuditEntry),
    draftId: plan.draftId,
    gaps: plan.gaps,
    meals: plan.meals,
    policy: plan.policy,
    request: plan.request,
    revision: plan.revision,
  };

  if (plan._tag === "Draft") {
    return { ...record, _tag: "Draft" };
  }

  if (plan._tag === "Approved") {
    return {
      ...record,
      _tag: "Approved",
      decision: {
        decidedAt: plan.decision.decidedAt,
        mutationId: plan.decision.mutationId,
        outcome: "approved",
        reason: plan.decision.reason,
      },
    };
  }

  return {
    ...record,
    _tag: "Rejected",
    decision: {
      decidedAt: plan.decision.decidedAt,
      mutationId: plan.decision.mutationId,
      outcome: "rejected",
      reason: plan.decision.reason,
    },
  };
};

export const HouseholdMealPlanInvalidRequestProblem = ProblemDetails(
  400,
  "invalid_request"
);
export const HouseholdMealPlanNotFoundProblem = ProblemDetails(
  404,
  "meal_plan_not_found"
);
export const HouseholdMealPlanConflictProblem = ProblemDetails(
  409,
  "meal_plan_conflict"
);
export const HouseholdMealPlanInternalProblem = ProblemDetails(
  500,
  "internal_error"
);
