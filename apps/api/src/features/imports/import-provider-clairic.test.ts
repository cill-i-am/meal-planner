import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { assembleClairicEvidenceText } from "./import-clairic-evidence.js";
import {
  correlationId,
  localDispatchGate,
} from "./import-provider-adapters.test-fixture.js";
import {
  decodeClairicRecipeResponse,
  makeExperimentalClairicRecipeExtractor,
} from "./import-provider-clairic.js";
import type { ProviderDispatchGate } from "./import-provider-kernel.js";
import type { RecipeEvidenceAssembly } from "./import-recipe-extractor.js";

const assembly: RecipeEvidenceAssembly = {
  evidenceFingerprint: "a".repeat(64),
  generation: 1 as never,
  importId: "clairic-eval-only" as never,
  items: [
    {
      artifactReference: "private:fixture",
      evidenceId: "transcript",
      kind: "transcript",
      origin: "creator_provided",
      value:
        "Onion soup\n2 onions, chopped\nCook the onions for 10 minutes.\nServes 4",
    },
  ],
};
const evidence = assembleClairicEvidenceText(assembly.items);
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

describe("experimental Clairic recipe adapter", () => {
  it("uses the common accounting boundary and retains structured grounded values", async () => {
    const reservations: string[] = [];
    const costs: object[] = [];
    const dispatch: ProviderDispatchGate = {
      run: (request) => {
        reservations.push(request.dispatchId);
        return request.invoke.pipe(
          Effect.tap(({ cost }) =>
            Effect.sync(() => {
              costs.push(cost);
            })
          ),
          Effect.map(({ value }) => value)
        );
      },
    };
    const requests: object[] = [];
    const extractor = makeExperimentalClairicRecipeExtractor({
      correlationId,
      dispatch,
      spanEncoding: "unicode-code-points",
      transport: {
        run: (body) => {
          requests.push(body);
          return Promise.resolve(Response.json(response()));
        },
      },
    });
    const output = await Effect.runPromise(extractor.extract(assembly));
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      model: "clairic",
      options: { return_state_text: true },
      state: evidence.state,
    });
    expect(reservations).toEqual([
      `recipe:${assembly.importId}:1:${assembly.evidenceFingerprint}`,
    ]);
    expect(costs).toEqual([{ _tag: "Known", actualCostMicroUsd: 66 }]);
    expect(output.recipe.ingredients?.[0]).toMatchObject({
      name: "onions",
      original: "2 onions, chopped",
      preparation: "chopped",
      quantity: { max: null, unit: null, value: 2 },
    });
    expect(output.recipe.instructions?.[0]?.duration).toEqual({ seconds: 600 });
    expect(output.usage).toMatchObject({
      inputTokens: 655,
      modelCalls: 1,
      outputTokens: 0,
    });
    expect(extractor.descriptor.version).toBe(
      "experimental-clairic-codepoints-v1"
    );
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

  it("preserves an explicitly authorized recovery dispatch and distinguishes span strategies", async () => {
    const ids: string[] = [];
    const dispatch: ProviderDispatchGate = {
      run: (request) => {
        ids.push(request.dispatchId);
        return request.invoke.pipe(Effect.map(({ value }) => value));
      },
    };
    const factory = (
      spanEncoding: "unicode-code-points" | "utf16-code-units"
    ) =>
      makeExperimentalClairicRecipeExtractor({
        correlationId,
        dispatch,
        spanEncoding,
        transport: { run: () => Promise.resolve(Response.json(response())) },
      });
    const extractor = factory("unicode-code-points");
    const dispatchId = `recipe:${assembly.importId}:1:${assembly.evidenceFingerprint}:recovery:2`;
    await Effect.runPromise(extractor.extract({ ...assembly, dispatchId }));
    expect(ids).toEqual([dispatchId]);
    expect(factory("utf16-code-units").descriptor.version).not.toBe(
      extractor.descriptor.version
    );
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

  it("does not fallback or repeat after an uncertain transport failure", async () => {
    let invocations = 0;
    const extractor = makeExperimentalClairicRecipeExtractor({
      correlationId,
      dispatch: localDispatchGate,
      spanEncoding: "unicode-code-points",
      transport: {
        run: () => {
          invocations += 1;
          return Promise.reject(new Error("private-provider-canary"));
        },
      },
    });
    const exit = await Effect.runPromiseExit(extractor.extract(assembly));
    expect(invocations).toBe(1);
    expect(exit._tag).toBe("Failure");
    expect(JSON.stringify(exit)).toContain("outcome_unknown");
    expect(JSON.stringify(exit)).not.toContain("private-provider-canary");
  });

  it("returns a failed result when a source-supported number cannot fit the recipe schema", () => {
    const value = `Cook at ${"9".repeat(400)} C.`;
    const oversized = assembleClairicEvidenceText(
      assembly.items.map((item) => ({ ...item, value }))
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
