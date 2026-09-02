import {
  HouseholdInvitationDigest,
  HouseholdPeopleAuditActorId,
  HouseholdPersonLinkageSubject,
} from "@meal-planner/household-api";
import type { HouseholdOrganizationId } from "@meal-planner/household-api";
import { Effect, Schema } from "effect";

import { HouseholdDigest } from "../shared-kernel/authority-services.js";
import { HouseholdDigestLive } from "../shared-kernel/authority-services.live.js";

export class HouseholdPeopleIdentityFailure {
  readonly _tag = "HouseholdPeopleIdentityFailure";
}

const peopleIdentityMaterial = (
  purpose: "audit-actor" | "invitation" | "linkage-subject",
  organizationId: HouseholdOrganizationId,
  subject: string
) =>
  JSON.stringify([
    "meal-planner/household-people",
    purpose,
    "v1",
    organizationId,
    subject,
  ]);

const derive = <A>(
  schema: Schema.Codec<A, string, never>,
  purpose: "audit-actor" | "invitation" | "linkage-subject",
  organizationId: HouseholdOrganizationId,
  subject: string
) =>
  Effect.gen(function* deriveHouseholdPeopleIdentity() {
    const digest = yield* HouseholdDigest;
    const value = yield* digest.sha256(
      peopleIdentityMaterial(purpose, organizationId, subject)
    );
    return yield* Schema.decodeUnknownEffect(schema)(value);
  }).pipe(
    Effect.mapError(() => new HouseholdPeopleIdentityFailure()),
    Effect.provide(HouseholdDigestLive)
  );

/** Household-scoped account subject derived only from immutable Better Auth user id. */
export const deriveHouseholdPersonLinkageSubject = (
  organizationId: HouseholdOrganizationId,
  userId: string
) =>
  derive(
    HouseholdPersonLinkageSubject,
    "linkage-subject",
    organizationId,
    userId
  );

/** Household-scoped, purpose-separated actor used only in audit records. */
export const deriveHouseholdPeopleAuditActorId = (
  organizationId: HouseholdOrganizationId,
  userId: string
) => derive(HouseholdPeopleAuditActorId, "audit-actor", organizationId, userId);

/** Purpose-bound digest of a Better Auth invitation id; raw ids stay API-local. */
export const deriveHouseholdInvitationDigest = (
  organizationId: HouseholdOrganizationId,
  invitationId: string
) =>
  derive(HouseholdInvitationDigest, "invitation", organizationId, invitationId);
