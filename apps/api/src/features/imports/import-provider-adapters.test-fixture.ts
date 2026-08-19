import { RuntimeContext } from "alchemy";
import { Effect, Option, Schema, Stream } from "effect";
import { AiError, LanguageModel } from "effect/unstable/ai";
import type { Response as AiResponse } from "effect/unstable/ai";

import type { ImportObservabilityEvent } from "./import-observability.js";
import {
  emitImportObservabilityEvent,
  ImportCorrelationId,
  ImportObservabilityTraceStore,
} from "./import-observability.js";
import type {
  ProviderDispatchGate,
  WorkersAiTransport,
} from "./import-provider-kernel.js";
import {
  InstalledRecipeModel,
  InstalledSpeechModel,
  InstalledVisualModel,
  normalizeWorkersAiResponse,
} from "./import-provider-kernel.js";
import { makeInstalledRecipeExtractor } from "./import-provider-recipe.js";

const ProviderToolCall = Schema.Union([
  Schema.Struct({
    arguments: Schema.optionalKey(Schema.Json),
    id: Schema.optionalKey(Schema.String),
    name: Schema.String,
    type: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    function: Schema.Struct({
      arguments: Schema.optionalKey(Schema.Json),
      name: Schema.String,
    }),
    id: Schema.optionalKey(Schema.String),
    type: Schema.optionalKey(Schema.String),
  }),
]);
type ProviderToolCall = typeof ProviderToolCall.Type;

const VisualProviderResponse = Schema.Struct({
  choices: Schema.optionalKey(Schema.Json),
  finish_reason: Schema.optionalKey(Schema.Json),
  response: Schema.optionalKey(Schema.Json),
  tool_calls: Schema.optionalKey(Schema.Json),
  usage: Schema.optionalKey(Schema.Json),
});
type VisualProviderResponse = typeof VisualProviderResponse.Type;

export const correlationId = Schema.decodeUnknownSync(ImportCorrelationId)(
  "019b37f2-1a6e-7f3a-8a5a-7f0d8f6c2b1a"
);

const VisualReasoningPart = Schema.Struct({
  text: Schema.String,
  type: Schema.Literal("reasoning"),
});
const VisualTextPart = Schema.Struct({
  text: Schema.String,
  type: Schema.Literal("text"),
});
const JsonObject = Schema.Record(Schema.String, Schema.Json);

const ProviderFixtureResponseInvalid = "provider_fixture_response_invalid";
const ProviderNormalizationInvalid = "provider_normalization_invalid";
const ProviderNormalizationBodyInvalid = "provider_normalization_body_invalid";

type FixtureAiErrorDescription =
  | typeof ProviderFixtureResponseInvalid
  | typeof ProviderNormalizationBodyInvalid
  | typeof ProviderNormalizationInvalid;

const fixtureAiError = (
  description: FixtureAiErrorDescription = ProviderFixtureResponseInvalid
) =>
  AiError.make({
    method: "generateText",
    module: "MealPlannerProviderFixture",
    reason: new AiError.UnknownError({
      description,
    }),
  });

const safeFixtureErrorDescription = (
  error: Error
): FixtureAiErrorDescription => {
  switch (error.message) {
    case ProviderNormalizationBodyInvalid:
    case ProviderNormalizationInvalid: {
      return error.message;
    }
    default: {
      return ProviderFixtureResponseInvalid;
    }
  }
};

type NormalizedVisualResponseOutcome =
  | {
      readonly _tag: "Failure";
      readonly description: FixtureAiErrorDescription;
    }
  | { readonly _tag: "Success"; readonly value: Schema.Json };

const readNormalizedVisualResponse = async (
  nextResponse: () => Response
): Promise<NormalizedVisualResponseOutcome> => {
  try {
    return {
      _tag: "Success",
      value: await normalizeWorkersAiResponse(nextResponse()).json(),
    };
  } catch (error) {
    return {
      _tag: "Failure",
      description:
        error instanceof Error
          ? safeFixtureErrorDescription(error)
          : ProviderFixtureResponseInvalid,
    };
  }
};

const toolCallName = (call: ProviderToolCall) =>
  "function" in call ? call.function.name : call.name;

const toolCallArguments = (call: ProviderToolCall): Schema.Json => {
  const value = "function" in call ? call.function.arguments : call.arguments;
  if (!Schema.is(Schema.String)(value)) {
    return value ?? null;
  }
  try {
    return Schema.decodeUnknownSync(Schema.Json)(JSON.parse(value));
  } catch {
    return value;
  }
};

const jsonObject = (
  value: Schema.Json | undefined
): Schema.JsonObject | undefined => {
  const decoded = Schema.decodeUnknownOption(JsonObject)(value);
  return Option.isSome(decoded) ? decoded.value : undefined;
};

const decodedProviderToolCalls = (
  value: Schema.Json | undefined
): readonly ProviderToolCall[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((call) => {
    const decoded = Schema.decodeUnknownOption(ProviderToolCall)(call);
    return Option.isSome(decoded) ? [decoded.value] : [];
  });
};

