import { RuntimeContext } from "alchemy";
import type { QueryGatewayClient } from "alchemy/Cloudflare/AI";
import { Effect, Schema } from "effect";

import type {
  ImportObservabilityEvent,
  ImportObservabilityTraceStoreShape,
} from "./import-observability.js";
import {
  ImportCorrelationId,
  ImportObservabilityTraceStore,
} from "./import-observability.js";
import type { ProviderDispatchGate } from "./import-provider-kernel.js";
import { makeInstalledRecipeExtractor } from "./import-provider-recipe.js";

export const makeRawGateway = (response: Response) => {
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

export const makeGateway = (response: unknown) =>
  makeRawGateway(Response.json(response));

export const makeSpeechGateway = makeGateway;

export const makeSpeechGatewayFromValue = (response: unknown) => {
  const responseEnvelope = new Response(null, { status: 200 });
  Object.defineProperty(responseEnvelope, "json", {
    value: () => Promise.resolve(response),
  });
  return makeRawGateway(responseEnvelope);
};

export const makeRejectedGateway = (error: unknown) =>
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

export const correlationId = Schema.decodeUnknownSync(ImportCorrelationId)(
  "019b37f2-1a6e-7f3a-8a5a-7f0d8f6c2b1a"
);

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

export const nestUnknownMetadata = (leaf: unknown, depth: number): unknown => {
  let value = leaf;
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

export const runRecipeTransportRoot = async (response: unknown) => {
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

export const recipeJsonResponse = (
  value: unknown,
  usage: unknown | null = defaultVisualUsage
) => ({
  response: value,
  ...(usage === null ? {} : { usage }),
});
