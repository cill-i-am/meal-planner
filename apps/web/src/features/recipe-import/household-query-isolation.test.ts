import { describe, expect, it } from "vitest";

import { recipeImportQueryKeys } from "./household-query-isolation.js";

describe("household query isolation", () => {
  it("keys private data by the Better Auth organization id", () => {
    expect(recipeImportQueryKeys.intent("household-a", "intent-1")).not.toEqual(
      recipeImportQueryKeys.intent("household-b", "intent-1")
    );
  });
});