const firstOpenAiChoice = (
  response: VisualProviderResponse
): Schema.JsonObject | undefined =>
  Array.isArray(response.choices) ? jsonObject(response.choices[0]) : undefined;

const openAiMessage = (
  response: VisualProviderResponse
): Schema.JsonObject | undefined =>
  jsonObject(firstOpenAiChoice(response)?.["message"]);

const providerToolCalls = (
  response: VisualProviderResponse
): readonly ProviderToolCall[] => {
  const openAiCalls = decodedProviderToolCalls(
    openAiMessage(response)?.["tool_calls"]
  );
  return openAiCalls.length > 0
    ? openAiCalls
    : decodedProviderToolCalls(response.tool_calls);
};

const providerText = (response: VisualProviderResponse): string | undefined => {
  const openAiContent = openAiMessage(response)?.["content"];
  if (Schema.is(Schema.String)(openAiContent) && openAiContent.length > 0) {
    return openAiContent;
  }
  if (response.response === undefined || response.response === null) {
    return undefined;
  }
  return Schema.is(
    Schema.Union([
      Schema.Array(Schema.Json),
      Schema.Record(Schema.String, Schema.Json),
    ])
  )(response.response)
    ? JSON.stringify(response.response)
    : String(response.response);
};

const providerReasoning = (
  response: VisualProviderResponse
): string | undefined => {
  const message = openAiMessage(response);
  const reasoning = message?.["reasoning_content"] ?? message?.["reasoning"];
  return Schema.is(Schema.String)(reasoning) && reasoning.length > 0
    ? reasoning
    : undefined;
};

const usageToken = (
  response: VisualProviderResponse,
  key: "completion_tokens" | "prompt_tokens"
): number | undefined => {
  const value = jsonObject(response.usage)?.[key];
  return Schema.is(Schema.Number)(value) ? value : undefined;
};

const providerResponseParts = (
  response: VisualProviderResponse
): AiResponse.PartEncoded[] => {
  const calls = providerToolCalls(response);
  const text = providerText(response);
  const reasoning = providerReasoning(response);
  return [
    ...(reasoning === undefined
      ? []
      : [
          Schema.decodeUnknownSync(VisualReasoningPart)({
            text: reasoning,
            type: "reasoning",
          }),
        ]),
    ...(text === undefined
      ? []
      : [
          Schema.decodeUnknownSync(VisualTextPart)({
            text,
            type: "text",
          }),
        ]),
    ...calls.map(
      (call): AiResponse.ToolCallPartEncoded => ({
        id: call.id ?? "provider-fixture-call",
        name: toolCallName(call),
        params: toolCallArguments(call),
        type: "tool-call",
      })
    ),
    {
      reason: calls.length === 0 ? "stop" : "tool-calls",
      type: "finish",
      usage: {
        inputTokens: { total: usageToken(response, "prompt_tokens") },
        outputTokens: { total: usageToken(response, "completion_tokens") },
      },
    },
  ];
};

const makeVisualLanguageModel = (
  nextResponse: () => Response,
  onDispatch: (request: LanguageModel.ProviderOptions) => Promise<void>,
  traceStore: ImportObservabilityTraceStore | undefined
) =>
  LanguageModel.make({
    generateText: (request) =>
      Effect.promise(() => onDispatch(request)).pipe(
        Effect.andThen(
          Effect.promise(async () => {
            await Effect.runPromise(
              emitImportObservabilityEvent(
                {
                  correlationId,
                  event: "provider.response",
                  outcome: "received",
                  providerStage: "visual",
                },
                traceStore
              )
            );
            return readNormalizedVisualResponse(nextResponse);
          })
        ),
        Effect.flatMap((outcome) =>
          outcome._tag === "Failure"
            ? Effect.fail(fixtureAiError(outcome.description))
            : Schema.decodeUnknownEffect(VisualProviderResponse, {
                onExcessProperty: "preserve",
              })(outcome.value).pipe(Effect.mapError(() => fixtureAiError()))
        ),
        Effect.map(providerResponseParts)
      ),
    streamText: () => Stream.fail(fixtureAiError()),
  });

export const makeVisualTransport = (
  nextResponse: () => Response,
  onDispatch: (request: LanguageModel.ProviderOptions) => Promise<void> = () =>
    Promise.resolve()
): WorkersAiTransport["visual"] => ({
  makeLanguageModel: () =>
    Effect.gen(function* makeFixtureVisualLanguageModel() {
      const traceStore = Option.getOrUndefined(
        yield* Effect.serviceOption(ImportObservabilityTraceStore)
      );
      return yield* makeVisualLanguageModel(
        nextResponse,
        onDispatch,
        traceStore
      );
    }),
  model: InstalledVisualModel,
});

