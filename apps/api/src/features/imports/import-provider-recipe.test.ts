import {
  emptyRecipeDetails,
  recipeIngredientFromText,
  recipeInstructionFromText,
} from "@meal-planner/recipe-domain";
import { Effect, Fiber, Schema } from "effect";
import { TestClock } from "effect/testing";
import { Tool } from "effect/unstable/ai";
import { describe, expect, it } from "vitest";

import type { ProviderAccountingConservativeReplayValue } from "../provider-accounting/provider-accounting.js";
import {
  makeRawProviderTransports,
  makeProviderTransports,
  makeRejectedProviderTransports,
  correlationId,
  localDispatchGate,
  runFactory,
  makeRecordingTraceStore,
  recipeEvidenceAssembly,
  runRecipeTransportRoot,
  validRecipeSemantics,
  validRecipe,
  emptyRecipeProviderSelection,
  defaultVisualUsage,
  toolResponse,
  recipeJsonResponse,
} from "./import-provider-adapters.test-fixture.js";
import type { ProviderDispatchGate } from "./import-provider-kernel.js";
import { makeInstalledRecipeExtractor } from "./import-provider-recipe.js";
import { hasMinimumRecipeEvidence } from "./import-recipe-draft.js";
import {
  RecipeCandidate,
  RecipeExtraction,
} from "./import-recipe-extractor.js";

