import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { SetupProgress } from "./onboarding.js";

const parse = Schema.decodeUnknownSync(SetupProgress);
const person = {
  associationState: "unlinked",
  associationVersion: null,
  createdAtEpochMs: 1,
  displayName: "Alex",
  id: "person_11111111-1111-4111-8111-111111111111",
  isCurrentAdult: false,
  kind: "adult",
  lifecycle: "active",
  updatedAtEpochMs: 1,
  version: 2,
};
describe("setup checkpoint contract", () => {
  it("retains an exact family creation across save and resume", () => {
    const checkpoint = {
      creator: { displayName: "Alex", mutationId: "creator-mutation-1" },
      name: "The Morgan family",
      slug: "family-11111111-1111-4111-8111-111111111111",
      stage: "family-create",
    };
    expect(parse({ checkpoint, status: "paused" }).checkpoint).toEqual(
      checkpoint
    );
  });
  it("rejects secrets and invalid steps rather than persisting a loose draft", () => {
    expect(() =>
      parse({
        checkpoint: {
          name: "Family",
          password: "never-save",
          stage: "family-name",
        },
        status: "paused",
      })
    ).toThrow();
    expect(() =>
      parse({ checkpoint: { stage: "invented" }, status: "active" })
    ).toThrow();
  });

  it("retains the interrupted person draft and exact roster removal across resume", () => {
    const checkpoint = {
      organizationId: "family-1",
      returnTo: {
        draft: {
          email: "jamie@",
          invite: true,
          name: "Jamie",
          participation: "adult",
        },
        stage: "person-draft",
      },
      stage: "person-manage",
      state: {
        command: { kind: "remove", mutationId: "remove-alex-1", person },
        phase: "pending",
      },
    };
    expect(parse({ checkpoint, status: "paused" }).checkpoint).toEqual(
      checkpoint
    );
  });

  it("allows unfinished invitation text only before dispatch and rejects extra stored fields", () => {
    const checkpoint = {
      organizationId: "family-1",
      returnTo: { stage: "family-review" },
      stage: "person-manage",
      state: {
        action: { email: "alex@", kind: "invite", person },
        phase: "draft",
      },
    };
    expect(parse({ checkpoint, status: "active" }).checkpoint).toEqual(
      checkpoint
    );
    expect(() =>
      parse({
        checkpoint: {
          ...checkpoint,
          state: {
            command: {
              email: "alex@",
              kind: "invite",
              mutationId: "invite-alex-1",
              person,
            },
            phase: "pending",
          },
        },
        status: "active",
      })
    ).toThrow();
    expect(() =>
      parse({
        checkpoint: {
          ...checkpoint,
          state: { ...checkpoint.state, password: "never-store" },
        },
        status: "active",
      })
    ).toThrow();
  });
});
