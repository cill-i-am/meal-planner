import { PlanningTags } from "@meal-planner/recipe-domain";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  CreateMealPlanPayload,
  DecideMealPlanPayload,
  MaximumMealPlanSlots,
  MaximumPreferredCuisines,
  MealPlanInstant,
  MealPlanPolicy,
  MealPlanPersistenceFailure,
  MealPlanRecipeSnapshotId,
  MealPlanRequest,
  SwapMealPlanPayload,
} from "./meal-plan.js";

const validCreatePayload = {
  policy: {
    allowedDietaryFit: ["household_match"],
    allowedDifficulties: ["easy"],
    allowedTotalTimeBands: ["under_30_minutes"],
    maxRecipeUses: 1,
    preferredCuisines: ["Mediterranean"],
    version: "policy-v1",
  },
  request: {
    requestKey: "week-1",
    slots: [
      {
        date: "2026-08-24",
        mealType: "dinner",
        servings: 2,
        slotId: "monday-dinner",
      },
    ],
  },
} as const;

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
      Schema.decodeUnknownSync(PlanningTags)({
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

  it.each([
    [
      "create",
      CreateMealPlanPayload,
      { ...validCreatePayload, organizationId: "browser-organization" },
    ],
    [
      "swap",
      SwapMealPlanPayload,
      {
        actorId: "browser-actor",
        expectedRevision: 0,
        mutationId: "swap-1",
        reason: "Use another approved recipe.",
        replacementImportId: "a9f513cb-d1cc-4ae8-99fb-20113da1b83a",
        slotId: "monday-dinner",
      },
    ],
    [
      "decide",
      DecideMealPlanPayload,
      {
        decidedAt: "2026-08-24T18:00:00.000Z",
        expectedRevision: 0,
        mutationId: "decision-1",
        reason: "The household reviewed this plan.",
      },
    ],
  ] as const)("rejects excess fields in the %s command", (_, schema, input) => {
    expect(() => Schema.decodeUnknownSync(schema)(input)).toThrow(
      /Expected no excess property/u
    );
  });

  it.each(["2026-99-99", "2026-02-29"])(
    "rejects the impossible calendar date %s",
    (date) => {
      expect(() =>
        Schema.decodeUnknownSync(CreateMealPlanPayload)({
          ...validCreatePayload,
          request: {
            ...validCreatePayload.request,
            slots: [
              {
                ...validCreatePayload.request.slots[0],
                date,
              },
            ],
          },
        })
      ).toThrow();
    }
  );

  it("accepts a real leap-day calendar date", () => {
    expect(() =>
      Schema.decodeUnknownSync(CreateMealPlanPayload)({
        ...validCreatePayload,
        request: {
          ...validCreatePayload.request,
          slots: [
            {
              ...validCreatePayload.request.slots[0],
              date: "2028-02-29",
            },
          ],
        },
      })
    ).not.toThrow();
  });
});
