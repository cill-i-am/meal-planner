import {
  emptyRecipeDetails,
  recipeIngredientFromText,
  recipeInstructionFromText,
} from "@meal-planner/recipe-domain";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { AcquisitionGeneration } from "./import-media.model.js";
import { extractionIsGrounded } from "./import-recipe-draft.js";
import { GroundedRecipeFacts } from "./import-recipe-extractor.js";
import type {
  RecipeEvidenceItem,
  RecipeCandidate,
  RecipeExtraction,
} from "./import-recipe-extractor.js";
import {
  groundRecipeCandidate,
  projectRecipeEvidenceSpan,
} from "./import-recipe-grounding.js";
import { ImportId } from "./import.contracts.js";

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
  it.each([
    ["Do not use milk.", "use milk"],
    ["Never add sugar.", "add sugar"],
    [
      "Avoid adding chopped tomatoes to the pan.",
      "add chopped tomatoes to the pan",
    ],
    ["Add milk only if needed.", "Add milk"],
    ["Unless tolerated, omit the onions.", "omit the onions"],
  ])(
    "rejects instruction fragments stripping source qualifiers from %s",
    (source, selected) => {
      const result = groundRecipeCandidate(
        candidate({ instructions: [recipeInstructionFromText(selected, 1)] }),
        items(source)
      );
      expect(result.recipe.instructions).toBeNull();
      expect(projectRecipeEvidenceSpan(source, selected)).toBeNull();
    }
  );
  it("retains a whole negative source instruction", () => {
    const original = "Do not use milk.";
    const result = groundRecipeCandidate(
      candidate({ instructions: [recipeInstructionFromText(original, 1)] }),
      items(original)
    );
    expect(result.recipe.instructions?.[0]?.text).toBe(original);
  });
  it.each([
    ["Chop onions.", "Ch"],
    ["Ajoutez les oignons.", "Aj"],
    ["Chop onions.", "hop onions"],
    ["Add cafe\u0301.", "Add cafe"],
    ["Add 200g flour.", "Add 200"],
  ])("rejects partial source words in %s", (source, selected) => {
    const result = groundRecipeCandidate(
      candidate({ instructions: [recipeInstructionFromText(selected, 1)] }),
      items(source)
    );
    expect(result.recipe.instructions).toBeNull();
    expect(
      result.evidence.some((entry) => entry.path.startsWith("instructions."))
    ).toBe(false);
    expect(result.unresolvedFields).toContain("instructions");
    expect(projectRecipeEvidenceSpan(source, selected)).toBeNull();
  });
  it.each([
    ["Do not add milk. Add milk.", "Add milk", "Add milk"],
    ["Do not Add milk. Add milk.", "Add milk", "Add milk"],
    [
      "Do not add milk. Start by adding the milk.",
      "add milk",
      "adding the milk",
    ],
  ])("grounds the valid occurrence in %s", (source, selected, expected) => {
    const result = groundRecipeCandidate(
      candidate({ instructions: [recipeInstructionFromText(selected, 1)] }),
      items(source)
    );
    expect(result.recipe.instructions?.[0]?.text).toBe(expected);
    expect(projectRecipeEvidenceSpan(source, selected)).toBe(expected);
    expect(groundRecipeCandidate(result.recipe, items(source))).toEqual(result);
  });
  it.each([
    ["Chop onions", null],
    ["chopping onions", null],
    ["add oil", null],
    ["Add oil when", null],
    ["Chop onions then add oil", null],
    ["add oil when the pan is hot", "add oil when the pan is hot"],
    [
      "Chop onions then add oil when the pan is hot",
      "Chop onions then add oil when the pan is hot",
    ],
  ])(
    "preserves sentence conditions when action scope is ambiguous for %s",
    (selected, expected) => {
      const source = "Chop onions then add oil when the pan is hot.";
      const result = groundRecipeCandidate(
        candidate({ instructions: [recipeInstructionFromText(selected, 1)] }),
        items(source)
      );
      expect(result.recipe.instructions?.[0]?.text ?? null).toBe(expected);
      expect(projectRecipeEvidenceSpan(source, selected)).toBe(expected);
      expect(groundRecipeCandidate(result.recipe, items(source))).toEqual(
        result
      );
    }
  );
  it.each([
    [
      "If using fresh onions, chop onions then add oil when hot.",
      "chop onions",
    ],
    ["If needed then add milk.", "add milk"],
    ["If needed, chop onions then add oil.", "add oil"],
    ["Do not chop onions then add oil.", "chop onions"],
    ["Only after the pan is hot, add oil then stir.", "add oil"],
    ["Add oil when the pan is hot.", "Add oil when"],
    ["Add milk unless already thick.", "Add milk unless"],
    ["Add milk then sugar, only if needed.", "Add milk"],
    ["Add milk then add sugar, only if needed.", "Add milk"],
    ["Add 1.5 g salt if needed.", "Add 1."],
    ["Add .5 g salt if needed.", "Add ."],
  ])(
    "keeps incomplete or inherited source conditions unresolved in %s",
    (source, selected) => {
      const result = groundRecipeCandidate(
        candidate({ instructions: [recipeInstructionFromText(selected, 1)] }),
        items(source)
      );
      expect(result.recipe.instructions).toBeNull();
      expect(projectRecipeEvidenceSpan(source, selected)).toBeNull();
    }
  );
  it("keeps a complete qualified sentence independent of the following sentence", () => {
    const source = "Do not use milk. Add oil only if needed.";
    const result = groundRecipeCandidate(
      candidate({
        instructions: [recipeInstructionFromText("Do not use milk.", 1)],
      }),
      items(source)
    );
    expect(result.recipe.instructions?.[0]?.text).toBe("Do not use milk.");
    expect(groundRecipeCandidate(result.recipe, items(source))).toEqual(result);
  });
  it("retains the selected evidence item for structured instruction and ingredient citations", () => {
    const sourceItems: readonly RecipeEvidenceItem[] = [
      ...items("Do not Cook flour for 5 minutes. Avoid 200 g flour.").map(
        (item) => ({ ...item, evidenceId: "negative" })
      ),
      ...items("Cook flour for 5 minutes. 200 g flour.").map((item) => ({
        ...item,
        evidenceId: "positive",
      })),
    ];
    const result = groundRecipeCandidate(
      candidate({
        ingredients: [
          {
            ...recipeIngredientFromText("200 g flour"),
            name: "flour",
            quantity: { max: null, unit: "g", value: 200 },
          },
        ],
        instructions: [
          {
            ...recipeInstructionFromText("Cook flour for 5 minutes", 1),
            duration: { seconds: 300 },
          },
        ],
      }),
      sourceItems
    );
    expect(result.recipe.instructions?.[0]?.duration).toEqual({ seconds: 300 });
    expect(result.recipe.ingredients?.[0]?.quantity).toEqual({
      max: null,
      unit: "g",
      value: 200,
    });
    expect(
      result.evidence.map((entry) => [
        entry.path,
        entry.citations.map((citation) => citation.evidenceId),
      ])
    ).toEqual([
      ["ingredients.0.original", ["positive"]],
      ["ingredients.0.name", ["positive"]],
      ["ingredients.0.quantity", ["positive"]],
      ["instructions.0.text", ["positive"]],
      ["instructions.0.duration", ["positive"]],
    ]);
    expect(groundRecipeCandidate(result.recipe, sourceItems)).toEqual(result);
  });
  it("admits source-grounded actions and rejects truncated words and conditions at the draft boundary", () => {
    const trustedItems: readonly RecipeEvidenceItem[] = [
      ...items(
        "200 g onions. Chop onions then add oil when the pan is hot. Do not add milk. Add milk."
      ),
      {
        artifactReference: "source",
        evidenceId: "source",
        kind: "source_url",
        origin: "observed",
        value: "https://example.com/recipe",
      },
    ];
    const grounded = groundRecipeCandidate(
      candidate({
        ingredients: [recipeIngredientFromText("200 g onions")],
        instructions: [
          recipeInstructionFromText(
            "chopping onions then add oil when the pan is hot",
            1
          ),
          recipeInstructionFromText("Add milk", 2),
        ],
      }),
      trustedItems
    );
    expect(
      grounded.recipe.instructions?.map((instruction) => instruction.text)
    ).toEqual(["Chop onions then add oil when the pan is hot", "Add milk"]);
    const extraction: RecipeExtraction = {
      ...grounded,
      cost: { certainty: "estimated", currency: "USD", estimatedMicroUsd: 1 },
      usage: {
        inputEvidenceItems: trustedItems.length,
        inputTokens: 0,
        latencyMilliseconds: 0,
        modelCalls: 1,
        outputTokens: 0,
      },
    };
    const assembly = {
      evidenceFingerprint: "fingerprint",
      generation: Schema.decodeUnknownSync(AcquisitionGeneration)(1),
      importId: Schema.decodeUnknownSync(ImportId)(
        "00000000-0000-4000-8000-000000000001"
      ),
      items: trustedItems,
    };
    const source = {
      canonicalUrl: "https://example.com/recipe",
      creator: { displayName: null, handle: null, id: null },
    };
    expect(extractionIsGrounded(extraction, assembly, source)).toBe(true);
    for (const fragment of ["Ch", "Add oil when"]) {
      expect(
        extractionIsGrounded(
          {
            ...extraction,
            recipe: {
              ...extraction.recipe,
              instructions: [recipeInstructionFromText(fragment, 1)],
            },
          },
          assembly,
          source
        )
      ).toBe(false);
    }
  });
  it.each(["Serves 4", "Servings: 4", "Portions: 4"])(
    "derives explicit serving unit from %s",
    (original) => {
      const result = groundRecipeCandidate(
        candidate({
          servings: { max: null, original, quantity: 4, unit: null },
        }),
        items(original)
      );
      expect(result.recipe.servings?.unit).toBe("serving");
      expect(groundRecipeCandidate(result.recipe, items(original))).toEqual(
        result
      );
    }
  );
  it("preserves a noun yield with unknown unit rather than declaring servings", () => {
    const original = "Makes 24 cookies";
    const result = groundRecipeCandidate(
      candidate({
        servings: { max: null, original, quantity: 24, unit: null },
      }),
      items(original)
    );
    expect(result.recipe.servings).toEqual({
      max: null,
      original,
      quantity: 24,
      unit: null,
    });
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
