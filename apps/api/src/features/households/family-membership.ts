import {
  FamilyFailure,
  HouseholdCreator,
} from "@meal-planner/families/application";
import { Effect, Layer } from "effect";

import type { HouseholdDomainWorkerMethods } from "./household-domain-worker.js";
import {
  deriveHouseholdPeopleAuditActorId,
  deriveHouseholdPersonLinkageSubject,
} from "./people/household-people.identity.js";
import { makeHouseholdPeopleCreatorAdmission } from "./rpc/command-envelope.js";

/** Adapter at the household boundary; identity derivation and signed RPC remain private. */
export const HouseholdCreatorLive = (
  domain: Pick<HouseholdDomainWorkerMethods, "bootstrapCreatorPerson">
) =>
  Layer.succeed(HouseholdCreator, {
    link: (input) =>
      Effect.gen(function* linkCreator() {
        const [actorId, linkageSubject] = yield* Effect.all([
          deriveHouseholdPeopleAuditActorId(input.familyId, input.userId),
          deriveHouseholdPersonLinkageSubject(input.familyId, input.userId),
        ]);
        const admission = yield* makeHouseholdPeopleCreatorAdmission({
          actorId,
          creatorAuthority: "better_auth_owner",
          linkageSubject,
          organizationId: input.familyId,
        });
        yield* domain.bootstrapCreatorPerson({
          admission,
          payload: {
            displayName: input.displayName,
            mutationId: input.mutationId,
          },
        });
      }).pipe(
        Effect.mapError(() => new FamilyFailure({ reason: "unavailable" }))
      ),
  });
