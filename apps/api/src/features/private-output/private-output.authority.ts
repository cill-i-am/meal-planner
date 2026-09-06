import { HouseholdPeopleRoster } from "@meal-planner/household-api";
import { Effect, Schema } from "effect";

import type { MealPlannerAuth } from "../auth/auth.js";
import { resolveAuthenticatedOrganization } from "../auth/auth.principal.js";
import type { HouseholdDomainWorkerMethods } from "../households/household-domain-worker.js";
import {
  deriveHouseholdPeopleAuditActorId,
  deriveHouseholdPersonLinkageSubject,
} from "../households/people/household-people.identity.js";
import { makeHouseholdPeopleAdmission } from "../households/rpc/command-envelope.js";
import {
  privateOutputKey,
  PrivateOutputUnavailable,
} from "./private-output.contract.js";

/** Canonical reads after registration; this result alone is never an egress grant. */
export const resolvePrivateOutputAuthority = (input: {
  readonly auth: MealPlannerAuth;
  readonly headers: Headers;
  readonly household: Pick<HouseholdDomainWorkerMethods, "listHouseholdPeople">;
}) =>
  Effect.gen(function* resolvePrivateAuthority() {
    const principal = yield* resolveAuthenticatedOrganization(input);
    const session = yield* Effect.tryPromise({
      catch: () =>
        new PrivateOutputUnavailable({ reason: "authority_unavailable" }),
      try: () => input.auth.api.getSession({ headers: input.headers }),
    });
    if (
      session === null ||
      session.user.id !== principal.userId ||
      session.session.activeOrganizationId !== principal.organizationId
    ) {
      return yield* Effect.fail(
        new PrivateOutputUnavailable({ reason: "authority_unavailable" })
      );
    }
    const linkageSubject = yield* deriveHouseholdPersonLinkageSubject(
      principal.organizationId,
      principal.userId
    );
    const actorId = yield* deriveHouseholdPeopleAuditActorId(
      principal.organizationId,
      principal.userId
    );
    const admission = yield* makeHouseholdPeopleAdmission({
      actorId,
      linkageSubject,
      organizationId: principal.organizationId,
    });
    const roster = yield* input.household
      .listHouseholdPeople({ admission, query: {} })
      .pipe(Effect.flatMap(Schema.decodeUnknownEffect(HouseholdPeopleRoster)));
    const person = roster.people.find(
      (candidate) => candidate.id === roster.currentPersonId
    );
    if (
      person === undefined ||
      person.kind !== "adult" ||
      person.lifecycle !== "active" ||
      person.associationState !== "linked" ||
      !person.isCurrentAdult
    ) {
      return yield* Effect.fail(
        new PrivateOutputUnavailable({ reason: "authority_unavailable" })
      );
    }
    const accountKey = yield* Effect.promise(() =>
      privateOutputKey("account", principal.userId)
    );
    const householdKey = yield* Effect.promise(() =>
      privateOutputKey("household", principal.organizationId)
    );
    return {
      accountKey,
      expiresAt: session.session.expiresAt.getTime(),
      householdKey,
      linkageSubject,
      personId: person.id,
    };
  }).pipe(
    Effect.mapError(
      () => new PrivateOutputUnavailable({ reason: "authority_unavailable" })
    )
  );
