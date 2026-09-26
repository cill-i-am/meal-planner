// @vitest-environment jsdom
import { InviteHouseholdAdultPayload } from "@meal-planner/household-api";
import { Schema } from "effect";
import { afterEach, expect, it } from "vitest";

import { parseDisplayedIdentity } from "../auth/displayed-identity.js";
import {
  clearInvitationIntent,
  retainedHouseholdPeopleIntents,
  retainInvitationIntent,
} from "./retained-intents.js";

afterEach(() => globalThis.sessionStorage.clear());

it("retains the exact uncertain invitation for its original actor and family only", () => {
  const original = parseDisplayedIdentity({
    organizationId: "family-a",
    userId: "alice",
  });
  const invitation = Schema.decodeUnknownSync(InviteHouseholdAdultPayload)({
    email: "recipient@example.test",
    mutationId: "00000000-0000-4000-8000-000000000101",
    personId: "person_00000000-0000-4000-8000-000000000102",
  });
  retainInvitationIntent(original, invitation);
  expect(
    retainedHouseholdPeopleIntents(
      parseDisplayedIdentity({ ...original, userId: "bob" })
    ).invitation
  ).toBeNull();
  expect(
    retainedHouseholdPeopleIntents(
      parseDisplayedIdentity({ ...original, organizationId: "family-b" })
    ).invitation
  ).toBeNull();
  clearInvitationIntent(parseDisplayedIdentity({ ...original, userId: "bob" }));
  expect(retainedHouseholdPeopleIntents(original).invitation).toEqual(
    invitation
  );
  clearInvitationIntent(original);
  expect(retainedHouseholdPeopleIntents(original).invitation).toBeNull();
});
