import { Context, Schema } from "effect";

import { HouseholdOrganizationId } from "./household-principal.js";
import { ProblemDetails } from "./problem-details.js";

/** Domain-separated household-scoped digest used only for people audit attribution. */
export const HouseholdPeopleAuditActorId = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-f\d]{64}$/u)),
  Schema.brand("HouseholdPeopleAuditActorId")
);
export type HouseholdPeopleAuditActorId =
  typeof HouseholdPeopleAuditActorId.Type;

/** Domain-separated household-scoped digest used only for account-to-person linkage. */
export const HouseholdPersonLinkageSubject = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-f\d]{64}$/u)),
  Schema.brand("HouseholdPersonLinkageSubject")
);
export type HouseholdPersonLinkageSubject =
  typeof HouseholdPersonLinkageSubject.Type;

/** Better Auth authority admitted to perform the one creator bootstrap. */
export const HouseholdCreatorAuthority = Schema.Literal("better_auth_owner");
export type HouseholdCreatorAuthority = typeof HouseholdCreatorAuthority.Type;

/** Purpose-bound principal passed to household people commands. */
export const HouseholdPeoplePrincipal = Schema.Struct({
  actorId: HouseholdPeopleAuditActorId,
  creatorAuthority: Schema.NullOr(HouseholdCreatorAuthority),
  linkageSubject: HouseholdPersonLinkageSubject,
  organizationId: HouseholdOrganizationId,
}).pipe(Schema.brand("HouseholdPeoplePrincipal"));
export type HouseholdPeoplePrincipal = typeof HouseholdPeoplePrincipal.Type;

/** Request-scoped authenticated people principal. */
export class HouseholdPeopleCurrentPrincipal extends Context.Service<
  HouseholdPeopleCurrentPrincipal,
  HouseholdPeoplePrincipal
>()("meal-planner/HouseholdPeopleCurrentPrincipal") {}

/** Invalid public people request. */
export const HouseholdPeopleInvalidRequestProblem = ProblemDetails(
  400,
  "invalid_request"
);
/** Requested person does not exist in this household. */
export const HouseholdPeopleNotFoundProblem = ProblemDetails(
  404,
  "person_not_found"
);
/** Creator bootstrap requires Better Auth organization owner authority. */
export const HouseholdPeopleCreatorRequiredProblem = ProblemDetails(
  403,
  "creator_required"
);
/** Account-link or departure operation requires a current household owner. */
export const HouseholdPeopleOrganizerRequiredProblem = ProblemDetails(
  403,
  "organizer_required"
);
/** The selected Better Auth member or invitation is not valid for this household. */
export const HouseholdPeopleControlPlaneNotFoundProblem = ProblemDetails(
  404,
  "control_plane_resource_not_found"
);
/** Mutation conflicts with current state or a prior mutation intent. */
export const HouseholdPeopleMutationCollisionProblem = ProblemDetails(
  409,
  "mutation_collision"
);
/** Household creator slot is occupied; the requesting account remains unlinked. */
export const HouseholdPeopleBootstrapConflictProblem = ProblemDetails(
  409,
  "bootstrap_conflict"
);
/** Optimistic person version is stale. */
export const HouseholdPeopleStaleVersionProblem = ProblemDetails(
  409,
  "stale_version"
);
/** Requested lifecycle transition is invalid from current state. */
export const HouseholdPeopleLifecycleConflictProblem = ProblemDetails(
  409,
  "lifecycle_conflict"
);
/** Invitation, member, link, or person association conflicts with current authority. */
export const HouseholdPeopleAssociationConflictProblem = ProblemDetails(
  409,
  "association_conflict"
);
/** Another departure owns this person/link or the requested transition is invalid. */
export const HouseholdPeopleDepartureConflictProblem = ProblemDetails(
  409,
  "departure_conflict"
);
/** Optimistic account-link or departure-operation version is stale. */
export const HouseholdPeopleAssociationStaleProblem = ProblemDetails(
  409,
  "association_stale"
);
/** Household people storage is temporarily unavailable. */
export const HouseholdPeopleUnavailableProblem = ProblemDetails(
  503,
  "people_unavailable"
);
/** Better Auth membership or invitation authority is temporarily unavailable. */
export const HouseholdPeopleControlPlaneUnavailableProblem = ProblemDetails(
  503,
  "control_plane_unavailable"
);
