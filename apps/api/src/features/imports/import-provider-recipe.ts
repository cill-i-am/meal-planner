import { Effect, Option, Schema } from "effect";

import { toStrictJsonSchema } from "../../infrastructure/strict-json-schema.js";
import {
  isProviderKnownZeroCostFailure,
  providerKnownZeroCostFailure,
} from "../provider-accounting/provider-accounting.js";
import { bytesToHex } from "./import-digest.js";
import { structurallyEqualJson } from "./import-forced-tool-response.js";
import type { ImportCorrelationId } from "./import-observability.js";
import {
  ImportObservabilityTraceStore,
  emitImportObservabilityEvent,
} from "./import-observability.js";
import {
  ProviderKnownZeroSetupFailureMessage,
  ProviderName,
  SafeProviderFailureCode,
  decodeProviderFailureEvidence,
  failAfter,
  isSafeProviderFailureCode,
  pricedTokenUsage,
  providerFailureFromEvidence,
  providerFailureFromStatus,
  providerNormalizationDecodeReasonFromDescription,
} from "./import-provider-kernel.js";
import type {
  RecipeWorkersAiRequest,
  ProviderDispatchGate,
  ProviderDispatchRequest,
  WorkersAiTransport,
} from "./import-provider-kernel.js";
import type {
  RecipeEvidenceAssembly,
  RecipeExtractor,
} from "./import-recipe-extractor.js";
import {
  RecipeCandidate,
  RecipeExtraction,
  RecipeExtractionFailure,
  RecipeExtractorDescriptor,
} from "./import-recipe-extractor.js";
import { groundRecipeCandidate } from "./import-recipe-grounding.js";

export { InstalledRecipeModel } from "./import-provider-kernel.js";

const RecipeMaximumCostMicroUsd = 100_000;

export const InstalledRecipeExtractorVersion =
  "installed-workers-ai-json-schema-v2";

/** Cloudflare catalog rates, checked 2026-10-23 against the 2026-10-20 price table. */
export const InstalledRecipeTokenPrices = {
  inputMicroUsdPerToken: 0.293,
  outputMicroUsdPerToken: 2.253,
} as const;

type RecipeDispatchOutcome =
  | {
      readonly _tag: "Extracted";
      readonly extraction: RecipeExtraction;
    }
  | {
      readonly _tag: "Failed";
      readonly code: SafeProviderFailureCode;
    };

const FailedRecipeReplay = Schema.Struct({
  _tag: Schema.Literal("Failed"),
  code: SafeProviderFailureCode,
});
const decodeFailedRecipeReplay = Schema.decodeUnknownOption(
  FailedRecipeReplay,
  {
    onExcessProperty: "error",
  }
);

const recipeReplaySha256 = (valueJson: string) =>
  Effect.tryPromise({
    catch: () => "malformed_response" as const,
    try: async () => {
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(valueJson)
      );
      return bytesToHex(digest);
    },
  });

const RecipeReplayMaximumBytes = 262_144;

const recipeConservativeReplay = (
  request: RecipeEvidenceAssembly
): NonNullable<
  ProviderDispatchRequest<
    RecipeDispatchOutcome,
    SafeProviderFailureCode
  >["conservativeReplay"]
> => ({
  decode: (replay) =>
    Effect.gen(function* decodeRecipeReplay() {
      const valueByteLength = new TextEncoder().encode(
        replay.valueJson
      ).byteLength;
      if (
        replay.evidenceFingerprint !== request.evidenceFingerprint ||
        replay.generation !== request.generation ||
        replay.importId !== request.importId ||
        valueByteLength === 0 ||
        valueByteLength > RecipeReplayMaximumBytes ||
        (yield* recipeReplaySha256(replay.valueJson)) !== replay.valueSha256
      ) {
        return yield* Effect.fail("malformed_response" as const);
      }
      const parsed = yield* Effect.try({
        catch: () => "malformed_response" as const,
        try: () => JSON.parse(replay.valueJson),
      });
      const failed = decodeFailedRecipeReplay(parsed);
      if (Option.isSome(failed)) {
        return {
          _tag: "Failed" as const,
          code: failed.value.code,
        };
      }
      const extraction = yield* Schema.decodeUnknownEffect(RecipeExtraction, {
        onExcessProperty: "error",
      })(parsed).pipe(Effect.mapError(() => "malformed_response" as const));
      return {
        _tag: "Extracted" as const,
        extraction,
      };
    }),
  encode: (value) =>
    Effect.gen(function* encodeRecipeReplay() {
      const encodedValue =
        value._tag === "Failed"
          ? value
          : Schema.encodeSync(RecipeExtraction)(value.extraction);
      const valueJson = JSON.stringify(encodedValue);
      const valueByteLength = new TextEncoder().encode(valueJson).byteLength;
      if (valueByteLength === 0 || valueByteLength > RecipeReplayMaximumBytes) {
        return yield* Effect.fail("malformed_response" as const);
      }
      return {
        evidenceFingerprint: request.evidenceFingerprint,
        generation: request.generation,
        importId: request.importId,
        valueJson,
        valueSha256: yield* recipeReplaySha256(valueJson),
      };
    }),
});

