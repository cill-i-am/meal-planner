import { Context, Schema } from "effect";
import { HttpApiSchema } from "effect/unstable/httpapi";

import { HouseholdOrganizationId } from "./household-principal.js";
import {
  MealPlanActorId,
  MealPlanApproved,
  MealPlanAudit,
  MealPlanDraft,
  MealPlanProposedRevision,
  MealPlanRuleViolation,
} from "./meal-plan.js";
import type { MealPlan } from "./meal-plan.js";
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

// The household receives the change and time; the internal actor digest stays private.
const PublicFields = {
  audit: Schema.Array(
    Schema.Struct({
      action: MealPlanAudit.fields.action,
      at: MealPlanAudit.fields.at,
      changedRequirements: MealPlanAudit.fields.changedRequirements,
      mutationId: MealPlanAudit.fields.mutationId,
      reason: MealPlanAudit.fields.reason,
    })
  ),
  planId: MealPlanDraft.fields.planId,
  request: MealPlanDraft.fields.request,
  revision: MealPlanDraft.fields.revision,
} as const;

export const HouseholdMealPlanResponse = Schema.Union([
  Schema.Struct({
    ...PublicFields,
    _tag: Schema.Literal("Draft"),
    proposed: MealPlanDraft.fields.proposed,
  }),
  Schema.Struct({
    ...PublicFields,
    _tag: Schema.Literal("Approved"),
    active: MealPlanApproved.fields.active,
  }),
  Schema.Struct({
    ...PublicFields,
    _tag: Schema.Literal("ProposedRevision"),
    active: MealPlanProposedRevision.fields.active,
    proposed: MealPlanProposedRevision.fields.proposed,
  }),
]);
export type HouseholdMealPlanResponse = typeof HouseholdMealPlanResponse.Type;

export const toHouseholdMealPlanResponse = (
  plan: MealPlan
): HouseholdMealPlanResponse => {
  const common = {
    audit: plan.audit.map(({ actorId: _actorId, ...entry }) => entry),
    planId: plan.planId,
    request: plan.request,
    revision: plan.revision,
  };
  switch (plan._tag) {
    case "Draft": {
      return { ...common, _tag: "Draft", proposed: plan.proposed };
    }
    case "Approved": {
      return { ...common, _tag: "Approved", active: plan.active };
    }
    case "ProposedRevision": {
      return {
        ...common,
        _tag: "ProposedRevision",
        active: plan.active,
        proposed: plan.proposed,
      };
    }
    default: {
      return plan satisfies never;
    }
  }
};

export const HouseholdMealPlanInvalidRequestProblem = ProblemDetails(
  400,
  "invalid_request"
);
export const HouseholdMealPlanNotFoundProblem = ProblemDetails(
  404,
  "meal_plan_not_found"
);
export const HouseholdMealPlanConflictReason = Schema.Union([
  MealPlanRuleViolation.fields.reason,
  Schema.Literals([
    "invalid_transition",
    "mutation_conflict",
    "request_conflict",
    "version_conflict",
  ]),
]);
export type HouseholdMealPlanConflictReason =
  typeof HouseholdMealPlanConflictReason.Type;
export const HouseholdMealPlanConflictProblem = Schema.Struct({
  code: Schema.Literal("meal_plan_conflict"),
  message: Schema.String,
  reason: HouseholdMealPlanConflictReason,
  status: Schema.Literal(409),
}).pipe(
  HttpApiSchema.status(409),
  HttpApiSchema.asJson({ contentType: "application/problem+json" })
);
export const HouseholdMealPlanInternalProblem = ProblemDetails(
  500,
  "internal_error"
);
