import { RuntimeContext } from "alchemy";
import type { QueryGatewayClient } from "alchemy/Cloudflare/AI";
import { Effect, Fiber, Schema } from "effect";
import { TestClock } from "effect/testing";
import { Tool } from "effect/unstable/ai";
import { describe, expect, it, vi } from "vitest";

import type { PilotProviderConservativeReplayValue } from "../pilots/pilot-provider-budget.js";
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
import {
  RecipeExtraction,
  RecipeExtractionSemantics,
} from "./import-recipe-extractor.js";

const makeRawGateway = (response: Response) => {
  const requests: unknown[] = [];
  const ai = {
    run: (model: unknown, body: unknown, options: unknown) => {
      requests.push({ body, model, options });
      return Promise.resolve(response);
    },
  };
  return {
    client: {
      gateway: Effect.die("universal AI Gateway binding must not be used"),
      id: Effect.succeed("meal-planner-pilot-gaia-118"),
      raw: Effect.succeed(ai),
      run: () => Effect.die("universal AI Gateway dispatch must not be used"),
    } as unknown as QueryGatewayClient,
    requests,
  };
};

const makeGateway = (response: unknown) =>
  makeRawGateway(Response.json(response));

const makeSpeechGateway = makeGateway;

const makeRejectedSpeechGateway = (error: unknown) =>
  ({
    gateway: Effect.die("universal AI Gateway binding must not be used"),
    id: Effect.succeed("meal-planner-pilot-gaia-118"),
    raw: Effect.succeed({
      run: () => {
        throw error;
      },
    }),
    run: () => Effect.die("universal AI Gateway dispatch must not be used"),
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
          | {
              readonly _tag: "Conservative";
              readonly conservativeChargeMicroUsd: number;
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

const validRecipeSemantics = {
  author: unresolvedString,
  category: unresolvedString,
  cookTimeMinutes: unresolvedNumber,
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
  yield: unresolvedString,
} as const;

const validRecipe = {
  ...validRecipeSemantics,
  cost: {
    certainty: "estimated",
    currency: "USD",
    estimatedMicroUsd: 50,
  },
  usage: {
    inputEvidenceItems: 1,
    inputTokens: 20,
    latencyMilliseconds: 10,
    modelCalls: 1,
    outputTokens: 10,
  },
};

const validVisual = {
  cost: {
    certainty: "estimated",
    currency: "USD",
    estimatedMicroUsd: 20,
  },
  model: "@cf/google/gemma-4-26b-a4b-it",
  observations: [],
  outcome: "empty",
  provider: "cloudflare-workers-ai",
  usage: { inputBytes: 3, inputFrames: 1, modelCalls: 1 },
};

const validVisualSemantics = {
  observations: [],
  outcome: "empty",
} as const;

const defaultVisualUsage = { completion_tokens: 10, prompt_tokens: 20 };
const toolResponse = (
  name: string,
  value: unknown,
  usage: unknown | null = defaultVisualUsage
) => ({
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
  ...(usage === null ? {} : { usage }),
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

  it("uses the authenticated binding with provider logging disabled and exact workerd speech response shape", async () => {
    const gateway = makeSpeechGateway({
      segments: [],
      text: "Chop the onion.",
      transcription_info: {
        duration: 60,
        duration_after_vad: 59,
        language: "en",
        language_probability: 0.99,
      },
      word_count: 3,
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
    expect(gateway.requests[0]).toEqual({
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
          collectLog: false,
          id: "meal-planner-pilot-gaia-118",
          skipCache: true,
        },
        returnRawResponse: true,
      },
    });
    const speechRequest = gateway.requests[0] as {
      readonly options: {
        readonly gateway: {
          readonly collectLog: boolean;
          readonly metadata?: unknown;
        };
      };
    };
    expect(speechRequest.options.gateway.collectLog).toBe(false);
    expect(speechRequest.options.gateway).not.toHaveProperty("metadata");
    expect(speechRequest.options).not.toHaveProperty("headers");
    expect(JSON.stringify(speechRequest.options)).not.toMatch(
      /AQID|Chop the onion|https?:|cookie|credential|prompt|transcript/iu
    );
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
      transcription_info: {
        duration: 1,
        language: "en",
      },
      word_count: 4,
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
          _tag: "AiGatewayError",
          cause: {
            providerSecret: "must-not-escape",
            status: 429,
          },
          message: "providerSecret=must-not-escape",
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

  it("uses one forced visual tool call and injects trusted transport metadata", async () => {
    const visualSemantics = {
      observations: [
        {
          confidence: 0.92,
          frameIndex: 1,
          text: "2 onions",
        },
      ],
      outcome: "found",
    } as const;
    const gateway = makeGateway(
      toolResponse("record_visual_evidence", visualSemantics)
    );
    const trace = makeRecordingTraceStore();
    const adapter = await runFactory(
      makeInstalledVisualEvidenceExtractor({
        client: gateway.client,
        correlationId,
        dispatch: localDispatchGate,
        model: "@cf/google/gemma-4-26b-a4b-it",
      }),
      trace.service
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
            timestampMilliseconds: 125,
            width: 1,
          },
          {
            bytes: new Uint8Array([4, 5]),
            height: 1,
            mimeType: "image/jpeg",
            sha256: "c".repeat(64),
            timestampMilliseconds: 500,
            width: 1,
          },
        ],
        generation: 1 as never,
        importId: "import-1" as never,
        sourceMediaSha256: "b".repeat(64),
      })
    );

    expect(output).toEqual({
      cost: {
        certainty: "estimated",
        currency: "USD",
        estimatedMicroUsd: 5,
      },
      model: "@cf/google/gemma-4-26b-a4b-it",
      observations: [
        {
          confidence: 0.92,
          frameIndex: 1,
          kind: "visible_text",
          regions: [{ height: 1, width: 1, x: 0, y: 0 }],
          text: "2 onions",
          timestampMilliseconds: 500,
        },
      ],
      outcome: "found",
      provider: "cloudflare-workers-ai",
      usage: { inputBytes: 5, inputFrames: 2, modelCalls: 1 },
    });
    expect(gateway.requests).toHaveLength(1);
    const request = gateway.requests[0] as {
      readonly body: {
        readonly response_format?: unknown;
        readonly messages: readonly {
          readonly content: readonly { readonly type: string }[];
        }[];
        readonly tool_choice: string;
        readonly tools: readonly {
          readonly function: {
            readonly name: string;
            readonly parameters: unknown;
          };
          readonly type: string;
        }[];
      };
      readonly model: string;
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
    expect(request.model).toBe("@cf/google/gemma-4-26b-a4b-it");
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
    expect(JSON.stringify(request.options)).not.toMatch(
      /AQID|data:image|https?:|cookie|credential|prompt|transcript/iu
    );
    expect(request.body).not.toHaveProperty("response_format");
    expect(request.body.tool_choice).toBe("required");
    expect(request.body.tools).toHaveLength(1);
    expect(request.body.tools[0]).toMatchObject({
      function: { name: "record_visual_evidence" },
      type: "function",
    });
    expect(request.body.messages[0]?.content.map(({ type }) => type)).toEqual([
      "text",
      "image_url",
      "image_url",
    ]);
    const jsonSchema = request.body.tools[0]?.function.parameters;
    expect(jsonSchema).toMatchObject({
      additionalProperties: false,
      properties: {
        observations: expect.any(Object),
        outcome: expect.any(Object),
      },
      required: ["observations", "outcome"],
      type: "object",
    });
    const observationItems = (
      jsonSchema as {
        readonly properties: {
          readonly observations: {
            readonly items: {
              readonly additionalProperties: boolean;
              readonly properties: Record<string, unknown>;
            };
          };
        };
      }
    ).properties.observations.items;
    expect(observationItems.additionalProperties).toBe(false);
    expect(Object.keys(observationItems.properties)).toEqual([
      "confidence",
      "frameIndex",
      "text",
    ]);
    expect(observationItems.properties["frameIndex"]).toMatchObject({
      type: "integer",
    });
    expect(JSON.stringify(observationItems.properties["frameIndex"])).toMatch(
      /"minimum":0/u
    );
    expect(JSON.stringify(observationItems.properties["frameIndex"])).toMatch(
      /"maximum":1/u
    );
    expect(
      Object.keys(
        (
          jsonSchema as {
            readonly properties: Record<string, unknown>;
          }
        ).properties
      )
    ).toEqual(["observations", "outcome"]);
    expect(trace.events).toEqual([
      {
        correlationId,
        event: "provider.response",
        outcome: "received",
        providerStage: "visual",
      },
      {
        correlationId,
        event: "provider.decode",
        outcome: "succeeded",
        providerStage: "visual",
      },
    ]);
    expect(JSON.stringify(trace.events)).not.toContain("2 onions");
  });

  it("accepts the installed Gemma native forced-tool response contract", async () => {
    const gateway = makeGateway({
      tool_calls: [
        {
          arguments: validVisualSemantics,
          name: "record_visual_evidence",
        },
      ],
      usage: defaultVisualUsage,
    });
    const adapter = await runFactory(
      makeInstalledVisualEvidenceExtractor({
        client: gateway.client,
        correlationId,
        dispatch: localDispatchGate,
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
            timestampMilliseconds: 125,
            width: 1,
          },
        ],
        generation: 1 as never,
        importId: "import-1" as never,
        sourceMediaSha256: "b".repeat(64),
      })
    );

    expect(output).toMatchObject({
      model: "@cf/google/gemma-4-26b-a4b-it",
      observations: [],
      outcome: "empty",
    });
    expect(gateway.requests).toHaveLength(1);
    expect((gateway.requests[0] as { readonly model: string }).model).toBe(
      "@cf/google/gemma-4-26b-a4b-it"
    );
  });

  it("rejects model attempts to inject visual transport metadata", async () => {
    const gateway = makeGateway(
      toolResponse("record_visual_evidence", validVisual)
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
    expect(JSON.stringify(exit)).toContain("malformed_response");
  });

  it.each([
    [
      "invalid tool arguments",
      toolResponse("record_visual_evidence", "{not-json"),
    ],
    [
      "model-owned trusted fields",
      toolResponse("record_visual_evidence", {
        observations: [
          {
            confidence: 0.9,
            frameIndex: 0,
            kind: "visible_text",
            text: "2 onions",
          },
        ],
        outcome: "found",
      }),
    ],
    [
      "out-of-range frame references",
      toolResponse("record_visual_evidence", {
        observations: [{ confidence: 0.9, frameIndex: 1, text: "2 onions" }],
        outcome: "found",
      }),
    ],
    [
      "contradictory outcomes",
      toolResponse("record_visual_evidence", {
        observations: [{ confidence: 0.9, frameIndex: 0, text: "2 onions" }],
        outcome: "empty",
      }),
    ],
  ])("fails closed for visual %s", async (_label, response) => {
    const gateway = makeGateway(response);
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
    expect(JSON.stringify(exit)).toContain("malformed_response");
    expect(JSON.stringify(exit)).not.toContain("must-not-escape");
  });

  it.each([
    [
      "absent",
      toolResponse("record_visual_evidence", validVisualSemantics, null),
    ],
    [
      "zero",
      toolResponse("record_visual_evidence", validVisualSemantics, {
        completion_tokens: 0,
        prompt_tokens: 0,
      }),
    ],
  ])(
    "settles %s visual usage at the bounded maximum without claiming known provider spend",
    async (_label, response) => {
      const costs: (
        | {
            readonly _tag: "Known";
            readonly actualCostMicroUsd: number;
          }
        | {
            readonly _tag: "Conservative";
            readonly conservativeChargeMicroUsd: number;
          }
        | { readonly _tag: "Unknown" }
      )[] = [];
      const adapter = await runFactory(
        makeInstalledVisualEvidenceExtractor({
          client: makeGateway(response).client,
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

      expect(costs).toEqual([{ _tag: "Known", actualCostMicroUsd: 100_000 }]);
      expect(output.cost).toEqual({
        certainty: "estimated",
        currency: "USD",
        estimatedMicroUsd: 100_000,
      });
    }
  );

  it("rejects an empty visual dispatch before the provider boundary", async () => {
    const gateway = makeGateway(
      toolResponse("record_visual_evidence", validVisualSemantics)
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
        frames: [],
        generation: 1 as never,
        importId: "import-1" as never,
        sourceMediaSha256: "b".repeat(64),
      })
    );

    expect(exit._tag).toBe("Failure");
    expect(JSON.stringify(exit)).toContain("insufficient_evidence");
    expect(gateway.requests).toHaveLength(0);
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
      toolResponse("record_recipe", {
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

  it("accepts semantic-only recipe output and injects trusted transport usage", async () => {
    const gateway = makeGateway(
      toolResponse("record_recipe", validRecipeSemantics)
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
        readonly tool_choice?: unknown;
        readonly tools: readonly {
          readonly function: {
            readonly name: string;
            readonly parameters: unknown;
          };
        }[];
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
    expect(request.body.tool_choice).toBe("required");
    expect(request.body.tools[0]?.function.name).toBe("record_recipe");
    expect(request.body.tools[0]?.function.parameters).toEqual(
      Tool.getJsonSchema(
        Tool.make("record_recipe", { parameters: RecipeExtractionSemantics })
      )
    );
    expect(request.body.tools[0]?.function.parameters).toMatchObject(
      expect.objectContaining({
        additionalProperties: false,
        type: "object",
      })
    );
  });

  it("uses the immutable recovery dispatch exactly once without changing evidence", async () => {
    const gateway = makeGateway(
      toolResponse("record_recipe", validRecipeSemantics)
    );
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
    const gateway = makeGateway(toolResponse("record_recipe", validRecipe));
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
    const response = toolResponse("record_recipe", validRecipeSemantics);
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
    const gateway = makeGateway(
      toolResponse("record_recipe", validRecipeSemantics)
    );
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
          const replay = yield* input.conservativeReplay.encode(
            validRecipe as A
          );
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
    const gateway = makeGateway(
      toolResponse("record_recipe", validRecipeSemantics)
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
          const replay = yield* input.conservativeReplay.encode(
            validRecipe as A
          );
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
    const gateway = makeGateway(
      toolResponse("record_recipe", validRecipeSemantics)
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
          const replay = yield* input.conservativeReplay.encode(
            validRecipe as A
          );
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
