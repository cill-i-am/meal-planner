import {
  HouseholdPerson,
  InvitationId,
  SetupCheckpoint,
} from "@meal-planner/household-api";
import { Effect, Schema } from "effect";
import { expect, it } from "vitest";

import { HouseholdPeopleOperationError } from "../household-people/operations.js";
import type { HouseholdPeopleEffectOperations } from "../household-people/operations.js";
import { saveSetupPerson } from "./person-save.js";

it("saves a managed adult without inviting them", async () => {
  const pending = Schema.decodeUnknownSync(SetupCheckpoint)({
    command: {
      kind: "managed",
      person: {
        displayName: "Jamie",
        kind: "adult",
        mutationId: "person-mutation-2222",
      },
    },
    organizationId: "family-id",
    stage: "person-create",
  });
  if (pending.stage !== "person-create") {
    throw new Error("Expected pending creation");
  }
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
  const saved: SetupCheckpoint[] = [];
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
  await Effect.runPromise(
    saveSetupPerson(pending, people, (next) =>
      Effect.sync(() => {
        saved.push(next);
      })
    )
  );
  expect(created).toEqual([pending.command.person]);
  expect(invitations).toHaveLength(0);
  expect(saved).toEqual([
    { organizationId: "family-id", stage: "family-review" },
  ]);
});

it.each(["lost", "rejected"])(
  "resumes a %s invitation without recreating the person",
  async (outcome) => {
    const pending = Schema.decodeUnknownSync(SetupCheckpoint)({
      command: {
        email: "jamie@example.test",
        invitationMutationId: "invite-mutation-1111",
        kind: "invited",
        person: {
          displayName: "Jamie",
          kind: "adult",
          mutationId: "person-mutation-1111",
        },
      },
      organizationId: "family-id",
      stage: "person-create",
    });
    if (pending.stage !== "person-create") {
      throw new Error("Expected pending creation");
    }
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
    let saved: SetupCheckpoint = pending;
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
    const checkpoint = (next: SetupCheckpoint) =>
      Effect.sync(() => {
        saved = next;
      });
    await (outcome === "lost"
      ? expect(
          Effect.runPromise(saveSetupPerson(pending, people, checkpoint))
        ).rejects.toThrow()
      : Effect.runPromise(saveSetupPerson(pending, people, checkpoint)));
    const serialized = JSON.stringify(saved);
    const resumed = Schema.decodeUnknownSync(
      Schema.fromJsonString(SetupCheckpoint)
    )(serialized);
    if (resumed.stage === "person-invite-draft") {
      expect(resumed.reason).toBe("already_member");
      await Effect.runPromise(
        saveSetupPerson(
          {
            command: {
              email:
                pending.command.kind === "invited"
                  ? pending.command.email
                  : (() => {
                      throw new Error("Expected invited command");
                    })(),
              mutationId: pending.command.person.mutationId,
              personId: resumed.personId,
            },
            displayName: resumed.displayName,
            organizationId: resumed.organizationId,
            stage: "person-invite",
          },
          people,
          checkpoint
        )
      );
    } else if (resumed.stage === "person-invite") {
      await Effect.runPromise(saveSetupPerson(resumed, people, checkpoint));
      expect(commands[1]).toEqual(commands[0]);
    } else {
      throw new Error("Expected saved invitation");
    }
    expect(creates).toBe(1);
    expect(saved).toEqual({
      organizationId: "family-id",
      stage: "family-review",
    });
  }
);
