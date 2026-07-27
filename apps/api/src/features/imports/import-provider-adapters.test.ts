import { RuntimeContext } from "alchemy";
import type { QueryGatewayClient } from "alchemy/Cloudflare/AI";
import { Effect, Schema } from "effect";
import { Tool } from "effect/unstable/ai";
import { describe, expect, it, vi } from "vitest";

import {
  ImportCorrelationId,
  ImportObservabilityTraceStore,
} from "./import-observability.js";
import type {
  ImportObservabilityEvent,
  ImportObservabilityTraceStoreShape,
} from "./import-observability.js";
import {
  makeInstalledRecipeExtractor,
  makeInstalledSpeechTranscriber,
  makeInstalledVisualEvidenceExtractor,
} from "./import-provider-adapters.js";
import type { ProviderDispatchGate } from "./import-provider-adapters.js";
import { hasMinimumRecipeEvidence } from "./import-recipe-draft.js";
import { RecipeExtraction } from "./import-recipe-extractor.js";
import { VisualEvidence } from "./import-visual-evidence-extractor.js";

const makeGateway = (response: unknown) => {
  const requests: unknown[] = [];
  const gateway = {
    run: (request: unknown) => {
      requests.push(request);
      return Promise.resolve(Response.json(response));
    },
  };
  return {
    client: {
      gateway: Effect.succeed(gateway),
      id: Effect.succeed("meal-planner-pilot-gaia-118"),
      raw: Effect.die("metadata-only universal gateway was bypassed"),
    } as unknown as QueryGatewayClient,
    requests,
  };
};

const makeRawGateway = (response: Response) => {
  const requests: unknown[] = [];
  const gateway = {
    run: (request: unknown) => {
      requests.push(request);
      return Promise.resolve(response);
    },
  };
  return {
    client: {
      gateway: Effect.succeed(gateway),
      id: Effect.succeed("meal-planner-pilot-gaia-118"),
      raw: Effect.die("metadata-only universal gateway was bypassed"),
    } as unknown as QueryGatewayClient,
    requests,
  };
};

const makeSpeechGateway = (response: unknown) => {
  const requests: {
    readonly body: unknown;
    readonly model: string;
    readonly options: unknown;
  }[] = [];
  const raw = {
    run: (model: string, body: unknown, options: unknown) => {
      requests.push({ body, model, options });
      return Promise.resolve(response);
    },
  };
  return {
    client: {
      gateway: Effect.die("native Workers AI binding was bypassed"),
      id: Effect.succeed("meal-planner-pilot-gaia-118"),
      raw: Effect.succeed(raw),
    } as unknown as QueryGatewayClient,
    requests,
  };
};

const makeRejectedSpeechGateway = (error: unknown) =>
  ({
    gateway: Effect.die("native Workers AI binding was bypassed"),
    id: Effect.succeed("meal-planner-pilot-gaia-118"),
    raw: Effect.succeed({
      run: Promise.reject.bind(Promise, error),
    }),
  }) as unknown as QueryGatewayClient;

const correlationId = Schema.decodeUnknownSync(ImportCorrelationId)(
  "019b37f2-1a6e-7f3a-8a5a-7f0d8f6c2b1a"
);

const localDispatchGate: ProviderDispatchGate = {
  run: <A, E>(input: {
    readonly invoke: Effect.Effect<
      {
        readonly cost:
          | {
              readonly _tag: "Known";
              readonly actualCostMicroUsd: number;
            }
          | { readonly _tag: "Unknown" };
        readonly value: A;
      },
      E
    >;
  }) => input.invoke.pipe(Effect.map(({ value }) => value)),
};

const testRuntimeContext = RuntimeContext.of({
  Type: "TestRuntimeContext",
  env: {},
  get: <T>() =>
    // eslint-disable-next-line unicorn/no-useless-undefined -- The Alchemy runtime contract explicitly represents a missing binding with undefined.
    Effect.succeed<T | undefined>(undefined),
  id: "installed-provider-test",
  set: (id) => Effect.succeed(id),
});

const runFactory = <A>(
  effect: Effect.Effect<A, never, RuntimeContext>,
  traceStore?: ImportObservabilityTraceStoreShape
): Promise<A> => {
  const withRuntime = effect.pipe(
    Effect.provideService(RuntimeContext, testRuntimeContext)
  );
  return Effect.runPromise(
    traceStore === undefined
      ? withRuntime
      : withRuntime.pipe(
          Effect.provideService(ImportObservabilityTraceStore, traceStore)
        )
  );
};

