import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  MaximumMealPlanSlots,
  MaximumPreferredCuisines,
  MealPlanInstant,
  MealPlanPolicy,
  MealPlanPersistenceFailure,
  MealPlanRecipeSnapshotId,
  MealPlanRequest,
  MealPlanTags,
} from "./meal-plan.js";

describe("meal-plan contract", () => {
  it("owns its recipe snapshot primitives without a transport contract", () => {
    expect(
      Schema.decodeUnknownSync(MealPlanRecipeSnapshotId)(
        "018f47ad-91aa-7c35-b6fe-000000000401"
      )
    ).toBe("018f47ad-91aa-7c35-b6fe-000000000401");
    expect(
      Schema.encodeSync(MealPlanInstant)(
        Schema.decodeUnknownSync(MealPlanInstant)("2026-07-22T10:01:00.000Z")
      )
    ).toBe("2026-07-22T10:01:00.000Z");
    expect(
      Schema.decodeUnknownSync(MealPlanTags)({
        cuisines: ["Mediterranean"],
        dietaryFit: "household_match",
        difficulty: "easy",
        leftovers: "one_meal",
        mealTypes: ["dinner"],
        totalTimeBand: "under_30_minutes",
      })
    ).toMatchObject({
      dietaryFit: "household_match",
      leftovers: "one_meal",
      mealTypes: ["dinner"],
    });
  });

  it.each(["create", "read", "save"] as const)(
    "represents a safe %s persistence failure",
    (operation) => {
      expect(
        Schema.decodeUnknownSync(MealPlanPersistenceFailure)({
          _tag: "MealPlanPersistenceFailure",
          operation,
        })
      ).toEqual({ _tag: "MealPlanPersistenceFailure", operation });
    }
  );

  it("rejects operations outside the repository contract", () => {
    expect(() =>
      Schema.decodeUnknownSync(MealPlanPersistenceFailure)({
        _tag: "MealPlanPersistenceFailure",
        operation: "delete",
      })
    ).toThrow();
  });

  it("bounds plan fan-out and policy collections", () => {
    expect(() =>
      Schema.decodeUnknownSync(MealPlanRequest)({
        requestKey: "oversized-plan",
        slots: Array.from({ length: MaximumMealPlanSlots + 1 }, (_, index) => ({
          date: "2026-08-24",
          mealType: "dinner",
          servings: 2,
          slotId: `slot-${String(index + 1)}`,
        })),
      })
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(MealPlanPolicy)({
        allowedDietaryFit: ["household_match"],
        allowedDifficulties: ["easy"],
        allowedTotalTimeBands: ["under_30_minutes"],
        maxRecipeUses: 1,
        preferredCuisines: Array.from(
          { length: MaximumPreferredCuisines + 1 },
          (_, index) => `Cuisine ${String(index + 1)}`
        ),
        version: "policy-v1",
      })
    ).toThrow();
  });
});