describe("installed recipe provider adapter", () => {
  it("classifies accessible non-food evidence semantically without a draft shape", () => {
    expect(
      hasMinimumRecipeEvidence(
        Schema.decodeUnknownSync(RecipeExtraction)(validRecipe)
      )
    ).toBe(false);
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
      const trace = makeRecordingTraceStore();
      const gateway = makeRawProviderTransports(response(), trace.service);
      const adapter = await runFactory(
        makeInstalledRecipeExtractor({
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
          transport: gateway.recipe,
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
      expect(gateway.recipeRequests).toHaveLength(1);
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
        transport: makeRejectedProviderTransports(
          Object.assign(new Error("provider transport unavailable"), {
            message: "providerPrivateCanary=must-not-escape",
            status: 503,
          })
        ).recipe,
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
    [
      "a tool envelope instead of JSON mode",
      toolResponse("record_recipe", validRecipeSemantics),
    ],
    [
      "schema-invalid arguments",
      recipeJsonResponse({
        ...validRecipeSemantics,
        name: { state: "invalid" },
      }),
    ],
  ])("fails closed for %s", async (_label, response) => {
    const gateway = makeProviderTransports(response);
    const adapter = await runFactory(
      makeInstalledRecipeExtractor({
        correlationId,
        dispatch: localDispatchGate,
        transport: gateway.recipe,
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
    const gateway = makeProviderTransports(
      recipeJsonResponse(emptyRecipeProviderSelection)
    );
    const adapter = await runFactory(
      makeInstalledRecipeExtractor({
        correlationId,
        dispatch: localDispatchGate,
        transport: gateway.recipe,
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
    const [request] = gateway.recipeRequests;
    expect(request).not.toHaveProperty("tool_choice");
    expect(request).not.toHaveProperty("tools");
    expect(request?.response_format).toEqual({
      json_schema: Tool.getJsonSchemaFromSchema(RecipeCandidate),
      type: "json_schema",
    });
    expect(request?.response_format).toMatchObject({
      json_schema: expect.objectContaining({
        additionalProperties: false,
        type: "object",
      }),
      type: "json_schema",
    });
    const serializedRequest = JSON.stringify(request);
    expect(serializedRequest).toContain(
      "Select only recipe values supported by the supplied evidence"
    );
    expect(serializedRequest).toContain(
      "Select ingredients as objects retaining exact original ingredient phrases"
    );
    expect(serializedRequest).toContain(
      "ingredients and instructions must each contain at least one"
    );
    expect(serializedRequest).toContain(
      "Do not reject recipe narration merely because quantities, timings, title, or other fields are missing"
    );
    expect(serializedRequest).toContain(
      "Include a numeric value only when the exact number and its unit occur in the evidence"
    );
    expect(serializedRequest).toContain("the trusted adapter derives those");
  });

  it("grounds sparse spoken recipes through the installed provider without invented quantities", async () => {
    const candidate = {
      ...emptyRecipeDetails,
      ingredients: [
        recipeIngredientFromText("tomatoes"),
        recipeIngredientFromText("invented mushrooms"),
      ],
      instructions: [
        recipeInstructionFromText("add chopped tomatoes to the pan", 1),
      ],
      name: null,
    };
    const gateway = makeProviderTransports(recipeJsonResponse(candidate));
    const adapter = await runFactory(
      makeInstalledRecipeExtractor({
        correlationId,
        dispatch: localDispatchGate,
        transport: gateway.recipe,
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
              "Ingredients include tomatoes. Start by adding the chopped tomatoes to the pan.",
          },
        ],
      })
    );
    expect(output.recipe.ingredients).toEqual([
      recipeIngredientFromText("tomatoes"),
    ]);
    expect(output.recipe.instructions?.[0]?.text).toBe(
      "adding the chopped tomatoes to the pan"
    );
    expect(output.recipe.author).toBeNull();
    expect(output.recipe.servings).toBeNull();
    expect(hasMinimumRecipeEvidence(output)).toBe(true);
    expect(JSON.stringify(output)).not.toContain("invented mushrooms");
    expect(output.evidence).toContainEqual({
      citations: [
        {
          confidence: 1,
          evidenceId: "transcript-evidence",
          origin: "creator_provided",
        },
      ],
      path: "ingredients.0.original",
    });
    expect(Schema.is(RecipeExtraction)(output)).toBe(true);
  });

  it("keeps installed non-food extraction below the recipe threshold", async () => {
    const adapter = await runFactory(
      makeInstalledRecipeExtractor({
        correlationId,
        dispatch: localDispatchGate,
        transport: makeProviderTransports(
          recipeJsonResponse(emptyRecipeProviderSelection)
        ).recipe,
      })
    );
    const output = await Effect.runPromise(
      adapter.extract({
        ...recipeEvidenceAssembly,
        items: [
          {
            artifactReference: "transcript",
            evidenceId: "non-food",
            kind: "transcript",
            origin: "creator_provided",
            value: "A city walking tour showing the bridges.",
          },
        ],
      })
    );
    expect(hasMinimumRecipeEvidence(output)).toBe(false);
    expect(output.recipe.ingredients).toBeNull();
    expect(output.recipe.instructions).toBeNull();
  });
  it.each([
    { citations: [{ confidence: 1, evidenceId: "fake", origin: "observed" }] },
    { sourceUrl: "https://forged.example/recipe" },
    { origin: "observed" },
    { unresolvedFields: [] },
  ])("rejects installed provider-owned authority %j", async (authority) => {
    const adapter = await runFactory(
      makeInstalledRecipeExtractor({
        correlationId,
        dispatch: localDispatchGate,
        transport: makeProviderTransports(
          recipeJsonResponse({ ...emptyRecipeProviderSelection, ...authority })
        ).recipe,
      })
    );
    const exit = await Effect.runPromiseExit(
      adapter.extract(recipeEvidenceAssembly)
    );
    expect(exit._tag).toBe("Failure");
    expect(JSON.stringify(exit)).toContain("malformed_response");
  });
  it("installed extraction takes source identity from trusted assembly", async () => {
    const selection = {
      ...emptyRecipeProviderSelection,
      author: { name: "Invented chef", url: "https://invented.example/chef" },
    };
    const adapter = await runFactory(
      makeInstalledRecipeExtractor({
        correlationId,
        dispatch: localDispatchGate,
        transport: makeProviderTransports(recipeJsonResponse(selection)).recipe,
      })
    );
    const output = await Effect.runPromise(
      adapter.extract({
        ...recipeEvidenceAssembly,
        items: [
          {
            artifactReference: "source",
            evidenceId: "creator",
            kind: "creator",
            origin: "observed",
            value: "Chef Ada",
          },
          {
            artifactReference: "source",
            evidenceId: "url",
            kind: "source_url",
            origin: "observed",
            value: "https://source.example/recipe",
          },
        ],
      })
    );
    expect(output.recipe.author).toEqual({ name: "Chef Ada", url: null });
    expect(output.sourceUrl).toMatchObject({
      citations: [{ confidence: 1, evidenceId: "url", origin: "observed" }],
      value: "https://source.example/recipe",
    });
    expect(JSON.stringify(output)).not.toContain("Invented chef");
  });

  it("uses the immutable recovery dispatch exactly once without changing evidence", async () => {
    const gateway = makeProviderTransports(
      recipeJsonResponse(emptyRecipeProviderSelection)
    );
    const dispatches: string[] = [];
    const adapter = await runFactory(
      makeInstalledRecipeExtractor({
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
        transport: gateway.recipe,
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
    expect(gateway.recipeRequests).toHaveLength(1);
  });

  it("rejects model attempts to inject recipe transport metadata", async () => {
    const gateway = makeProviderTransports(recipeJsonResponse(validRecipe));
    const adapter = await runFactory(
      makeInstalledRecipeExtractor({
        correlationId,
        dispatch: localDispatchGate,
        transport: gateway.recipe,
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
    const response = recipeJsonResponse(emptyRecipeProviderSelection);
    delete (response as { usage?: unknown }).usage;
    const gateway = makeProviderTransports(response);
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
        transport: gateway.recipe,
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
    const trace = makeRecordingTraceStore();
    const gateway = makeRawProviderTransports(
      new Response(
        new ReadableStream<Uint8Array>({
          start() {
            // The provider returned headers but never completed the body.
          },
        }),
        { headers: { "content-type": "application/json" } }
      ),
      trace.service
    );
    const adapter = await runFactory(
      makeInstalledRecipeExtractor({
        correlationId,
        dispatch: localDispatchGate,
        transport: gateway.recipe,
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
    const gateway = makeProviderTransports(
      recipeJsonResponse(validRecipeSemantics)
    );
    const replayGate: ProviderDispatchGate = {
      run: <A, E>(input: {
        readonly conservativeReplay?: {
          readonly decode: (
            replay: ProviderAccountingConservativeReplayValue
          ) => Effect.Effect<A, E>;
          readonly encode: (
            value: A
          ) => Effect.Effect<ProviderAccountingConservativeReplayValue, E>;
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
        correlationId,
        dispatch: replayGate,
        transport: gateway.recipe,
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
    expect(gateway.recipeRequests).toHaveLength(0);
  });

  it("fails closed without invoking the provider when conservative replay JSON violates the schema", async () => {
    const gateway = makeProviderTransports(
      recipeJsonResponse(validRecipeSemantics)
    );
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
            replay: ProviderAccountingConservativeReplayValue
          ) => Effect.Effect<A, E>;
          readonly encode: (
            value: A
          ) => Effect.Effect<ProviderAccountingConservativeReplayValue, E>;
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
        correlationId,
        dispatch: replayGate,
        transport: gateway.recipe,
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
    expect(gateway.recipeRequests).toHaveLength(0);
  });

  it("fails closed without invoking the provider when a multibyte replay exceeds the byte cap", async () => {
    const gateway = makeProviderTransports(
      recipeJsonResponse(validRecipeSemantics)
    );
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
            replay: ProviderAccountingConservativeReplayValue
          ) => Effect.Effect<A, E>;
          readonly encode: (
            value: A
          ) => Effect.Effect<ProviderAccountingConservativeReplayValue, E>;
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
        correlationId,
        dispatch: replayGate,
        transport: gateway.recipe,
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
    expect(gateway.recipeRequests).toHaveLength(0);
  });
});
