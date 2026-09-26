import { SetupProgress } from "@meal-planner/household-api";
import { Schema } from "effect";
import { expect, it } from "vitest";

import { setupDestination } from "./setup-state.js";

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

it("resumes a roster operation on its original setup surface", () => {
  const checkpoint = {
    organizationId: "family-1",
    returnTo: { stage: "family-review" },
    stage: "person-manage",
    state: {
      command: { kind: "remove", mutationId: "remove-alex-1", person },
      phase: "pending",
    },
  };
  const parse = Schema.decodeUnknownSync(SetupProgress);
  expect(setupDestination(parse({ checkpoint, status: "active" }))).toBe(
    "/setup/review"
  );
  expect(
    setupDestination(
      parse({
        checkpoint: {
          ...checkpoint,
          returnTo: {
            draft: { email: "", name: "Jamie", participation: "" },
            stage: "person-draft",
          },
        },
        status: "active",
      })
    )
  ).toBe("/setup/people");
  expect(setupDestination(parse({ checkpoint, status: "paused" }))).toBe(
    "/setup/saved"
  );
});