const makeRecordingTraceStore = () => {
  const events: ImportObservabilityEvent[] = [];
  const service = ImportObservabilityTraceStore.of({
    append: (event) =>
      Effect.sync(() => {
        events.push(event);
      }),
    read: (requestedCorrelationId) =>
      Effect.succeed(
        events.filter((event) => event.correlationId === requestedCorrelationId)
      ),
  });
  return { events, service };
};

const unresolvedString = {
  citations: [],
  origin: "unresolved",
  reason: "not present in evidence",
  state: "unresolved",
} as const;
const unresolvedNumber = unresolvedString;
const unresolvedList = {
  items: [],
  reason: "not present in evidence",
  state: "unresolved",
} as const;

const validRecipe = {
  author: unresolvedString,
  category: unresolvedString,
  cookTimeMinutes: unresolvedNumber,
  cost: {
    certainty: "estimated",
    currency: "USD",
    estimatedMicroUsd: 50,
  },
  cuisine: unresolvedString,
  description: unresolvedString,
  ingredientLines: unresolvedList,
  instructions: unresolvedList,
  name: unresolvedString,
  nutrition: unresolvedString,
  prepTimeMinutes: unresolvedNumber,
  sourceUrl: unresolvedString,
  supportedClaims: unresolvedList,
  temperatureCelsius: unresolvedNumber,
  tools: unresolvedList,
  totalTimeMinutes: unresolvedNumber,
  unresolvedFields: ["name", "description", "ingredient_lines", "instructions"],
  usage: {
    inputEvidenceItems: 1,
    inputTokens: 20,
    latencyMilliseconds: 10,
    modelCalls: 1,
    outputTokens: 10,
  },
  yield: unresolvedString,
};

const validVisual = {
  cost: {
    certainty: "estimated",
    currency: "USD",
    estimatedMicroUsd: 20,
  },
  model: "@cf/meta/llama-3.2-11b-vision-instruct",
  observations: [],
  outcome: "empty",
  provider: "cloudflare-workers-ai",
  usage: { inputBytes: 3, inputFrames: 1, modelCalls: 1 },
};

const toolResponse = (name: string, value: unknown) => ({
  choices: [
    {
      finish_reason: "tool_calls",
      message: {
        content: null,
        tool_calls: [
          {
            function: { arguments: JSON.stringify(value), name },
            id: "call-1",
            type: "function",
          },
        ],
      },
    },
  ],
  usage: { completion_tokens: 10, prompt_tokens: 20 },
});