const recipePromptText = (input: RecipeEvidenceAssembly) =>
  [
    "Select only recipe values supported by the supplied evidence. " +
      "Copy short exact phrases from the evidence whenever possible. " +
      "Return null for an unsupported scalar and an empty array for an " +
      "unsupported list. If the content is not food or not a recipe, return " +
      "null scalars and null ingredients and instructions.",
    "Select ingredients as objects retaining exact original ingredient phrases and instructions " +
      "as individual cooking-action phrases. When the evidence contains both " +
      "an ingredient phrase and a cooking-action phrase, ingredients and " +
      "instructions must each contain at least one short exact supported phrase. " +
      "Do not reject recipe narration merely because quantities, timings, title, " +
      "or other fields are missing. Retain exact instruction text. Ingredient quantity, unit, preparation and optional status must be supported within its original phrase. Set ingredientId and localName to null and step ingredients to empty arrays. Only include nutrition with an explicit basis and provided nutrient amounts. Do not infer dietary or allergen claims from ingredients. Set media and language to empty/null unless directly supported. Include a numeric value only when the exact " +
      "number and its unit occur in the evidence. Do not return source identity, " +
      "citations, provenance, confidence, state, reasons, or unresolved-field " +
      "bookkeeping; the trusted adapter derives those.",
    ...input.items.map((item) =>
      JSON.stringify({
        evidenceId: item.evidenceId,
        kind: item.kind,
        origin: item.origin,
        value: item.value,
      })
    ),
  ].join("\n");

const RecipeTransportTokenCount = Schema.Int.pipe(
  Schema.check(
    Schema.isGreaterThanOrEqualTo(0),
    Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)
  )
);
const RecipeTransportUsage = Schema.Struct({
  completion_tokens: RecipeTransportTokenCount,
  prompt_tokens: RecipeTransportTokenCount,
  prompt_tokens_details: Schema.optionalKey(
    Schema.Struct({ cached_tokens: RecipeTransportTokenCount })
  ),
  total_tokens: RecipeTransportTokenCount,
});
// Provider metadata is extensible, but supplied completion controls must still
// establish a completed JSON response without refusal or tool execution.
const RecipeJsonModeCompletionControls = {
  finish_reason: Schema.optionalKey(Schema.Literal("stop")),
  function_call: Schema.optionalKey(Schema.Null),
  refusal: Schema.optionalKey(Schema.Null),
  tool_calls: Schema.optionalKey(Schema.NullOr(Schema.Tuple([]))),
};
const RecipeJsonModeChoice = Schema.Struct({
  ...RecipeJsonModeCompletionControls,
  message: Schema.Struct({
    ...RecipeJsonModeCompletionControls,
    content: Schema.fromJsonString(Schema.Json),
    role: Schema.Literal("assistant"),
  }),
});
const RecipeJsonModeTransportEnvelope = Schema.Struct({
  ...RecipeJsonModeCompletionControls,
  choices: Schema.optionalKey(
    Schema.Array(RecipeJsonModeChoice).pipe(Schema.check(Schema.isMaxLength(1)))
  ),
  response: Schema.Json,
  usage: Schema.optionalKey(Schema.Json),
});
const decodeRecipeTransportUsage = Schema.decodeUnknownOption(
  RecipeTransportUsage,
  { onExcessProperty: "ignore" }
);
const decodeRecipeJsonModeTransportEnvelope = Schema.decodeUnknownResult(
  RecipeJsonModeTransportEnvelope,
  { onExcessProperty: "ignore" }
);

const decodeRecipeCandidate = Schema.decodeUnknownResult(RecipeCandidate, {
  onExcessProperty: "error",
});
const recipeCandidateJsonSchema = Schema.decodeUnknownSync(Schema.Json)(
  toStrictJsonSchema(RecipeCandidate)
);
export const makeInstalledRecipeRequest = (
  request: RecipeEvidenceAssembly
): RecipeWorkersAiRequest => ({
  max_tokens: 16_384,
  messages: [
    {
      content: [
        recipePromptText(request),
        `Your output must satisfy this exact JSON Schema, including every required field and nested type. Return only a JSON object conforming to it:\n${JSON.stringify(recipeCandidateJsonSchema)}`,
        "For each ingredient, name contains only the food name; original retains the complete evidence phrase, including its amount, unit and preparation.",
      ].join("\n\n"),
      role: "user",
    },
  ],
  response_format: {
    json_schema: recipeCandidateJsonSchema,
    type: "json_schema",
  },
  temperature: 0,
});

