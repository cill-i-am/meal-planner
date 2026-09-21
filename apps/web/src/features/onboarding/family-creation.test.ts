import { HouseholdPerson, SetupCheckpoint } from "@meal-planner/household-api";
import { Schema } from "effect";
import { expect, it } from "vitest";

import { makeAuthClient } from "../auth/auth-client.js";
import type { HouseholdPeopleOperations } from "../household-people/operations.js";
import { completeFamilyCreation } from "./family-creation.js";

const command = Schema.decodeUnknownSync(SetupCheckpoint)({
  creator: { displayName: "Alex", mutationId: "bootstrap-11111111" },
  name: "Morgan family",
  slug: "family-11111111-1111-4111-8111-111111111111",
  stage: "family-create",
});
const person = Schema.decodeUnknownSync(HouseholdPerson)({
  associationState: "linked",
  associationVersion: 1,
  createdAtEpochMs: 1,
  displayName: "Alex",
  id: "person_11111111-1111-4111-8111-111111111111",
  isCurrentAdult: true,
  kind: "adult",
  lifecycle: "active",
  updatedAtEpochMs: 1,
  version: 1,
});

it.each(["creation", "bootstrap"])(
  "reconciles a lost %s response without creating a second family or person",
  async (lost) => {
    if (command.stage !== "family-create") {
      throw new Error("Expected creation command");
    }
    const family = { id: "family-id", name: command.name, slug: command.slug };
    let created = false;
    let linked = false;
    let createCalls = 0;
    let bootstrapCalls = 0;
    const payloads: unknown[] = [];
    const transport: typeof fetch = async (input, init) => {
      const request = new Request(
        new URL(
          input instanceof Request ? input.url : input.toString(),
          "http://localhost"
        ),
        init
      );
      const path = new URL(request.url).pathname;
      if (path.endsWith("/list")) {
        return Response.json(created ? [family] : []);
      }
      if (path.endsWith("/set-active")) {
        return Response.json(family);
      }
      if (path.endsWith("/create")) {
        createCalls += 1;
        payloads.push(await request.json());
        created = true;
        if (lost === "creation") {
          throw new TypeError("Connection lost after write");
        }
        return Response.json(family);
      }
      return Response.json({}, { status: 404 });
    };
    const people: Pick<HouseholdPeopleOperations, "list" | "bootstrapCreator"> =
      {
        bootstrapCreator: async (payload) => {
          bootstrapCalls += 1;
          expect(payload).toEqual(command.creator);
          linked = true;
          if (lost === "bootstrap") {
            throw new TypeError("Connection lost after bootstrap");
          }
          return person;
        },
        list: async () => ({
          creatorSlot: linked ? "occupied" : "available",
          currentPersonId: linked ? person.id : null,
          people: linked ? [person] : [],
        }),
      };
    const auth = makeAuthClient(transport);
    await expect(
      completeFamilyCreation(command, auth, (id) => {
        expect(id).toBe(family.id);
        return people;
      })
    ).rejects.toThrow();
    await expect(
      completeFamilyCreation(command, auth, (id) => {
        expect(id).toBe(family.id);
        return people;
      })
    ).resolves.toEqual({ organizationId: family.id, stage: "family-review" });
    expect(createCalls).toBe(1);
    expect(bootstrapCalls).toBe(1);
    expect(payloads).toEqual([{ name: command.name, slug: command.slug }]);
  }
);
