import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { SetupProgress } from "./onboarding.js";

const parse = Schema.decodeUnknownSync(SetupProgress);
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
});