export type RecipeProviderOutcome =
  | {
      readonly _tag: "Decoded";
      readonly inputTokens: number | undefined;
      readonly outputTokens: number | undefined;
      readonly value: RecipeCandidate;
    }
  | {
      readonly _tag: "Failed";
      readonly code: SafeProviderFailureCode;
    };

const decodeRecipeResponse = (
  raw: Schema.Json
): {
  readonly outcome: RecipeProviderOutcome;
  readonly failure?: {
    readonly decodeReason:
      | "json_mode_envelope_invalid"
      | "json_mode_schema_invalid";
    readonly decodeStage: "json_mode_envelope" | "recipe_schema";
  };
} => {
  const envelope = decodeRecipeJsonModeTransportEnvelope(raw);
  if (
    envelope._tag === "Failure" ||
    envelope.success.choices?.some(
      (choice) =>
        !structurallyEqualJson(
          choice.message.content,
          envelope.success.response
        )
    )
  ) {
    return {
      failure: {
        decodeReason: "json_mode_envelope_invalid",
        decodeStage: "json_mode_envelope",
      },
      outcome: { _tag: "Failed", code: "malformed_response" },
    };
  }
  const selection = decodeRecipeCandidate(envelope.success.response);
  if (selection._tag === "Failure") {
    return {
      failure: {
        decodeReason: "json_mode_schema_invalid",
        decodeStage: "recipe_schema",
      },
      outcome: { _tag: "Failed", code: "malformed_response" },
    };
  }
  const usage =
    envelope.success.usage === undefined
      ? undefined
      : Option.getOrUndefined(
          decodeRecipeTransportUsage(envelope.success.usage)
        );
  if (
    envelope.success.usage !== undefined &&
    (usage === undefined ||
      usage.prompt_tokens + usage.completion_tokens !== usage.total_tokens)
  ) {
    return {
      failure: {
        decodeReason: "json_mode_envelope_invalid",
        decodeStage: "json_mode_envelope",
      },
      outcome: { _tag: "Failed", code: "malformed_response" },
    };
  }
  return {
    outcome: {
      _tag: "Decoded",
      inputTokens: usage?.prompt_tokens,
      outputTokens: usage?.completion_tokens,
      value: selection.success,
    },
  };
};

/** The evaluation collector uses the same strict decoder as live imports. */
export const decodeInstalledRecipeResponse = (
  raw: Schema.Json
): RecipeProviderOutcome => decodeRecipeResponse(raw).outcome;

const runRecipeJsonMode = Effect.fn("Imports.runRecipeJsonMode")(
  function* runRecipeJsonModeWorkflow(
    transport: WorkersAiTransport["recipe"],
    request: RecipeEvidenceAssembly,
    observability: {
      readonly correlationId: ImportCorrelationId;
      readonly traceStore: ImportObservabilityTraceStore | undefined;
    }
  ) {
    return yield* failAfter(
      Effect.gen(function* invokeRecipeJsonMode() {
        const response = yield* Effect.tryPromise({
          catch: (error) => error,
          try: () => transport.run(makeInstalledRecipeRequest(request)),
        });
        if (!response.ok) {
          return {
            _tag: "Failed" as const,
            code: providerFailureFromStatus(response.status).code,
          } satisfies RecipeProviderOutcome;
        }
        const raw = Option.getOrUndefined(
          yield* Effect.tryPromise({
            catch: () => "malformed_response" as const,
            try: () => response.json(),
          }).pipe(Effect.option)
        );
        if (raw === undefined) {
          return {
            _tag: "Failed" as const,
            code: "malformed_response" as const,
          } satisfies RecipeProviderOutcome;
        }
        const decoded = decodeRecipeResponse(raw);
        yield* emitImportObservabilityEvent(
          decoded.failure === undefined
            ? {
                correlationId: observability.correlationId,
                event: "provider.decode",
                outcome: "succeeded",
                providerStage: "recipe",
              }
            : {
                correlationId: observability.correlationId,
                ...decoded.failure,
                event: "provider.decode",
                outcome: "malformed",
                providerStage: "recipe",
              },
          observability.traceStore
        );
        return decoded.outcome;
      }),
      {
        correlationId: observability.correlationId,
        providerStage: "recipe",
        traceStore: observability.traceStore,
      }
    ).pipe(
      Effect.tapError((error) => {
        const decodeReason = providerNormalizationDecodeReasonFromDescription(
          error instanceof Error
            ? error.message
            : providerFailureFromEvidence(
                Option.getOrUndefined(decodeProviderFailureEvidence(error))
              ).description
        );
        return decodeReason === undefined
          ? Effect.void
          : emitImportObservabilityEvent(
              {
                correlationId: observability.correlationId,
                decodeReason,
                decodeStage: "provider_normalization",
                event: "provider.decode",
                outcome: "malformed",
                providerStage: "recipe",
              },
              observability.traceStore
            );
      }),
      Effect.mapError((error) => {
        if (Schema.is(Schema.String)(error)) {
          return error;
        }
        const failure = providerFailureFromEvidence(
          Option.getOrUndefined(decodeProviderFailureEvidence(error))
        );
        const description =
          error instanceof Error ? error.message : failure.description;
        if (
          providerNormalizationDecodeReasonFromDescription(description) !==
          undefined
        ) {
          return "malformed_response" as const;
        }
        if (description === ProviderKnownZeroSetupFailureMessage) {
          return providerKnownZeroCostFailure("provider_unavailable" as const);
        }
        return failure.code;
      })
    );
  }
);