export const makeRawProviderTransports = (
  response: Response,
  traceStore?: ImportObservabilityTraceStore
) => {
  const recipeRequests: Parameters<WorkersAiTransport["recipe"]["run"]>[0][] =
    [];
  const speechRequests: Parameters<WorkersAiTransport["speech"]["run"]>[0][] =
    [];
  const visualRequests: LanguageModel.ProviderOptions[] = [];
  const recipe: WorkersAiTransport["recipe"] = {
    model: InstalledRecipeModel,
    run: async (body) => {
      recipeRequests.push(body);
      await Effect.runPromise(
        emitImportObservabilityEvent(
          {
            correlationId,
            event: "provider.response",
            outcome: "received",
            providerStage: "recipe",
          },
          traceStore
        )
      );
      return normalizeWorkersAiResponse(response);
    },
  };
  const speech: WorkersAiTransport["speech"] = {
    model: InstalledSpeechModel,
    run: async (body) => {
      speechRequests.push(body);
      await Effect.runPromise(
        emitImportObservabilityEvent(
          {
            correlationId,
            event: "provider.response",
            outcome: "received",
            providerStage: "speech",
          },
          traceStore
        )
      );
      return normalizeWorkersAiResponse(response);
    },
  };
  const visual = makeVisualTransport(
    () => response,
    (request) => {
      visualRequests.push(request);
      return Promise.resolve();
    }
  );
  return {
    recipe,
    recipeRequests,
    speech,
    speechRequests,
    visual,
    visualRequests,
  };
};

export const makeProviderTransports = (
  response: Schema.Json,
  traceStore?: ImportObservabilityTraceStore
) => makeRawProviderTransports(Response.json(response), traceStore);

export const makeSpeechTransportFromValue = (response: Schema.Json) => {
  const responseEnvelope = new Response(null, { status: 200 });
  Object.defineProperty(responseEnvelope, "json", {
    value: () => Promise.resolve(response),
  });
  return makeRawProviderTransports(responseEnvelope).speech;
};

export const makeRejectedProviderTransports = (error: Error) => ({
  recipe: {
    model: InstalledRecipeModel,
    run: () => Effect.runPromise(Effect.fail(error)),
  } satisfies WorkersAiTransport["recipe"],
  speech: {
    model: InstalledSpeechModel,
    run: () => Effect.runPromise(Effect.fail(error)),
  } satisfies WorkersAiTransport["speech"],
  visual: {
    makeLanguageModel: () =>
      LanguageModel.make({
        generateText: () =>
          Effect.fail(
            AiError.make({
              method: "generateText",
              module: "MealPlannerProviderFixture",
              reason: new AiError.UnknownError({
                description: error.message,
              }),
            })
          ),
        streamText: () => Stream.fail(fixtureAiError()),
      }),
    model: InstalledVisualModel,
  } satisfies WorkersAiTransport["visual"],
});

export const speechTranscriptionInput = {
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

export const nestUnknownMetadata = (
  leaf: Schema.Json,
  depth: number
): Schema.Json => {
  let value: Schema.Json = leaf;
  for (let index = 0; index < depth; index += 1) {
    value = { nested: value };
  }
  return value;
};

export const localDispatchGate: ProviderDispatchGate = {
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

export const testRuntimeContext = RuntimeContext.of({
  Type: "TestRuntimeContext",
  env: {},
  get: <T>() =>
    // eslint-disable-next-line unicorn/no-useless-undefined -- The Alchemy runtime contract explicitly represents a missing binding with undefined.
    Effect.succeed<T | undefined>(undefined),
  id: "installed-provider-test",
  set: (id) => Effect.succeed(id),
});

export const runFactory = <A>(
  effect: Effect.Effect<A, never, RuntimeContext>,
  traceStore?: ImportObservabilityTraceStore
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

export const makeRecordingTraceStore = () => {
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

export const recipeEvidenceAssembly = {
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

export const runRecipeTransportRoot = async (response: Schema.Json) => {
  const trace = makeRecordingTraceStore();
  const adapter = await runFactory(
    makeInstalledRecipeExtractor({
      correlationId,
      dispatch: localDispatchGate,
      transport: makeProviderTransports(response).recipe,
    }),
    trace.service
  );
  const exit = await Effect.runPromiseExit(
    adapter.extract(recipeEvidenceAssembly)
  );
  return { exit, trace };
};

export const unresolvedString = {
  citations: [],
  origin: "unresolved",
  reason: "not resolved from available evidence",
  state: "unresolved",
} as const;

export const unresolvedNumber = unresolvedString;

export const unresolvedList = {
  items: [],
  reason: "not resolved from available evidence",
  state: "unresolved",
} as const;

export const validRecipeSemantics = {
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

export const validRecipe = {
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

export const emptyRecipeProviderSelection = {
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

export const validVisual = {
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

export const validVisualSemantics = {
  observations: [],
} as const;

export const defaultVisualUsage = {
  completion_tokens: 10,
  prompt_tokens: 20,
  total_tokens: 30,
};

export const toolResponse = (
  name: string,
  value: Schema.Json,
  usage: Schema.Json | null = defaultVisualUsage
) => {
  const response = {
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
  };
  return usage === null ? response : { ...response, usage };
};

export const recipeJsonResponse = (
  value: Schema.Json,
  usage: Schema.Json | null = defaultVisualUsage
) => {
  const response = { response: value };
  return usage === null ? response : { ...response, usage };
};
