import { Family } from "@meal-planner/families";
import { Schema } from "effect";
import { expect, it } from "vitest";

import { setupDestination } from "./setup-state.js";

it("chooses a default entry from saved family state without remembering a screen", () => {
  const family = Schema.decodeUnknownSync(Family)({
    canManage: true,
    createdAtEpochMs: 1,
    id: "family-1",
    name: "Family",
    setup: { status: "in_progress" },
    slug: "family",
    updatedAtEpochMs: 1,
    version: 1,
  });
  expect(setupDestination(undefined)).toBe("/setup/family");
  expect(setupDestination(family)).toBe("/setup/review");
  expect(
    setupDestination({
      ...family,
      setup: { completedAtEpochMs: 2, status: "complete" },
    })
  ).toBe("/");
});
