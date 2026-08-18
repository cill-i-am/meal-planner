import { Effect, Option, Schema } from "effect";
import { Tool } from "effect/unstable/ai";

import {
  isPilotProviderKnownZeroCostFailure,
  pilotProviderKnownZeroCostFailure,
} from "../pilots/pilot-provider-budget.js";
import type { ImportCorrelationId } from "./import-observability.js";
import {
  ImportObservabilityTraceStore,
  emitImportObservabilityEvent,
} from "./import-observability.js";
import {
  ProviderKnownZeroSetupFailureMessage,
  ProviderName,
  RecipeWorkersAiRequest,
  SafeProviderFailureCode,
  decodeProviderFailureEvidence,
  failAfter,
  isSafeProviderFailureCode,
  pricedTokenUsage,
  providerErrorDescription,
  providerFailureFromEvidence,
  providerFailureFromStatus,
  providerNormalizationDecodeReasonFromDescription,
  safeFailureCode,
} from "./import-provider-kernel.js";
import type {
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
      return [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
    },
  });

const RecipeReplayMaximumBytes = 262_144;

const recipeReplayByteLength = (valueJson: string) =>
  new TextEncoder().encode(valueJson).byteLength;

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
      if (
        replay.evidenceFingerprint !== request.evidenceFingerprint ||
        replay.generation !== request.generation ||
        replay.importId !== request.importId ||
        recipeReplayByteLength(replay.valueJson) === 0 ||
        recipeReplayByteLength(replay.valueJson) > RecipeReplayMaximumBytes ||
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
      const valueByteLength = recipeReplayByteLength(valueJson);
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
      "null scalars and empty ingredientLines and instructions.",
    "Select ingredientLines as individual ingredient phrases and instructions " +
      "as individual cooking-action phrases. When the evidence contains both " +
      "an ingredient phrase and a cooking-action phrase, ingredientLines and " +
      "instructions must each contain at least one short exact supported phrase. " +
      "Do not reject recipe narration merely because quantities, timings, title, " +
      "or other fields are missing. Include a numeric value only when the exact " +
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
const RecipeJsonModeTransportEnvelope = Schema.Struct({
  response: Schema.Json,
  usage: Schema.optionalKey(Schema.Json),
});
const decodeRecipeTransportUsage = Schema.decodeUnknownOption(
  RecipeTransportUsage,
  { onExcessProperty: "error" }
);
const decodeRecipeJsonModeTransportEnvelope = Schema.decodeUnknownResult(
  RecipeJsonModeTransportEnvelope,
  { onExcessProperty: "error" }
);

const decodeRecipeCandidate = Schema.decodeUnknownResult(RecipeCandidate, {
  onExcessProperty: "error",
});
const recipeJsonModeRequest = (
  request: RecipeEvidenceAssembly
): RecipeWorkersAiRequest =>
  Schema.decodeUnknownSync(RecipeWorkersAiRequest)({
    max_tokens: 16_384,
    messages: [{ content: recipePromptText(request), role: "user" }],
    response_format: {
      json_schema: Tool.getJsonSchemaFromSchema(RecipeCandidate),
      type: "json_schema",
    },
    temperature: 0,
  });

type RecipeJsonModeOutcome =
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
          try: () => transport.run(recipeJsonModeRequest(request)),
        });
        if (!response.ok) {
          return {
            _tag: "Failed" as const,
            code: safeFailureCode(providerFailureFromStatus(response.status)),
          } satisfies RecipeJsonModeOutcome;
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
          } satisfies RecipeJsonModeOutcome;
        }
        const envelope = decodeRecipeJsonModeTransportEnvelope(raw);
        if (envelope._tag === "Failure") {
          yield* emitImportObservabilityEvent(
            {
              correlationId: observability.correlationId,
              decodeReason: "json_mode_envelope_invalid",
              decodeStage: "json_mode_envelope",
              event: "provider.decode",
              outcome: "malformed",
              providerStage: "recipe",
            },
            observability.traceStore
          );
          return {
            _tag: "Failed" as const,
            code: "malformed_response" as const,
          } satisfies RecipeJsonModeOutcome;
        }
        const selection = decodeRecipeCandidate(envelope.success.response);
        if (selection._tag === "Failure") {
          yield* emitImportObservabilityEvent(
            {
              correlationId: observability.correlationId,
              decodeReason: "json_mode_schema_invalid",
              decodeStage: "recipe_schema",
              event: "provider.decode",
              outcome: "malformed",
              providerStage: "recipe",
            },
            observability.traceStore
          );
          return {
            _tag: "Failed" as const,
            code: "malformed_response" as const,
          } satisfies RecipeJsonModeOutcome;
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
            usage.prompt_tokens + usage.completion_tokens !==
              usage.total_tokens)
        ) {
          yield* emitImportObservabilityEvent(
            {
              correlationId: observability.correlationId,
              decodeReason: "json_mode_envelope_invalid",
              decodeStage: "json_mode_envelope",
              event: "provider.decode",
              outcome: "malformed",
              providerStage: "recipe",
            },
            observability.traceStore
          );
          return {
            _tag: "Failed" as const,
            code: "malformed_response" as const,
          } satisfies RecipeJsonModeOutcome;
        }
        yield* emitImportObservabilityEvent(
          {
            correlationId: observability.correlationId,
            event: "provider.decode",
            outcome: "succeeded",
            providerStage: "recipe",
          },
          observability.traceStore
        );
        return {
          _tag: "Decoded" as const,
          inputTokens: usage?.prompt_tokens,
          outputTokens: usage?.completion_tokens,
          value: selection.success,
        } satisfies RecipeJsonModeOutcome;
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
            : providerErrorDescription(
                providerFailureFromEvidence(
                  Option.getOrUndefined(decodeProviderFailureEvidence(error))
                )
              )
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
        if (
          providerNormalizationDecodeReasonFromDescription(
            error instanceof Error
              ? error.message
              : providerErrorDescription(
                  providerFailureFromEvidence(
                    Option.getOrUndefined(decodeProviderFailureEvidence(error))
                  )
                )
          ) !== undefined
        ) {
          return "malformed_response" as const;
        }
        if (
          (error instanceof Error
            ? error.message
            : providerErrorDescription(
                providerFailureFromEvidence(
                  Option.getOrUndefined(decodeProviderFailureEvidence(error))
                )
              )) === ProviderKnownZeroSetupFailureMessage
        ) {
          return pilotProviderKnownZeroCostFailure(
            "provider_unavailable" as const
          );
        }
        return safeFailureCode(
          providerFailureFromEvidence(
            Option.getOrUndefined(decodeProviderFailureEvidence(error))
          )
        );
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
  const { model } = input.transport;
  const traceStore = Option.getOrUndefined(
    yield* Effect.serviceOption(ImportObservabilityTraceStore)
  );
  return {
    descriptor: Schema.decodeUnknownSync(RecipeExtractorDescriptor)({
      model,
      provider: ProviderName,
      version: "installed-workers-ai-json-schema-v1",
    }),
    extract: (request) =>
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
            const meteredCost = pricedTokenUsage(inputTokens, outputTokens, {
              inputMicroUsdPerToken: 0.29,
              outputMicroUsdPerToken: 2.25,
            });
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
                isPilotProviderKnownZeroCostFailure(error) &&
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
