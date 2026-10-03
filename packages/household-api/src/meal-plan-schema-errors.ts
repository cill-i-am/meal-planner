import { HttpApiMiddleware } from "effect/http-api";

import { HouseholdMealPlanInvalidRequestProblem } from "./meal-plan-http.js";

export class HouseholdMealPlanSchemaErrors extends HttpApiMiddleware.Service<HouseholdMealPlanSchemaErrors>()(
  "HouseholdMealPlanSchemaErrors",
  { error: HouseholdMealPlanInvalidRequestProblem }
) {}
