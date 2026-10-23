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

const normalizeAndGround = (
  input: Parameters<typeof normalizeClairicRecipePhrases>[0]
) => {
  const candidate = normalizeClairicRecipePhrases(input);
  const grounded = groundRecipeCandidate(candidate, [
    {
      artifactReference: "private:transcript",
      evidenceId: "source",
      kind: "transcript",
      origin: "creator_provided",
      value: [
        input.name,
        ...input.ingredients,
        ...input.instructions,
        input.servings,
        input.prep,
        input.cook,
        input.inactive,
        input.total,
      ].join("\n"),
    },
  ]);
  return { candidate, grounded: grounded.recipe };
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
    "Cook 1,000 minutes.",
    "Cook 1,5 minutes.",
    "Cook 1⁄2 hour.",
    "Cook 1 / 2 hour.",
    "Cook 1e3 minutes.",
    "Bake at 180,5°C.",
    "Bake at 180٫5°C.",
    "Bake at 180—200°C.",
    "Bake at 180 -200°C.",
    "Bake at 180–200°C, then rest at 20°C.",
    "Cook 1 000 minutes.",
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

  it.each([
    "1⁄2 cup flour",
    "1,000g flour",
    "1,5 g salt",
    "1e3 g flour",
    "1 / 2 cup flour",
    "2 to 3 cups rice",
    "2 to3cups rice",
    "2—3 cups rice",
    "2 × 400 g tomatoes",
    "2x400g tomatoes",
    "1-inch ginger",
    "1:2 flour",
    "1٫5 g flour",
  ])("keeps unsupported ingredient notation unresolved: %s", (original) => {
    const { candidate, grounded } = normalizeAndGround({
      ...phrases,
      ingredients: [original],
    });
    expect(candidate.ingredients?.[0]?.quantity).toBeNull();
    expect(grounded.ingredients?.[0]).toMatchObject({
      original,
      quantity: null,
    });
  });

  it.each([
    ["1½ cups flour", { max: null, unit: "cups", value: 1.5 }],
    ["1 1/2 cups flour", { max: null, unit: "cups", value: 1.5 }],
    ["2–3 g salt", { max: 3, unit: "g", value: 2 }],
    ["200g flour", { max: null, unit: "g", value: 200 }],
  ] as const)(
    "retains complete supported ingredient notation: %s",
    (original, quantity) => {
      const { candidate, grounded } = normalizeAndGround({
        ...phrases,
        ingredients: [original],
      });
      expect(candidate.ingredients?.[0]?.quantity).toEqual(quantity);
      expect(grounded.ingredients?.[0]?.quantity).toEqual(quantity);
    }
  );

  it.each([
    "salt, not optional",
    "salt (not optional)",
    "salt, never optional",
    "salt (optional only if desired)",
    "salt (optional) only if tolerated",
    "salt not (optional)",
    "salt only if tolerated (optional)",
  ])(
    "does not turn qualified optionality into an affirmative flag: %s",
    (original) => {
      const { candidate, grounded } = normalizeAndGround({
        ...phrases,
        ingredients: [original],
      });
      expect(candidate.ingredients?.[0]?.optional).toBeNull();
      expect(grounded.ingredients?.[0]).toMatchObject({
        optional: null,
        original,
      });
    }
  );

  it.each(["salt (optional)", "salt, optional"])(
    "retains explicit unqualified optionality: %s",
    (original) => {
      const { candidate, grounded } = normalizeAndGround({
        ...phrases,
        ingredients: [original],
      });
      expect(candidate.ingredients?.[0]?.optional).toBe(true);
      expect(grounded.ingredients?.[0]?.optional).toBe(true);
    }
  );

  it.each([
    ["Makes 2 litres", 2, "litres"],
    ["Makes 2 cups sauce", 2, "cups"],
    ["Makes 24 cookies", 24, "cookies"],
  ] as const)(
    "preserves the explicit yield unit in %s",
    (original, quantity, unit) => {
      const { candidate, grounded } = normalizeAndGround({
        ...phrases,
        servings: original,
      });
      const expected = { max: null, original, quantity, unit };
      expect(candidate.servings).toEqual(expected);
      expect(grounded.servings).toEqual(expected);
    }
  );

  it("retains supported decimal duration and temperature", () => {
    const { candidate, grounded } = normalizeAndGround({
      ...phrases,
      instructions: ["Cook 1.5 minutes.", "Bake at 180.5°C."],
    });
    for (const recipe of [candidate, grounded]) {
      expect(recipe.instructions?.[0]?.duration).toEqual({ seconds: 90 });
      expect(recipe.instructions?.[1]?.temperature).toEqual({
        unit: "C",
        value: 180.5,
      });
    }
  });

  it.each([
    "Cook at 180°C for 5–10 minutes.",
    "Add 1/2 cup milk and bake at 180°C.",
  ])(
    "does not discard a temperature because another number is unsupported: %s",
    (text) => {
      const { candidate, grounded } = normalizeAndGround({
        ...phrases,
        instructions: [text],
      });
      expect(candidate.instructions?.[0]?.temperature).toEqual({
        unit: "C",
        value: 180,
      });
      expect(grounded.instructions?.[0]?.temperature).toEqual({
        unit: "C",
        value: 180,
      });
    }
  );

  it("does not discard a duration because another number is unsupported", () => {
    const { candidate, grounded } = normalizeAndGround({
      ...phrases,
      instructions: ["Add 1/2 cup milk and cook for 10 minutes."],
    });
    expect(candidate.instructions?.[0]?.duration).toEqual({ seconds: 600 });
    expect(grounded.instructions?.[0]?.duration).toEqual({ seconds: 600 });
  });
});
