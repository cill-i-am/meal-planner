import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  RecipeContent,
  RecipeQuantity,
  RecipeInstructions,
  makeRecipeContent,
  recipeIngredientFromText,
  recipeInstructionFromText,
  recipeContentBlockers,
  formatRecipeIngredient,
} from "./content.js";
import { scaleRecipeIngredients } from "./scaling.js";

const servings = {
  max: null,
  original: "Serves 2",
  quantity: 2,
  unit: "serving",
} as const;
const recipe = makeRecipeContent({
  ingredients: [
    {
      ...recipeIngredientFromText("2–3 large tomatoes, chopped"),
      group: "Stew",
      name: "tomatoes",
      preparation: "chopped",
      quantity: { max: 3, unit: null, value: 2 },
      size: "large",
    },
    recipeIngredientFromText("salt to taste"),
  ],
  instructions: [
    {
      ...recipeInstructionFromText("Simmer the tomatoes.", 1),
      duration: { seconds: 600 },
      group: "Stew",
    },
  ],
  name: "Tomato stew",
  servings,
});
describe("structured recipe content", () => {
  it("keeps unknown quantities unknown while scaling known ranges without changing source", () => {
    const result = scaleRecipeIngredients(recipe, 4);
    expect(result._tag).toBe("Scaled");
    if (result._tag !== "Scaled") {
      throw new Error("Expected scalable recipe");
    }
    expect(result.ingredients[0]?.quantity).toEqual({
      max: 6,
      unit: null,
      value: 4,
    });
    expect(result.ingredients[0]?.original).toBe("2–3 large tomatoes, chopped");
    expect(result.ingredients[1]?.quantity).toBeNull();
    expect(result.unresolvedIngredientIndexes).toEqual([1]);
    expect(recipe.ingredients[0].quantity?.value).toBe(2);
    const [first, second] = result.ingredients;
    if (first === undefined || second === undefined) {
      throw new Error("Missing scaled ingredients");
    }
    expect(formatRecipeIngredient(first)).toBe("4–6 large tomatoes, chopped");
  });
  it("refuses to guess a baseline for ranged, unknown or non-serving yields", () => {
    expect(scaleRecipeIngredients({ ...recipe, servings: null }, 4)).toEqual({
      _tag: "CannotScale",
      reason: "unknown_servings",
    });
    expect(
      scaleRecipeIngredients(
        { ...recipe, servings: { ...servings, max: 4 } },
        4
      )
    ).toEqual({ _tag: "CannotScale", reason: "ambiguous_servings" });
    expect(
      scaleRecipeIngredients(
        { ...recipe, servings: { ...servings, unit: "cookie" } },
        4
      )
    ).toEqual({ _tag: "CannotScale", reason: "non_serving_yield" });
  });
  it("does not treat an unknown item yield as reference servings", () => {
    const result = scaleRecipeIngredients(
      {
        ...recipe,
        servings: {
          max: null,
          original: "Makes 24 cookies",
          quantity: 24,
          unit: null,
        },
      },
      4
    );
    expect(result).toEqual({
      _tag: "CannotScale",
      reason: "non_serving_yield",
    });
  });
  it("surfaces fractional whole items and packages instead of inventing precision", () => {
    const result = scaleRecipeIngredients(
      makeRecipeContent({
        ...recipe,
        ingredients: [
          {
            ...recipeIngredientFromText("1 egg"),
            name: "egg",
            quantity: { max: null, unit: null, value: 1 },
          },
          {
            ...recipeIngredientFromText("1 tin beans"),
            name: "beans",
            quantity: { max: null, unit: "tin", value: 1 },
          },
        ],
      }),
      3
    );
    expect(result._tag).toBe("Scaled");
    if (result._tag !== "Scaled") {
      throw new Error("Expected scaling preview");
    }
    expect(result.unresolvedIngredientIndexes).toEqual([0, 1]);
    expect(
      result.ingredients.every((ingredient) => ingredient.quantity === null)
    ).toBe(true);
    expect(result.ingredients[0]?.original).toBe("1 egg");
  });
  it("rejects malformed ranges, nonfinite amounts and disordered steps", () => {
    for (const value of [
      { max: 1, unit: "g", value: 2 },
      { max: null, unit: "g", value: Infinity },
      { max: null, unit: "g", value: -1 },
    ]) {
      expect(Schema.is(RecipeQuantity)(value)).toBe(false);
    }
    expect(
      Schema.is(RecipeInstructions)([recipeInstructionFromText("Cook.", 2)])
    ).toBe(false);
  });
  it("validates cross-references even while the title is unresolved", () => {
    const draft = {
      ...recipe,
      instructions: [
        { ...recipe.instructions[0], ingredients: ["invented"] },
      ] as const,
      name: null,
    };
    expect(recipeContentBlockers(draft)).toEqual({
      invalidFields: ["instructions"],
      unresolvedRequiredFields: ["name"],
    });
    expect(Schema.is(RecipeContent)({ ...draft, name: "Stew" })).toBe(false);
  });
  it("allows prep/cook overlap but rejects total smaller than an individual duration", () => {
    expect(
      recipeContentBlockers({
        ...recipe,
        times: {
          cook: { seconds: 1200 },
          inactive: null,
          prep: { seconds: 600 },
          total: { seconds: 1200 },
        },
      }).invalidFields
    ).toEqual([]);
    expect(
      recipeContentBlockers({
        ...recipe,
        times: {
          cook: { seconds: 1200 },
          inactive: null,
          prep: null,
          total: { seconds: 600 },
        },
      }).invalidFields
    ).toEqual(["times"]);
  });
  it("rejects duplicate claims and media with invalid step references", () => {
    const claim = {
      kind: "allergen",
      name: "milk",
      original: "Contains milk",
      source: "provided",
      value: true,
    } as const;
    expect(
      Schema.is(RecipeContent)({ ...recipe, dietary: [claim, claim] })
    ).toBe(false);
    expect(
      Schema.is(RecipeContent)({
        ...recipe,
        media: [
          {
            alt: null,
            caption: null,
            role: "step",
            step: 2,
            type: "image",
            url: "https://example.com/step.jpg",
          },
        ],
      })
    ).toBe(false);
  });
});
