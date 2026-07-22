import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  makeSyntheticMealPlanTracer,
  syntheticMealPlanRequest,
  syntheticPlanningPolicy,
} from "./meal-plan.fake.js";

describe("provider-free meal-plan tracer", () => {
  it("creates an approved-only deterministic draft with explicit hard-constraint gaps", async () => {
    const tracer = makeSyntheticMealPlanTracer();

    const first = await Effect.runPromise(
      tracer.service.create(syntheticMealPlanRequest, syntheticPlanningPolicy)
    );
    const replay = await Effect.runPromise(
      tracer.service.create(syntheticMealPlanRequest, syntheticPlanningPolicy)
    );

    expect(first).toEqual(replay);
    expect(first._tag).toBe("Draft");
    expect(first.revision).toBe(0);
    expect(first.meals).toHaveLength(1);
    expect(first.meals[0]).toMatchObject({
      reasons: [
        "approved_recipe",
        "meal_type_match",
        "hard_constraints_satisfied",
        "preferred_cuisine",
      ],
      relevantTags: {
        cuisines: ["Synthetic Mediterranean"],
        dietaryFit: "household_match",
        difficulty: "easy",
        leftovers: "one_meal",
        mealTypes: ["dinner"],
        totalTimeBand: "under_30_minutes",
      },
      servings: 2,
      slotId: "synthetic-dinner",
      sourceRecipe: {
        recipe: { name: "Synthetic Tomato Orzo" },
      },
    });
    expect(first.gaps).toEqual([
      {
        reason: "no_eligible_approved_recipe",
        slotId: "synthetic-breakfast",
      },
    ]);
    expect(
      first.meals.some(
        ({ sourceRecipe }) =>
          sourceRecipe.recipe.name === "Synthetic Rejected Pancakes"
      )
    ).toBe(false);
    expect(tracer.drafts).toHaveLength(1);
  });
});
