import { HouseholdPerson, InvitationId } from "@meal-planner/household-api";
import { Effect, Schema } from "effect";
import { expect, it } from "vitest";

import { HouseholdPeopleOperationError } from "../household-people/client.js";
import type { HouseholdPeopleEffectOperations } from "../household-people/client.js";
import { PersonCreation } from "./person-commands.js";
import { savePerson } from "./person-save.js";

it("saves a managed adult without inviting them", async () => {
  const pending = Schema.decodeUnknownSync(PersonCreation)({
    kind: "managed",
    person: {
      displayName: "Jamie",
      kind: "adult",
      mutationId: "person-mutation-2222",
    },
  });
  const person = Schema.decodeUnknownSync(HouseholdPerson)({
    associationState: "unlinked",
    associationVersion: null,
    createdAtEpochMs: 1,
    displayName: "Jamie",
    id: "person_22222222-2222-4222-8222-222222222222",
    isCurrentAdult: false,
    kind: "adult",
    lifecycle: "active",
    updatedAtEpochMs: 1,
    version: 1,
  });
  const created: unknown[] = [];
  const invitations: unknown[] = [];
  const people: Pick<
    HouseholdPeopleEffectOperations,
    "create" | "inviteAdult"
  > = {
    create: (command) =>
      Effect.sync(() => {
        created.push(command);
        return person;
      }),
    inviteAdult: (command) =>
      Effect.sync(() => {
        invitations.push(command);
        throw new Error("Managed adults must not be invited");
      }),
  };
  const result = await Effect.runPromise(savePerson(pending, people));
  expect(created).toEqual([pending.person]);
  expect(invitations).toHaveLength(0);
  expect(result).toEqual({ invitationIssue: null, person });
});

it.each(["lost", "rejected"])(
  "resumes a %s invitation without recreating the person",
  async (outcome) => {
    const pending = Schema.decodeUnknownSync(PersonCreation)({
      email: "jamie@example.test",
      invitationMutationId: "invite-mutation-1111",
      kind: "invited",
      person: {
        displayName: "Jamie",
        kind: "adult",
        mutationId: "person-mutation-1111",
      },
    });
    const person = Schema.decodeUnknownSync(HouseholdPerson)({
      associationState: "unlinked",
      associationVersion: null,
      createdAtEpochMs: 1,
      displayName: "Jamie",
      id: "person_11111111-1111-4111-8111-111111111111",
      isCurrentAdult: false,
      kind: "adult",
      lifecycle: "active",
      updatedAtEpochMs: 1,
      version: 1,
    });
    let creates = 0;
    let invitations = 0;
    const commands: unknown[] = [];
    const people: Pick<
      HouseholdPeopleEffectOperations,
      "create" | "inviteAdult"
    > = {
      create: () =>
        Effect.sync(() => {
          creates += 1;
          return person;
        }),
      inviteAdult: (command) =>
        Effect.suspend(() => {
          commands.push(command);
          invitations += 1;
          if (invitations === 1) {
            if (outcome === "rejected") {
              return Effect.fail(
                new HouseholdPeopleOperationError("invitation_rejected", {
                  cause: {
                    code: "invitation_rejected",
                    reason: "already_member",
                  },
                })
              );
            }
            return Effect.fail(
              new HouseholdPeopleOperationError("transport_unavailable")
            );
          }
          return Effect.succeed({
            association: "associated",
            invitationId:
              Schema.decodeUnknownSync(InvitationId)("invitation-111111"),
            person,
          });
        }),
    };
    if (outcome === "lost") {
      await expect(
        Effect.runPromise(savePerson(pending, people))
      ).rejects.toThrow();
      const retry = Schema.decodeUnknownSync(
        Schema.fromJsonString(PersonCreation)
      )(JSON.stringify(pending));
      const result = await Effect.runPromise(savePerson(retry, people));
      expect(result.invitationIssue).toBeNull();
      expect(commands[1]).toEqual(commands[0]);
      // Same create key replays the saved person at the server.
      expect(creates).toBe(2);
    } else {
      const result = await Effect.runPromise(savePerson(pending, people));
      expect(result.person).toEqual(person);
      expect(result.invitationIssue?.invitationRejection).toBe(
        "already_member"
      );
      expect(creates).toBe(1);
      expect(invitations).toBe(1);
    }
  }
);
