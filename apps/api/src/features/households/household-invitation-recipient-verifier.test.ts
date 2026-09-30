import {
  HouseholdOrganizationId,
  InvitationId,
  UserId,
} from "@meal-planner/household-api";
import { Context, Effect, Option, Schema } from "effect";
import { expect, it } from "vitest";

import type { HouseholdDomainWorkerMethods } from "./household-domain-worker.js";
import { makeHouseholdInvitationRecipientVerifier } from "./household-request-composition.js";

class RequestMarker extends Context.Service<RequestMarker, string>()(
  "RequestMarker"
) {}

it("keeps each request's Effect services when Better Auth invokes the verifier", async () => {
  const seen: string[] = [];
  const domain: Pick<
    HouseholdDomainWorkerMethods,
    "confirmAdultInvitationRecipient"
  > = {
    confirmAdultInvitationRecipient: () =>
      Effect.gen(function* confirmInvitation() {
        const marker = yield* Effect.serviceOption(RequestMarker);
        if (Option.isNone(marker)) {
          return yield* Effect.die("Request service was lost");
        }
        seen.push(marker.value);
      }),
  };
  const makeForRequest = (marker: string) =>
    Effect.runPromise(
      makeHouseholdInvitationRecipientVerifier(domain).pipe(
        Effect.provideService(RequestMarker, marker)
      )
    );
  const [first, second] = await Promise.all([
    makeForRequest("first"),
    makeForRequest("second"),
  ]);
  const input = {
    invitationId: Schema.decodeUnknownSync(InvitationId)("invitation-1"),
    organizationId: Schema.decodeUnknownSync(HouseholdOrganizationId)(
      "family-1"
    ),
    userId: Schema.decodeUnknownSync(UserId)("user-1"),
  };

  await Promise.all([first(input), second(input)]);

  expect(seen.toSorted()).toEqual(["first", "second"]);
});
