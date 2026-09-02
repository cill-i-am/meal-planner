import {
  HouseholdInvitationDigest,
  HouseholdPeopleAuditActorId,
  HouseholdPersonLinkageSubject,
} from "@meal-planner/household-api";
import type { HouseholdOrganizationId } from "@meal-planner/household-api";
import { Effect, Schema } from "effect";

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

const sha256 = (value: string) =>
  Effect.tryPromise({
    catch: () => new HouseholdPeopleIdentityFailure(),
    try: async () => {
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(value)
      );
      return Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0")
      ).join("");
    },
  });

const derive = <A>(
  schema: Schema.Codec<A, string, never>,
  purpose: "audit-actor" | "invitation" | "linkage-subject",
  organizationId: HouseholdOrganizationId,
  subject: string
) =>
  sha256(peopleIdentityMaterial(purpose, organizationId, subject)).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(schema)),
    Effect.mapError(() => new HouseholdPeopleIdentityFailure())
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