export const makeInstalledRecipeExtractor = Effect.fn(
  "Imports.makeInstalledRecipeExtractor"
)(function* makeRecipeAdapter(input: {
  readonly correlationId: ImportCorrelationId;
  readonly dispatch: ProviderDispatchGate;
  readonly transport: WorkersAiTransport["recipe"];
}) {
  const traceStore = Option.getOrUndefined(
    yield* Effect.serviceOption(ImportObservabilityTraceStore)
  );
  return {
    descriptor: Schema.decodeUnknownSync(RecipeExtractorDescriptor)({
      model: input.transport.model,
      provider: ProviderName,
      version: InstalledRecipeExtractorVersion,
    }),
    extract: (request: RecipeEvidenceAssembly) =>
      input.dispatch
        .run({
          conservativeReplay: recipeConservativeReplay(request),
          dispatchId:
            request.dispatchId ??
            `recipe:${request.importId}:${request.generation}:${request.evidenceFingerprint}`,
          invoke: Effect.gen(function* extractRecipeSemantics() {
            const startedAt = yield* Effect.sync(() => Date.now());
            const result = yield* runRecipeJsonMode(input.transport, request, {
              correlationId: input.correlationId,
              traceStore,
            });
            if (result._tag === "Failed") {
              return {
                cost: {
                  _tag: "Conservative" as const,
                  conservativeChargeMicroUsd: RecipeMaximumCostMicroUsd,
                },
                value: {
                  _tag: "Failed" as const,
                  code: result.code,
                } satisfies RecipeDispatchOutcome,
              };
            }
            const { inputTokens, outputTokens, value } = result;
            const completedAt = yield* Effect.sync(() => Date.now());
            const meteredCost = pricedTokenUsage(
              inputTokens,
              outputTokens,
              InstalledRecipeTokenPrices
            );
            // A schema-valid response proves this bounded recipe call
            // completed. When the provider omits trustworthy usage, charge
            // the reservation maximum against the safety ledger without
            // representing it as known provider spend.
            const cost =
              meteredCost._tag === "Known"
                ? meteredCost
                : {
                    _tag: "Conservative" as const,
                    conservativeChargeMicroUsd: RecipeMaximumCostMicroUsd,
                  };
            const estimatedMicroUsd =
              cost._tag === "Known"
                ? cost.actualCostMicroUsd
                : cost.conservativeChargeMicroUsd;
            return {
              cost,
              value: {
                _tag: "Extracted" as const,
                extraction: {
                  ...groundRecipeCandidate(value, request.items),
                  cost: {
                    certainty: "estimated" as const,
                    currency: "USD" as const,
                    estimatedMicroUsd,
                  },
                  usage: {
                    inputEvidenceItems: request.items.length,
                    inputTokens: inputTokens ?? 0,
                    latencyMilliseconds: Math.max(0, completedAt - startedAt),
                    modelCalls: 1 as const,
                    outputTokens: outputTokens ?? 0,
                  },
                },
              } satisfies RecipeDispatchOutcome,
            };
          }),
          maximumCostMicroUsd: RecipeMaximumCostMicroUsd,
          providerStage: "recipe",
          providerStageId: "recipe-extraction",
        })
        .pipe(
          Effect.flatMap((outcome) =>
            outcome._tag === "Failed"
              ? Effect.fail(outcome.code)
              : Effect.succeed(outcome.extraction)
          ),
          Effect.mapError(
            // eslint-disable-next-line promise/prefer-await-to-callbacks -- Effect callbacks preserve the adapter error contract.
            (error): RecipeExtractionFailure => {
              const providerError =
                isProviderKnownZeroCostFailure(error) &&
                isSafeProviderFailureCode(error.error)
                  ? error.error
                  : undefined;

              return new RecipeExtractionFailure({
                code:
                  providerError ??
                  (isSafeProviderFailureCode(error)
                    ? error
                    : "outcome_unknown"),
              });
            }
          )
        ),
  } satisfies RecipeExtractor;
});
