import {
  emptyRecipeDetails,
  recipeIngredientFromText,
  recipeInstructionFromText,
} from "@meal-planner/recipe-domain";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { extractionIsGrounded } from "./import-recipe-draft.js";
import { GroundedRecipeFacts } from "./import-recipe-extractor.js";
import type {
  RecipeEvidenceItem,
  RecipeCandidate,
} from "./import-recipe-extractor.js";
import { groundRecipeCandidate } from "./import-recipe-grounding.js";

const items = (value: string): readonly RecipeEvidenceItem[] => [
  {
    artifactReference: "transcript",
    evidenceId: "trusted",
    kind: "transcript",
    origin: "creator_provided",
    value,
  },
];
const candidate = (
  overrides: Partial<RecipeCandidate> = {}
): RecipeCandidate => ({
  ...emptyRecipeDetails,
  ingredients: null,
  instructions: null,
  name: null,
  ...overrides,
});

describe("structured recipe grounding", () => {
  it.each([
    ["1/2 cup flour", 0.5, null, "cup"],
    ["1 1/2 cups flour", 1.5, null, "cup"],
    ["½ cup flour", 0.5, null, "cup"],
    ["1½ cups flour", 1.5, null, "cup"],
    ["⅜ cup flour", 0.375, null, "cup"],
    ["2–3 tablespoons oil", 2, 3, "tbsp"],
    ["200 grams flour", 200, null, "g"],
  ] as const)(
    "grounds the source quantity %s without losing original text",
    (original, value, max, unit) => {
      const result = groundRecipeCandidate(
        candidate({
          ingredients: [
            {
              ...recipeIngredientFromText(original),
              name: "flour",
              quantity: { max, unit, value },
            },
          ],
        }),
        items(original)
      );
      expect(result.recipe.ingredients?.[0]?.quantity).toEqual({
        max,
        unit,
        value,
      });
      expect(result.recipe.ingredients?.[0]?.original).toBe(original);
      expect(Schema.is(GroundedRecipeFacts)(result)).toBe(true);
      expect(groundRecipeCandidate(result.recipe, items(original))).toEqual(
        result
      );
    }
  );
  it("rejects a quantity borrowed from another ingredient and unsupported conversions", () => {
    const result = groundRecipeCandidate(
      candidate({
        ingredients: [
          {
            ...recipeIngredientFromText("flour"),
            quantity: { max: null, unit: "g", value: 200 },
          },
          {
            ...recipeIngredientFromText("200 g sugar"),
            quantity: { max: null, unit: "kg", value: 0.2 },
          },
        ],
      }),
      items("flour; 200 g sugar")
    );
    expect(
      result.recipe.ingredients?.map((ingredient) => ingredient.quantity)
    ).toEqual([null, null]);
  });
  it("supports inactive hours and per-step durations without mistaking cooking time for prep", () => {
    const result = groundRecipeCandidate(
      candidate({
        instructions: [
          {
            ...recipeInstructionFromText("Cook 10 minutes at 180 C", 1),
            duration: { seconds: 600 },
            temperature: { unit: "C", value: 180 },
          },
        ],
        times: {
          cook: { seconds: 600 },
          inactive: { seconds: 7200 },
          prep: { seconds: 600 },
          total: null,
        },
      }),
      items("Cook 10 minutes at 180 C. Chill inactive 2 hours.")
    );
    expect(result.recipe.times).toEqual({
      cook: { seconds: 600 },
      inactive: { seconds: 7200 },
      prep: null,
      total: null,
    });
    expect(result.recipe.instructions?.[0]).toMatchObject({
      duration: { seconds: 600 },
      temperature: { unit: "C", value: 180 },
    });
  });
  it("keeps nutritional basis unknown rather than inventing per-serving values", () => {
    const nutrition = {
      basis: { description: null, servings: null, type: "serving" as const },
      nutrients: [
        { amount: { unit: "g" as const, value: 20 }, name: "protein" },
      ],
      original: "protein 20 g",
      source: "provided" as const,
    };
    expect(
      groundRecipeCandidate(candidate({ nutrition }), items("protein 20 g"))
        .recipe.nutrition
    ).toBeNull();
    const explicit = { ...nutrition, original: "per serving protein 20 g" };
    expect(
      groundRecipeCandidate(
        candidate({ nutrition: explicit }),
        items(explicit.original)
      ).recipe.nutrition
    ).toEqual(explicit);
  });
  it("rejects dropping a weight unit and swapping prep with cook durations", () => {
    const result = groundRecipeCandidate(
      candidate({
        ingredients: [
          {
            ...recipeIngredientFromText("200 g flour"),
            quantity: { max: null, unit: null, value: 200 },
          },
        ],
        times: {
          cook: { seconds: 300 },
          inactive: null,
          prep: { seconds: 720 },
          total: null,
        },
      }),
      items("200 g flour. Prep 5 minutes, cook 12 minutes.")
    );
    expect(result.recipe.ingredients?.[0]?.quantity).toBeNull();
    expect(result.recipe.times.prep).toBeNull();
    expect(result.recipe.times.cook).toBeNull();
  });
  it("binds each nutrient to its own amount and recognizes explicit serving yield", () => {
    const original = "per serving protein 10 g, fat 5 g";
    const result = groundRecipeCandidate(
      candidate({
        nutrition: {
          basis: { description: null, servings: null, type: "serving" },
          nutrients: [{ amount: { unit: "g", value: 5 }, name: "protein" }],
          original,
          source: "provided",
        },
        servings: {
          max: null,
          original: "Serves 2",
          quantity: 2,
          unit: "serving",
        },
      }),
      items(`${original}. Serves 2.`)
    );
    expect(result.recipe.nutrition).toBeNull();
    expect(result.recipe.servings).toMatchObject({
      quantity: 2,
      unit: "serving",
    });
  });
  it("rejects forged nested values, citation authority and author in a full extraction", () => {
    const trustedItems: readonly RecipeEvidenceItem[] = [
      ...items("200 g flour. Cook flour."),
      {
        artifactReference: "source",
        evidenceId: "source",
        kind: "source_url",
        origin: "observed",
        value: "https://example.com/recipe",
      },
      {
        artifactReference: "source",
        evidenceId: "creator",
        kind: "creator",
        origin: "observed",
        value: "Chef Ada",
      },
    ];
    const grounded = groundRecipeCandidate(
      candidate({
        ingredients: [
          {
            ...recipeIngredientFromText("200 g flour"),
            quantity: { max: null, unit: "g", value: 200 },
          },
        ],
        instructions: [recipeInstructionFromText("Cook flour.", 1)],
      }),
      trustedItems
    );
    const extraction = {
      ...grounded,
      cost: {
        certainty: "estimated" as const,
        currency: "USD" as const,
        estimatedMicroUsd: 1,
      },
      usage: {
        inputEvidenceItems: trustedItems.length,
        inputTokens: 0,
        latencyMilliseconds: 0,
        modelCalls: 1 as const,
        outputTokens: 0,
      },
    };
    const assembly = {
      evidenceFingerprint: "fingerprint",
      generation: 1 as never,
      importId: "import" as never,
      items: trustedItems,
    };
    const source = {
      canonicalUrl: "https://example.com/recipe",
      creator: { displayName: "Chef Ada", handle: null, id: null },
    };
    expect(extractionIsGrounded(extraction, assembly, source)).toBe(true);
    const forgedIngredient = {
      ...recipeIngredientFromText("200 g flour"),
      quantity: { max: null, unit: "g", value: 300 },
    };
    expect(
      extractionIsGrounded(
        {
          ...extraction,
          recipe: { ...extraction.recipe, ingredients: [forgedIngredient] },
        },
        assembly,
        source
      )
    ).toBe(false);
    expect(
      extractionIsGrounded(
        {
          ...extraction,
          recipe: {
            ...extraction.recipe,
            author: { name: "Invented chef", url: null },
          },
        },
        assembly,
        source
      )
    ).toBe(false);
    expect(
      extractionIsGrounded(
        {
          ...extraction,
          evidence: extraction.evidence.map((entry) => ({
            ...entry,
            citations: [
              { confidence: 0.5, evidenceId: "invented", origin: "observed" },
            ],
          })),
        },
        assembly,
        source
      )
    ).toBe(false);
    expect(
      extractionIsGrounded(
        { ...extraction, unresolvedFields: [] },
        assembly,
        source
      )
    ).toBe(false);
  });
  it.each([
    ["not vegan", "diet", "vegan", true, "vegan"],
    ["not milk free", "allergen", "milk", false, "milk free"],
    ["This is not vegan, but tastes good", "diet", "vegan", true, "vegan"],
    ["May contain milk", "allergen", "milk", true, "contain milk"],
  ] as const)(
    "rejects negated or uncertain source dietary wording %s",
    (source, kind, name, value, original) => {
      expect(
        groundRecipeCandidate(
          candidate({
            dietary: [{ kind, name, original, source: "provided", value }],
          }),
          items(source)
        ).recipe.dietary
      ).toEqual([]);
    }
  );
  it("grounds affirmative source diet and allergen declarations", () => {
    const result = groundRecipeCandidate(
      candidate({
        dietary: [
          {
            kind: "diet",
            name: "vegan",
            original: "vegan",
            source: "provided",
            value: true,
          },
          {
            kind: "allergen",
            name: "milk",
            original: "milk free",
            source: "provided",
            value: false,
          },
        ],
      }),
      items("This recipe is vegan. It is milk free.")
    );
    expect(result.recipe.dietary).toHaveLength(2);
  });
  it("does not infer diet or allergen freedom from ingredient names", () => {
    const result = groundRecipeCandidate(
      candidate({
        dietary: [
          {
            kind: "allergen",
            name: "milk",
            original: "milk",
            source: "provided",
            value: false,
          },
        ],
        ingredients: [recipeIngredientFromText("milk")],
      }),
      items("milk")
    );
    expect(result.recipe.dietary).toEqual([]);
  });
  it("preserves sparse spoken recipes while stripping hallucinations", () => {
    const result = groundRecipeCandidate(
      candidate({
        ingredients: [
          recipeIngredientFromText("tomatoes"),
          recipeIngredientFromText("invented mushrooms"),
        ],
        instructions: [
          recipeInstructionFromText("add chopped tomatoes to the pan", 1),
        ],
      }),
      items("Use tomatoes. Start by adding the chopped tomatoes to the pan.")
    );
    expect(result.recipe.ingredients?.[0]?.original).toBe("tomatoes");
    expect(result.recipe.instructions?.[0]?.text).toBe(
      "adding the chopped tomatoes to the pan"
    );
    expect(JSON.stringify(result)).not.toContain("invented");
    expect(
      groundRecipeCandidate(
        result.recipe,
        items("Use tomatoes. Start by adding the chopped tomatoes to the pan.")
      )
    ).toEqual(result);
  });
});
