import { Context, Schema } from "effect";
import { HttpApiSchema } from "effect/unstable/httpapi";

import { HouseholdOrganizationId } from "./household-principal.js";
import { MealPlanActorId } from "./meal-plan.js";

export const HouseholdMealPlanPrincipal = Schema.Struct({
  actorId: MealPlanActorId,
  organizationId: HouseholdOrganizationId,
});
export type HouseholdMealPlanPrincipal = typeof HouseholdMealPlanPrincipal.Type;

export class HouseholdMealPlanCurrentPrincipal extends Context.Service<
  HouseholdMealPlanCurrentPrincipal,
  HouseholdMealPlanPrincipal
>()("meal-planner/HouseholdMealPlanCurrentPrincipal") {}

const ProblemDetails = <const Status extends number, const Code extends string>(
  status: Status,
  code: Code
) =>
  Schema.Struct({
    code: Schema.Literal(code),
    message: Schema.String,
    status: Schema.Literal(status),
  }).pipe(
    HttpApiSchema.status(status),
    HttpApiSchema.asJson({ contentType: "application/problem+json" })
  );

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
