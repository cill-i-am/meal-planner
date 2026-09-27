import { it } from "@effect/vitest";
import {
  InvitationId,
  InvitationView,
  HouseholdPersonMutationId,
} from "@meal-planner/household-api";
import { Effect, Layer, Schema, Result } from "effect";
import { expect } from "vitest";

import {
  InvitationAuthority,
  InvitationMembership,
  InvitationResponseFailure,
  InvitationResponseService,
  InvitationResponseServiceLive,
} from "./application.js";

const id = Schema.decodeUnknownSync(InvitationId)("invitation-test");
const mutationId = Schema.decodeUnknownSync(HouseholdPersonMutationId)(
  "join-request-test"
);
const view = (status: (typeof InvitationView.Type)["status"]) =>
  Schema.decodeUnknownSync(InvitationView)({
    email: "person@example.test",
    familyName: "Family",
    id,
    inviterName: "Owner",
    organizationId: "family-test",
    status,
  });

it.effect(
  "resumes an accepted invitation after linking failed, preserving the submission identity",
  () =>
    Effect.gen(function* retryAcceptance() {
      let status: (typeof InvitationView.Type)["status"] = "pending";
      let acceptCalls = 0;
      const links: string[] = [];
      const live = InvitationResponseServiceLive.pipe(
        Layer.provide(
          Layer.succeed(InvitationAuthority, {
            accept: () =>
              Effect.sync(() => {
                acceptCalls += 1;
                status = "accepted";
              }),
            decline: () => Effect.die("Unexpected decline"),
            read: () => Effect.sync(() => view(status)),
          })
        ),
        Layer.provide(
          Layer.succeed(InvitationMembership, {
            link: (_familyId, _invitationId, key) =>
              Effect.suspend(() => {
                links.push(key);
                return links.length === 1
                  ? Effect.fail(
                      new InvitationResponseFailure({ reason: "unavailable" })
                    )
                  : Effect.void;
              }),
          })
        )
      );
      const respond = InvitationResponseService.use((service) =>
        service.respond(id, { decision: "accept", mutationId })
      ).pipe(Effect.provide(live));
      const first = yield* Effect.result(respond);
      expect(Result.isFailure(first) && first.failure.reason).toBe(
        "unavailable"
      );
      expect(yield* respond).toEqual({
        familyId: "family-test",
        status: "joined",
      });
      expect(acceptCalls).toBe(1);
      expect(links).toEqual([mutationId, mutationId]);
    })
);

it.effect(
  "a repeated decline does not grant access or create a household link",
  () =>
    Effect.gen(function* replayDecline() {
      const live = InvitationResponseServiceLive.pipe(
        Layer.provide(
          Layer.succeed(InvitationAuthority, {
            accept: () => Effect.die("Unexpected acceptance"),
            decline: () => Effect.die("Already declined"),
            read: () => Effect.succeed(view("rejected")),
          })
        ),
        Layer.provide(
          Layer.succeed(InvitationMembership, {
            link: () => Effect.die("A decline cannot link a person"),
          })
        )
      );
      const result = yield* InvitationResponseService.use((service) =>
        service.respond(id, { decision: "decline", mutationId })
      ).pipe(Effect.provide(live));
      expect(result.status).toBe("declined");
    })
);
