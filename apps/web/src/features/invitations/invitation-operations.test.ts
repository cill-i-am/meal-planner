import {
  HouseholdPerson,
  InvitationView,
  SetupCheckpoint,
} from "@meal-planner/household-api";
import { Schema } from "effect";
import { expect, it } from "vitest";

import { makeAuthClient } from "../auth/auth-client.js";
import type { HouseholdPeopleOperations } from "../household-people/operations.js";
import { completeInvitation } from "./invitation-operations.js";

it.each(["accept", "decline"] as const)(
  "reconciles a lost %s result using the original response and link command",
  async (decision) => {
    const pending = Schema.decodeUnknownSync(SetupCheckpoint)({
      decision,
      invitationId: "invite-synthetic",
      linkMutationId: "link-mutation-1111",
      organizationId: "family-synthetic",
      returnCheckpoint: {
        organizationId: "prior-family",
        stage: "family-review",
      },
      stage: "invitation-response",
    });
    if (pending.stage !== "invitation-response") {
      throw new Error("Expected response checkpoint");
    }
    let status: InvitationView["status"] = "pending";
    let responses = 0;
    let links = 0;
    let saved: SetupCheckpoint = pending;
    const linkCommands: unknown[] = [];
    const person = Schema.decodeUnknownSync(HouseholdPerson)({
      associationState: "linked",
      associationVersion: 1,
      createdAtEpochMs: 1,
      displayName: "Taylor",
      id: "person_11111111-1111-4111-8111-111111111111",
      isCurrentAdult: true,
      kind: "adult",
      lifecycle: "active",
      updatedAtEpochMs: 1,
      version: 2,
    });
    const people: HouseholdPeopleOperations = {
      archive: async () => person,
      bootstrapCreator: async () => person,
      completeAdultLink: async (command) => {
        linkCommands.push(command);
        links += 1;
        if (links === 1) {
          throw new Error("Link response lost");
        }
        return person;
      },
      create: async () => person,
      list: async () => ({
        creatorSlot: "occupied",
        currentPersonId: null,
        people: [],
      }),
      restore: async () => person,
    };
    const transport: typeof fetch = async () => {
      responses += 1;
      status = decision === "accept" ? "accepted" : "rejected";
      if (decision === "decline") {
        throw new Error("Decline response lost");
      }
      return Response.json({ id: "invite-synthetic" });
    };
    const dependencies = {
      activate: () => Promise.resolve(),
      auth: makeAuthClient(transport),
      people,
      read: async () =>
        Schema.decodeUnknownSync(InvitationView)({
          email: "taylor@example.test",
          familyName: "Synthetic family",
          id: "invite-synthetic",
          inviterName: "Alex",
          organizationId: "family-synthetic",
          status,
        }),
      save: async (next: SetupCheckpoint) => {
        saved = next;
      },
    };
    await expect(completeInvitation(pending, dependencies)).rejects.toThrow();
    const serialized = JSON.stringify(saved);
    const resumed = Schema.decodeUnknownSync(
      Schema.fromJsonString(SetupCheckpoint)
    )(serialized);
    if (
      resumed.stage !== "invitation-link" &&
      resumed.stage !== "invitation-response"
    ) {
      throw new Error("Expected retained invitation");
    }
    expect(await completeInvitation(resumed, dependencies)).toBe(
      decision === "accept" ? "joined" : "declined"
    );
    expect(responses).toBe(1);
    if (decision === "accept") {
      expect(linkCommands[1]).toEqual(linkCommands[0]);
      expect(saved).toMatchObject({
        organizationId: "family-synthetic",
        stage: "ready",
      });
    } else {
      expect(links).toBe(0);
      expect(saved).toEqual({
        organizationId: "prior-family",
        stage: "family-review",
      });
    }
  }
);
