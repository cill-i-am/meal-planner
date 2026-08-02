import { RuntimeContext } from "alchemy";
import type { QueryGatewayClient } from "alchemy/Cloudflare/AI";
import { Effect, Fiber, Schema } from "effect";
import { TestClock } from "effect/testing";
import { Tool } from "effect/unstable/ai";
import { describe, expect, it, vi } from "vitest";

import {
  isPilotProviderKnownZeroCostFailure,
  pilotProviderKnownZeroCostFailure,
} from "../pilots/pilot-provider-budget.js";
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
  RecipeProviderToolArguments,
} from "./import-recipe-extractor.js";

const makeRawGateway = (response: Response) => {
  const requests: unknown[] = [];
  const ai = {
    run: (model: unknown, body: unknown, options: unknown) => {
      requests.push({ body, model, options });
      return (options as { readonly returnRawResponse?: boolean })
        .returnRawResponse === true
        ? Promise.resolve(response)
        : response.clone().json();
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

const makeSpeechGatewayFromValue = (response: unknown) => {
  const responseEnvelope = new Response(null, { status: 200 });
  Object.defineProperty(responseEnvelope, "json", {
    value: () => Promise.resolve(response),
  });
  return makeRawGateway(responseEnvelope);
};

const makeRejectedGateway = (error: unknown) =>
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

const speechTranscriptionInput = {
  audio: {
    bytes: new Uint8Array([1]),
    durationMilliseconds: 1000,
    mimeType: "audio/wav" as const,
    sha256: "a".repeat(64),
  },
  dispatchId: "speech:import-1:1",
  generation: 1 as never,
  importId: "import-1" as never,
  sourceMediaSha256: "b".repeat(64),
};

const nestUnknownMetadata = (leaf: unknown, depth: number): unknown => {
  let value = leaf;
  for (let index = 0; index < depth; index += 1) {
    value = { nested: value };
  }
  return value;
};

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

const recipeEvidenceAssembly = {
  evidenceFingerprint: "fingerprint",
  generation: 1 as never,
  importId: "import-1" as never,
  items: [
    {
      artifactReference: "private:evidence",
      evidenceId: "evidence-1",
      kind: "caption",
      origin: "creator_provided",
      value: "visible evidence first supported value second supported value",
    },
  ],
} as const;

const runRecipeTransportRoot = async (response: unknown) => {
  const trace = makeRecordingTraceStore();
  const adapter = await runFactory(
    makeInstalledRecipeExtractor({
      client: makeGateway(response).client,
      correlationId,
      dispatch: localDispatchGate,
    }),
    trace.service
  );
  const exit = await Effect.runPromiseExit(
    adapter.extract(recipeEvidenceAssembly)
  );
  return { exit, trace };
};

const unresolvedString = {
  citations: [],
  origin: "unresolved",
  reason: "not resolved from available evidence",
  state: "unresolved",
} as const;
const unresolvedNumber = unresolvedString;
const unresolvedList = {
  items: [],
  reason: "not resolved from available evidence",
  state: "unresolved",
} as const;
const providerCitedString = (value: string) => ({
  citations: [
    {
      confidence: 0.9,
      evidenceId: "provider-selected-evidence",
      origin: "creator_provided" as const,
    },
  ],
  origin: "inferred" as const,
  state: "supported" as const,
  value,
});

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
  unresolvedFields: [
    "author",
    "category",
    "cook_time_minutes",
    "cuisine",
    "description",
    "ingredient_lines",
    "instructions",
    "name",
    "nutrition",
    "prep_time_minutes",
    "temperature_celsius",
    "tools",
    "total_time_minutes",
    "yield",
    "ingredient_quantities",
    "ingredient_units",
  ],
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

const emptyRecipeProviderSelection = {
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
} as const;

const citedRecipeString = (value: string) => ({
  citations: [
    {
      confidence: 0.9,
      evidenceId: "transcript-evidence",
      origin: "creator_provided" as const,
    },
  ],
  origin: "inferred" as const,
  state: "supported" as const,
  value,
});

const validVisual = {
  cost: {
    certainty: "estimated",
    currency: "USD",
    estimatedMicroUsd: 20,
  },
  model: "@cf/meta/llama-4-scout-17b-16e-instruct",
  observations: [],
  outcome: "empty",
  provider: "cloudflare-workers-ai",
  usage: { inputBytes: 3, inputFrames: 1, modelCalls: 1 },
};

const validVisualSemantics = {
  observations: [],
} as const;

const defaultVisualUsage = {
  completion_tokens: 10,
  prompt_tokens: 20,
  total_tokens: 30,
};
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

const recipeJsonResponse = (
  value: unknown,
  usage: unknown | null = defaultVisualUsage
) => ({
  response: value,
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

  it("uses the authenticated binding with provider logging disabled and the pinned combined speech response shape", async () => {
    const gateway = makeSpeechGateway({
      segments: [
        {
          avg_logprob: -0.25,
          compression_ratio: 1.1,
          end: 1,
          no_speech_prob: 0.01,
          start: 0,
          temperature: 0,
          text: "Chop the onion.",
          words: [
            {
              end: 0.5,
              start: 0,
              word: "Chop",
            },
          ],
        },
      ],
      text: "Chop the onion.",
      transcription_info: {
        duration: 1,
        duration_after_vad: 0.9,
        language: "en",
        language_probability: 0.99,
      },
      vtt: "WEBVTT",
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

  it("retains the pinned installed root speech response compatibility shape", async () => {
    const adapter = await runFactory(
      makeInstalledSpeechTranscriber({
        client: makeSpeechGateway({
          text: "Chop the onion.",
          vtt: null,
          word_count: 3,
          words: [
            {
              end: 0.5,
              start: 0,
              word: "Chop",
            },
          ],
        }).client,
        correlationId,
        dispatch: localDispatchGate,
      })
    );

    const transcript = await Effect.runPromise(
      adapter.transcribe(speechTranscriptionInput)
    );

    expect(transcript.text).toBe("Chop the onion.");
  });

  it("accepts bounded standard Whisper segment metadata and projects it away", async () => {
    const baselineAdapter = await runFactory(
      makeInstalledSpeechTranscriber({
        client: makeSpeechGateway({
          segments: [],
          text: "Chop the onion.",
        }).client,
        correlationId,
        dispatch: localDispatchGate,
      })
    );
    const trace = makeRecordingTraceStore();
    const metadataAdapter = await runFactory(
      makeInstalledSpeechTranscriber({
        client: makeSpeechGateway({
          segments: [
            {
              id: 0,
              seek: 0,
              tokens: [50_365, 50_817],
            },
          ],
          text: "Chop the onion.",
        }).client,
        correlationId,
        dispatch: localDispatchGate,
      }),
      trace.service
    );

    const [baselineTranscript, metadataTranscript] = await Promise.all([
      Effect.runPromise(baselineAdapter.transcribe(speechTranscriptionInput)),
      Effect.runPromise(metadataAdapter.transcribe(speechTranscriptionInput)),
    ]);

    expect(metadataTranscript).toEqual(baselineTranscript);
    expect(trace.events.at(-1)).toEqual({
      correlationId,
      event: "provider.decode",
      outcome: "succeeded",
      providerStage: "speech",
    });
    expect(
      JSON.stringify({ metadataTranscript, trace: trace.events })
    ).not.toMatch(/50365|50817/u);
  });

  it("accepts only the bounded upper edge of standard Whisper segment metadata", async () => {
    const adapter = await runFactory(
      makeInstalledSpeechTranscriber({
        client: makeSpeechGateway({
          segments: [
            {
              id: Number.MAX_SAFE_INTEGER,
              seek: Number.MAX_SAFE_INTEGER,
              tokens: Array.from({ length: 4096 }, () => 1),
            },
          ],
          text: "Chop the onion.",
        }).client,
        correlationId,
        dispatch: localDispatchGate,
      })
    );

    const transcript = await Effect.runPromise(
      adapter.transcribe(speechTranscriptionInput)
    );

    expect(transcript.text).toBe("Chop the onion.");
  });

  it.each([
    ["one unconsumed root scalar", { platformRevision: 7 }],
    [
      "one inert root object",
      {
        platformMetadata: {
          attempt: 1,
          region: "synthetic",
        },
      },
    ],
    [
      "one deeply nested inert root object",
      {
        platformMetadata: nestUnknownMetadata("synthetic", 24),
      },
    ],
    [
      "multiple unconsumed root values",
      {
        platformEnabled: true,
        platformMetadata: {
          attempt: 1,
          region: "synthetic",
        },
        platformRevision: 7,
      },
    ],
  ] as const)(
    "discards %s after family discrimination without changing semantic output",
    async (_case, rootMetadata) => {
      const baselineAdapter = await runFactory(
        makeInstalledSpeechTranscriber({
          client: makeSpeechGateway({
            segments: [],
            text: "Chop the onion.",
          }).client,
          correlationId,
          dispatch: localDispatchGate,
        })
      );
      const trace = makeRecordingTraceStore();
      const metadataAdapter = await runFactory(
        makeInstalledSpeechTranscriber({
          client: makeSpeechGateway({
            ...rootMetadata,
            segments: [],
            text: "Chop the onion.",
          }).client,
          correlationId,
          dispatch: localDispatchGate,
        }),
        trace.service
      );

      const [baselineTranscript, metadataTranscript] = await Promise.all([
        Effect.runPromise(baselineAdapter.transcribe(speechTranscriptionInput)),
        Effect.runPromise(metadataAdapter.transcribe(speechTranscriptionInput)),
      ]);

      expect(metadataTranscript).toEqual(baselineTranscript);
      expect(trace.events.at(-1)).toEqual({
        correlationId,
        event: "provider.decode",
        outcome: "succeeded",
        providerStage: "speech",
      });
      expect(JSON.stringify(trace.events)).not.toMatch(
        /platform(?:Enabled|Metadata|Revision)|synthetic/u
      );
    }
  );

  it.each([
    [
      "transcription-info",
      {
        segments: [],
        text: "Chop the onion.",
        transcription_info: { duration: 1 },
      },
      {
        segments: [],
        text: "Chop the onion.",
        transcription_info: {
          duration: 1,
          providerPrivateInfoCanary: { revision: 7 },
        },
      },
      /providerPrivateInfoCanary|revision/u,
    ],
    [
      "segment",
      {
        segments: [{ id: 0 }],
        text: "Chop the onion.",
      },
      {
        segments: [
          {
            id: 0,
            providerPrivateSegmentCanary: { revision: 7 },
          },
        ],
        text: "Chop the onion.",
      },
      /providerPrivateSegmentCanary|revision/u,
    ],
    [
      "model-specific word",
      {
        segments: [{ words: [{ word: "Chop" }] }],
        text: "Chop the onion.",
      },
      {
        segments: [
          {
            words: [
              {
                providerPrivateWordCanary: { revision: 7 },
                word: "Chop",
              },
            ],
          },
        ],
        text: "Chop the onion.",
      },
      /providerPrivateWordCanary|revision/u,
    ],
  ] as const)(
    "discards bounded inert %s metadata without changing semantic output",
    async (_case, baselineResponse, metadataResponse, privatePattern) => {
      const baselineAdapter = await runFactory(
        makeInstalledSpeechTranscriber({
          client: makeSpeechGateway(baselineResponse).client,
          correlationId,
          dispatch: localDispatchGate,
        })
      );
      const trace = makeRecordingTraceStore();
      const metadataAdapter = await runFactory(
        makeInstalledSpeechTranscriber({
          client: makeSpeechGateway(metadataResponse).client,
          correlationId,
          dispatch: localDispatchGate,
        }),
        trace.service
      );

      const [baselineTranscript, metadataTranscript] = await Promise.all([
        Effect.runPromise(baselineAdapter.transcribe(speechTranscriptionInput)),
        Effect.runPromise(metadataAdapter.transcribe(speechTranscriptionInput)),
      ]);

      expect(metadataTranscript).toEqual(baselineTranscript);
      expect(trace.events.at(-1)).toEqual({
        correlationId,
        event: "provider.decode",
        outcome: "succeeded",
        providerStage: "speech",
      });
      expect(JSON.stringify(trace.events)).not.toMatch(privatePattern);
    }
  );

  it("normalizes null only at allowlisted optional installed-runtime metadata positions", async () => {
    const compatibleResponses = [
      {
        segments: null,
        text: "Chop the onion.",
        transcription_info: null,
        vtt: null,
        word_count: null,
      },
      {
        segments: [
          {
            avg_logprob: null,
            compression_ratio: null,
            end: null,
            no_speech_prob: null,
            start: null,
            temperature: null,
            text: null,
            words: null,
          },
        ],
        text: "Chop the onion.",
        transcription_info: {
          duration: null,
          duration_after_vad: null,
          language: null,
          language_probability: null,
        },
        vtt: null,
        word_count: null,
      },
      {
        segments: [
          {
            words: [
              {
                end: null,
                start: null,
                word: null,
              },
            ],
          },
        ],
        text: "Chop the onion.",
      },
    ];

    await Promise.all(
      compatibleResponses.map(async (response) => {
        const adapter = await runFactory(
          makeInstalledSpeechTranscriber({
            client: makeSpeechGateway(response).client,
            correlationId,
            dispatch: localDispatchGate,
          })
        );

        const transcript = await Effect.runPromise(
          adapter.transcribe(speechTranscriptionInput)
        );

        expect(transcript.text).toBe("Chop the onion.");
      })
    );
  });

  it("normalizes harmless whitespace from the pinned installed speech text contract", async () => {
    const trace = makeRecordingTraceStore();
    const adapter = await runFactory(
      makeInstalledSpeechTranscriber({
        client: makeSpeechGateway({
          segments: [],
          text: " \nChop the onion.\t ",
          transcription_info: {
            duration: 1,
            language: "en",
          },
          word_count: 3,
        }).client,
        correlationId,
        dispatch: localDispatchGate,
      }),
      trace.service
    );

    const transcript = await Effect.runPromise(
      adapter.transcribe(speechTranscriptionInput)
    );

    expect(transcript.text).toBe("Chop the onion.");
    expect(transcript.segments).toEqual([
      {
        endMilliseconds: 1000,
        startMilliseconds: 0,
        text: "Chop the onion.",
      },
    ]);
    expect(trace.events.at(-1)).toEqual({
      correlationId,
      event: "provider.decode",
      outcome: "succeeded",
      providerStage: "speech",
    });
  });

  it.each([
    ["non-object envelope", "invalid", "unclassified", "not_object", undefined],
    [
      "missing required text",
      { segments: [] },
      "model_specific",
      "required_text_missing",
      undefined,
    ],
    [
      "wrong required text type",
      { segments: [], text: 3 },
      "model_specific",
      "required_text_type",
      undefined,
    ],
    [
      "wrong root metadata type",
      { text: "Chop the onion.", word_count: "3" },
      "generic",
      "root_metadata_type",
      undefined,
    ],
    [
      "wrong nested container type",
      { segments: {}, text: "Chop the onion." },
      "model_specific",
      "nested_container_type",
      undefined,
    ],
    [
      "wrong nested entry type",
      { segments: [null], text: "Chop the onion." },
      "model_specific",
      "nested_entry_type",
      undefined,
    ],
    [
      "wrong nested metadata type",
      {
        text: "Chop the onion.",
        transcription_info: { duration: "1" },
      },
      "model_specific",
      "nested_metadata_type",
      undefined,
    ],
    [
      "wrong model segment id type",
      { segments: [{ id: "0" }], text: "Chop the onion." },
      "model_specific",
      "nested_metadata_type",
      undefined,
    ],
    [
      "wrong model segment seek type",
      { segments: [{ seek: "0" }], text: "Chop the onion." },
      "model_specific",
      "nested_metadata_type",
      undefined,
    ],
    [
      "wrong model segment tokens container",
      { segments: [{ tokens: {} }], text: "Chop the onion." },
      "model_specific",
      "nested_container_type",
      undefined,
    ],
    [
      "wrong model segment token type",
      { segments: [{ tokens: [1, "2"] }], text: "Chop the onion." },
      "model_specific",
      "nested_metadata_type",
      undefined,
    ],
    [
      "null model segment id",
      { segments: [{ id: null }], text: "Chop the onion." },
      "model_specific",
      "semantic_constraint",
      undefined,
    ],
    [
      "out-of-range model segment id",
      {
        segments: [{ id: Number.MAX_SAFE_INTEGER + 1 }],
        text: "Chop the onion.",
      },
      "model_specific",
      "semantic_constraint",
      undefined,
    ],
    [
      "non-finite model segment seek",
      {
        segments: [{ seek: Number.POSITIVE_INFINITY }],
        text: "Chop the onion.",
      },
      "model_specific",
      "semantic_constraint",
      undefined,
    ],
    [
      "oversized model segment tokens",
      {
        segments: [{ tokens: Array.from({ length: 4097 }, () => 1) }],
        text: "Chop the onion.",
      },
      "model_specific",
      "semantic_constraint",
      undefined,
    ],
    [
      "out-of-range model segment token",
      {
        segments: [{ tokens: [Number.MAX_SAFE_INTEGER + 1] }],
        text: "Chop the onion.",
      },
      "model_specific",
      "semantic_constraint",
      undefined,
    ],
    [
      "standard segment metadata on a generic word",
      { text: "Chop the onion.", words: [{ id: 0 }] },
      "generic",
      "unsupported_property",
      "word",
    ],
    [
      "semantic constraint",
      { text: "Chop the onion.", word_count: -1 },
      "generic",
      "semantic_constraint",
      undefined,
    ],
    [
      "normalized text",
      { text: " \n\t " },
      "generic",
      "normalized_text_invalid",
      undefined,
    ],
    [
      "ambiguous mixed family",
      { segments: [], text: "Chop the onion.", words: [] },
      "unclassified",
      "unsupported_property",
      "root",
    ],
  ] as const)(
    "emits only bounded speech shape diagnostics for %s",
    async (
      testCase,
      response,
      speechEnvelopeFamily,
      speechEnvelopeFailure,
      speechEnvelopeUnsupportedLocation
    ) => {
      const speechEnvelopeUnsupportedRootProperty =
        testCase === "ambiguous mixed family" ? ("words" as const) : undefined;
      const trace = makeRecordingTraceStore();
      const adapter = await runFactory(
        makeInstalledSpeechTranscriber({
          client: makeSpeechGateway(response).client,
          correlationId,
          dispatch: localDispatchGate,
        }),
        trace.service
      );

      const exit = await Effect.runPromiseExit(
        adapter.transcribe(speechTranscriptionInput)
      );

      expect(exit._tag).toBe("Failure");
      expect(JSON.stringify(exit)).toContain("SpeechTranscriptionFailure");
      expect(JSON.stringify(exit)).toContain("malformed_response");
      expect(trace.events.at(-1)).toEqual({
        correlationId,
        decodeReason:
          speechEnvelopeFailure === "normalized_text_invalid"
            ? "speech_transcript_normalization_invalid"
            : "speech_envelope_schema_invalid",
        decodeStage:
          speechEnvelopeFailure === "normalized_text_invalid"
            ? "speech_transcript"
            : "speech_envelope",
        event: "provider.decode",
        outcome: "malformed",
        providerStage: "speech",
        speechEnvelopeFailure,
        speechEnvelopeFamily,
        ...(speechEnvelopeUnsupportedLocation === undefined
          ? {}
          : { speechEnvelopeUnsupportedLocation }),
        ...(speechEnvelopeUnsupportedRootProperty === undefined
          ? {}
          : { speechEnvelopeUnsupportedRootProperty }),
      });
      expect(JSON.stringify(exit)).not.toContain("private-shape-canary");
      expect(JSON.stringify(trace.events)).not.toContain(
        "private-shape-canary"
      );
      expect(Object.keys(trace.events.at(-1) ?? {}).toSorted()).toEqual([
        "correlationId",
        "decodeReason",
        "decodeStage",
        "event",
        "outcome",
        "providerStage",
        "speechEnvelopeFailure",
        "speechEnvelopeFamily",
        ...(speechEnvelopeUnsupportedLocation === undefined
          ? []
          : ["speechEnvelopeUnsupportedLocation"]),
        ...(speechEnvelopeUnsupportedRootProperty === undefined
          ? []
          : ["speechEnvelopeUnsupportedRootProperty"]),
      ]);
    }
  );

  it.each([
    [
      "transcription info",
      {
        segments: [],
        text: "Chop the onion.",
        transcription_info: {
          duration: 1,
          privateInfoCanary: {
            nested: {
              text: "info-private-value",
            },
          },
        },
      },
      "model_specific",
      "transcription_info",
      undefined,
      "info-private-value",
    ],
    [
      "segment",
      {
        segments: [
          {
            id: 0,
            privateSegmentCanary: {
              text: "segment-private-value",
            },
          },
        ],
        text: "Chop the onion.",
      },
      "model_specific",
      "segment",
      undefined,
      "segment-private-value",
    ],
    [
      "model-specific word",
      {
        segments: [
          {
            words: [
              {
                privateWordCanary: {
                  nested: {
                    text: "word-private-value",
                  },
                },
                probability: 1,
                word: "Chop",
              },
            ],
          },
        ],
        text: "Chop the onion.",
      },
      "model_specific",
      "word",
      undefined,
      "word-private-value",
    ],
    [
      "generic word",
      {
        text: "Chop the onion.",
        words: [
          {
            privateGenericWordCanary: "generic-word-private-value",
            word: "Chop",
          },
        ],
      },
      "generic",
      "word",
      undefined,
      "generic-word-private-value",
    ],
  ] as const)(
    "locates transcript-bearing unknown metadata at %s without exposing its name or value",
    async (
      _case,
      response,
      speechEnvelopeFamily,
      speechEnvelopeUnsupportedLocation,
      speechEnvelopeUnsupportedRootProperty,
      privateValue
    ) => {
      const trace = makeRecordingTraceStore();
      const adapter = await runFactory(
        makeInstalledSpeechTranscriber({
          client: makeSpeechGateway(response).client,
          correlationId,
          dispatch: localDispatchGate,
        }),
        trace.service
      );

      const exit = await Effect.runPromiseExit(
        adapter.transcribe(speechTranscriptionInput)
      );

      expect(exit._tag).toBe("Failure");
      expect(trace.events.at(-1)).toEqual({
        correlationId,
        decodeReason: "speech_envelope_schema_invalid",
        decodeStage: "speech_envelope",
        event: "provider.decode",
        outcome: "malformed",
        providerStage: "speech",
        speechEnvelopeFailure: "unsupported_property",
        speechEnvelopeFamily,
        speechEnvelopeUnsupportedLocation,
        ...(speechEnvelopeUnsupportedRootProperty === undefined
          ? {}
          : { speechEnvelopeUnsupportedRootProperty }),
      });
      expect(Object.keys(trace.events.at(-1) ?? {}).toSorted()).toEqual([
        "correlationId",
        "decodeReason",
        "decodeStage",
        "event",
        "outcome",
        "providerStage",
        "speechEnvelopeFailure",
        "speechEnvelopeFamily",
        "speechEnvelopeUnsupportedLocation",
        ...(speechEnvelopeUnsupportedRootProperty === undefined
          ? []
          : ["speechEnvelopeUnsupportedRootProperty"]),
      ]);
      expect(JSON.stringify(exit)).not.toContain(privateValue);
      expect(JSON.stringify(trace.events)).not.toContain(privateValue);
      expect(JSON.stringify(trace.events)).not.toMatch(
        /private(?:Root|Info|Segment|Word|GenericWord)Canary/u
      );
    }
  );

  it.each([
    [
      "discarded root metadata does not mask a nested failure",
      {
        privateRootCanary: "root-private-value",
        segments: [
          {
            privateSegmentCanary: {
              text: "segment-private-value",
            },
            words: [
              {
                privateWordCanary: {
                  text: "word-private-value",
                },
                word: "Chop",
              },
            ],
          },
        ],
        text: "Chop the onion.",
        transcription_info: {
          privateInfoCanary: {
            text: "info-private-value",
          },
        },
      },
      "transcription_info",
    ],
    [
      "transcription info before segment and word",
      {
        segments: [
          {
            privateSegmentCanary: {
              text: "segment-private-value",
            },
            words: [
              {
                privateWordCanary: {
                  text: "word-private-value",
                },
                word: "Chop",
              },
            ],
          },
        ],
        text: "Chop the onion.",
        transcription_info: {
          privateInfoCanary: {
            text: "info-private-value",
          },
        },
      },
      "transcription_info",
    ],
    [
      "segment before word",
      {
        segments: [
          {
            privateSegmentCanary: {
              text: "segment-private-value",
            },
            words: [
              {
                privateWordCanary: {
                  text: "word-private-value",
                },
                word: "Chop",
              },
            ],
          },
        ],
        text: "Chop the onion.",
      },
      "segment",
    ],
    [
      "segment in a later item before word in an earlier item",
      {
        segments: [
          {
            words: [
              {
                privateWordCanary: {
                  text: "word-private-value",
                },
                word: "Chop",
              },
            ],
          },
          {
            privateSegmentCanary: {
              text: "segment-private-value",
            },
          },
        ],
        text: "Chop the onion.",
      },
      "segment",
    ],
    [
      "word when it is the only unsupported location",
      {
        segments: [
          {
            words: [
              {
                privateWordCanary: {
                  text: "word-private-value",
                },
                word: "Chop",
              },
            ],
          },
        ],
        text: "Chop the onion.",
      },
      "word",
    ],
  ] as const)(
    "uses deterministic unsupported-property precedence: %s",
    async (_case, response, speechEnvelopeUnsupportedLocation) => {
      const trace = makeRecordingTraceStore();
      const adapter = await runFactory(
        makeInstalledSpeechTranscriber({
          client: makeSpeechGateway(response).client,
          correlationId,
          dispatch: localDispatchGate,
        }),
        trace.service
      );

      await Effect.runPromiseExit(adapter.transcribe(speechTranscriptionInput));

      expect(trace.events.at(-1)?.speechEnvelopeUnsupportedLocation).toBe(
        speechEnvelopeUnsupportedLocation
      );
      expect(JSON.stringify(trace.events)).not.toMatch(
        /private(?:Root|Info|Segment|Word)Canary|private-value/u
      );
    }
  );

  it.each([
    [
      "result wrapper",
      {
        result: {
          accepted: "wrapper-value-canary",
        },
        segments: [],
        text: "Chop the onion.",
      },
    ],
    [
      "success wrapper",
      {
        segments: [],
        success: true,
        text: "Chop the onion.",
      },
    ],
    [
      "errors wrapper",
      {
        errors: ["wrapper-value-canary"],
        segments: [],
        text: "Chop the onion.",
      },
    ],
    [
      "messages wrapper",
      {
        messages: ["wrapper-value-canary"],
        segments: [],
        text: "Chop the onion.",
      },
    ],
    [
      "unknown transcript-bearing object",
      {
        segments: [],
        syntheticTranscriptContainer: {
          text: "nested-transcript-canary",
        },
        text: "Chop the onion.",
      },
    ],
    [
      "deep unknown transcript-bearing object",
      {
        segments: [],
        syntheticTranscriptContainer: nestUnknownMetadata(
          {
            text: "nested-transcript-canary",
          },
          24
        ),
        text: "Chop the onion.",
      },
    ],
    [
      "unknown transcript-bearing array",
      {
        segments: [],
        syntheticTranscriptContainer: [
          {
            text: "nested-transcript-canary",
          },
        ],
        text: "Chop the onion.",
      },
    ],
    [
      "deep unknown transcript-bearing array/container",
      {
        segments: [],
        syntheticTranscriptContainer: [
          {
            nested: [
              {
                nested: {
                  text: "nested-transcript-canary",
                },
              },
            ],
          },
        ],
        text: "Chop the onion.",
      },
    ],
  ] as const)(
    "rejects an ambiguous %s without exposing its name or value",
    async (_case, response) => {
      const trace = makeRecordingTraceStore();
      const adapter = await runFactory(
        makeInstalledSpeechTranscriber({
          client: makeSpeechGateway(response).client,
          correlationId,
          dispatch: localDispatchGate,
        }),
        trace.service
      );

      const exit = await Effect.runPromiseExit(
        adapter.transcribe(speechTranscriptionInput)
      );

      expect(exit._tag).toBe("Failure");
      expect(trace.events.at(-1)).toEqual({
        correlationId,
        decodeReason: "speech_envelope_schema_invalid",
        decodeStage: "speech_envelope",
        event: "provider.decode",
        outcome: "malformed",
        providerStage: "speech",
        speechEnvelopeFailure: "unsupported_property",
        speechEnvelopeFamily: "model_specific",
        speechEnvelopeUnsupportedLocation: "root",
        speechEnvelopeUnsupportedRootProperty: "other",
      });
      expect(JSON.stringify(exit)).not.toMatch(
        /nested-transcript-canary|wrapper-value-canary/u
      );
      expect(JSON.stringify(trace.events)).not.toMatch(
        /nested-transcript-canary|syntheticTranscriptContainer|wrapper-value-canary/u
      );
    }
  );

  it.each([
    [
      "excessively deep inert unknown metadata",
      nestUnknownMetadata("inert-depth-canary", 70),
      "inert-depth-canary",
    ],
    [
      "excessively large inert unknown metadata",
      Array.from({ length: 20_000 }, () => "inert-size-canary"),
      "inert-size-canary",
    ],
  ] as const)(
    "fails closed for %s without exposing its name or value",
    async (_case, syntheticTraversalContainer, privateValue) => {
      const trace = makeRecordingTraceStore();
      const adapter = await runFactory(
        makeInstalledSpeechTranscriber({
          client: makeSpeechGateway({
            segments: [],
            syntheticTraversalContainer,
            text: "Chop the onion.",
          }).client,
          correlationId,
          dispatch: localDispatchGate,
        }),
        trace.service
      );

      const exit = await Effect.runPromiseExit(
        adapter.transcribe(speechTranscriptionInput)
      );

      expect(exit._tag).toBe("Failure");
      expect(trace.events.at(-1)).toEqual({
        correlationId,
        decodeReason: "speech_envelope_schema_invalid",
        decodeStage: "speech_envelope",
        event: "provider.decode",
        outcome: "malformed",
        providerStage: "speech",
        speechEnvelopeFailure: "unsupported_property",
        speechEnvelopeFamily: "model_specific",
        speechEnvelopeUnsupportedLocation: "root",
        speechEnvelopeUnsupportedRootProperty: "other",
      });
      expect(JSON.stringify(exit)).not.toContain(privateValue);
      expect(JSON.stringify(trace.events)).not.toMatch(
        /inert-(?:depth|size)-canary|syntheticTraversalContainer/u
      );
    }
  );

  it.each([
    [
      "transcription-info depth",
      {
        segments: [],
        text: "Chop the onion.",
        transcription_info: {
          privateInfoCanary: nestUnknownMetadata(
            "nested-depth-private-value",
            70
          ),
        },
      },
      "transcription_info",
      /nested-depth-private-value|privateInfoCanary/u,
    ],
    [
      "segment node count",
      {
        segments: [
          {
            privateSegmentCanary: Array.from(
              { length: 20_000 },
              () => "nested-size-private-value"
            ),
          },
        ],
        text: "Chop the onion.",
      },
      "segment",
      /nested-size-private-value|privateSegmentCanary/u,
    ],
    [
      "word depth",
      {
        segments: [
          {
            words: [
              {
                privateWordCanary: nestUnknownMetadata(
                  "nested-word-depth-private-value",
                  70
                ),
                word: "Chop",
              },
            ],
          },
        ],
        text: "Chop the onion.",
      },
      "word",
      /nested-word-depth-private-value|privateWordCanary/u,
    ],
  ] as const)(
    "fails closed when unknown nested metadata exceeds the bounded %s traversal",
    async (
      _case,
      response,
      speechEnvelopeUnsupportedLocation,
      privatePattern
    ) => {
      const trace = makeRecordingTraceStore();
      const adapter = await runFactory(
        makeInstalledSpeechTranscriber({
          client: makeSpeechGateway(response).client,
          correlationId,
          dispatch: localDispatchGate,
        }),
        trace.service
      );

      const exit = await Effect.runPromiseExit(
        adapter.transcribe(speechTranscriptionInput)
      );

      expect(exit._tag).toBe("Failure");
      expect(trace.events.at(-1)).toEqual({
        correlationId,
        decodeReason: "speech_envelope_schema_invalid",
        decodeStage: "speech_envelope",
        event: "provider.decode",
        outcome: "malformed",
        providerStage: "speech",
        speechEnvelopeFailure: "unsupported_property",
        speechEnvelopeFamily: "model_specific",
        speechEnvelopeUnsupportedLocation,
      });
      expect(JSON.stringify({ exit, trace: trace.events })).not.toMatch(
        privatePattern
      );
    }
  );

  it("shares the existing node budget across root and nested unknown metadata", async () => {
    const trace = makeRecordingTraceStore();
    const adapter = await runFactory(
      makeInstalledSpeechTranscriber({
        client: makeSpeechGateway({
          privateRootCanary: Array.from({ length: 6000 }, () => 1),
          segments: [
            {
              privateSegmentCanary: Array.from({ length: 6000 }, () => 3),
            },
          ],
          text: "Chop the onion.",
          transcription_info: {
            privateInfoCanary: Array.from({ length: 6000 }, () => 2),
          },
        }).client,
        correlationId,
        dispatch: localDispatchGate,
      }),
      trace.service
    );

    const exit = await Effect.runPromiseExit(
      adapter.transcribe(speechTranscriptionInput)
    );

    expect(exit._tag).toBe("Failure");
    expect(trace.events.at(-1)).toMatchObject({
      speechEnvelopeFailure: "unsupported_property",
      speechEnvelopeUnsupportedLocation: "segment",
    });
    expect(JSON.stringify({ exit, trace: trace.events })).not.toMatch(
      /private(?:Root|Info|Segment)Canary/u
    );
  });

  it.each(["transcription_info", "segment", "word"] as const)(
    "fails closed for cyclic unknown %s metadata",
    async (speechEnvelopeUnsupportedLocation) => {
      const cycle: Record<string, unknown> = {};
      cycle["nested"] = cycle;
      let response: unknown;
      if (speechEnvelopeUnsupportedLocation === "transcription_info") {
        response = {
          segments: [],
          text: "Chop the onion.",
          transcription_info: {
            privateCycleCanary: cycle,
          },
        };
      } else if (speechEnvelopeUnsupportedLocation === "segment") {
        response = {
          segments: [
            {
              privateCycleCanary: cycle,
            },
          ],
          text: "Chop the onion.",
        };
      } else {
        response = {
          segments: [
            {
              words: [
                {
                  privateCycleCanary: cycle,
                  word: "Chop",
                },
              ],
            },
          ],
          text: "Chop the onion.",
        };
      }
      const trace = makeRecordingTraceStore();
      const adapter = await runFactory(
        makeInstalledSpeechTranscriber({
          client: makeSpeechGatewayFromValue(response).client,
          correlationId,
          dispatch: localDispatchGate,
        }),
        trace.service
      );

      const exit = await Effect.runPromiseExit(
        adapter.transcribe(speechTranscriptionInput)
      );

      expect(exit._tag).toBe("Failure");
      expect(trace.events.at(-1)).toEqual({
        correlationId,
        decodeReason: "speech_envelope_schema_invalid",
        decodeStage: "speech_envelope",
        event: "provider.decode",
        outcome: "malformed",
        providerStage: "speech",
        speechEnvelopeFailure: "unsupported_property",
        speechEnvelopeFamily: "model_specific",
        speechEnvelopeUnsupportedLocation,
      });
      expect(JSON.stringify({ exit, trace: trace.events })).not.toMatch(
        /privateCycleCanary/u
      );
    }
  );

  it.each([
    [
      "transcription-info field",
      {
        segments: [],
        text: "Chop the onion.",
        transcription_info: {
          duration: -1,
          privateInfoCanary: "safe-private-value",
        },
      },
      "semantic_constraint",
    ],
    [
      "segment field",
      {
        segments: [
          {
            id: "0",
            privateSegmentCanary: "safe-private-value",
          },
        ],
        text: "Chop the onion.",
      },
      "nested_metadata_type",
    ],
    [
      "word field",
      {
        segments: [
          {
            words: [
              {
                privateWordCanary: "safe-private-value",
                start: "0",
              },
            ],
          },
        ],
        text: "Chop the onion.",
      },
      "nested_metadata_type",
    ],
  ] as const)(
    "preserves strict validation of a malformed known %s beside inert unknown metadata",
    async (_case, response, speechEnvelopeFailure) => {
      const trace = makeRecordingTraceStore();
      const adapter = await runFactory(
        makeInstalledSpeechTranscriber({
          client: makeSpeechGateway(response).client,
          correlationId,
          dispatch: localDispatchGate,
        }),
        trace.service
      );

      const exit = await Effect.runPromiseExit(
        adapter.transcribe(speechTranscriptionInput)
      );

      expect(exit._tag).toBe("Failure");
      expect(trace.events.at(-1)).toMatchObject({
        speechEnvelopeFailure,
        speechEnvelopeFamily: "model_specific",
      });
      expect(trace.events.at(-1)).not.toHaveProperty(
        "speechEnvelopeUnsupportedLocation"
      );
      expect(JSON.stringify({ exit, trace: trace.events })).not.toMatch(
        /private(?:Info|Segment|Word)Canary|safe-private-value/u
      );
    }
  );

  it("omits the root-property classification for a nested unsupported property", async () => {
    const trace = makeRecordingTraceStore();
    const adapter = await runFactory(
      makeInstalledSpeechTranscriber({
        client: makeSpeechGateway({
          segments: [
            {
              id: 0,
              privateSegmentCanary: {
                text: "segment-private-value",
              },
              seek: 0,
              tokens: [50_365],
            },
          ],
          text: "Chop the onion.",
        }).client,
        correlationId,
        dispatch: localDispatchGate,
      }),
      trace.service
    );

    const exit = await Effect.runPromiseExit(
      adapter.transcribe(speechTranscriptionInput)
    );

    expect(trace.events.at(-1)).toMatchObject({
      speechEnvelopeFailure: "unsupported_property",
      speechEnvelopeUnsupportedLocation: "segment",
    });
    expect(trace.events.at(-1)).not.toHaveProperty(
      "speechEnvelopeUnsupportedRootProperty"
    );
    expect(JSON.stringify({ exit, trace: trace.events })).not.toMatch(
      /segment-private-value|50365/u
    );
  });

  it("omits unsupported-property location for a non-unsupported failure", async () => {
    const trace = makeRecordingTraceStore();
    const adapter = await runFactory(
      makeInstalledSpeechTranscriber({
        client: makeSpeechGateway({
          segments: [],
          text: 3,
        }).client,
        correlationId,
        dispatch: localDispatchGate,
      }),
      trace.service
    );

    await Effect.runPromiseExit(adapter.transcribe(speechTranscriptionInput));

    expect(trace.events.at(-1)).toMatchObject({
      speechEnvelopeFailure: "required_text_type",
    });
    expect(trace.events.at(-1)).not.toHaveProperty(
      "speechEnvelopeUnsupportedLocation"
    );
  });

  it("fails closed for missing, wrong, ambiguous, or unsafe speech response fields", async () => {
    const malformedResponses = [
      {
        transcription_info: {
          duration: 1,
          language: "en",
        },
      },
      {
        text: 3,
        transcription_info: {
          duration: 1,
          language: "en",
        },
      },
      {
        segments: [],
        text: null,
      },
      {
        text: "Root transcript.",
        transcription_info: {
          text: "Nested transcript.",
        },
      },
      {
        text: "Same transcript.",
        transcription_info: {
          text: "Same transcript.",
        },
      },
      {
        result: {
          text: "Chop the onion.",
        },
      },
      {
        result: {
          text: "Nested transcript.",
        },
        text: "Root transcript.",
      },
      {
        segments: [],
        text: "Chop the onion.",
        words: [],
      },
      {
        text: "Chop the onion.",
        transcription_info: {
          language_probability: 1.01,
        },
      },
      {
        text: "Chop the onion.",
        transcription_info: {
          duration: -1,
        },
      },
      {
        text: "Chop the onion.",
        transcription_info: {
          language: " ",
        },
      },
      {
        segments: [
          {
            no_speech_prob: -0.01,
          },
        ],
        text: "Chop the onion.",
      },
      {
        segments: [null],
        text: "Chop the onion.",
      },
      {
        text: "a".repeat(1_048_577),
      },
    ];

    await Promise.all(
      malformedResponses.map(async (response) => {
        const trace = makeRecordingTraceStore();
        const adapter = await runFactory(
          makeInstalledSpeechTranscriber({
            client: makeSpeechGateway(response).client,
            correlationId,
            dispatch: localDispatchGate,
          }),
          trace.service
        );

        const exit = await Effect.runPromiseExit(
          adapter.transcribe(speechTranscriptionInput)
        );

        expect(exit._tag).toBe("Failure");
        expect(JSON.stringify(exit)).toContain("malformed_response");
        expect(trace.events.at(-1)).toMatchObject({
          correlationId,
          decodeReason: "speech_envelope_schema_invalid",
          decodeStage: "speech_envelope",
          event: "provider.decode",
          outcome: "malformed",
          providerStage: "speech",
        });
        expect([
          "generic",
          "model_specific",
          "unclassified",
        ] as const).toContain(trace.events.at(-1)?.speechEnvelopeFamily);
        expect([
          "nested_container_type",
          "nested_entry_type",
          "nested_metadata_type",
          "required_text_missing",
          "required_text_type",
          "root_metadata_type",
          "semantic_constraint",
          "unsupported_property",
        ] as const).toContain(trace.events.at(-1)?.speechEnvelopeFailure);
        const diagnosticEvent = trace.events.at(-1);
        const hasUnsupportedLocation =
          diagnosticEvent?.speechEnvelopeFailure === "unsupported_property";
        expect(diagnosticEvent?.speechEnvelopeUnsupportedLocation).toSatisfy(
          (location) =>
            hasUnsupportedLocation
              ? ["root", "segment", "transcription_info", "word"].includes(
                  location ?? ""
                )
              : location === undefined
        );
        const hasUnsupportedRootProperty =
          diagnosticEvent?.speechEnvelopeUnsupportedRootProperty !== undefined;
        expect(
          diagnosticEvent?.speechEnvelopeUnsupportedRootProperty
        ).toSatisfy((property) =>
          hasUnsupportedRootProperty
            ? [
                "duration",
                "duration_after_vad",
                "language",
                "language_probability",
                "multiple",
                "other",
                "task",
                "words",
              ].includes(property ?? "")
            : property === undefined
        );
        expect(Object.keys(diagnosticEvent ?? {}).toSorted()).toEqual([
          "correlationId",
          "decodeReason",
          "decodeStage",
          "event",
          "outcome",
          "providerStage",
          "speechEnvelopeFailure",
          "speechEnvelopeFamily",
          ...(hasUnsupportedLocation
            ? ["speechEnvelopeUnsupportedLocation"]
            : []),
          ...(hasUnsupportedRootProperty
            ? ["speechEnvelopeUnsupportedRootProperty"]
            : []),
        ]);
        expect(JSON.stringify(exit)).not.toContain("must-not-escape");
        expect(JSON.stringify(trace.events)).not.toContain("must-not-escape");
      })
    );
  });

  it("fails closed with metadata-only transcript normalization diagnostics", async () => {
    const trace = makeRecordingTraceStore();
    const adapter = await runFactory(
      makeInstalledSpeechTranscriber({
        client: makeSpeechGateway({
          segments: [],
          text: " \n\t ",
          transcription_info: {
            duration: 1,
            language: "en",
          },
        }).client,
        correlationId,
        dispatch: localDispatchGate,
      }),
      trace.service
    );

    const exit = await Effect.runPromiseExit(
      adapter.transcribe(speechTranscriptionInput)
    );

    expect(exit._tag).toBe("Failure");
    expect(JSON.stringify(exit)).toContain("malformed_response");
    expect(trace.events.at(-1)).toEqual({
      correlationId,
      decodeReason: "speech_transcript_normalization_invalid",
      decodeStage: "speech_transcript",
      event: "provider.decode",
      outcome: "malformed",
      providerStage: "speech",
      speechEnvelopeFailure: "normalized_text_invalid",
      speechEnvelopeFamily: "model_specific",
    });
    expect(Object.keys(trace.events.at(-1) ?? {}).toSorted()).toEqual([
      "correlationId",
      "decodeReason",
      "decodeStage",
      "event",
      "outcome",
      "providerStage",
      "speechEnvelopeFailure",
      "speechEnvelopeFamily",
    ]);
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
        decodeReason: "speech_envelope_schema_invalid",
        decodeStage: "speech_envelope",
        event: "provider.decode",
        outcome: "malformed",
        providerStage: "speech",
        speechEnvelopeFailure: "required_text_missing",
        speechEnvelopeFamily: "model_specific",
      },
    ]);
    expect(JSON.stringify(exit)).not.toContain("must-not-escape");
    expect(JSON.stringify(trace.events)).not.toContain("must-not-escape");
  });

  it("preserves retryable native speech failures as typed redacted failures", async () => {
    const adapter = await runFactory(
      makeInstalledSpeechTranscriber({
        client: makeRejectedGateway({
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

  it("maps a missing visual forced-tool call without payload data", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(vi.fn());
    const gateway = makeGateway({ providerSecret: "must-not-escape" });
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
    expect(JSON.stringify(exit)).toContain("insufficient_evidence");
    expect(JSON.stringify(exit)).not.toContain("must-not-escape");
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
          decodeReason: "forced_tool_missing",
          decodeStage: "forced_tool_envelope",
          event: "provider.decode",
          outcome: "malformed",
          providerStage: "visual",
        },
      ],
    ]);
    expect(JSON.stringify(log.mock.calls)).not.toContain("must-not-escape");
    log.mockRestore();
  });

  it.each(["request-shape rejection", "model-agreement requirement"])(
    "preserves an explicitly branded known-zero visual %s for guarded settlement",
    async () => {
      let reachedDispatchAsKnownZero = false;
      const dispatch: ProviderDispatchGate = {
        run: (input) =>
          input.invoke.pipe(
            // eslint-disable-next-line promise/prefer-await-to-callbacks -- Effect callbacks preserve the typed failure channel under test.
            Effect.tapError((error) =>
              Effect.sync(() => {
                reachedDispatchAsKnownZero =
                  isPilotProviderKnownZeroCostFailure(error);
              })
            ),
            Effect.map(({ value }) => value)
          ),
      };
      const trace = makeRecordingTraceStore();
      const adapter = await runFactory(
        makeInstalledVisualEvidenceExtractor({
          client: makeRejectedGateway(
            pilotProviderKnownZeroCostFailure("provider_unavailable" as const)
          ),
          correlationId,
          dispatch,
        }),
        trace.service
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
      expect(JSON.stringify(exit)).toContain("provider_unavailable");
      expect(reachedDispatchAsKnownZero).toBe(true);
      expect(trace.events).toEqual([]);
    }
  );

  it("does not infer known-zero visual settlement from unbranded provider status, code, or name fields", async () => {
    let reachedDispatchAsKnownZero = false;
    const dispatch: ProviderDispatchGate = {
      run: (input) =>
        input.invoke.pipe(
          // eslint-disable-next-line promise/prefer-await-to-callbacks -- Effect callbacks preserve the typed failure channel under test.
          Effect.tapError((error) =>
            Effect.sync(() => {
              reachedDispatchAsKnownZero =
                isPilotProviderKnownZeroCostFailure(error);
            })
          ),
          Effect.map(({ value }) => value)
        ),
    };
    const trace = makeRecordingTraceStore();
    const adapter = await runFactory(
      makeInstalledVisualEvidenceExtractor({
        client: makeRejectedGateway({
          _tag: "AiGatewayError",
          cause: {
            code: "model_agreement_required",
            name: "request_shape_rejected",
            providerSecret: "must-not-escape",
            status: 400,
          },
          message: "providerSecret=must-not-escape",
        }),
        correlationId,
        dispatch,
      }),
      trace.service
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
    expect(JSON.stringify(exit)).toContain("provider_unavailable");
    expect(JSON.stringify(exit)).not.toContain("must-not-escape");
    expect(reachedDispatchAsKnownZero).toBe(false);
    expect(trace.events).toEqual([]);
  });

  it("uses the current Workers AI image-message forced-tool contract and derives trusted visual metadata", async () => {
    const visualSemantics = {
      observations: [
        {
          confidence: 92,
          frameIndex: 0,
          kind: "visible_text",
          regions: [{ height: 0.25, width: 0.25, x: 0.25, y: 0.25 }],
          text: "2 onions",
          timestampMilliseconds: 999,
        },
      ],
      outcome: "empty",
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
        model: "@cf/meta/llama-4-scout-17b-16e-instruct",
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
          {
            bytes: new Uint8Array([6]),
            height: 1,
            mimeType: "image/jpeg",
            sha256: "d".repeat(64),
            timestampMilliseconds: 750,
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
        estimatedMicroUsd: 14,
      },
      model: "@cf/meta/llama-4-scout-17b-16e-instruct",
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
      usage: { inputBytes: 2, inputFrames: 1, modelCalls: 1 },
    });
    expect(gateway.requests).toHaveLength(1);
    const request = gateway.requests[0] as {
      readonly body: {
        readonly messages: readonly {
          readonly content: readonly [
            { readonly text: string; readonly type: "text" },
            {
              readonly image_url: { readonly url: string };
              readonly type: "image_url";
            },
          ];
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
        readonly returnRawResponse?: boolean;
      };
    };
    expect(request.model).toBe("@cf/meta/llama-4-scout-17b-16e-instruct");
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
    expect(request.body.tool_choice).toBe("required");
    expect(request.body.tools).toHaveLength(1);
    expect(request.body.tools[0]?.function.name).toBe("record_visual_evidence");
    expect(request.body).not.toHaveProperty("stream");
    expect(request.body).not.toHaveProperty("image");
    expect(request.body).not.toHaveProperty("response_format");
    expect(request.body.messages[0]?.content[0]?.text).toContain(
      "adapter owns the source frame identity and timing"
    );
    expect(request.body.messages[0]?.content[1]).toEqual({
      image_url: { url: "data:image/jpeg;base64,BAU=" },
      type: "image_url",
    });
    const jsonSchema = request.body.tools[0]?.function.parameters;
    expect(jsonSchema).toMatchObject({
      additionalProperties: false,
      properties: {
        observations: expect.any(Object),
      },
      required: ["observations"],
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
      "text",
    ]);
    expect(observationItems).toMatchObject({
      required: ["text"],
    });
    expect(
      Object.keys(
        (
          jsonSchema as {
            readonly properties: Record<string, unknown>;
          }
        ).properties
      )
    ).toEqual(["observations"]);
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
    expect(JSON.stringify(trace.events)).not.toContain("BAU=");
  });

  it("projects known inert visual metadata before strict semantic decoding", async () => {
    const gateway = makeGateway(
      toolResponse("record_visual_evidence", {
        observations: [
          {
            confidence: " 92 ",
            frameIndex: "provider-owned",
            kind: "provider-owned",
            regions: [{ providerOwned: true }],
            text: "  2 onions  ",
            timestampMilliseconds: null,
          },
        ],
        outcome: "provider-owned",
      })
    );
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
      observations: [
        {
          confidence: 0.92,
          frameIndex: 0,
          kind: "visible_text",
          regions: [{ height: 1, width: 1, x: 0, y: 0 }],
          text: "2 onions",
          timestampMilliseconds: 125,
        },
      ],
      outcome: "found",
    });
  });

  it("conservatively normalizes optional provider confidence variants", async () => {
    const gateway = makeGateway(
      toolResponse("record_visual_evidence", {
        observations: [
          {
            confidence: "92%",
            text: "  2 onions  ",
          },
          {
            text: "add stock",
          },
          {
            confidence: "high",
            text: "serve",
          },
        ],
      })
    );
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
      observations: [
        { confidence: 0.92, text: "2 onions" },
        { confidence: 0, text: "add stock" },
        { confidence: 0, text: "serve" },
      ],
      outcome: "found",
    });
  });

  it("keeps only safe visual facts when the provider adds malformed metadata", async () => {
    const gateway = makeGateway(
      toolResponse("record_visual_evidence", {
        observations: [
          {
            confidence: 87,
            providerPrivateNote: "must-not-escape",
            text: "  chop the onions  ",
          },
          {
            confidence: 140,
            text: "add stock",
          },
          {
            confidence: 95,
            text: null,
          },
        ],
        providerPrivateSummary: "must-not-escape",
      })
    );
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
      observations: [
        { confidence: 0.87, text: "chop the onions" },
        { confidence: 0, text: "add stock" },
      ],
      outcome: "found",
    });
    expect(JSON.stringify(output)).not.toContain("must-not-escape");
  });

  it.each([
    ["omits observations", { providerPrivateNote: "must-not-escape" }],
    [
      "returns non-array observations",
      {
        observations: { text: "must-not-escape" },
        providerPrivateNote: "must-not-escape",
      },
    ],
  ])(
    "projects empty visual evidence when the provider %s",
    async (_label, body) => {
      const gateway = makeGateway(toolResponse("record_visual_evidence", body));
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

      expect(output).toMatchObject({ observations: [], outcome: "empty" });
      expect(JSON.stringify(output)).not.toContain("must-not-escape");
    }
  );

  it("accepts the documented Workers AI forced-tool response envelope", async () => {
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
      model: "@cf/meta/llama-4-scout-17b-16e-instruct",
      observations: [],
      outcome: "empty",
    });
    expect(gateway.requests).toHaveLength(1);
    expect((gateway.requests[0] as { readonly model: string }).model).toBe(
      "@cf/meta/llama-4-scout-17b-16e-instruct"
    );
  });

  it("derives low-confidence outcome from strict provider observations", async () => {
    const gateway = makeGateway(
      toolResponse("record_visual_evidence", {
        observations: [
          {
            confidence: 0.5,
            frameIndex: 0,
            text: "possible ingredient label",
          },
        ],
      })
    );
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
      observations: [{ confidence: 0.5, text: "possible ingredient label" }],
      outcome: "low_confidence",
    });
  });

  it.each([
    [
      "aligned native and OpenAI authorities",
      {
        ...toolResponse("record_visual_evidence", validVisualSemantics),
        tool_calls: [
          {
            arguments: validVisualSemantics,
            name: "record_visual_evidence",
          },
        ],
      },
    ],
    [
      "an empty OpenAI authority beside one native call",
      {
        choices: [],
        tool_calls: [
          {
            arguments: validVisualSemantics,
            name: "record_visual_evidence",
          },
        ],
        usage: defaultVisualUsage,
      },
    ],
    [
      "one OpenAI message with no calls beside one native call",
      {
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              content: null,
              tool_calls: [],
            },
          },
        ],
        tool_calls: [
          {
            arguments: validVisualSemantics,
            name: "record_visual_evidence",
          },
        ],
        usage: defaultVisualUsage,
      },
    ],
    [
      "aligned flat and nested fields on one call",
      {
        tool_calls: [
          {
            arguments: validVisualSemantics,
            function: {
              arguments: JSON.stringify(validVisualSemantics),
              name: "record_visual_evidence",
            },
            name: "record_visual_evidence",
          },
        ],
        usage: defaultVisualUsage,
      },
    ],
    [
      "null non-authoritative tool metadata beside an exact native mirror",
      {
        choices: null,
        response: JSON.stringify({
          arguments: validVisualSemantics,
          name: "record_visual_evidence",
        }),
        tool_calls: null,
        usage: defaultVisualUsage,
      },
    ],
  ] as const)(
    "accepts the unambiguous Workers AI vision variant with %s",
    async (_label, response) => {
      const gateway = makeGateway(response);
      const trace = makeRecordingTraceStore();
      const adapter = await runFactory(
        makeInstalledVisualEvidenceExtractor({
          client: gateway.client,
          correlationId,
          dispatch: localDispatchGate,
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
          ],
          generation: 1 as never,
          importId: "import-1" as never,
          sourceMediaSha256: "b".repeat(64),
        })
      );

      expect(output).toMatchObject({
        observations: [],
        outcome: "empty",
      });
      expect(trace.events.at(-1)).toEqual({
        correlationId,
        event: "provider.decode",
        outcome: "succeeded",
        providerStage: "visual",
      });
    }
  );

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

  it("discards model attempts to inject visual transport metadata", async () => {
    const gateway = makeGateway(
      toolResponse("record_visual_evidence", {
        ...validVisual,
        providerPrivateCanary: "must-not-escape",
      })
    );
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
            timestampMilliseconds: 0,
            width: 1,
          },
        ],
        generation: 1 as never,
        importId: "import-1" as never,
        sourceMediaSha256: "b".repeat(64),
      })
    );

    expect(output).toMatchObject({ observations: [], outcome: "empty" });
    expect(JSON.stringify(output)).not.toContain("must-not-escape");
  });

  it("fails closed for prose instead of structured visual tool arguments", async () => {
    const response = toolResponse("record_visual_evidence", "{not-json");
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

  it("degrades an unparseable optional visual response to bounded empty evidence", async () => {
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
    const trace = makeRecordingTraceStore();
    const gateway = makeRawGateway(
      new Response("provider-private-canary", {
        headers: { "content-type": "application/json" },
      })
    );
    const adapter = await runFactory(
      makeInstalledVisualEvidenceExtractor({
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

    expect(output).toMatchObject({
      cost: {
        certainty: "estimated",
        currency: "USD",
        estimatedMicroUsd: 100_000,
      },
      observations: [],
      outcome: "empty",
      usage: { inputBytes: 3, inputFrames: 1, modelCalls: 1 },
    });
    expect(costs).toEqual([{ _tag: "Known", actualCostMicroUsd: 100_000 }]);
    expect(trace.events).toEqual([
      {
        correlationId,
        event: "provider.response",
        outcome: "received",
        providerStage: "visual",
      },
      {
        correlationId,
        decodeReason: "provider_normalization_invalid",
        decodeStage: "provider_normalization",
        event: "provider.decode",
        outcome: "malformed",
        providerStage: "visual",
      },
    ]);
    expect(JSON.stringify({ output, trace: trace.events })).not.toContain(
      "provider-private-canary"
    );
  });

  it.each([
    ["free-text substitution", { response: "provider-private-canary" }],
    [
      "a fenced JSON object",
      {
        response:
          '```json\n{"observations":[],"outcome":"empty","secret":"provider-private-canary"}\n```',
      },
    ],
    [
      "multiple JSON objects",
      {
        response:
          '{"observations":[],"outcome":"empty"}\n{"secret":"provider-private-canary"}',
      },
    ],
    [
      "an extra native tool call",
      {
        tool_calls: [
          {
            arguments: validVisualSemantics,
            name: "record_visual_evidence",
          },
          {
            arguments: validVisualSemantics,
            name: "record_visual_evidence",
          },
        ],
      },
    ],
    [
      "a conflicting native mirror",
      {
        response: JSON.stringify({
          arguments: {
            observations: [
              {
                confidence: 0.5,
                frameIndex: 0,
                text: "provider-private-canary",
              },
            ],
            outcome: "found",
          },
          name: "record_visual_evidence",
        }),
        tool_calls: [
          {
            arguments: validVisualSemantics,
            name: "record_visual_evidence",
          },
        ],
      },
    ],
    [
      "conflicting native and OpenAI authorities",
      {
        ...toolResponse("record_visual_evidence", validVisualSemantics),
        tool_calls: [
          {
            arguments: {
              observations: [
                {
                  confidence: 0.5,
                  frameIndex: 0,
                  text: "provider-private-canary",
                },
              ],
              outcome: "found",
            },
            name: "record_visual_evidence",
          },
        ],
      },
    ],
    [
      "conflicting flat and nested fields on one call",
      {
        tool_calls: [
          {
            arguments: validVisualSemantics,
            function: {
              arguments: JSON.stringify({
                observations: [
                  {
                    confidence: 0.5,
                    frameIndex: 0,
                    text: "provider-private-canary",
                  },
                ],
                outcome: "found",
              }),
              name: "record_visual_evidence",
            },
            name: "record_visual_evidence",
          },
        ],
      },
    ],
    [
      "an empty flat name beside a valid nested name",
      {
        tool_calls: [
          {
            function: {
              arguments: JSON.stringify(validVisualSemantics),
              name: "record_visual_evidence",
            },
            name: "",
          },
        ],
      },
    ],
    [
      "a null flat name beside a valid nested name",
      {
        tool_calls: [
          {
            function: {
              arguments: JSON.stringify(validVisualSemantics),
              name: "record_visual_evidence",
            },
            name: null,
          },
        ],
      },
    ],
    [
      "an extra OpenAI tool call",
      {
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  function: {
                    arguments: JSON.stringify(validVisualSemantics),
                    name: "record_visual_evidence",
                  },
                  type: "function",
                },
                {
                  function: {
                    arguments: JSON.stringify(validVisualSemantics),
                    name: "record_visual_evidence",
                  },
                  type: "function",
                },
              ],
            },
          },
        ],
      },
    ],
    [
      "a valid OpenAI tool call beside a malformed nameless call",
      {
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  function: {
                    arguments: JSON.stringify(validVisualSemantics),
                    name: "record_visual_evidence",
                  },
                  type: "function",
                },
                {
                  function: {
                    arguments: "{}",
                  },
                  type: "function",
                },
              ],
            },
          },
        ],
      },
    ],
    [
      "an extra authoritative OpenAI choice",
      {
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  function: {
                    arguments: JSON.stringify(validVisualSemantics),
                    name: "record_visual_evidence",
                  },
                  type: "function",
                },
              ],
            },
          },
          {
            message: {
              content: null,
              tool_calls: [
                {
                  function: {
                    arguments: JSON.stringify(validVisualSemantics),
                    name: "record_visual_evidence",
                  },
                  type: "function",
                },
              ],
            },
          },
        ],
      },
    ],
  ] as const)(
    "fails closed for visual %s without leaking provider data",
    async (_label, response) => {
      const gateway = makeGateway(response);
      const trace = makeRecordingTraceStore();
      const adapter = await runFactory(
        makeInstalledVisualEvidenceExtractor({
          client: gateway.client,
          correlationId,
          dispatch: localDispatchGate,
        }),
        trace.service
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
      expect(trace.events[0]).toEqual({
        correlationId,
        event: "provider.response",
        outcome: "received",
        providerStage: "visual",
      });
      expect(trace.events).toContainEqual(
        expect.objectContaining({
          correlationId,
          event: "provider.decode",
          outcome: "malformed",
          providerStage: "visual",
        })
      );
      expect(JSON.stringify(exit)).not.toContain("provider-private-canary");
      expect(JSON.stringify(trace.events)).not.toContain(
        "provider-private-canary"
      );
    }
  );

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
    "settles %s visual usage at the bounded safety maximum",
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
