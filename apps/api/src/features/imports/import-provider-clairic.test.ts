import { describe, expect, it } from "vitest";

import { assembleClairicEvidenceText } from "./import-clairic-evidence.js";
import {
  decodeClairicRecipeResponse,
  makeClairicRecipeRequest,
} from "./import-provider-clairic.js";
import type { RecipeEvidenceItem } from "./import-recipe-extractor.js";
import { groundRecipeCandidate } from "./import-recipe-grounding.js";

const items: readonly RecipeEvidenceItem[] = [
  {
    artifactReference: "private:fixture",
    evidenceId: "transcript",
    kind: "transcript",
    origin: "creator_provided",
    value:
      "Onion soup\n2 onions, chopped\nCook the onions for 10 minutes.\nServes 4",
  },
];
const evidence = assembleClairicEvidenceText(items);
const textAnswer = (value: string) => ({
  span: [
    evidence.state.indexOf(value),
    evidence.state.indexOf(value) + value.length,
  ],
  type: "text",
  value,
});
const missingAnswer = { type: "text", value: null };
const response = () => ({
  answers: {
    cook: missingAnswer,
    inactive: missingAnswer,
    ingredients: {
      spans: [textAnswer("2 onions, chopped").span],
      type: "list",
      value: ["2 onions, chopped"],
    },
    instructions: {
      spans: [textAnswer("Cook the onions for 10 minutes.").span],
      type: "list",
      value: ["Cook the onions for 10 minutes."],
    },
    name: textAnswer("Onion soup"),
    prep: missingAnswer,
    servings: textAnswer("Serves 4"),
    total: missingAnswer,
  },
  model: "clairic",
  state_text: evidence.state,
  truncated: false,
  usage: {
    input_tokens: 655,
    output_tokens: 0,
    passes: 3,
    schema_tokens: 472,
    state_tokens: 61,
  },
});

describe("experimental Clairic recipe request and decoder", () => {
  it("retains source phrases and metering for evaluation through the common grounder", () => {
    expect(makeClairicRecipeRequest(evidence)).toMatchObject({
      model: "clairic",
      options: { return_state_text: true },
      state: evidence.state,
    });
    const decoded = decodeClairicRecipeResponse(
      response(),
      evidence,
      "unicode-code-points"
    );
    expect(decoded).toMatchObject({
      _tag: "Decoded",
      inputTokens: 655,
      outputTokens: 0,
    });
    if (decoded._tag !== "Decoded") {
      throw new Error("Expected a source-supported recipe response");
    }
    const output = groundRecipeCandidate(decoded.value, items);
    expect(output.recipe.ingredients?.[0]).toMatchObject({
      name: "onions",
      original: "2 onions, chopped",
      preparation: "chopped",
      quantity: { max: null, unit: null, value: 2 },
    });
    expect(output.recipe.instructions?.[0]?.duration).toEqual({ seconds: 600 });
  });

  it("respects null even when the provider attaches a confident guess and span", () => {
    const raw = response();
    const result = decodeClairicRecipeResponse(
      {
        ...raw,
        answers: {
          ...raw.answers,
          name: {
            ...textAnswer("Onion soup"),
            confidence: 0.999,
            guess: "Onion soup",
            p_null: 0.6,
            value: null,
          },
        },
      },
      evidence,
      "unicode-code-points"
    );
    expect(result._tag).toBe("Decoded");
    if (result._tag === "Decoded") {
      expect(result.value.name).toBeNull();
    }
  });

  it.each([
    { ...response(), truncated: true },
    { ...response(), state_text: `${evidence.state}changed` },
    {
      ...response(),
      answers: {
        ...response().answers,
        name: { span: [0, 10], type: "text", value: "Invented title" },
      },
    },
    {
      ...response(),
      answers: {
        ...response().answers,
        ingredients: { spans: [], type: "list", value: ["2 onions, chopped"] },
      },
    },
    {
      ...response(),
      answers: {
        ...response().answers,
        ingredients: {
          spans: [
            textAnswer("2 onions, chopped").span,
            textAnswer("Onion soup").span,
          ],
          type: "list",
          value: ["2 onions, chopped", "Onion soup"],
        },
      },
    },
    {
      ...response(),
      answers: {
        ...response().answers,
        ingredients: {
          spans: [
            textAnswer("2 onions, chopped").span,
            textAnswer("2 onions, chopped").span,
          ],
          type: "list",
          value: ["2 onions, chopped", "2 onions, chopped"],
        },
      },
    },
  ])("rejects a provider response without exact complete provenance", (raw) => {
    expect(
      decodeClairicRecipeResponse(raw, evidence, "unicode-code-points")
    ).toEqual({ _tag: "Failed", code: "malformed_response" });
  });

  it("returns a failed result when a source-supported number cannot fit the recipe schema", () => {
    const value = `Cook at ${"9".repeat(400)} C.`;
    const oversized = assembleClairicEvidenceText(
      items.map((item) => ({ ...item, value }))
    );
    const raw = response();
    expect(
      decodeClairicRecipeResponse(
        {
          ...raw,
          answers: {
            ...raw.answers,
            ingredients: { spans: [], type: "list", value: [] },
            instructions: {
              spans: [[0, value.length]],
              type: "list",
              value: [value],
            },
            name: missingAnswer,
            servings: missingAnswer,
          },
          state_text: value,
        },
        oversized,
        "unicode-code-points"
      )
    ).toEqual({ _tag: "Failed", code: "malformed_response" });
  });
});