describe("installed import provider adapters", () => {
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

  it("uses the installed speech binding and duration-priced budget settlement", async () => {
    const gateway = makeSpeechGateway({
      segments: [],
      text: "Chop the onion.",
      transcription_info: {
        text: "Chop the onion.",
        word_count: 3,
      },
      vtt: "WEBVTT",
    });
    const trace = makeRecordingTraceStore();
    const dispatches: {
      readonly actualCostMicroUsd: number;
      readonly maximumCostMicroUsd: number;
      readonly providerStageId: string;
    }[] = [];
    const dispatch: ProviderDispatchGate = {
      run: (input) =>
        input.invoke.pipe(
          Effect.tap(({ cost }) =>
            Effect.sync(() => {
              dispatches.push({
                actualCostMicroUsd:
                  cost._tag === "Known" ? cost.actualCostMicroUsd : -1,
                maximumCostMicroUsd: input.maximumCostMicroUsd,
                providerStageId: input.providerStageId,
              });
            })
          ),
          Effect.map(({ value }) => value)
        ),
    };
    const adapter = await runFactory(
      makeInstalledSpeechTranscriber({
        client: gateway.client,
        correlationId,
        dispatch,
      }),
      trace.service
    );
    const transcript = await Effect.runPromise(
      adapter.transcribe({
        audio: {
          bytes: new Uint8Array([1, 2, 3]),
          durationMilliseconds: 60_000,
          mimeType: "audio/wav",
          sha256: "a".repeat(64),
        },
        dispatchId: "speech:import-1:1",
        generation: 1 as never,
        importId: "import-1" as never,
        sourceMediaSha256: "b".repeat(64),
      })
    );

    expect(transcript.text).toBe("Chop the onion.");
    expect(transcript.cost).toEqual({
      certainty: "estimated",
      currency: "USD",
      estimatedMicroUsd: 510,
    });
    expect(dispatches).toEqual([
      {
        actualCostMicroUsd: 510,
        maximumCostMicroUsd: 50_000,
        providerStageId: "speech-transcription",
      },
    ]);
    expect(gateway.requests[0]).toMatchObject({
      body: {
        audio: "AQID",
        condition_on_previous_text: false,
        language: "en",
        task: "transcribe",
        vad_filter: true,
      },
      model: "@cf/openai/whisper-large-v3-turbo",
      options: {
        gateway: {
          collectLog: true,
          id: "meal-planner-pilot-gaia-118",
          metadata: { correlationId },
        },
      },
    });
    expect(trace.events).toEqual([
      {
        correlationId,
        event: "provider.response",
        outcome: "received",
        providerStage: "speech",
      },
      {
        correlationId,
        event: "provider.decode",
        outcome: "succeeded",
        providerStage: "speech",
      },
    ]);
    expect(JSON.stringify(trace.events)).not.toContain("Chop the onion.");
  });

  it("settles known cost and fails closed when the installed speech response is malformed", async () => {
    const gateway = makeSpeechGateway({
      providerSecret: "must-not-escape",
      text: "text without transcription info",
    });
    const trace = makeRecordingTraceStore();
    const settledCosts: number[] = [];
    const adapter = await runFactory(
      makeInstalledSpeechTranscriber({
        client: gateway.client,
        correlationId,
        dispatch: {
          run: (input) =>
            input.invoke.pipe(
              Effect.tap(({ cost }) =>
                Effect.sync(() => {
                  settledCosts.push(
                    cost._tag === "Known" ? cost.actualCostMicroUsd : -1
                  );
                })
              ),
              Effect.map(({ value }) => value)
            ),
        },
      }),
      trace.service
    );
    const exit = await Effect.runPromiseExit(
      adapter.transcribe({
        audio: {
          bytes: new Uint8Array([1]),
          durationMilliseconds: 1000,
          mimeType: "audio/wav",
          sha256: "a".repeat(64),
        },
        dispatchId: "speech:import-1:1",
        generation: 1 as never,
        importId: "import-1" as never,
        sourceMediaSha256: "b".repeat(64),
      })
    );
    expect(exit._tag).toBe("Failure");
    expect(JSON.stringify(exit)).toContain("malformed_response");
    expect(settledCosts).toEqual([9]);
    expect(trace.events).toEqual([
      {
        correlationId,
        event: "provider.response",
        outcome: "received",
        providerStage: "speech",
      },
      {
        correlationId,
        event: "provider.decode",
        outcome: "malformed",
        providerStage: "speech",
      },
    ]);
    expect(JSON.stringify(exit)).not.toContain("must-not-escape");
    expect(JSON.stringify(trace.events)).not.toContain("must-not-escape");
  });

  it("preserves retryable native speech failures as typed redacted failures", async () => {
    const adapter = await runFactory(
      makeInstalledSpeechTranscriber({
        client: makeRejectedSpeechGateway({
          message: "providerSecret=must-not-escape",
          status: 429,
        }),
        correlationId,
        dispatch: localDispatchGate,
      })
    );

    const exit = await Effect.runPromiseExit(
      adapter.transcribe({
        audio: {
          bytes: new Uint8Array([1]),
          durationMilliseconds: 1000,
          mimeType: "audio/wav",
          sha256: "a".repeat(64),
        },
        dispatchId: "speech:import-1:1",
        generation: 1 as never,
        importId: "import-1" as never,
        sourceMediaSha256: "b".repeat(64),
      })
    );

    expect(exit._tag).toBe("Failure");
    expect(JSON.stringify(exit)).toContain("throttled");
    expect(JSON.stringify(exit)).not.toContain("must-not-escape");
  });

  it("observes the raw response and installed visual decode failure without payload data", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(vi.fn());
    const gateway = makeRawGateway(
      new Response('{"providerSecret":"must-not-escape"', {
        headers: { "content-type": "application/json" },
      })
    );
    const adapter = await runFactory(
      makeInstalledVisualEvidenceExtractor({
        client: gateway.client,
        correlationId,
        dispatch: localDispatchGate,
      })
    );

    const exit = await Effect.runPromiseExit(
      adapter.extract({
        dispatchId: "visual:import-1:1",
        frames: [
          {
            bytes: new Uint8Array([1, 2, 3]),
            height: 1,
            mimeType: "image/jpeg",
            sha256: "a".repeat(64),
            timestampMilliseconds: 0,
            width: 1,
          },
        ],
        generation: 1 as never,
        importId: "import-1" as never,
        sourceMediaSha256: "b".repeat(64),
      })
    );

    expect(exit._tag).toBe("Failure");
    expect(log.mock.calls).toEqual([
      [
        {
          correlationId,
          event: "provider.response",
          outcome: "received",
          providerStage: "visual",
        },
      ],
      [
        {
          correlationId,
          event: "provider.decode",
          outcome: "malformed",
          providerStage: "visual",
        },
      ],
    ]);
    expect(JSON.stringify(log.mock.calls)).not.toContain("must-not-escape");
    log.mockRestore();
  });

  it("uses the installed forced single-tool JSON Schema path for visual evidence", async () => {
    const gateway = makeGateway(
      toolResponse("record_visual_evidence", validVisual)
    );
    const adapter = await runFactory(
      makeInstalledVisualEvidenceExtractor({
        client: gateway.client,
        correlationId,
        dispatch: localDispatchGate,
        model: "@cf/meta/llama-3.2-11b-vision-instruct",
      })
    );
    const output = await Effect.runPromise(
      adapter.extract({
        dispatchId: "visual:import-1:1",
        frames: [
          {
            bytes: new Uint8Array([1, 2, 3]),
            height: 1,
            mimeType: "image/jpeg",
            sha256: "a".repeat(64),
            timestampMilliseconds: 0,
            width: 1,
          },
        ],
        generation: 1 as never,
        importId: "import-1" as never,
        sourceMediaSha256: "b".repeat(64),
      })
    );

    expect(output).toEqual({
      ...validVisual,
      cost: {
        certainty: "estimated",
        currency: "USD",
        estimatedMicroUsd: 8,
      },
    });
    expect(gateway.requests).toHaveLength(1);
    const request = gateway.requests[0] as {
      readonly query: {
        readonly tool_choice: unknown;
        readonly tools: readonly {
          readonly function: { name: string; parameters: unknown };
        }[];
      };
    };
    expect(request.query.tool_choice).toBe("required");
    expect(request.query.tools).toHaveLength(1);
    expect(request.query.tools[0]?.function.name).toBe(
      "record_visual_evidence"
    );
    expect(request.query.tools[0]?.function.parameters).toEqual(
      Tool.getJsonSchema(
        Tool.make("record_visual_evidence", { parameters: VisualEvidence })
      )
    );
  });

  it.each([
    ["prose", { choices: [{ message: { content: "{}" } }] }],
    ["wrong tool", toolResponse("wrong_tool", validRecipe)],
    [
      "multiple tools",
      {
        choices: [
          {
            message: {
              tool_calls: [
                {
                  function: {
                    arguments: JSON.stringify(validRecipe),
                    name: "record_recipe",
                  },
                },
                {
                  function: {
                    arguments: JSON.stringify(validRecipe),
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
                    arguments: JSON.stringify(validRecipe),
                    name: "wrong_tool",
                  },
                },
                {
                  function: {
                    arguments: JSON.stringify(validRecipe),
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
      toolResponse("record_recipe", {
        ...validRecipe,
        cost: { ...validRecipe.cost, estimatedMicroUsd: "not-a-number" },
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

  it("exposes the exact recipe schema to the installed transport", async () => {
    const gateway = makeGateway(toolResponse("record_recipe", validRecipe));
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
    expect(Schema.is(RecipeExtraction)(output)).toBe(true);
    const request = gateway.requests[0] as {
      readonly query: {
        readonly tools: readonly {
          readonly function: { parameters: unknown };
        }[];
      };
    };
    expect(request.query.tools[0]?.function.parameters).toEqual(
      Tool.getJsonSchema(
        Tool.make("record_recipe", { parameters: RecipeExtraction })
      )
    );
  });

  it("preserves absent installed usage as unknown for the atomic ledger", async () => {
    const response = toolResponse("record_recipe", validRecipe);
    delete (response as { usage?: unknown }).usage;
    const gateway = makeGateway(response);
    const costs: string[] = [];
    const adapter = await runFactory(
      makeInstalledRecipeExtractor({
        client: gateway.client,
        correlationId,
        dispatch: {
          run: (input) =>
            input.invoke.pipe(
              Effect.tap(({ cost }) =>
                Effect.sync(() => {
                  costs.push(cost._tag);
                })
              ),
              Effect.map(({ value }) => value)
            ),
        },
      })
    );
    await Effect.runPromise(
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
    expect(costs).toEqual(["Unknown"]);
  });
});
