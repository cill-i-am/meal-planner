import { HttpApiMiddleware } from "effect/unstable/httpapi";

import { HouseholdMealPlanInvalidRequestProblem } from "./meal-plan-http.js";

export class HouseholdMealPlanSchemaErrors extends HttpApiMiddleware.Service<HouseholdMealPlanSchemaErrors>()(
  "HouseholdMealPlanSchemaErrors",
  { error: HouseholdMealPlanInvalidRequestProblem }
) {}
