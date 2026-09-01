import { HttpApiMiddleware } from "effect/unstable/httpapi";

import { HouseholdPeopleInvalidRequestProblem } from "./people-http.js";

/** Transforms public household-people schema failures into a closed problem. */
export class HouseholdPeopleSchemaErrors extends HttpApiMiddleware.Service<HouseholdPeopleSchemaErrors>()(
  "HouseholdPeopleSchemaErrors",
  { error: HouseholdPeopleInvalidRequestProblem }
) {}
