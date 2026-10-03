import {
  makeRecipeContent,
  recipeIngredientFromText,
  recipeInstructionFromText,
  PlanningTags,
} from "@meal-planner/recipe-domain";
import { Context, Schema } from "effect";
import { HttpApi } from "effect/http-api";
import { describe, expect, it } from "vitest";

import { HouseholdMealPlanApi } from "./index.js";
import {
  CreateMealPlanPayload,
  DecideMealPlanPayload,
  MaximumMealPlanSlots,
  MaximumPreferredCuisines,
  MealPlanInstant,
  MealPlanPolicy,
  MealPlanPersistenceFailure,
  MealPlanRecipeSnapshotId,
  MealPlanRecipeSnapshot,
  MealPlanRequest,
  SwapMealPlanPayload,
} from "./meal-plan.js";

const validCreatePayload = {
  policy: {
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
  it("preserves structured cooking facts in the approved planning snapshot", () => {
    const recipe = makeRecipeContent({
      ingredients: [
        {
          ...recipeIngredientFromText("400 g beans, drained"),
          group: "Stew",
          ingredientId: "beans",
          name: "beans",
          preparation: "drained",
          quantity: { max: null, unit: "g", value: 400 },
        },
      ],
      instructions: [
        {
          ...recipeInstructionFromText("Simmer the beans.", 1),
          duration: { seconds: 600 },
          group: "Stew",
          ingredients: ["beans"],
        },
      ],
      name: "Bean stew",
      notes: ["Refrigerate leftovers."],
      servings: {
        max: null,
        original: "Serves 4",
        quantity: 4,
        unit: "servings",
      },
      times: {
        cook: { seconds: 600 },
        inactive: null,
        prep: { seconds: 300 },
        total: { seconds: 900 },
      },
    });
    const snapshot = Schema.decodeUnknownSync(MealPlanRecipeSnapshot)({
      approvedAt: "2026-07-22T10:01:00.000Z",
      extractionFingerprint: "extraction",
      importId: "018f47ad-91aa-7c35-b6fe-000000000401",
      recipe,
      source: { evidenceFingerprint: "evidence", sourceUrl: null },
      tags: {
        cuisines: ["Mediterranean"],
        difficulty: "easy",
        leftovers: "one_meal",
        mealTypes: ["dinner"],
        totalTimeBand: "under_30_minutes",
      },
      version: 1,
    });
    expect(Schema.encodeSync(MealPlanRecipeSnapshot)(snapshot).recipe).toEqual(
      recipe
    );
  });

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
        difficulty: "easy",
        leftovers: "one_meal",
        mealTypes: ["dinner"],
        totalTimeBand: "under_30_minutes",
      })
    ).toMatchObject({
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
    expect(() =>
      Schema.decodeUnknownSync(
        schema,
        Context.getUnsafe(
          HouseholdMealPlanApi.annotations,
          HttpApi.PayloadParseOptions
        )
      )(input)
    ).toThrow(/Expected no excess property/u);
  });

  it.each(["2026-99-99", "2026-02-29"])(
    "rejects the impossible calendar date %s",
    (date) => {
      expect(() =>
        Schema.decodeUnknownSync(CreateMealPlanPayload, {
          onExcessProperty: "error",
        })({
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
      Schema.decodeUnknownSync(CreateMealPlanPayload, {
        onExcessProperty: "error",
      })({
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
