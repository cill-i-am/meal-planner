import { Effect, Fiber, Schema } from "effect";
import { TestClock } from "effect/testing";
import { Tool } from "effect/unstable/ai";
import { describe, expect, it } from "vitest";

import type { PilotProviderConservativeReplayValue } from "../pilots/pilot-provider-budget.js";
import {
  makeRawGateway,
  makeGateway,
  makeRejectedGateway,
  correlationId,
  localDispatchGate,
  runFactory,
  makeRecordingTraceStore,
  recipeEvidenceAssembly,
  runRecipeTransportRoot,
  providerCitedString,
  validRecipeSemantics,
  validRecipe,
  emptyRecipeProviderSelection,
  citedRecipeString,
  defaultVisualUsage,
  toolResponse,
  recipeJsonResponse,
} from "./import-provider-adapters.test-fixture.js";
import type { ProviderDispatchGate } from "./import-provider-kernel.js";
import { makeInstalledRecipeExtractor } from "./import-provider-recipe.js";
import { hasMinimumRecipeEvidence } from "./import-recipe-draft.js";
import {
  RecipeExtraction,
  RecipeProviderToolArguments,
} from "./import-recipe-extractor.js";

describe("installed recipe provider adapter", () => {
  it("classifies accessible non-food evidence semantically without a draft shape", () => {
    expect(
      hasMinimumRecipeEvidence(
        Schema.decodeUnknownSync(RecipeExtraction)(validRecipe)
      )
    ).toBe(false);
    expect(JSON.stringify(validRecipe.ingredientLines.items)).not.toContain(
      "invented"
    );
  });

  it("fails closed when strict recipe JSON mode adds transport metadata", async () => {
    const { exit, trace } = await runRecipeTransportRoot({
      ...recipeJsonResponse(emptyRecipeProviderSelection),
      providerPrivateCanary: "must-not-escape",
    });

    expect(exit._tag).toBe("Failure");
    expect(JSON.stringify(exit)).toContain("malformed_response");
    expect(trace.events.at(-1)).toEqual({
      correlationId,
      decodeReason: "json_mode_envelope_invalid",
      decodeStage: "json_mode_envelope",
      event: "provider.decode",
      outcome: "malformed",
      providerStage: "recipe",
    });
    expect(JSON.stringify({ exit, trace: trace.events })).not.toContain(
      "must-not-escape"
    );
  });

  it("fails closed when strict recipe JSON mode violates its schema", async () => {
    const { exit, trace } = await runRecipeTransportRoot(
      recipeJsonResponse({
        ...emptyRecipeProviderSelection,
        providerPrivateCanary: "must-not-escape",
      })
    );

    expect(exit._tag).toBe("Failure");
    expect(JSON.stringify(exit)).toContain("malformed_response");
    expect(trace.events.at(-1)).toEqual({
      correlationId,
      decodeReason: "json_mode_schema_invalid",
      decodeStage: "recipe_schema",
      event: "provider.decode",
      outcome: "malformed",
      providerStage: "recipe",
    });
    expect(JSON.stringify({ exit, trace: trace.events })).not.toContain(
      "must-not-escape"
    );
  });

  it("classifies a missing strict recipe JSON response without retaining evidence", async () => {
    const { exit, trace } = await runRecipeTransportRoot({
      usage: defaultVisualUsage,
    });

    expect(exit._tag).toBe("Failure");
    expect(JSON.stringify(exit)).toContain("malformed_response");
    expect(trace.events.at(-1)).toEqual({
      correlationId,
      decodeReason: "json_mode_envelope_invalid",
      decodeStage: "json_mode_envelope",
      event: "provider.decode",
      outcome: "malformed",
      providerStage: "recipe",
    });
    expect(JSON.stringify(trace.events)).not.toContain("visible evidence");
  });

  it("fails closed for inconsistent strict recipe JSON usage", async () => {
    const { exit, trace } = await runRecipeTransportRoot(
      recipeJsonResponse(emptyRecipeProviderSelection, {
        completion_tokens: 10,
        prompt_tokens: 20,
        total_tokens: 31,
      })
    );

    expect(exit._tag).toBe("Failure");
    expect(JSON.stringify(exit)).toContain("malformed_response");
    expect(trace.events.at(-1)).toEqual({
      correlationId,
      decodeReason: "json_mode_envelope_invalid",
      decodeStage: "json_mode_envelope",
      event: "provider.decode",
      outcome: "malformed",
      providerStage: "recipe",
    });
  });

  it.each([
    [
      "an HTTP rejection",
      () =>
        Response.json(
          { providerPrivateCanary: "must-not-escape" },
          { status: 422 }
        ),
      "provider_unavailable",
    ],
    [
      "an unreadable JSON body",
      () =>
        new Response("providerPrivateCanary=must-not-escape", {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      "malformed_response",
    ],
    [
      "a schema-invalid JSON result",
      () =>
        Response.json(
          recipeJsonResponse({
            ...emptyRecipeProviderSelection,
            providerPrivateCanary: "must-not-escape",
          })
        ),
      "malformed_response",
    ],
  ] as const)(
    "conservatively settles %s while failing the recipe honestly",
    async (_label, response, expectedCode) => {
      const costs: unknown[] = [];
      const gateway = makeRawGateway(response());
      const trace = makeRecordingTraceStore();
      const adapter = await runFactory(
        makeInstalledRecipeExtractor({
          client: gateway.client,
          correlationId,
          dispatch: {
            run: (input) =>
              input.invoke.pipe(
                Effect.tap(({ cost }) =>
                  Effect.sync(() => {
                    costs.push(cost);
                  })
                ),
                Effect.map(({ value }) => value)
              ),
          },
        }),
        trace.service
      );

      const exit = await Effect.runPromiseExit(
        adapter.extract(recipeEvidenceAssembly)
      );

      expect(exit._tag).toBe("Failure");
      expect(JSON.stringify(exit)).toContain(expectedCode);
      expect(costs).toEqual([
        {
          _tag: "Conservative",
          conservativeChargeMicroUsd: 100_000,
        },
      ]);
      expect(gateway.requests).toHaveLength(1);
      expect(trace.events).toContainEqual({
        correlationId,
        event: "provider.response",
        outcome: "received",
        providerStage: "recipe",
      });
      expect(JSON.stringify({ exit, trace: trace.events })).not.toContain(
        "must-not-escape"
      );
    }
  );

  it("keeps a recipe transport failure unknown to the settlement gate", async () => {
    let completedInsideDispatch = false;
    const adapter = await runFactory(
      makeInstalledRecipeExtractor({
        client: makeRejectedGateway({
          message: "providerPrivateCanary=must-not-escape",
          status: 503,
        }),
        correlationId,
        dispatch: {
          run: (input) =>
            input.invoke.pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  completedInsideDispatch = true;
                })
              ),
              Effect.map(({ value }) => value)
            ),
        },
      })
    );

    const exit = await Effect.runPromiseExit(
      adapter.extract(recipeEvidenceAssembly)
    );

    expect(exit._tag).toBe("Failure");
    expect(JSON.stringify(exit)).toContain("provider_unavailable");
    expect(JSON.stringify(exit)).not.toContain("must-not-escape");
    expect(completedInsideDispatch).toBe(false);
  });

  it.each([
    ["prose", { choices: [{ message: { content: "{}" } }] }],
    ["wrong tool", toolResponse("wrong_tool", validRecipeSemantics)],
    [
      "multiple tools",
      {
        choices: [
          {
            message: {
              tool_calls: [
                {
                  function: {
                    arguments: JSON.stringify(validRecipeSemantics),
                    name: "record_recipe",
                  },
                },
                {
                  function: {
                    arguments: JSON.stringify(validRecipeSemantics),
                    name: "record_recipe",
                  },
                },
              ],
            },
          },
        ],
      },
    ],
    [
      "an extra tool before the forced tool",
      {
        choices: [
          {
            message: {
              tool_calls: [
                {
                  function: {
                    arguments: JSON.stringify(validRecipeSemantics),
                    name: "wrong_tool",
                  },
                },
                {
                  function: {
                    arguments: JSON.stringify(validRecipeSemantics),
                    name: "record_recipe",
                  },
                },
              ],
            },
          },
        ],
      },
    ],
    [
      "malformed JSON",
      {
        choices: [
          {
            message: {
              tool_calls: [
                {
                  function: {
                    arguments: "{",
                    name: "record_recipe",
                  },
                },
              ],
            },
          },
        ],
      },
    ],
    [
      "schema-invalid arguments",
      recipeJsonResponse({
        ...validRecipeSemantics,
        name: { ...validRecipeSemantics.name, state: "invalid" },
      }),
    ],
  ])("fails closed for %s", async (_label, response) => {
    const gateway = makeGateway(response);
    const adapter = await runFactory(
      makeInstalledRecipeExtractor({
        client: gateway.client,
        correlationId,
        dispatch: localDispatchGate,
        model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      })
    );
    const exit = await Effect.runPromiseExit(
      adapter.extract({
        evidenceFingerprint: "fingerprint",
        generation: 1 as never,
        importId: "import-1" as never,
        items: [
          {
            artifactReference: "private:evidence",
            evidenceId: "evidence-1",
            kind: "caption",
            origin: "creator_provided",
            value: "an accessible non-food travel video",
          },
        ],
      })
    );
    expect(exit._tag).toBe("Failure");
    expect(JSON.stringify(exit)).not.toContain(
      "an accessible non-food travel video"
    );
  });

  it("requests strict recipe JSON mode and injects trusted transport usage", async () => {
    const gateway = makeGateway(
      recipeJsonResponse(emptyRecipeProviderSelection)
    );
    const adapter = await runFactory(
      makeInstalledRecipeExtractor({
        client: gateway.client,
        correlationId,
        dispatch: localDispatchGate,
        model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      })
    );
    const output = await Effect.runPromise(
      adapter.extract({
        evidenceFingerprint: "fingerprint",
        generation: 1 as never,
        importId: "import-1" as never,
        items: [
          {
            artifactReference: "private:evidence",
            evidenceId: "evidence-1",
            kind: "caption",
            origin: "creator_provided",
            value: "visible evidence",
          },
        ],
      })
    );
    expect(output).toEqual({
      ...validRecipeSemantics,
      cost: {
        certainty: "estimated",
        currency: "USD",
        estimatedMicroUsd: 29,
      },
      usage: {
        inputEvidenceItems: 1,
        inputTokens: 20,
        latencyMilliseconds: expect.any(Number),
        modelCalls: 1,
        outputTokens: 10,
      },
    });
    expect(Schema.is(RecipeExtraction)(output)).toBe(true);
    const request = gateway.requests[0] as {
      readonly body: {
        readonly response_format?: unknown;
        readonly tool_choice?: unknown;
        readonly tools?: unknown;
      };
      readonly options: {
        readonly gateway: {
          readonly collectLog: boolean;
          readonly id: string;
          readonly metadata?: unknown;
          readonly skipCache: boolean;
        };
        readonly returnRawResponse: boolean;
      };
    };
    expect(request.options).toEqual({
      gateway: {
        collectLog: false,
        id: "meal-planner-pilot-gaia-118",
        skipCache: true,
      },
      returnRawResponse: true,
    });
    expect(request.options.gateway).not.toHaveProperty("metadata");
    expect(request.options).not.toHaveProperty("headers");
    expect(request.body).not.toHaveProperty("tool_choice");
    expect(request.body).not.toHaveProperty("tools");
    expect(request.body.response_format).toEqual({
      json_schema: Tool.getJsonSchemaFromSchema(RecipeProviderToolArguments),
      type: "json_schema",
    });
    expect(request.body.response_format).toMatchObject({
      json_schema: expect.objectContaining({
        additionalProperties: false,
        type: "object",
      }),
      type: "json_schema",
    });
    const serializedRequest = JSON.stringify(request.body);
    expect(serializedRequest).toContain(
      "Select only recipe values supported by the supplied evidence"
    );
    expect(serializedRequest).toContain(
      "Select ingredientLines as individual ingredient phrases"
    );
    expect(serializedRequest).toContain(
      "ingredientLines and instructions must each contain at least one"
    );
    expect(serializedRequest).toContain(
      "Do not reject recipe narration merely because quantities, timings, title, or other fields are missing"
    );
    expect(serializedRequest).toContain(
      "Include a numeric value only when the exact number and its unit occur in the evidence"
    );
    expect(serializedRequest).toContain("the trusted adapter derives those");
  });

  it("grounds the narrow provider-selection contract through the installed path", async () => {
    const providerSelection = Schema.decodeUnknownSync(
      RecipeProviderToolArguments
    )({
      category: "pasta",
      cookTimeMinutes: 12,
      cuisine: null,
      description: "quick tomato pasta",
      ingredientLines: ["tomatoes", "fresh pasta", "olive oil"],
      instructions: [
        "chop the tomatoes",
        "boil the fresh pasta",
        "add the tomatoes to the pan",
      ],
      name: "quick tomato pasta",
      nutrition: null,
      prepTimeMinutes: null,
      supportedClaims: ["ready in 12 minutes"],
      temperatureCelsius: null,
      tools: ["pan"],
      totalTimeMinutes: 12,
      yield: null,
    });
    const gateway = makeGateway(recipeJsonResponse(providerSelection));
    const adapter = await runFactory(
      makeInstalledRecipeExtractor({
        client: gateway.client,
        correlationId,
        dispatch: localDispatchGate,
      })
    );

    const output = await Effect.runPromise(
      adapter.extract({
        evidenceFingerprint: "fingerprint",
        generation: 1 as never,
        importId: "import-1" as never,
        items: [
          {
            artifactReference: "private:transcript",
            evidenceId: "transcript-evidence",
            kind: "transcript",
            origin: "creator_provided",
            value:
              "Quick tomato pasta is ready in 12 minutes. Use tomatoes, fresh pasta and olive oil. Chop the tomatoes, boil the fresh pasta, then add the tomatoes to the pan.",
          },
        ],
      })
    );

    expect(output.ingredientLines).toMatchObject({
      items: [
        { state: "supported", value: "tomatoes" },
        { state: "supported", value: "fresh pasta" },
        { state: "supported", value: "olive oil" },
      ],
      state: "supported",
    });
    expect(output.instructions).toMatchObject({
      items: [
        { state: "supported", value: "chop the tomatoes" },
        { state: "supported", value: "boil the fresh pasta" },
        { state: "supported", value: "add the tomatoes to the pan" },
      ],
      state: "supported",
    });
    expect(output.sourceUrl.state).toBe("unresolved");
    expect(output.author.state).toBe("unresolved");
    expect(hasMinimumRecipeEvidence(output)).toBe(true);
    expect(JSON.stringify(output)).not.toContain("adapter-provider-selection");
    expect(Schema.is(RecipeExtraction)(output)).toBe(true);
  });

  it("keeps a narrow non-food provider selection below the recipe threshold", async () => {
    const providerSelection = Schema.decodeUnknownSync(
      RecipeProviderToolArguments
    )({
      category: null,
      cookTimeMinutes: null,
      cuisine: null,
      description: null,
      ingredientLines: [],
      instructions: [],
      name: null,
      nutrition: null,
      prepTimeMinutes: null,
      supportedClaims: [],
      temperatureCelsius: null,
      tools: [],
      totalTimeMinutes: null,
      yield: null,
    });
    const gateway = makeGateway(recipeJsonResponse(providerSelection));
    const adapter = await runFactory(
      makeInstalledRecipeExtractor({
        client: gateway.client,
        correlationId,
        dispatch: localDispatchGate,
      })
    );

    const output = await Effect.runPromise(
      adapter.extract({
        evidenceFingerprint: "fingerprint",
        generation: 1 as never,
        importId: "import-1" as never,
        items: [
          {
            artifactReference: "private:transcript",
            evidenceId: "transcript-evidence",
            kind: "transcript",
            origin: "creator_provided",
            value: "A city walking tour with no food preparation.",
          },
        ],
      })
    );

    expect(hasMinimumRecipeEvidence(output)).toBe(false);
    expect(output.ingredientLines.state).toBe("unresolved");
    expect(output.instructions.state).toBe("unresolved");
  });

  it("derives recipe grounding authority only from exact trusted evidence", async () => {
    const untrustedCitation = {
      confidence: 0.1,
      evidenceId: "provider-invented-evidence",
      origin: "creator_provided" as const,
    };
    const supported = <A>(value: A) => ({
      citations: [untrustedCitation],
      origin: "inferred" as const,
      state: "supported" as const,
      value,
    });
    const groundedCandidate = {
      ...validRecipeSemantics,
      author: supported("provider-invented-author"),
      category: supported("provider-invented-category"),
      description: supported("A red tomato pasta dish."),
      ingredientLines: {
        items: [supported("tomatoes"), supported("pasta")],
        state: "supported" as const,
      },
      instructions: {
        items: [supported("Chop tomatoes."), supported("Boil pasta.")],
        state: "supported" as const,
      },
      name: supported("tomato pasta"),
      sourceUrl: supported("https://provider.invalid/private"),
      supportedClaims: {
        items: [supported("A red tomato pasta dish.")],
        state: "supported" as const,
      },
      tools: {
        items: [supported("pot")],
        state: "supported" as const,
      },
      totalTimeMinutes: supported(10),
      unresolvedFields: ["author"],
      yield: supported("Serves 2"),
    };
    const gateway = makeGateway(recipeJsonResponse(groundedCandidate));
    const adapter = await runFactory(
      makeInstalledRecipeExtractor({
        client: gateway.client,
        correlationId,
        dispatch: localDispatchGate,
      })
    );

    const output = await Effect.runPromise(
      adapter.extract({
        evidenceFingerprint: "fingerprint",
        generation: 1 as never,
        importId: "import-1" as never,
        items: [
          {
            artifactReference: "private:source",
            evidenceId: "source-evidence",
            kind: "source_url",
            origin: "observed",
            value: "https://source.example/canonical",
          },
          {
            artifactReference: "private:source",
            evidenceId: "creator-evidence",
            kind: "creator",
            origin: "observed",
            value: "Chef Ada",
          },
          {
            artifactReference: "private:transcript",
            evidenceId: "transcript-evidence",
            kind: "transcript",
            origin: "creator_provided",
            value:
              "Weeknight tomato pasta takes 10 minutes. Chop tomatoes. Boil pasta. Use a pot. Serves 2.",
          },
          {
            artifactReference: "private:visual",
            evidenceId: "visual-evidence",
            kind: "visual_observation",
            origin: "observed",
            value: "A red tomato pasta dish.",
          },
        ],
      })
    );

    expect(output).toMatchObject({
      author: {
        citations: [
          {
            confidence: 1,
            evidenceId: "creator-evidence",
            origin: "observed",
          },
        ],
        origin: "observed",
        state: "supported",
        value: "Chef Ada",
      },
      category: {
        citations: [],
        origin: "unresolved",
        state: "unresolved",
      },
      sourceUrl: {
        citations: [
          {
            confidence: 1,
            evidenceId: "source-evidence",
            origin: "observed",
          },
        ],
        origin: "observed",
        state: "supported",
        value: "https://source.example/canonical",
      },
      totalTimeMinutes: {
        citations: [
          {
            confidence: 1,
            evidenceId: "transcript-evidence",
            origin: "creator_provided",
          },
        ],
        origin: "creator_provided",
        state: "supported",
        value: 10,
      },
    });
    expect(output.unresolvedFields).toEqual([
      "category",
      "cook_time_minutes",
      "cuisine",
      "nutrition",
      "prep_time_minutes",
      "temperature_celsius",
      "ingredient_quantities",
      "ingredient_units",
    ]);
    expect(JSON.stringify(output)).not.toContain("provider-invented");
    expect(Schema.is(RecipeExtraction)(output)).toBe(true);
  });

  it("grounds harmless textual normalization while rejecting absent recipe facts", async () => {
    const candidate = {
      ...validRecipeSemantics,
      ingredientLines: {
        items: [
          providerCitedString("TOMATOES!"),
          providerCitedString("mushrooms"),
        ],
        state: "supported" as const,
      },
      instructions: {
        items: [providerCitedString("CHOP TOMATOES!")],
        state: "supported" as const,
      },
      name: providerCitedString("TOMATO PASTA!"),
    };
    const gateway = makeGateway(recipeJsonResponse(candidate));
    const adapter = await runFactory(
      makeInstalledRecipeExtractor({
        client: gateway.client,
        correlationId,
        dispatch: localDispatchGate,
      })
    );

    const output = await Effect.runPromise(
      adapter.extract({
        evidenceFingerprint: "fingerprint",
        generation: 1 as never,
        importId: "import-1" as never,
        items: [
          {
            artifactReference: "private:transcript",
            evidenceId: "transcript-evidence",
            kind: "transcript",
            origin: "creator_provided",
            value:
              "Tonight, we cook tomato pasta. Ingredients: tomatoes, pasta. Chop tomatoes, then boil pasta.",
          },
        ],
      })
    );

    expect(output.name).toMatchObject({
      state: "supported",
      value: "TOMATO PASTA!",
    });
    expect(output.ingredientLines).toMatchObject({
      items: [{ state: "supported", value: "TOMATOES!" }],
      state: "supported",
    });
    expect(output.instructions).toMatchObject({
      items: [{ state: "supported", value: "CHOP TOMATOES!" }],
      state: "supported",
    });
    expect(hasMinimumRecipeEvidence(output)).toBe(true);
    expect(JSON.stringify(output)).not.toContain("mushrooms");
    expect(Schema.is(RecipeExtraction)(output)).toBe(true);
  });

  it("grounds provider-selected values when the provider omits provenance members", async () => {
    const candidate = {
      ...emptyRecipeProviderSelection,
      ingredientLines: ["tomatoes", "provider-invented mushrooms"],
      instructions: ["Chop tomatoes."],
      name: "Tomato pasta",
    };
    const gateway = makeGateway(recipeJsonResponse(candidate));
    const adapter = await runFactory(
      makeInstalledRecipeExtractor({
        client: gateway.client,
        correlationId,
        dispatch: localDispatchGate,
      })
    );

    const output = await Effect.runPromise(
      adapter.extract({
        evidenceFingerprint: "fingerprint",
        generation: 1 as never,
        importId: "import-1" as never,
        items: [
          {
            artifactReference: "private:transcript",
            evidenceId: "transcript-evidence",
            kind: "transcript",
            origin: "creator_provided",
            value: "Tonight we make tomato pasta with tomatoes. Chop tomatoes.",
          },
        ],
      })
    );

    expect(output.name).toMatchObject({
      citations: [
        {
          evidenceId: "transcript-evidence",
          origin: "creator_provided",
        },
      ],
      state: "supported",
      value: "Tomato pasta",
    });
    expect(output.ingredientLines).toMatchObject({
      items: [{ state: "supported", value: "tomatoes" }],
      state: "supported",
    });
    expect(output.instructions).toMatchObject({
      items: [{ state: "supported", value: "Chop tomatoes." }],
      state: "supported",
    });
    expect(hasMinimumRecipeEvidence(output)).toBe(true);
    expect(JSON.stringify(output)).not.toContain("provider-invented");
    expect(JSON.stringify(output)).not.toContain("adapter-provider-selection");
    expect(Schema.is(RecipeExtraction)(output)).toBe(true);
  });

  it("projects uncited provider-selected facts back to exact evidence spans", async () => {
    const candidate = {
      ...emptyRecipeProviderSelection,
      ingredientLines: ["tomatoes and pasta"],
      instructions: ["add chopped tomatoes to the pan"],
    };
    const gateway = makeGateway(recipeJsonResponse(candidate));
    const adapter = await runFactory(
      makeInstalledRecipeExtractor({
        client: gateway.client,
        correlationId,
        dispatch: localDispatchGate,
      })
    );

    const output = await Effect.runPromise(
      adapter.extract({
        evidenceFingerprint: "fingerprint",
        generation: 1 as never,
        importId: "import-1" as never,
        items: [
          {
            artifactReference: "private:transcript",
            evidenceId: "transcript-evidence",
            kind: "transcript",
            origin: "creator_provided",
            value:
              "Ingredients include tomatoes, plus fresh pasta. Start by adding the chopped tomatoes to the pan.",
          },
        ],
      })
    );

    expect(output.ingredientLines).toMatchObject({
      items: [
        {
          state: "supported",
          value: "tomatoes, plus fresh pasta",
        },
      ],
      state: "supported",
    });
    expect(output.instructions).toMatchObject({
      items: [
        {
          state: "supported",
          value: "adding the chopped tomatoes to the pan",
        },
      ],
      state: "supported",
    });
    expect(hasMinimumRecipeEvidence(output)).toBe(true);
    expect(Schema.is(RecipeExtraction)(output)).toBe(true);
  });

  it("projects model-selected facts to exact cited evidence spans", async () => {
    const candidate = {
      ...validRecipeSemantics,
      ingredientLines: {
        items: [
          citedRecipeString("tomatoes and pasta"),
          citedRecipeString("mushrooms"),
        ],
        state: "supported" as const,
      },
      instructions: {
        items: [citedRecipeString("add tomatoes to pan")],
        state: "supported" as const,
      },
    };
    const gateway = makeGateway(recipeJsonResponse(candidate));
    const adapter = await runFactory(
      makeInstalledRecipeExtractor({
        client: gateway.client,
        correlationId,
        dispatch: localDispatchGate,
      })
    );

    const output = await Effect.runPromise(
      adapter.extract({
        evidenceFingerprint: "fingerprint",
        generation: 1 as never,
        importId: "import-1" as never,
        items: [
          {
            artifactReference: "private:transcript",
            evidenceId: "transcript-evidence",
            kind: "transcript",
            origin: "creator_provided",
            value:
              "Ingredients include tomatoes, plus fresh pasta. First, start by adding the chopped tomatoes to the pan, then boil the fresh pasta until tender.",
          },
        ],
      })
    );

    expect(output.ingredientLines).toMatchObject({
      items: [{ state: "supported", value: "tomatoes, plus fresh pasta" }],
      state: "supported",
    });
    expect(output.instructions).toMatchObject({
      items: [
        {
          state: "supported",
          value: "adding the chopped tomatoes to the pan",
        },
      ],
      state: "supported",
    });
    expect(hasMinimumRecipeEvidence(output)).toBe(true);
    expect(JSON.stringify(output)).not.toContain("mushrooms");
    expect(Schema.is(RecipeExtraction)(output)).toBe(true);
  });

  it("uses the immutable recovery dispatch exactly once without changing evidence", async () => {
    const gateway = makeGateway(recipeJsonResponse(validRecipeSemantics));
    const dispatches: string[] = [];
    const adapter = await runFactory(
      makeInstalledRecipeExtractor({
        client: gateway.client,
        correlationId,
        dispatch: {
          run: (input) =>
            Effect.sync(() => {
              dispatches.push(input.dispatchId);
            }).pipe(
              Effect.andThen(input.invoke),
              Effect.map(({ value }) => value)
            ),
        },
      })
    );
    const request = {
      dispatchId: "recipe:import-1:1:fingerprint:recovery:1",
      evidenceFingerprint: "fingerprint",
      generation: 1 as never,
      importId: "import-1" as never,
      items: [
        {
          artifactReference: "private:evidence",
          evidenceId: "evidence-1",
          kind: "caption" as const,
          origin: "creator_provided" as const,
          value: "visible evidence",
        },
      ],
    };

    await Effect.runPromise(adapter.extract(request));

    expect(dispatches).toEqual([request.dispatchId]);
    expect(gateway.requests).toHaveLength(1);
  });

  it("rejects model attempts to inject recipe transport metadata", async () => {
    const gateway = makeGateway(recipeJsonResponse(validRecipe));
    const adapter = await runFactory(
      makeInstalledRecipeExtractor({
        client: gateway.client,
        correlationId,
        dispatch: localDispatchGate,
      })
    );
    const exit = await Effect.runPromiseExit(
      adapter.extract({
        evidenceFingerprint: "fingerprint",
        generation: 1 as never,
        importId: "import-1" as never,
        items: [
          {
            artifactReference: "private:evidence",
            evidenceId: "evidence-1",
            kind: "caption",
            origin: "creator_provided",
            value: "visible evidence",
          },
        ],
      })
    );

    expect(exit._tag).toBe("Failure");
    expect(JSON.stringify(exit)).toContain("malformed_response");
  });

  it("settles a schema-valid recipe without usage at the conservative maximum", async () => {
    const response = recipeJsonResponse(validRecipeSemantics);
    delete (response as { usage?: unknown }).usage;
    const gateway = makeGateway(response);
    const costs: (
      | { readonly _tag: "Known"; readonly actualCostMicroUsd: number }
      | {
          readonly _tag: "Conservative";
          readonly conservativeChargeMicroUsd: number;
        }
      | { readonly _tag: "Unknown" }
    )[] = [];
    const adapter = await runFactory(
      makeInstalledRecipeExtractor({
        client: gateway.client,
        correlationId,
        dispatch: {
          run: (input) =>
            input.invoke.pipe(
              Effect.tap(({ cost }) =>
                Effect.sync(() => {
                  costs.push(cost);
                })
              ),
              Effect.map(({ value }) => value)
            ),
        },
      })
    );
    const output = await Effect.runPromise(
      adapter.extract({
        evidenceFingerprint: "fingerprint",
        generation: 1 as never,
        importId: "import-1" as never,
        items: [
          {
            artifactReference: "private:evidence",
            evidenceId: "evidence-1",
            kind: "caption",
            origin: "creator_provided",
            value: "visible evidence",
          },
        ],
      })
    );
    expect(costs).toEqual([
      {
        _tag: "Conservative",
        conservativeChargeMicroUsd: 100_000,
      },
    ]);
    expect(output.cost).toEqual({
      certainty: "estimated",
      currency: "USD",
      estimatedMicroUsd: 100_000,
    });
  });

  it("times out a hanging recipe response body without logging or decoding its payload", async () => {
    const gateway = makeRawGateway(
      new Response(
        new ReadableStream<Uint8Array>({
          start() {
            // The provider returned headers but never completed the body.
          },
        }),
        { headers: { "content-type": "application/json" } }
      )
    );
    const trace = makeRecordingTraceStore();
    const adapter = await runFactory(
      makeInstalledRecipeExtractor({
        client: gateway.client,
        correlationId,
        dispatch: localDispatchGate,
      }),
      trace.service
    );
    const exit = await Effect.runPromise(
      Effect.gen(function* hangingRecipeBody() {
        const fiber = yield* Effect.forkChild(
          adapter.extract({
            evidenceFingerprint: "fingerprint",
            generation: 1 as never,
            importId: "import-1" as never,
            items: [
              {
                artifactReference: "private:evidence",
                evidenceId: "evidence-1",
                kind: "caption",
                origin: "creator_provided",
                value: "must-not-appear",
              },
            ],
          })
        );
        yield* Effect.yieldNow;
        yield* TestClock.adjust("150 seconds");
        return yield* Fiber.await(fiber);
      }).pipe(Effect.provide(TestClock.layer({ warningDelay: "10 seconds" })))
    );

    expect(exit).toMatchObject({ _tag: "Failure" });
    expect(JSON.stringify(exit)).toContain("timeout");
    expect(trace.events).toEqual([
      {
        correlationId,
        event: "provider.response",
        outcome: "received",
        providerStage: "recipe",
      },
      {
        correlationId,
        event: "provider.timeout",
        outcome: "timed_out",
        providerStage: "recipe",
      },
    ]);
    expect(JSON.stringify(exit)).not.toContain("must-not-appear");
    expect(JSON.stringify(trace.events)).not.toContain("must-not-appear");
  });

  it("fails closed without invoking the provider when a conservative replay hash is corrupt", async () => {
    const gateway = makeGateway(recipeJsonResponse(validRecipeSemantics));
    const replayGate: ProviderDispatchGate = {
      run: <A, E>(input: {
        readonly conservativeReplay?: {
          readonly decode: (
            replay: PilotProviderConservativeReplayValue
          ) => Effect.Effect<A, E>;
          readonly encode: (
            value: A
          ) => Effect.Effect<PilotProviderConservativeReplayValue, E>;
        };
      }) =>
        Effect.gen(function* replayCorruptHash() {
          if (input.conservativeReplay === undefined) {
            return yield* Effect.die("Missing conservative replay codec");
          }
          const replay = yield* input.conservativeReplay.encode({
            _tag: "Extracted",
            extraction: validRecipe,
          } as A);
          return yield* input.conservativeReplay.decode({
            ...replay,
            valueSha256: "0".repeat(64),
          });
        }),
    };
    const adapter = await runFactory(
      makeInstalledRecipeExtractor({
        client: gateway.client,
        correlationId,
        dispatch: replayGate,
      })
    );

    const exit = await Effect.runPromiseExit(
      adapter.extract({
        evidenceFingerprint: "e".repeat(64),
        generation: 1 as never,
        importId: "import-1" as never,
        items: [
          {
            artifactReference: "private:evidence",
            evidenceId: "evidence-1",
            kind: "caption",
            origin: "creator_provided",
            value: "must-not-appear",
          },
        ],
      })
    );

    expect(exit._tag).toBe("Failure");
    expect(JSON.stringify(exit)).toContain("malformed_response");
    expect(JSON.stringify(exit)).not.toContain("must-not-appear");
    expect(gateway.requests).toHaveLength(0);
  });

  it("fails closed without invoking the provider when conservative replay JSON violates the schema", async () => {
    const gateway = makeGateway(recipeJsonResponse(validRecipeSemantics));
    const valueJson = JSON.stringify({ unexpected: true });
    const valueSha256 = [
      ...new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(valueJson)
        )
      ),
    ]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    const replayGate: ProviderDispatchGate = {
      run: <A, E>(input: {
        readonly conservativeReplay?: {
          readonly decode: (
            replay: PilotProviderConservativeReplayValue
          ) => Effect.Effect<A, E>;
          readonly encode: (
            value: A
          ) => Effect.Effect<PilotProviderConservativeReplayValue, E>;
        };
      }) =>
        Effect.gen(function* replaySchemaInvalidJson() {
          if (input.conservativeReplay === undefined) {
            return yield* Effect.die("Missing conservative replay codec");
          }
          const replay = yield* input.conservativeReplay.encode({
            _tag: "Extracted",
            extraction: validRecipe,
          } as A);
          return yield* input.conservativeReplay.decode({
            ...replay,
            valueJson,
            valueSha256,
          });
        }),
    };
    const adapter = await runFactory(
      makeInstalledRecipeExtractor({
        client: gateway.client,
        correlationId,
        dispatch: replayGate,
      })
    );

    const exit = await Effect.runPromiseExit(
      adapter.extract({
        evidenceFingerprint: "e".repeat(64),
        generation: 1 as never,
        importId: "import-1" as never,
        items: [
          {
            artifactReference: "private:evidence",
            evidenceId: "evidence-1",
            kind: "caption",
            origin: "creator_provided",
            value: "must-not-appear",
          },
        ],
      })
    );

    expect(exit._tag).toBe("Failure");
    expect(JSON.stringify(exit)).toContain("malformed_response");
    expect(JSON.stringify(exit)).not.toContain("must-not-appear");
    expect(gateway.requests).toHaveLength(0);
  });

  it("fails closed without invoking the provider when a multibyte replay exceeds the byte cap", async () => {
    const gateway = makeGateway(recipeJsonResponse(validRecipeSemantics));
    const valueJson = JSON.stringify({ value: "é".repeat(140_000) });
    expect(valueJson.length).toBeLessThan(262_144);
    expect(new TextEncoder().encode(valueJson).byteLength).toBeGreaterThan(
      262_144
    );
    const valueSha256 = [
      ...new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(valueJson)
        )
      ),
    ]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    const replayGate: ProviderDispatchGate = {
      run: <A, E>(input: {
        readonly conservativeReplay?: {
          readonly decode: (
            replay: PilotProviderConservativeReplayValue
          ) => Effect.Effect<A, E>;
          readonly encode: (
            value: A
          ) => Effect.Effect<PilotProviderConservativeReplayValue, E>;
        };
      }) =>
        Effect.gen(function* replayOversizedMultibyteJson() {
          if (input.conservativeReplay === undefined) {
            return yield* Effect.die("Missing conservative replay codec");
          }
          const replay = yield* input.conservativeReplay.encode({
            _tag: "Extracted",
            extraction: validRecipe,
          } as A);
          return yield* input.conservativeReplay.decode({
            ...replay,
            valueJson,
            valueSha256,
          });
        }),
    };
    const adapter = await runFactory(
      makeInstalledRecipeExtractor({
        client: gateway.client,
        correlationId,
        dispatch: replayGate,
      })
    );

    const exit = await Effect.runPromiseExit(
      adapter.extract({
        evidenceFingerprint: "e".repeat(64),
        generation: 1 as never,
        importId: "import-1" as never,
        items: [
          {
            artifactReference: "private:evidence",
            evidenceId: "evidence-1",
            kind: "caption",
            origin: "creator_provided",
            value: "must-not-appear",
          },
        ],
      })
    );

    expect(exit._tag).toBe("Failure");
    expect(JSON.stringify(exit)).toContain("malformed_response");
    expect(JSON.stringify(exit)).not.toContain("must-not-appear");
    expect(gateway.requests).toHaveLength(0);
  });
});
