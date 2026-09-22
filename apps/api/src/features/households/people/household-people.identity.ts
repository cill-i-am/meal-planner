import {
  HouseholdInvitationDigest,
  HouseholdInvitationRequestDigest,
  HouseholdPeopleAuditActorId,
  HouseholdPersonLinkageSubject,
  InvitationId,
} from "@meal-planner/household-api";
import type {
  EmailAddress,
  HouseholdOrganizationId,
  HouseholdPersonMutationId,
  UserId,
} from "@meal-planner/household-api";
import { Effect, Schema } from "effect";

import { HouseholdDigest } from "../shared-kernel/authority-services.js";
import { HouseholdDigestLive } from "../shared-kernel/authority-services.live.js";

export class HouseholdPeopleIdentityFailure {
  readonly _tag = "HouseholdPeopleIdentityFailure";
}

const decodeInvitationId = Schema.decodeUnknownEffect(InvitationId);

const peopleIdentityMaterial = (
  purpose:
    | "audit-actor"
    | "invitation"
    | "invitation-operation"
    | "invitation-request"
    | "linkage-subject",
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
  purpose:
    | "audit-actor"
    | "invitation"
    | "invitation-operation"
    | "invitation-request"
    | "linkage-subject",
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
  userId: UserId
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
  userId: UserId
) => derive(HouseholdPeopleAuditActorId, "audit-actor", organizationId, userId);

/** Purpose-bound digest of a Better Auth invitation id; raw ids stay API-local. */
export const deriveHouseholdInvitationDigest = (
  organizationId: HouseholdOrganizationId,
  invitationId: typeof InvitationId.Type
) =>
  derive(HouseholdInvitationDigest, "invitation", organizationId, invitationId);

/** Exact Better Auth invitation id derived from one household-scoped mutation. */
export const deriveHouseholdInvitationId = (
  organizationId: HouseholdOrganizationId,
  mutationId: typeof HouseholdPersonMutationId.Type
) =>
  derive(
    HouseholdInvitationDigest,
    "invitation-operation",
    organizationId,
    mutationId
  ).pipe(
    Effect.flatMap((digest) =>
      decodeInvitationId(`household_invitation_${digest}`)
    ),
    Effect.mapError(() => new HouseholdPeopleIdentityFailure())
  );

/** Digest retaining the exact API-local invitation payload without storing email in Household. */
export const deriveHouseholdInvitationRequestDigest = (
  organizationId: HouseholdOrganizationId,
  input: {
    readonly email: EmailAddress;
    readonly invitationId: typeof InvitationId.Type;
  }
) =>
  derive(
    HouseholdInvitationRequestDigest,
    "invitation-request",
    organizationId,
    JSON.stringify([input.invitationId, input.email])
  );
