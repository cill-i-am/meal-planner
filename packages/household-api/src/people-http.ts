import { Context, Schema } from "effect";
import { HttpApiSchema } from "effect/unstable/httpapi";

import { HouseholdOrganizationId } from "./household-principal.js";

const PeopleProblem = <const Status extends number, const Code extends string>(
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

/** Purpose-bound principal passed to household people commands. */
export const HouseholdPeoplePrincipal = Schema.Struct({
  actorId: Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-f\d]{64}$/u))),
  organizationId: HouseholdOrganizationId,
}).pipe(Schema.brand("HouseholdPeoplePrincipal"));
export type HouseholdPeoplePrincipal = typeof HouseholdPeoplePrincipal.Type;

/** Request-scoped authenticated people principal. */
export class HouseholdPeopleCurrentPrincipal extends Context.Service<
  HouseholdPeopleCurrentPrincipal,
  HouseholdPeoplePrincipal
>()("meal-planner/HouseholdPeopleCurrentPrincipal") {}

/** Invalid public people request. */
export const HouseholdPeopleInvalidRequestProblem = PeopleProblem(
  400,
  "invalid_request"
);
/** Requested person does not exist in this household. */
export const HouseholdPeopleNotFoundProblem = PeopleProblem(
  404,
  "person_not_found"
);
/** Mutation conflicts with current state or a prior mutation intent. */
export const HouseholdPeopleMutationCollisionProblem = PeopleProblem(
  409,
  "mutation_collision"
);
/** Creator is already linked through a different bootstrap intent. */
export const HouseholdPeopleBootstrapConflictProblem = PeopleProblem(
  409,
  "bootstrap_conflict"
);
/** Optimistic person version is stale. */
export const HouseholdPeopleStaleVersionProblem = PeopleProblem(
  409,
  "stale_version"
);
/** Requested lifecycle transition is invalid from current state. */
export const HouseholdPeopleLifecycleConflictProblem = PeopleProblem(
  409,
  "lifecycle_conflict"
);
/** Household people storage is temporarily unavailable. */
export const HouseholdPeopleUnavailableProblem = PeopleProblem(
  503,
  "people_unavailable"
);
