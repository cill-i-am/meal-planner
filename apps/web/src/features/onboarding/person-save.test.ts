import {
  HouseholdPerson,
  InvitationId,
  SetupCheckpoint,
} from "@meal-planner/household-api";
import { Schema } from "effect";
import { expect, it } from "vitest";

import { HouseholdPeopleOperationError } from "../household-people/operations.js";
import type { HouseholdPeopleOperations } from "../household-people/operations.js";
import { saveSetupPerson } from "./person-save.js";

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
    const people: HouseholdPeopleOperations = {
      archive: async () => person,
      bootstrapCreator: async () => person,
      create: async () => {
        creates += 1;
        return person;
      },
      inviteAdult: async (command) => {
        commands.push(command);
        invitations += 1;
        if (invitations === 1) {
          if (outcome === "rejected") {
            throw new HouseholdPeopleOperationError("invitation_rejected", {
              cause: { code: "invitation_rejected", reason: "already_member" },
            });
          }
          throw new Error("Lost invitation response");
        }
        return {
          association: "associated",
          invitationId:
            Schema.decodeUnknownSync(InvitationId)("invitation-111111"),
          person,
        };
      },
      list: async () => ({
        creatorSlot: "occupied",
        currentPersonId: null,
        people: [person],
      }),
      restore: async () => person,
    };
    const checkpoint = async (next: SetupCheckpoint) => {
      saved = next;
    };
    await (outcome === "lost"
      ? expect(saveSetupPerson(pending, people, checkpoint)).rejects.toThrow()
      : saveSetupPerson(pending, people, checkpoint));
    const serialized = JSON.stringify(saved);
    const resumed = Schema.decodeUnknownSync(
      Schema.fromJsonString(SetupCheckpoint)
    )(serialized);
    if (resumed.stage === "person-invite-draft") {
      expect(resumed.reason).toBe("already_member");
      await saveSetupPerson(
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
      );
    } else if (resumed.stage === "person-invite") {
      await saveSetupPerson(resumed, people, checkpoint);
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
