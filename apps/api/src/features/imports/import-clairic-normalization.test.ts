import { describe, expect, it } from "vitest";

import { normalizeClairicRecipePhrases } from "./import-clairic-normalization.js";
import { groundRecipeCandidate } from "./import-recipe-grounding.js";

const phrases = {
  cook: null,
  inactive: null,
  ingredients: ["1½ cups onions, finely chopped", "2–3 g salt (optional)"],
  instructions: ["Cook the onions for 10 minutes.", "Bake at 180°C."],
  name: "Onion soup",
  prep: "Prep time: 5 minutes",
  servings: "Serves 4",
  total: null,
};

describe("Clairic local phrase normalization", () => {
  it("retains raw phrases and locally supported structure through the existing grounder", () => {
    const candidate = normalizeClairicRecipePhrases(phrases);
    const grounded = groundRecipeCandidate(candidate, [
      {
        artifactReference: "private:transcript",
        evidenceId: "source",
        kind: "transcript",
        origin: "creator_provided",
        value: [
          phrases.name,
          ...phrases.ingredients,
          ...phrases.instructions,
          phrases.servings,
          phrases.prep,
        ].join("\n"),
      },
    ]);
    expect(grounded.recipe.ingredients?.[0]).toMatchObject({
      name: "onions",
      original: "1½ cups onions, finely chopped",
      preparation: "finely chopped",
      quantity: { max: null, unit: "cups", value: 1.5 },
    });
    expect(grounded.recipe.ingredients?.[1]).toMatchObject({
      name: "2–3 g salt (optional)",
      optional: true,
      original: "2–3 g salt (optional)",
      quantity: { max: 3, unit: "g", value: 2 },
    });
    expect(grounded.recipe.instructions?.[0]?.duration).toEqual({
      seconds: 600,
    });
    expect(grounded.recipe.instructions?.[1]?.temperature).toEqual({
      unit: "C",
      value: 180,
    });
    expect(grounded.recipe.servings).toEqual({
      max: null,
      original: "Serves 4",
      quantity: 4,
      unit: "serving",
    });
    expect(grounded.recipe.times.prep).toEqual({ seconds: 300 });
  });

  it("leaves missing and ambiguous structured values unresolved", () => {
    const candidate = normalizeClairicRecipePhrases({
      ...phrases,
      ingredients: ["salt to taste", "1/0 cup flour"],
      instructions: ["Cook 5–10 minutes, then rest for 2 minutes."],
      name: null,
      prep: null,
      servings: null,
    });
    expect(candidate.name).toBeNull();
    expect(
      candidate.ingredients?.map((ingredient) => ingredient.quantity)
    ).toEqual([null, null]);
    expect(candidate.instructions?.[0]?.duration).toBeNull();
    expect(candidate.servings).toBeNull();
    expect(candidate.times.prep).toBeNull();
  });

  it.each([
    "Cook for 1/2 hour.",
    "Cook for 5 to 10 minutes.",
    "Cook for -5 minutes.",
    "Bake at 180–200°C.",
    "Bake at 180 to 200 C.",
  ])("does not reinterpret a partial number in %s", (text) => {
    const candidate = normalizeClairicRecipePhrases({
      ...phrases,
      instructions: [text],
    });
    const grounded = groundRecipeCandidate(candidate, [
      {
        artifactReference: "private:transcript",
        evidenceId: "source",
        kind: "transcript",
        origin: "creator_provided",
        value: text,
      },
    ]);
    expect(grounded.recipe.instructions?.[0]?.duration).toBeNull();
    expect(grounded.recipe.instructions?.[0]?.temperature).toBeNull();
  });
});
