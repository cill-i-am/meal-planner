import * as Cloudflare from "alchemy/Cloudflare";
import type { QueryGatewayClient } from "alchemy/Cloudflare/AI";
import { WorkflowStepContext } from "alchemy/Cloudflare/Workflows";
import { Cause, Effect, Option, Schema } from "effect";
import type { SchemaIssue } from "effect";
import * as Clock from "effect/Clock";
import type { LanguageModel, Prompt } from "effect/unstable/ai";
import { Tool, Toolkit } from "effect/unstable/ai";

import {
  PilotBudgetDispatchId,
  PilotBudgetProviderStageId,
  PilotProviderBudgetRuntime,
  isPilotProviderKnownZeroCostFailure,
  pilotProviderKnownZeroCostFailure,
  runPilotProviderDispatch,
} from "../pilots/pilot-provider-budget.js";
import type {
  PilotBudgetRunId,
  PilotBudgetTimestamp,
  PilotProviderConservativeReplayValue,
  PilotProviderKnownZeroCostFailure,
  PilotProviderBudgetRepository,
  PilotProviderBudgetRuntimeShape,
} from "../pilots/pilot-provider-budget.js";
import {
  decodeForcedToolResponseResult,
  structurallyEqualJson,
} from "./import-forced-tool-response.js";
import type {
  ImportCorrelationId,
  ImportObservabilityTraceStoreShape,
  ProviderDecodeReason,
  SpeechEnvelopeFailure,
  SpeechEnvelopeFamily,
  SpeechEnvelopeUnsupportedLocation,
  SpeechEnvelopeUnsupportedRootProperty,
} from "./import-observability.js";
import {
  ImportObservabilityTraceStore,
  emitImportObservabilityEvent,
} from "./import-observability.js";
import type {
  RecipeEvidenceAssembly,
  RecipeEvidenceItem,
  RecipeExtractionFailure,
  RecipeExtractorShape,
} from "./import-recipe-extractor.js";
import {
  RecipeEvidenceCitation,
  RecipeExtraction,
  RecipeExtractionSemantics,
  RecipeExtractorDescriptor,
  RecipeProviderToolArguments,
  RecipeUnresolvedField,
  projectRecipeProviderToolArguments,
} from "./import-recipe-extractor.js";
import {
  projectRecipeEvidenceSpan,
  recipeEvidenceContains,
} from "./import-recipe-grounding.js";
import type {
  SpeechTranscriberShape,
  SpeechTranscriptionFailure,
  SpeechTranscriptionInput,
} from "./import-speech-transcriber.js";
import { SpeechTranscript } from "./import-speech-transcriber.js";
import type {
  VisualEvidenceExtractionFailure,
  VisualEvidenceExtractorShape,
  VisualFrameArtifact,
} from "./import-visual-evidence-extractor.js";
import {
  projectVisualProviderSemanticsInput,
  representativeVisualFrameIndex,
  VisualEvidenceProviderSemantics,
  VisualEvidenceProviderToolArguments,
  visualEvidenceOutcomeForObservations,
} from "./import-visual-evidence-extractor.js";

const ProviderName = "cloudflare-workers-ai" as const;
export const InstalledSpeechModel =
  "@cf/openai/whisper-large-v3-turbo" as const;
export const InstalledVisualModel =
  "@cf/meta/llama-4-scout-17b-16e-instruct" as const;
export const InstalledRecipeModel =
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast" as const;

const ProviderTimeout = "150 seconds";
const SpeechMaximumCostMicroUsd = 50_000;
const VisualMaximumCostMicroUsd = 100_000;
const RecipeMaximumCostMicroUsd = 100_000;
const ProviderTransportUnavailableMessage =
  "provider_transport_unavailable" as const;
const ProviderNormalizationInvalidMessage =
  "provider_normalization_invalid" as const;
const ProviderNormalizationBodyInvalidMessage =
  "provider_normalization_body_invalid" as const;
const ProviderNormalizationRecipeDecodeReasons = [
  "provider_normalization_recipe_arguments_ambiguous",
  "provider_normalization_recipe_arguments_missing",
  "provider_normalization_recipe_arguments_schema_invalid",
  "provider_normalization_recipe_authority_conflict",
  "provider_normalization_recipe_metadata_invalid",
  "provider_normalization_recipe_semantics_missing_required_field",
  "provider_normalization_recipe_semantics_unexpected_property",
  "provider_normalization_recipe_semantics_wrong_type_or_constraint",
  "provider_normalization_recipe_tool_name_invalid",
] as const satisfies readonly ProviderDecodeReason[];
type ProviderNormalizationRecipeDecodeReason =
  (typeof ProviderNormalizationRecipeDecodeReasons)[number];
const ProviderNormalizationRecipeDecodeReasonSet = new Set<string>(
  ProviderNormalizationRecipeDecodeReasons
);
const ProviderKnownZeroSetupFailureMessage =
  "provider_known_zero_setup_failure" as const;

type SafeProviderFailureCode =
  | "insufficient_evidence"
  | "malformed_response"
  | "model_refusal"
  | "outcome_unknown"
  | "provider_unavailable"
  | "throttled"
  | "timeout";

const SafeProviderFailureCodes = new Set<string>([
  "insufficient_evidence",
  "malformed_response",
  "model_refusal",
  "outcome_unknown",
  "provider_unavailable",
  "throttled",
  "timeout",
]);

const isSafeProviderFailureCode = (
  value: unknown
): value is SafeProviderFailureCode =>
  typeof value === "string" && SafeProviderFailureCodes.has(value);

interface ProviderDispatchRequest<A, E> {
  readonly conservativeReplay?: {
    readonly decode: (
      replay: PilotProviderConservativeReplayValue
    ) => Effect.Effect<A, E>;
    readonly encode: (
      value: A
    ) => Effect.Effect<PilotProviderConservativeReplayValue, E>;
  };
  readonly dispatchId: string;
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
  readonly maximumCostMicroUsd: number;
  readonly providerStage: "recipe" | "speech" | "visual";
  readonly providerStageId: string;
}

/** Mandatory dispatch gate used by every installed provider adapter. */
export interface ProviderDispatchGate {
  readonly run: <A, E>(
    input: ProviderDispatchRequest<A, E>
  ) => Effect.Effect<A, E | { readonly _tag: "ProviderDispatchRejected" }>;
}

const dispatchRejected = {
  _tag: "ProviderDispatchRejected",
} as const;

const retryDispatchId = (base: string, attempt: number) =>
  attempt === 1 ? base : `${base}:attempt:${attempt}`;

/** Compose the GAIA-161 reserve/claim/settle authority for adapter factories. */
export const makePilotProviderDispatchGate = (input: {
  readonly correlationId: ImportCorrelationId;
  readonly now: () => PilotBudgetTimestamp;
  readonly repository: PilotProviderBudgetRepository;
  readonly runId: PilotBudgetRunId;
  readonly runtime: PilotProviderBudgetRuntimeShape;
}): ProviderDispatchGate => ({
  run: <A, E>(request: ProviderDispatchRequest<A, E>) =>
    Effect.gen(function* runBudgetedAdapterDispatch() {
      const workflowContext = Option.getOrUndefined(
        yield* Effect.serviceOption(WorkflowStepContext)
      );
      const attempt =
        request.providerStage === "speech"
          ? (workflowContext?.attempt ?? 1)
          : 1;
      const timestamp = input.now();
      const reservation = {
        dispatchId: Schema.decodeUnknownSync(PilotBudgetDispatchId)(
          retryDispatchId(request.dispatchId, attempt)
        ),
        maximumCostMicroUsd: request.maximumCostMicroUsd,
        providerStageId: Schema.decodeUnknownSync(PilotBudgetProviderStageId)(
          request.providerStageId
        ),
        runId: input.runId,
        timestamp,
      };
      return yield* runPilotProviderDispatch({
        ...(request.conservativeReplay === undefined
          ? {}
          : { conservativeReplay: request.conservativeReplay }),
        invoke: request.invoke,
        onDispatch: emitImportObservabilityEvent({
          correlationId: input.correlationId,
          event: "provider.dispatch",
          outcome: "started",
          providerStage: request.providerStage,
        }),
        onPoison: emitImportObservabilityEvent({
          correlationId: input.correlationId,
          event: "budget.poison",
          outcome: "poisoned",
          providerStage: request.providerStage,
        }),
        onReservation: emitImportObservabilityEvent({
          correlationId: input.correlationId,
          event: "budget.reservation",
          outcome: "reserved",
          providerStage: request.providerStage,
        }),
        onSettlement: (outcome) =>
          emitImportObservabilityEvent({
            correlationId: input.correlationId,
            event: "provider.settlement",
            outcome,
            providerStage: request.providerStage,
          }),
        ...(attempt > 1
          ? {
              previousAttempt: {
                ...reservation,
                dispatchId: Schema.decodeUnknownSync(PilotBudgetDispatchId)(
                  retryDispatchId(request.dispatchId, attempt - 1)
                ),
              },
            }
          : {}),
        repository: input.repository,
        reservation,
      });
    }).pipe(
      Effect.provideService(PilotProviderBudgetRuntime, input.runtime),
      Effect.flatMap((result) => {
        switch (result._tag) {
          case "Completed":
          case "CompletedConservativeCost":
          case "CompletedUnknownCost": {
            return Effect.succeed(result.value);
          }
          case "AlreadyConservativelySettled": {
            return Effect.succeed(result.value);
          }
          case "AlreadySettled": {
            return Effect.fail(dispatchRejected);
          }
          default: {
            return Effect.fail(dispatchRejected);
          }
        }
      }),
      // eslint-disable-next-line promise/prefer-await-to-callbacks -- Effect callbacks preserve the typed error channel.
      Effect.mapError((error) => {
        if (
          typeof error === "object" &&
          error !== null &&
          "_tag" in error &&
          error._tag === "PilotProviderBudgetError"
        ) {
          return dispatchRejected;
        }
        return error as E | typeof dispatchRejected;
      })
    ),
});

const safeFailureCode = (
  cause: Cause.Cause<unknown>
): SafeProviderFailureCode => {
  const error = Option.getOrUndefined(Cause.findErrorOption(cause));
  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    const reason =
      typeof record["reason"] === "object" && record["reason"] !== null
        ? (record["reason"] as Record<string, unknown>)
        : record;
    const original =
      typeof record["cause"] === "object" && record["cause"] !== null
        ? (record["cause"] as Record<string, unknown>)
        : record;
    const tag = String(
      original["_tag"] ?? reason["_tag"] ?? record["_tag"] ?? ""
    ).toLowerCase();
    const status = original["status"] ?? reason["status"] ?? record["status"];
    if (status === 429 || tag.includes("rate") || tag.includes("throttl")) {
      return "throttled";
    }
    if (tag.includes("refusal") || tag.includes("contentfilter")) {
      return "model_refusal";
    }
  }
  return "provider_unavailable";
};

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
    RecipeExtraction,
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
        try: () => JSON.parse(replay.valueJson) as unknown,
      });
      return yield* Schema.decodeUnknownEffect(RecipeExtraction, {
        onExcessProperty: "error",
      })(parsed).pipe(Effect.mapError(() => "malformed_response" as const));
    }),
  encode: (value) =>
    Effect.gen(function* encodeRecipeReplay() {
      const valueJson = JSON.stringify(
        Schema.encodeSync(RecipeExtraction)(value)
      );
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

const providerErrorDescription = (error: unknown): string | undefined => {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const record = error as Record<string, unknown>;
  const reason =
    typeof record["reason"] === "object" && record["reason"] !== null
      ? (record["reason"] as Record<string, unknown>)
      : record;
  return typeof reason["description"] === "string"
    ? reason["description"]
    : undefined;
};

const hasProviderErrorDescription = (
  error: unknown,
  description: string
): boolean => providerErrorDescription(error) === description;

const providerNormalizationDecodeReason = (
  error: unknown
): ProviderDecodeReason | undefined => {
  const description = providerErrorDescription(error);
  if (
    description === ProviderNormalizationInvalidMessage ||
    description === ProviderNormalizationBodyInvalidMessage
  ) {
    return ProviderNormalizationInvalidMessage;
  }
  const prefix = `${ProviderNormalizationInvalidMessage}:`;
  if (description?.startsWith(prefix) !== true) {
    return undefined;
  }
  const reason = description.slice(prefix.length);
  return ProviderNormalizationRecipeDecodeReasonSet.has(reason)
    ? (reason as ProviderNormalizationRecipeDecodeReason)
    : undefined;
};

const isProviderNormalizationFailure = (error: unknown): boolean =>
  providerNormalizationDecodeReason(error) !== undefined;

const isProviderNormalizationBodyFailure = (error: unknown): boolean =>
  hasProviderErrorDescription(error, ProviderNormalizationBodyInvalidMessage);

export const failAfter = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  observability: {
    readonly correlationId: ImportCorrelationId;
    readonly providerStage: "recipe" | "speech" | "visual";
    readonly traceStore?: ImportObservabilityTraceStoreShape | undefined;
  }
): Effect.Effect<A, E | SafeProviderFailureCode, R> =>
  effect.pipe(
    Effect.timeoutOrElse({
      duration: ProviderTimeout,
      orElse: () => Effect.fail("timeout" as const),
    }),
    // eslint-disable-next-line promise/prefer-await-to-callbacks -- Effect callbacks preserve the typed timeout channel.
    Effect.tapError((error) =>
      error === "timeout"
        ? emitImportObservabilityEvent(
            {
              correlationId: observability.correlationId,
              event: "provider.timeout",
              outcome: "timed_out",
              providerStage: observability.providerStage,
            },
            observability.traceStore
          )
        : Effect.void
    )
  );

const oneForcedToolCall = <Name extends string, S extends Schema.Top>(
  service: LanguageModel.Service,
  input: {
    readonly acceptUnwrappedObject?: boolean;
    readonly description: string;
    readonly name: Name;
    readonly normalizeValue?: (value: unknown) => unknown;
    readonly prompt: Prompt.RawInput;
    readonly providerNormalizationFallback?: () => S["Type"];
    readonly schema: S;
    readonly toolSchema?: Schema.Top;
  },
  observability: {
    readonly correlationId: ImportCorrelationId;
    readonly providerStage: "recipe" | "visual";
    readonly traceStore: ImportObservabilityTraceStoreShape | undefined;
  }
): Effect.Effect<
  {
    readonly inputTokens: number | undefined;
    readonly outputTokens: number | undefined;
    readonly value: S["Type"];
  },
  | SafeProviderFailureCode
  | PilotProviderKnownZeroCostFailure<SafeProviderFailureCode>,
  S["DecodingServices"]
> => {
  const tool = Tool.dynamic(input.name, {
    description: input.description,
    // Keep the provider-facing contract strict while retaining the untrusted
    // arguments verbatim for the explicit fail-closed decode below. Tool.make
    // decodes parameters inside Effect's response schema first, where excess
    // object properties are stripped before this adapter can reject them.
    parameters: Tool.getJsonSchemaFromSchema(input.toolSchema ?? input.schema),
  });
  const toolkit = Toolkit.make(tool);
  return failAfter(
    service.generateText({
      disableToolCallResolution: true,
      prompt: input.prompt,
      toolChoice: { tool: input.name },
      toolkit,
    } as never),
    observability
  ).pipe(
    // The raw-client wrapper marks only the installed adapter's response.json
    // failure. Request, provider, transport, and timeout failures share this
    // Effect error channel but must not be represented as decode evidence.
    // eslint-disable-next-line promise/prefer-await-to-callbacks -- Effect callbacks preserve the typed error channel.
    Effect.tapError((error) => {
      const decodeReason = providerNormalizationDecodeReason(error);
      if (decodeReason !== undefined) {
        return emitImportObservabilityEvent(
          {
            correlationId: observability.correlationId,
            decodeReason,
            decodeStage: "provider_normalization",
            event: "provider.decode",
            outcome: "malformed",
            providerStage: observability.providerStage,
          },
          observability.traceStore
        );
      }
      return Effect.void;
    }),
    Effect.map((response) => ({ _tag: "Response" as const, response })),
    Effect.catchIf(
      (error) =>
        isProviderNormalizationBodyFailure(error) &&
        input.providerNormalizationFallback !== undefined,
      () =>
        Effect.succeed({
          _tag: "ProviderNormalizationFallback" as const,
          value: input.providerNormalizationFallback?.() as S["Type"],
        })
    ),
    // eslint-disable-next-line promise/prefer-await-to-callbacks -- Effect callbacks preserve the typed error channel.
    Effect.mapError((error) => {
      if (typeof error === "string") {
        return error;
      }
      if (isProviderNormalizationFailure(error)) {
        return "malformed_response" as const;
      }
      if (
        hasProviderErrorDescription(error, ProviderKnownZeroSetupFailureMessage)
      ) {
        return pilotProviderKnownZeroCostFailure(
          "provider_unavailable" as const
        );
      }
      return safeFailureCode(Cause.fail(error));
    }),
    Effect.flatMap((result) => {
      if (result._tag === "ProviderNormalizationFallback") {
        return Effect.succeed({
          inputTokens: undefined,
          outputTokens: undefined,
          value: result.value,
        });
      }
      const { response } = result;
      const decoded = decodeForcedToolResponseResult(
        response.content,
        input.name,
        input.acceptUnwrappedObject === true
          ? { acceptUnwrappedObject: true }
          : undefined
      );
      if (decoded._tag !== "Decoded") {
        return emitImportObservabilityEvent(
          {
            correlationId: observability.correlationId,
            decodeReason:
              decoded._tag === "Missing"
                ? "forced_tool_missing"
                : "forced_tool_envelope_invalid",
            decodeStage: "forced_tool_envelope",
            event: "provider.decode",
            outcome: "malformed",
            providerStage: observability.providerStage,
          },
          observability.traceStore
        ).pipe(
          Effect.andThen(
            Effect.fail(
              decoded._tag === "Missing"
                ? ("insufficient_evidence" as const)
                : ("malformed_response" as const)
            )
          )
        );
      }
      const normalizedInput =
        input.normalizeValue === undefined
          ? decoded.value
          : input.normalizeValue(decoded.value);
      return Schema.decodeUnknownEffect(input.schema, {
        onExcessProperty: "error",
      })(normalizedInput).pipe(
        Effect.matchEffect({
          onFailure: () =>
            emitImportObservabilityEvent(
              {
                correlationId: observability.correlationId,
                decodeReason: "forced_tool_arguments_schema_invalid",
                decodeStage:
                  observability.providerStage === "recipe"
                    ? "recipe_schema"
                    : "visual_schema",
                event: "provider.decode",
                outcome: "malformed",
                providerStage: observability.providerStage,
              },
              observability.traceStore
            ).pipe(Effect.andThen(Effect.fail("malformed_response" as const))),
          onSuccess: (value) =>
            emitImportObservabilityEvent(
              {
                correlationId: observability.correlationId,
                event: "provider.decode",
                outcome: "succeeded",
                providerStage: observability.providerStage,
              },
              observability.traceStore
            ).pipe(
              Effect.as({
                inputTokens: response.usage.inputTokens.total,
                outputTokens: response.usage.outputTokens.total,
                value,
              })
            ),
        })
      );
    })
  );
};

const recipePromptText = (input: RecipeEvidenceAssembly) =>
  [
    "Select only recipe values supported by the supplied evidence. " +
      "Copy short exact phrases from the evidence whenever possible. " +
      "Return null for an unsupported scalar and an empty array for an " +
      "unsupported list. If the content is not food or not a recipe, return " +
      "null scalars and empty ingredientLines and instructions.",
    "Select ingredientLines as individual ingredient phrases and instructions " +
      "as individual cooking-action phrases. Include a numeric value only when " +
      "the exact number and its unit occur in the evidence. Do not return source " +
      "identity, citations, provenance, confidence, state, reasons, or " +
      "unresolved-field bookkeeping; the trusted adapter derives those.",
    ...input.items.map((item) =>
      JSON.stringify({
        evidenceId: item.evidenceId,
        kind: item.kind,
        origin: item.origin,
        value: item.value,
      })
    ),
  ].join("\n");

const RecipeUnresolvedFieldBySemanticKey = new Map<
  string,
  RecipeUnresolvedField
>([
  ["author", "author"],
  ["category", "category"],
  ["cookTimeMinutes", "cook_time_minutes"],
  ["cuisine", "cuisine"],
  ["description", "description"],
  ["ingredientLines", "ingredient_lines"],
  ["instructions", "instructions"],
  ["name", "name"],
  ["nutrition", "nutrition"],
  ["prepTimeMinutes", "prep_time_minutes"],
  ["temperatureCelsius", "temperature_celsius"],
  ["tools", "tools"],
  ["totalTimeMinutes", "total_time_minutes"],
  ["yield", "yield"],
]);
const MissingRecipeSemanticReason =
  "not resolved from available evidence" as const;
const MissingRecipeFact = {
  citations: [],
  origin: "unresolved",
  reason: MissingRecipeSemanticReason,
  state: "unresolved",
} as const;
const MissingRecipeFactList = {
  items: [],
  reason: MissingRecipeSemanticReason,
  state: "unresolved",
} as const;

const trustedRecipeCitation = (item: RecipeEvidenceItem) => ({
  confidence: 1,
  evidenceId: item.evidenceId,
  origin: item.origin,
});

const trustedSupportedRecipeFact = <A>(value: A, item: RecipeEvidenceItem) => ({
  citations: [trustedRecipeCitation(item)] as const,
  origin: item.origin,
  state: "supported" as const,
  value,
});

const normalizedStringEvidence = (
  items: readonly RecipeEvidenceItem[],
  value: string
) => items.find((item) => recipeEvidenceContains(item.value, value));

const groundedStringEvidence = (
  fact: RecipeExtractionSemantics["name"],
  items: readonly RecipeEvidenceItem[]
) => {
  if (fact.state === "unresolved") {
    return null;
  }
  const exact = normalizedStringEvidence(items, fact.value);
  if (exact !== undefined) {
    return { item: exact, value: fact.value } as const;
  }
  for (const citation of fact.citations) {
    const item = items.find(
      (candidate) =>
        candidate.evidenceId === citation.evidenceId &&
        candidate.origin === citation.origin
    );
    if (item === undefined) {
      continue;
    }
    const projected = projectRecipeEvidenceSpan(item.value, fact.value);
    if (projected !== null) {
      return { item, value: projected } as const;
    }
  }
  for (const item of items) {
    if (
      item.kind !== "caption" &&
      item.kind !== "transcript" &&
      item.kind !== "visual_observation"
    ) {
      continue;
    }
    const projected = projectRecipeEvidenceSpan(item.value, fact.value);
    if (projected !== null) {
      return { item, value: projected } as const;
    }
  }
  return null;
};

const exactTimeEvidence = (
  items: readonly RecipeEvidenceItem[],
  value: number
) =>
  items.find((item) =>
    new RegExp(`\\b${value}\\s*(?:minutes?|mins?)\\b`, "iu").test(item.value)
  );

const exactTemperatureEvidence = (
  items: readonly RecipeEvidenceItem[],
  value: number
) =>
  items.find((item) =>
    new RegExp(`\\b${value}\\s*(?:°\\s*)?c\\b`, "iu").test(item.value)
  );

const groundRecipeStringFact = (
  fact: RecipeExtractionSemantics["name"],
  items: readonly RecipeEvidenceItem[]
) => {
  if (fact.state === "unresolved") {
    return MissingRecipeFact;
  }
  const grounded = groundedStringEvidence(fact, items);
  return grounded === null
    ? MissingRecipeFact
    : trustedSupportedRecipeFact(grounded.value, grounded.item);
};

const groundRecipeNumberFact = (
  fact: RecipeExtractionSemantics["totalTimeMinutes"],
  items: readonly RecipeEvidenceItem[],
  findEvidence: (
    evidence: readonly RecipeEvidenceItem[],
    value: number
  ) => RecipeEvidenceItem | undefined
) => {
  if (fact.state === "unresolved") {
    return MissingRecipeFact;
  }
  const evidence = findEvidence(items, fact.value);
  return evidence === undefined
    ? MissingRecipeFact
    : trustedSupportedRecipeFact(fact.value, evidence);
};

const groundRecipeFactList = (
  list: RecipeExtractionSemantics["ingredientLines"],
  items: readonly RecipeEvidenceItem[]
) => {
  if (list.state === "unresolved") {
    return MissingRecipeFactList;
  }
  const grounded = list.items.flatMap((fact) => {
    if (fact.state === "unresolved") {
      return [];
    }
    const groundedFact = groundedStringEvidence(fact, items);
    return groundedFact === null
      ? []
      : [trustedSupportedRecipeFact(groundedFact.value, groundedFact.item)];
  });
  const unique = grounded.filter(
    (fact, index) =>
      grounded.findIndex((candidate) => candidate.value === fact.value) ===
      index
  );
  const [first, ...rest] = unique;
  return first === undefined
    ? MissingRecipeFactList
    : { items: [first, ...rest] as const, state: "supported" as const };
};

const trustedEvidenceFact = (
  items: readonly RecipeEvidenceItem[],
  kind: "creator" | "source_url"
) => {
  const evidence = items.find((item) => item.kind === kind);
  return evidence === undefined
    ? MissingRecipeFact
    : trustedSupportedRecipeFact(evidence.value, evidence);
};

const deriveTrustedRecipeSemantics = (
  candidate: RecipeExtractionSemantics,
  items: readonly RecipeEvidenceItem[]
): RecipeExtractionSemantics => {
  const semantics = {
    author: trustedEvidenceFact(items, "creator"),
    category: groundRecipeStringFact(candidate.category, items),
    cookTimeMinutes: groundRecipeNumberFact(
      candidate.cookTimeMinutes,
      items,
      exactTimeEvidence
    ),
    cuisine: groundRecipeStringFact(candidate.cuisine, items),
    description: groundRecipeStringFact(candidate.description, items),
    ingredientLines: groundRecipeFactList(candidate.ingredientLines, items),
    instructions: groundRecipeFactList(candidate.instructions, items),
    name: groundRecipeStringFact(candidate.name, items),
    nutrition: groundRecipeStringFact(candidate.nutrition, items),
    prepTimeMinutes: groundRecipeNumberFact(
      candidate.prepTimeMinutes,
      items,
      exactTimeEvidence
    ),
    sourceUrl: trustedEvidenceFact(items, "source_url"),
    supportedClaims: groundRecipeFactList(candidate.supportedClaims, items),
    temperatureCelsius: groundRecipeNumberFact(
      candidate.temperatureCelsius,
      items,
      exactTemperatureEvidence
    ),
    tools: groundRecipeFactList(candidate.tools, items),
    totalTimeMinutes: groundRecipeNumberFact(
      candidate.totalTimeMinutes,
      items,
      exactTimeEvidence
    ),
    yield: groundRecipeStringFact(candidate.yield, items),
  };
  const unresolvedFields = [
    ...RecipeUnresolvedFieldBySemanticKey.entries(),
  ].flatMap(([key, field]) =>
    semantics[key as keyof typeof semantics].state === "unresolved"
      ? [field]
      : []
  );
  return {
    ...semantics,
    unresolvedFields: [
      ...unresolvedFields,
      "ingredient_quantities",
      "ingredient_units",
    ],
  };
};

const encodeBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }
  return btoa(binary);
};

const visualPrompt = (frame: VisualFrameArtifact): Prompt.RawInput => [
  {
    content: [
      {
        text:
          "Record only visible text in the provided source image. " +
          "The adapter owns the source frame identity and timing. " +
          "Do not infer ingredients, quantities, steps, or other unseen facts.",
        type: "text",
      },
      {
        data: frame.bytes,
        mediaType: frame.mimeType,
        type: "file",
      },
    ],
    role: "user",
  },
];

const adapterFailure = <Tag extends string>(
  tag: Tag,
  code: SafeProviderFailureCode
) => ({ _tag: tag, code });

const pricedTokenUsage = (
  inputTokens: number | undefined,
  outputTokens: number | undefined,
  prices: {
    readonly inputMicroUsdPerToken: number;
    readonly outputMicroUsdPerToken: number;
  }
) => {
  if (
    inputTokens === undefined ||
    outputTokens === undefined ||
    !Number.isSafeInteger(inputTokens) ||
    !Number.isSafeInteger(outputTokens) ||
    inputTokens <= 0 ||
    outputTokens <= 0
  ) {
    return { _tag: "Unknown" as const };
  }
  return {
    _tag: "Known" as const,
    actualCostMicroUsd: Math.ceil(
      inputTokens * prices.inputMicroUsdPerToken +
        outputTokens * prices.outputMicroUsdPerToken
    ),
  };
};

const workersAiGatewayOptions = (gatewayId: string) =>
  ({
    gateway: {
      collectLog: false,
      id: gatewayId,
      skipCache: true,
    },
    returnRawResponse: true,
  }) as const;

type WorkersAiBinding = Effect.Success<QueryGatewayClient["raw"]>;

const runWorkersAi = (
  ai: WorkersAiBinding,
  model: string,
  body: unknown,
  gatewayId: string
): Promise<Response> =>
  ai.run(
    model as never,
    body as never,
    workersAiGatewayOptions(gatewayId) as never
  ) as Promise<Response>;

const isUnknownRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

type RawToolCallAuthority =
  | { readonly _tag: "Absent" }
  | {
      readonly _tag: "Call";
      readonly arguments: unknown;
      readonly call: Record<string, unknown>;
      readonly name: string;
    }
  | { readonly _tag: "Invalid" };

type RawToolCall = Extract<RawToolCallAuthority, { readonly _tag: "Call" }>;

const comparableToolArguments = (value: unknown): unknown => {
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
};

const decodeFlatRawToolCall = (
  value: Record<string, unknown>
): RawToolCallAuthority => {
  const { arguments: toolArguments, id, name, type } = value;
  if (typeof name !== "string" || name.length === 0) {
    return { _tag: "Invalid" };
  }
  const hasArguments = Object.hasOwn(value, "arguments");
  return {
    _tag: "Call",
    arguments: toolArguments,
    call: {
      ...(typeof id === "string" ? { id } : {}),
      ...(typeof type === "string" ? { type } : {}),
      ...(hasArguments ? { arguments: toolArguments } : {}),
      name,
    },
    name,
  };
};

const decodeNestedRawToolCall = (
  value: Record<string, unknown>,
  functionValue: Record<string, unknown>
): RawToolCallAuthority => {
  const { arguments: flatArguments, id, name: flatName, type } = value;
  const hasFlatName = Object.hasOwn(value, "name");
  const hasFlatArguments = Object.hasOwn(value, "arguments");
  const { arguments: functionArguments, name: functionName } = functionValue;
  if (typeof functionName !== "string" || functionName.length === 0) {
    return { _tag: "Invalid" };
  }
  if (
    hasFlatName &&
    (typeof flatName !== "string" ||
      flatName.length === 0 ||
      flatName !== functionName)
  ) {
    return { _tag: "Invalid" };
  }

  const hasFunctionArguments = Object.hasOwn(functionValue, "arguments");
  if (
    hasFlatArguments &&
    hasFunctionArguments &&
    !structurallyEqualJson(
      comparableToolArguments(flatArguments),
      comparableToolArguments(functionArguments)
    )
  ) {
    return { _tag: "Invalid" };
  }
  const toolArguments = hasFunctionArguments
    ? functionArguments
    : flatArguments;

  return {
    _tag: "Call",
    arguments: toolArguments,
    call: {
      ...(typeof id === "string" ? { id } : {}),
      ...(typeof type === "string" ? { type } : {}),
      function: {
        ...(hasFunctionArguments || hasFlatArguments
          ? { arguments: toolArguments }
          : {}),
        name: functionName,
      },
    },
    name: functionName,
  };
};

const decodeRawToolCall = (value: unknown): RawToolCallAuthority => {
  if (!isUnknownRecord(value)) {
    return { _tag: "Invalid" };
  }
  const { function: functionValue } = value;
  if (functionValue === undefined || functionValue === null) {
    return decodeFlatRawToolCall(value);
  }
  return isUnknownRecord(functionValue)
    ? decodeNestedRawToolCall(value, functionValue)
    : { _tag: "Invalid" };
};

const decodeRawToolCalls = (value: unknown): RawToolCallAuthority => {
  if (value === undefined || value === null) {
    return { _tag: "Absent" };
  }
  if (!Array.isArray(value)) {
    return { _tag: "Invalid" };
  }
  if (value.length === 0) {
    return { _tag: "Absent" };
  }
  if (value.length !== 1) {
    return { _tag: "Invalid" };
  }
  return decodeRawToolCall(value[0]);
};

const sameRawToolAuthority = (left: RawToolCall, right: RawToolCall): boolean =>
  left.name === right.name &&
  structurallyEqualJson(
    comparableToolArguments(left.arguments),
    comparableToolArguments(right.arguments)
  );

const RecipeSemanticsKeys = new Set(
  Object.keys(RecipeExtractionSemantics.fields)
);
const RecipeTransportAuthorityKeys = new Set([
  "arguments",
  "choices",
  "parameters",
  "response",
  "tool_calls",
]);
const RecipeTransportRootKeys = new Set([
  "arguments",
  "name",
  "parameters",
  "usage",
]);
const RecipeNestedAuthorityKeys = new Set([
  ...RecipeTransportAuthorityKeys,
  ...RecipeTransportRootKeys,
]);
const RecipeEvidenceCitationKeys = new Set([
  "confidence",
  "evidenceId",
  "origin",
]);
const RecipeSupportedFactKeys = new Set([
  "citations",
  "origin",
  "state",
  "value",
]);
const RecipeUnresolvedFactKeys = new Set([
  "citations",
  "origin",
  "reason",
  "state",
]);
const RecipeKnownFactKeys = new Set([
  ...RecipeSupportedFactKeys,
  ...RecipeUnresolvedFactKeys,
]);
const RecipeSupportedFactListKeys = new Set(["items", "state"]);
const RecipeUnresolvedFactListKeys = new Set(["items", "reason", "state"]);
const RecipeKnownFactListKeys = new Set([
  ...RecipeSupportedFactListKeys,
  ...RecipeUnresolvedFactListKeys,
]);
const RecipeFactFieldKinds = {
  author: "string",
  category: "string",
  cookTimeMinutes: "number",
  cuisine: "string",
  description: "string",
  name: "string",
  nutrition: "string",
  prepTimeMinutes: "number",
  sourceUrl: "string",
  temperatureCelsius: "number",
  totalTimeMinutes: "number",
  yield: "string",
} as const;
const RecipeFactListFieldKeys = new Set([
  "ingredientLines",
  "instructions",
  "supportedClaims",
  "tools",
]);
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
const decodeRecipeTransportUsage = Schema.decodeUnknownOption(
  RecipeTransportUsage,
  { onExcessProperty: "error" }
);

class ProviderNormalizationRejectionError extends Error {
  constructor(decodeReason: ProviderNormalizationRecipeDecodeReason) {
    super(`${ProviderNormalizationInvalidMessage}:${decodeReason}`);
    this.name = "ProviderNormalizationRejectionError";
  }
}

const rejectRecipeTransportRoot = (
  decodeReason: ProviderNormalizationRecipeDecodeReason
): never => {
  throw new ProviderNormalizationRejectionError(decodeReason);
};

const decodeRecipeSemantics = Schema.decodeUnknownResult(
  RecipeExtractionSemantics,
  {
    onExcessProperty: "error",
  }
);

const decodeRecipeProviderToolArguments = Schema.decodeUnknownResult(
  RecipeProviderToolArguments,
  { onExcessProperty: "error" }
);

const decodeRecipeProviderSelection = (
  value: unknown
): ReturnType<typeof decodeRecipeSemantics> => {
  const decoded = decodeRecipeProviderToolArguments(value);
  return decoded._tag === "Success"
    ? decodeRecipeSemantics(projectRecipeProviderToolArguments(decoded.success))
    : decodeRecipeSemantics(value);
};

const isSchemaValidRecipeSemantics = (value: unknown): boolean =>
  decodeRecipeSemantics(value)._tag === "Success";

const RecipeSemanticsSchemaMismatchPriority = {
  missing_required_field: 1,
  unexpected_property: 2,
  wrong_type_or_constraint: 0,
} as const;
type RecipeSemanticsSchemaMismatch =
  keyof typeof RecipeSemanticsSchemaMismatchPriority;

const higherPriorityRecipeSemanticsSchemaMismatch = (
  left: RecipeSemanticsSchemaMismatch,
  right: RecipeSemanticsSchemaMismatch
): RecipeSemanticsSchemaMismatch =>
  RecipeSemanticsSchemaMismatchPriority[left] >=
  RecipeSemanticsSchemaMismatchPriority[right]
    ? left
    : right;

const classifyRecipeSemanticsSchemaMismatch = (
  issue: SchemaIssue.Issue
): RecipeSemanticsSchemaMismatch => {
  switch (issue._tag) {
    case "MissingKey": {
      return "missing_required_field";
    }
    case "UnexpectedKey": {
      return "unexpected_property";
    }
    case "Encoding":
    case "Filter":
    case "Pointer": {
      return classifyRecipeSemanticsSchemaMismatch(issue.issue);
    }
    case "AnyOf":
    case "Composite": {
      let mismatch: RecipeSemanticsSchemaMismatch = "wrong_type_or_constraint";
      for (const nestedIssue of issue.issues) {
        mismatch = higherPriorityRecipeSemanticsSchemaMismatch(
          mismatch,
          classifyRecipeSemanticsSchemaMismatch(nestedIssue)
        );
      }
      return mismatch;
    }
    default: {
      return "wrong_type_or_constraint";
    }
  }
};

const recipeSemanticsDecodeReason = (
  mismatch: RecipeSemanticsSchemaMismatch
): ProviderNormalizationRecipeDecodeReason =>
  `provider_normalization_recipe_semantics_${mismatch}`;

const projectRecipeSemantics = (
  value: Readonly<Record<string, unknown>>
): Record<string, unknown> => {
  const projection: Record<string, unknown> = {};
  for (const key of RecipeSemanticsKeys) {
    if (Object.hasOwn(value, key)) {
      projection[key] = value[key];
    }
  }
  return projection;
};

const projectKnownRecipeNode = (
  value: Readonly<Record<string, unknown>>,
  allowedKeys: ReadonlySet<string>
): Record<string, unknown> => {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key) && RecipeNestedAuthorityKeys.has(key)) {
      return rejectRecipeTransportRoot(
        "provider_normalization_recipe_authority_conflict"
      );
    }
  }
  const projection: Record<string, unknown> = {};
  for (const key of allowedKeys) {
    if (Object.hasOwn(value, key)) {
      projection[key] = value[key];
    }
  }
  return projection;
};

const assertNoRecipeNestedAuthority = (value: unknown): void => {
  if (Array.isArray(value)) {
    for (const item of value) {
      assertNoRecipeNestedAuthority(item);
    }
    return;
  }
  if (!isUnknownRecord(value)) {
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (RecipeNestedAuthorityKeys.has(key)) {
      rejectRecipeTransportRoot(
        "provider_normalization_recipe_authority_conflict"
      );
    }
    assertNoRecipeNestedAuthority(nested);
  }
};

const canonicalizeRecipeCitation = (value: unknown): unknown =>
  isUnknownRecord(value)
    ? projectKnownRecipeNode(value, RecipeEvidenceCitationKeys)
    : value;

const canonicalizeRecipeCitations = (value: unknown): unknown =>
  Array.isArray(value) ? value.map(canonicalizeRecipeCitation) : value;

const canonicalizeRecipeFact = (value: unknown): unknown => {
  if (!isUnknownRecord(value)) {
    return value;
  }
  let allowedKeys: ReadonlySet<string> | undefined;
  if (value["state"] === "supported") {
    allowedKeys = RecipeSupportedFactKeys;
  } else if (value["state"] === "unresolved") {
    allowedKeys = RecipeUnresolvedFactKeys;
  }
  if (allowedKeys === undefined) {
    if (Object.hasOwn(value, "state")) {
      projectKnownRecipeNode(value, RecipeKnownFactKeys);
      return rejectRecipeTransportRoot(
        "provider_normalization_recipe_semantics_wrong_type_or_constraint"
      );
    }
    return value;
  }
  if (
    Object.keys(value).some(
      (key) => RecipeKnownFactKeys.has(key) && !allowedKeys.has(key)
    )
  ) {
    return rejectRecipeTransportRoot(
      "provider_normalization_recipe_semantics_wrong_type_or_constraint"
    );
  }
  const projection = projectKnownRecipeNode(value, allowedKeys);
  if (Object.hasOwn(projection, "citations")) {
    projection["citations"] = canonicalizeRecipeCitations(
      projection["citations"]
    );
  }
  return projection;
};

const canonicalizeRecipeFactList = (value: unknown): unknown => {
  if (!isUnknownRecord(value)) {
    return value;
  }
  let allowedKeys: ReadonlySet<string> | undefined;
  if (value["state"] === "supported") {
    allowedKeys = RecipeSupportedFactListKeys;
  } else if (value["state"] === "unresolved") {
    allowedKeys = RecipeUnresolvedFactListKeys;
  }
  if (allowedKeys === undefined) {
    if (Object.hasOwn(value, "state")) {
      projectKnownRecipeNode(value, RecipeKnownFactListKeys);
      return rejectRecipeTransportRoot(
        "provider_normalization_recipe_semantics_wrong_type_or_constraint"
      );
    }
    return value;
  }
  if (
    Object.keys(value).some(
      (key) => RecipeKnownFactListKeys.has(key) && !allowedKeys.has(key)
    )
  ) {
    return rejectRecipeTransportRoot(
      "provider_normalization_recipe_semantics_wrong_type_or_constraint"
    );
  }
  const projection = projectKnownRecipeNode(value, allowedKeys);
  if (value["state"] === "supported" && Array.isArray(projection["items"])) {
    projection["items"] = projection["items"].map(canonicalizeRecipeFact);
  }
  return projection;
};

interface CanonicalizedRecipeNode {
  readonly repaired: boolean;
  readonly value: unknown;
}

const isTrimmedNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.trim() === value;

const isSupportedRecipeOrigin = (value: unknown): boolean =>
  value === "creator_provided" || value === "inferred" || value === "observed";

const isValidRecipeCitationList = (value: unknown): boolean =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every(Schema.is(RecipeEvidenceCitation));

const isValidRecipeFactValue = (
  value: unknown,
  kind: "number" | "string"
): value is number | string =>
  kind === "string"
    ? isTrimmedNonEmptyString(value) && value.length <= 4096
    : Number.isSafeInteger(value) && Number(value) >= 0;

const provisionalProviderSelection = (value: number | string) => ({
  citations: [
    {
      confidence: 0,
      evidenceId: "adapter-provider-selection",
      origin: "observed" as const,
    },
  ] as const,
  origin: "inferred" as const,
  state: "supported" as const,
  value,
});

const canonicalizeRecipeFactWithMissingRepair = (
  value: unknown,
  kind: "number" | "string"
): CanonicalizedRecipeNode => {
  assertNoRecipeNestedAuthority(value);
  const canonical = canonicalizeRecipeFact(value);
  if (!isUnknownRecord(canonical)) {
    return { repaired: true, value: MissingRecipeFact };
  }

  if (canonical["state"] === "supported") {
    const requiredKeys = ["citations", "origin", "value"] as const;
    const hasMissingKey = requiredKeys.some(
      (key) => !Object.hasOwn(canonical, key)
    );
    const presentMembersAreValid =
      (!Object.hasOwn(canonical, "citations") ||
        isValidRecipeCitationList(canonical["citations"])) &&
      (!Object.hasOwn(canonical, "origin") ||
        isSupportedRecipeOrigin(canonical["origin"])) &&
      (!Object.hasOwn(canonical, "value") ||
        isValidRecipeFactValue(canonical["value"], kind));
    if (!hasMissingKey && presentMembersAreValid) {
      return { repaired: false, value: canonical };
    }
    return isValidRecipeFactValue(canonical["value"], kind)
      ? {
          repaired: true,
          value: provisionalProviderSelection(canonical["value"]),
        }
      : { repaired: true, value: MissingRecipeFact };
  }

  if (canonical["state"] === "unresolved") {
    const requiredKeys = ["citations", "origin", "reason"] as const;
    const hasMissingKey = requiredKeys.some(
      (key) => !Object.hasOwn(canonical, key)
    );
    const presentMembersAreValid =
      (!Object.hasOwn(canonical, "citations") ||
        (Array.isArray(canonical["citations"]) &&
          canonical["citations"].length === 0)) &&
      (!Object.hasOwn(canonical, "origin") ||
        canonical["origin"] === "unresolved") &&
      (!Object.hasOwn(canonical, "reason") ||
        isTrimmedNonEmptyString(canonical["reason"]));
    return hasMissingKey || !presentMembersAreValid
      ? { repaired: true, value: MissingRecipeFact }
      : { repaired: false, value: canonical };
  }

  return { repaired: true, value: MissingRecipeFact };
};

const canonicalizeRecipeFactListWithMissingRepair = (
  value: unknown
): CanonicalizedRecipeNode => {
  assertNoRecipeNestedAuthority(value);
  const canonical = canonicalizeRecipeFactList(value);
  if (!isUnknownRecord(canonical)) {
    return { repaired: true, value: MissingRecipeFactList };
  }

  let repairedItem = false;
  if (canonical["state"] === "supported" && Array.isArray(canonical["items"])) {
    canonical["items"] = canonical["items"].map((item) => {
      const result = canonicalizeRecipeFactWithMissingRepair(item, "string");
      repairedItem ||= result.repaired;
      return result.value;
    });
  }

  if (canonical["state"] === "supported") {
    const itemsAreValid =
      Array.isArray(canonical["items"]) &&
      canonical["items"].length > 0 &&
      canonical["items"].length <= 256;
    return itemsAreValid
      ? { repaired: repairedItem, value: canonical }
      : { repaired: true, value: MissingRecipeFactList };
  }

  if (canonical["state"] === "unresolved") {
    const hasMissingKey = ["items", "reason"].some(
      (key) => !Object.hasOwn(canonical, key)
    );
    const presentMembersAreValid =
      (!Object.hasOwn(canonical, "items") ||
        (Array.isArray(canonical["items"]) &&
          canonical["items"].length === 0)) &&
      (!Object.hasOwn(canonical, "reason") ||
        isTrimmedNonEmptyString(canonical["reason"]));
    return hasMissingKey || !presentMembersAreValid
      ? { repaired: true, value: MissingRecipeFactList }
      : { repaired: false, value: canonical };
  }

  return { repaired: true, value: MissingRecipeFactList };
};

const isRecipeNodeUnresolved = (value: unknown): boolean =>
  isUnknownRecord(value) &&
  (value["state"] === "unresolved" ||
    (value["state"] === "supported" &&
      Array.isArray(value["items"]) &&
      value["items"].some(
        (item) => isUnknownRecord(item) && item["state"] === "unresolved"
      )));

const isValidUnresolvedFields = (
  value: unknown
): value is RecipeUnresolvedField[] =>
  Array.isArray(value) &&
  value.length <= 16 &&
  value.every(Schema.is(RecipeUnresolvedField));

const canonicalizeKnownRecipeSemanticsNodes = (
  value: Readonly<Record<string, unknown>>
): Record<string, unknown> => {
  const projection = { ...value };
  const repairedFields = new Set<RecipeUnresolvedField>();
  for (const [key, kind] of Object.entries(RecipeFactFieldKinds)) {
    const result = Object.hasOwn(projection, key)
      ? canonicalizeRecipeFactWithMissingRepair(projection[key], kind)
      : { repaired: true, value: MissingRecipeFact };
    projection[key] = result.value;
    const unresolvedField = RecipeUnresolvedFieldBySemanticKey.get(key);
    if (result.repaired && unresolvedField !== undefined) {
      repairedFields.add(unresolvedField);
    }
  }
  for (const key of RecipeFactListFieldKeys) {
    const result = Object.hasOwn(projection, key)
      ? canonicalizeRecipeFactListWithMissingRepair(projection[key])
      : { repaired: true, value: MissingRecipeFactList };
    projection[key] = result.value;
    const unresolvedField = RecipeUnresolvedFieldBySemanticKey.get(key);
    if (result.repaired && unresolvedField !== undefined) {
      repairedFields.add(unresolvedField);
    }
  }

  const { unresolvedFields } = projection;
  assertNoRecipeNestedAuthority(unresolvedFields);
  projection["unresolvedFields"] = isValidUnresolvedFields(unresolvedFields)
    ? [...new Set([...unresolvedFields, ...repairedFields])]
    : [...RecipeUnresolvedFieldBySemanticKey.entries()].flatMap(
        ([key, unresolvedField]) =>
          isRecipeNodeUnresolved(projection[key]) ? [unresolvedField] : []
      );
  return projection;
};

const canonicalizeRecipeSemantics = (
  value: Readonly<Record<string, unknown>>
): Record<string, unknown> =>
  canonicalizeKnownRecipeSemanticsNodes(projectRecipeSemantics(value));

const decodeCanonicalRecipeSemantics = (
  value: unknown
): ReturnType<typeof decodeRecipeSemantics> => {
  const decoded = decodeRecipeSemantics(value);
  if (decoded._tag === "Success" || !isUnknownRecord(value)) {
    return decoded;
  }
  return decodeRecipeSemantics(canonicalizeRecipeSemantics(value));
};

const decodeCanonicalNestedRecipeSemantics = (
  value: unknown
): ReturnType<typeof decodeRecipeSemantics> => {
  const decoded = decodeRecipeProviderSelection(value);
  if (decoded._tag === "Success" || !isUnknownRecord(value)) {
    return decoded;
  }
  return decodeRecipeSemantics(canonicalizeKnownRecipeSemanticsNodes(value));
};

const canonicalizeRecipeTransportUsage = (value: unknown): unknown => {
  const usage = Option.getOrUndefined(decodeRecipeTransportUsage(value));
  const expectedTotalTokens =
    usage === undefined
      ? undefined
      : usage.prompt_tokens + usage.completion_tokens;
  if (
    usage === undefined ||
    !Number.isSafeInteger(expectedTotalTokens) ||
    usage.total_tokens !== expectedTotalTokens
  ) {
    return rejectRecipeTransportRoot(
      "provider_normalization_recipe_metadata_invalid"
    );
  }
  return {
    completion_tokens: usage.completion_tokens,
    prompt_tokens: usage.prompt_tokens,
    ...(usage.prompt_tokens_details === undefined
      ? {}
      : {
          prompt_tokens_details: {
            cached_tokens: usage.prompt_tokens_details.cached_tokens,
          },
        }),
  };
};

const canonicalizeUnwrappedRecipeSemantics = (
  value: Record<string, unknown>,
  keys: readonly string[]
): unknown => {
  if (keys.some((key) => RecipeTransportAuthorityKeys.has(key))) {
    return rejectRecipeTransportRoot(
      "provider_normalization_recipe_authority_conflict"
    );
  }
  const hasUsage = Object.hasOwn(value, "usage");
  const { usage, ...semantics } = value;
  const decodedSemantics = decodeRecipeSemantics(semantics);
  if (decodedSemantics._tag === "Success") {
    return {
      response: decodedSemantics.success,
      ...(hasUsage ? { usage: canonicalizeRecipeTransportUsage(usage) } : {}),
    };
  }
  const projectedSemantics = decodeCanonicalRecipeSemantics(semantics);
  if (projectedSemantics._tag === "Failure") {
    return rejectRecipeTransportRoot(
      recipeSemanticsDecodeReason(
        classifyRecipeSemanticsSchemaMismatch(projectedSemantics.failure.issue)
      )
    );
  }
  return {
    response: projectedSemantics.success,
    ...(hasUsage ? { usage: canonicalizeRecipeTransportUsage(usage) } : {}),
  };
};

const canonicalizeRecipeTransportRoot = (value: unknown): unknown => {
  if (!isUnknownRecord(value)) {
    return value;
  }
  if (isSchemaValidRecipeSemantics(value)) {
    return { response: value };
  }
  const providerSelection = decodeRecipeProviderToolArguments(value);
  if (providerSelection._tag === "Success") {
    return {
      response: projectRecipeProviderToolArguments(providerSelection.success),
    };
  }

  const keys = Object.keys(value);
  const hasArguments = Object.hasOwn(value, "arguments");
  const hasParameters = Object.hasOwn(value, "parameters");
  const hasCallSignal =
    hasArguments || hasParameters || value["name"] === "record_recipe";
  const hasSemanticsSignal = keys.some((key) => RecipeSemanticsKeys.has(key));
  if (hasCallSignal) {
    if (value["name"] !== "record_recipe") {
      return rejectRecipeTransportRoot(
        "provider_normalization_recipe_tool_name_invalid"
      );
    }
    if (!hasArguments && !hasParameters) {
      return rejectRecipeTransportRoot(
        "provider_normalization_recipe_arguments_missing"
      );
    }
    if (hasArguments && hasParameters) {
      return rejectRecipeTransportRoot(
        "provider_normalization_recipe_arguments_ambiguous"
      );
    }
    const unsupportedKeys = keys.filter(
      (key) => !RecipeTransportRootKeys.has(key)
    );
    if (unsupportedKeys.length > 0) {
      return rejectRecipeTransportRoot(
        unsupportedKeys.some((key) => RecipeTransportAuthorityKeys.has(key))
          ? "provider_normalization_recipe_authority_conflict"
          : "provider_normalization_recipe_metadata_invalid"
      );
    }
    const hasUsage = Object.hasOwn(value, "usage");
    const argumentsValue = hasArguments
      ? value["arguments"]
      : value["parameters"];
    const decodedArguments =
      decodeCanonicalNestedRecipeSemantics(argumentsValue);
    if (decodedArguments._tag === "Failure") {
      return rejectRecipeTransportRoot(
        "provider_normalization_recipe_arguments_schema_invalid"
      );
    }
    return {
      response: {
        ...(hasArguments
          ? { arguments: decodedArguments.success }
          : { parameters: decodedArguments.success }),
        name: "record_recipe",
      },
      ...(hasUsage
        ? { usage: canonicalizeRecipeTransportUsage(value["usage"]) }
        : {}),
    };
  }
  if (hasSemanticsSignal) {
    return canonicalizeUnwrappedRecipeSemantics(value, keys);
  }
  return value;
};

const canonicalizeProviderTransportRoot = (
  value: unknown,
  providerStage: "recipe" | "visual"
): unknown =>
  providerStage === "recipe" ? canonicalizeRecipeTransportRoot(value) : value;

const canonicalizeRawRecipeToolCall = (
  call: RawToolCall,
  providerStage: "recipe" | "visual"
): RawToolCall => {
  if (providerStage !== "recipe" || call.name !== "record_recipe") {
    return call;
  }
  const decodedArguments = decodeCanonicalNestedRecipeSemantics(
    comparableToolArguments(call.arguments)
  );
  if (decodedArguments._tag === "Failure") {
    return call;
  }
  const canonicalArguments =
    typeof call.arguments === "string"
      ? JSON.stringify(decodedArguments.success)
      : decodedArguments.success;
  const functionValue = call.call["function"];
  return {
    ...call,
    arguments: canonicalArguments,
    call: isUnknownRecord(functionValue)
      ? {
          ...call.call,
          function: {
            ...functionValue,
            arguments: canonicalArguments,
          },
        }
      : {
          ...call.call,
          arguments: canonicalArguments,
        },
  };
};

const normalizeRawToolShape = (
  value: unknown,
  providerStage: "recipe" | "visual"
): unknown => {
  if (!isUnknownRecord(value)) {
    return value;
  }

  const { choices, tool_calls: nativeToolCalls } = value;
  const nativeAuthority = decodeRawToolCalls(nativeToolCalls);
  if (nativeAuthority._tag === "Invalid") {
    throw new Error(ProviderNormalizationInvalidMessage);
  }

  let openAiAuthority: RawToolCallAuthority = { _tag: "Absent" };
  let openAiChoice:
    | {
        readonly choice: Record<string, unknown>;
        readonly message: Record<string, unknown>;
      }
    | undefined;
  if (choices !== undefined && choices !== null) {
    if (!Array.isArray(choices) || choices.length > 1) {
      throw new Error(ProviderNormalizationInvalidMessage);
    }
    const [choice] = choices;
    if (choice !== undefined) {
      if (!isUnknownRecord(choice)) {
        throw new Error(ProviderNormalizationInvalidMessage);
      }
      const { message } = choice;
      if (!isUnknownRecord(message)) {
        throw new Error(ProviderNormalizationInvalidMessage);
      }
      openAiChoice = { choice, message };
      openAiAuthority = decodeRawToolCalls(message["tool_calls"]);
      if (openAiAuthority._tag === "Invalid") {
        throw new Error(ProviderNormalizationInvalidMessage);
      }
    }
  }

  if (
    openAiAuthority._tag === "Call" &&
    nativeAuthority._tag === "Call" &&
    !sameRawToolAuthority(openAiAuthority, nativeAuthority)
  ) {
    throw new Error(ProviderNormalizationInvalidMessage);
  }

  if (openAiAuthority._tag === "Call" && openAiChoice !== undefined) {
    const canonicalCall = canonicalizeRawRecipeToolCall(
      openAiAuthority,
      providerStage
    );
    const { tool_calls: _nativeToolCalls, ...withoutNativeToolCalls } = value;
    return {
      ...withoutNativeToolCalls,
      choices: [
        {
          ...openAiChoice.choice,
          message: {
            ...openAiChoice.message,
            tool_calls: [canonicalCall.call],
          },
        },
      ],
    };
  }

  if (nativeAuthority._tag === "Call") {
    const canonicalCall = canonicalizeRawRecipeToolCall(
      nativeAuthority,
      providerStage
    );
    const canonicalNative = {
      ...value,
      tool_calls: [canonicalCall.call],
    };
    if (openAiChoice === undefined) {
      return Array.isArray(choices) && choices.length === 0
        ? Object.fromEntries(
            Object.entries(canonicalNative).filter(([key]) => key !== "choices")
          )
        : canonicalNative;
    }
    const { tool_calls: _nativeToolCalls, ...withoutNativeToolCalls } =
      canonicalNative;
    return {
      ...withoutNativeToolCalls,
      choices: [
        {
          ...openAiChoice.choice,
          message: {
            ...openAiChoice.message,
            tool_calls: [canonicalCall.call],
          },
        },
      ],
    };
  }

  return value;
};

const withProviderNormalizationBoundary = (
  response: Response,
  providerStage: "recipe" | "visual"
): Response => {
  const parseJson = response.json.bind(response);
  return new Proxy(response, {
    get: (target, property) => {
      if (property === "json") {
        return async (): Promise<unknown> => {
          let raw: unknown;
          try {
            raw = await parseJson();
          } catch {
            // The raw body is untrusted and must never cross this boundary.
            // Preserve only enough internal authority for the optional visual
            // stage to degrade without weakening structural tool validation.
            throw new Error(ProviderNormalizationBodyInvalidMessage);
          }
          try {
            return normalizeRawToolShape(
              canonicalizeProviderTransportRoot(raw, providerStage),
              providerStage
            );
          } catch (error) {
            // Provider payloads and parser details must not cross the
            // observability boundary. Alchemy preserves this closed
            // description inside its typed AiError.UnknownError.
            if (error instanceof ProviderNormalizationRejectionError) {
              throw error;
            }
            // eslint-disable-next-line preserve-caught-error -- Provider payloads and parser details must not cross this privacy boundary, including as Error.cause.
            throw new Error(ProviderNormalizationInvalidMessage);
          }
        };
      }
      return Reflect.get(target, property, target);
    },
  });
};

/**
 * Keep the installed Alchemy LanguageModel composition while dispatching
 * through the account-bound Workers AI binding. The binding cannot express
 * AI Gateway's payload-suppression header, so the proxy disables provider-side
 * gateway logging at the final SDK boundary and relies on the redacted,
 * correlation-aware Worker observability events. It never touches the
 * universal gateway binding.
 */
const noLogWorkersAiClient = (
  client: QueryGatewayClient,
  correlationId: ImportCorrelationId,
  providerStage: "recipe" | "visual",
  traceStore: ImportObservabilityTraceStoreShape | undefined
): QueryGatewayClient => ({
  ...client,
  raw: Effect.all([client.raw, client.id]).pipe(
    Effect.map(
      ([ai, gatewayId]) =>
        ({
          run: async (model: unknown, body: unknown) => {
            let response: Response;
            try {
              response = await runWorkersAi(ai, String(model), body, gatewayId);
            } catch (error) {
              if (isPilotProviderKnownZeroCostFailure(error)) {
                // Alchemy intentionally redacts the original thrown value into
                // an AiError description. Preserve only this internal,
                // payload-free authority marker so the outer budget gate can
                // settle an explicitly classified setup failure at exact zero.
                // eslint-disable-next-line preserve-caught-error -- The branded failure is intentionally reduced to a non-secret authority marker.
                throw new Error(ProviderKnownZeroSetupFailureMessage);
              }
              // eslint-disable-next-line preserve-caught-error -- Provider payloads and transport errors must not cross this privacy boundary, including as Error.cause.
              throw new Error(ProviderTransportUnavailableMessage);
            }
            await Effect.runPromise(
              emitImportObservabilityEvent(
                {
                  correlationId,
                  event: "provider.response",
                  outcome: "received",
                  providerStage,
                },
                traceStore
              )
            );
            return withProviderNormalizationBoundary(response, providerStage);
          },
        }) as WorkersAiBinding
    )
  ) as QueryGatewayClient["raw"],
});

export const makeInstalledVisualEvidenceExtractor = (input: {
  readonly client: QueryGatewayClient;
  readonly correlationId: ImportCorrelationId;
  readonly dispatch: ProviderDispatchGate;
  readonly model?: string;
}) =>
  Effect.gen(function* makeVisualAdapter() {
    const model = input.model ?? InstalledVisualModel;
    const traceStore = Option.getOrUndefined(
      yield* Effect.serviceOption(ImportObservabilityTraceStore)
    );
    const client = noLogWorkersAiClient(
      input.client,
      input.correlationId,
      "visual",
      traceStore
    );
    const service = yield* Cloudflare.AI.makeLanguageModel({
      client,
      model,
      parameters: { maxTokens: 8192, temperature: 0 },
    });
    return {
      extract: (request) =>
        request.frames.length === 0
          ? Effect.fail(
              adapterFailure(
                "VisualEvidenceExtractionFailure",
                "insufficient_evidence"
              )
            )
          : input.dispatch
              .run({
                dispatchId: request.dispatchId,
                invoke: Effect.gen(function* invokeVisualForcedTool() {
                  const frameIndex = representativeVisualFrameIndex(
                    request.frames.length
                  );
                  const frame = request.frames[frameIndex];
                  if (frame === undefined) {
                    return yield* Effect.fail("insufficient_evidence" as const);
                  }
                  const { inputTokens, outputTokens, value } =
                    yield* oneForcedToolCall(
                      service,
                      {
                        description:
                          "Record only observations of text visibly present in the supplied source image.",
                        name: "record_visual_evidence",
                        normalizeValue: projectVisualProviderSemanticsInput,
                        prompt: visualPrompt(frame),
                        // Visual evidence is optional. A provider response
                        // that cannot be normalized must not abort otherwise
                        // valid transcript processing or leave the budget
                        // poisoned. Record honest empty evidence and charge
                        // the full bounded reservation; strict forced-tool
                        // envelope and argument validation still fail closed.
                        providerNormalizationFallback: () => ({
                          observations: [],
                        }),
                        schema: VisualEvidenceProviderSemantics,
                        toolSchema: VisualEvidenceProviderToolArguments,
                      },
                      {
                        correlationId: input.correlationId,
                        providerStage: "visual",
                        traceStore,
                      }
                    );
                  const observations = value.observations.map(
                    (observation) => ({
                      confidence:
                        observation.confidence > 1
                          ? observation.confidence / 100
                          : observation.confidence,
                      frameIndex,
                      kind: "visible_text" as const,
                      regions: [
                        {
                          height: 1,
                          width: 1,
                          x: 0,
                          y: 0,
                        },
                      ] as const,
                      text: observation.text,
                      timestampMilliseconds: frame.timestampMilliseconds,
                    })
                  );
                  const meteredCost = pricedTokenUsage(
                    inputTokens,
                    outputTokens,
                    {
                      inputMicroUsdPerToken: 0.27,
                      outputMicroUsdPerToken: 0.85,
                    }
                  );
                  // A schema-valid response proves this bounded visual call
                  // completed. When the provider omits trustworthy usage,
                  // charge the reservation maximum against the safety ledger
                  // while the returned estimate remains explicitly uncertain.
                  const cost =
                    meteredCost._tag === "Known"
                      ? meteredCost
                      : {
                          _tag: "Known" as const,
                          actualCostMicroUsd: VisualMaximumCostMicroUsd,
                        };
                  return {
                    cost,
                    value: {
                      cost: {
                        certainty: "estimated" as const,
                        currency: "USD" as const,
                        estimatedMicroUsd: cost.actualCostMicroUsd,
                      },
                      model,
                      observations,
                      outcome:
                        visualEvidenceOutcomeForObservations(observations),
                      provider: ProviderName,
                      usage: {
                        inputBytes: frame.bytes.byteLength,
                        inputFrames: 1 as const,
                        modelCalls: 1 as const,
                      },
                    },
                  };
                }).pipe(
                  // eslint-disable-next-line promise/prefer-await-to-callbacks -- Effect callbacks preserve the typed error channel.
                  Effect.mapError((error) => {
                    if (isPilotProviderKnownZeroCostFailure(error)) {
                      return error;
                    }
                    return typeof error === "string"
                      ? error
                      : safeFailureCode(Cause.fail(error));
                  })
                ),
                maximumCostMicroUsd: VisualMaximumCostMicroUsd,
                providerStage: "visual",
                providerStageId: "visual-evidence",
              })
              .pipe(
                Effect.mapError(
                  // eslint-disable-next-line promise/prefer-await-to-callbacks -- Effect callbacks preserve the adapter error contract.
                  (error): VisualEvidenceExtractionFailure => {
                    const providerError =
                      isPilotProviderKnownZeroCostFailure(error) &&
                      isSafeProviderFailureCode(error.error)
                        ? error.error
                        : undefined;
                    return adapterFailure(
                      "VisualEvidenceExtractionFailure",
                      providerError ??
                        (isSafeProviderFailureCode(error)
                          ? error
                          : "outcome_unknown")
                    );
                  }
                )
              ),
    } satisfies VisualEvidenceExtractorShape;
  });

export const makeInstalledRecipeExtractor = (input: {
  readonly client: QueryGatewayClient;
  readonly correlationId: ImportCorrelationId;
  readonly dispatch: ProviderDispatchGate;
  readonly model?: string;
}) =>
  Effect.gen(function* makeRecipeAdapter() {
    const model = input.model ?? InstalledRecipeModel;
    const traceStore = Option.getOrUndefined(
      yield* Effect.serviceOption(ImportObservabilityTraceStore)
    );
    const client = noLogWorkersAiClient(
      input.client,
      input.correlationId,
      "recipe",
      traceStore
    );
    const service = yield* Cloudflare.AI.makeLanguageModel({
      client,
      model,
      parameters: { maxTokens: 16_384, temperature: 0 },
    });
    return {
      descriptor: Schema.decodeUnknownSync(RecipeExtractorDescriptor)({
        model,
        provider: ProviderName,
        version: "installed-alchemy-forced-tool-v4",
      }),
      extract: (request) =>
        input.dispatch
          .run({
            conservativeReplay: recipeConservativeReplay(request),
            dispatchId:
              request.dispatchId ??
              `recipe:${request.importId}:${request.generation}:${request.evidenceFingerprint}`,
            invoke: Effect.gen(function* extractRecipeSemantics() {
              const startedAt = yield* Clock.currentTimeMillis;
              const { inputTokens, outputTokens, value } =
                yield* oneForcedToolCall(
                  service,
                  {
                    acceptUnwrappedObject: true,
                    description:
                      "Record only provenance-backed recipe facts and unresolved fields.",
                    name: "record_recipe",
                    prompt: recipePromptText(request),
                    schema: RecipeExtractionSemantics,
                    toolSchema: RecipeProviderToolArguments,
                  },
                  {
                    correlationId: input.correlationId,
                    providerStage: "recipe",
                    traceStore,
                  }
                );
              const completedAt = yield* Clock.currentTimeMillis;
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
                  ...deriveTrustedRecipeSemantics(value, request.items),
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
              };
            }),
            maximumCostMicroUsd: RecipeMaximumCostMicroUsd,
            providerStage: "recipe",
            providerStageId: "recipe-extraction",
          })
          .pipe(
            Effect.mapError(
              // eslint-disable-next-line promise/prefer-await-to-callbacks -- Effect callbacks preserve the adapter error contract.
              (error): RecipeExtractionFailure => {
                const providerError =
                  isPilotProviderKnownZeroCostFailure(error) &&
                  isSafeProviderFailureCode(error.error)
                    ? error.error
                    : undefined;

                return adapterFailure(
                  "RecipeExtractionFailure",
                  providerError ??
                    (isSafeProviderFailureCode(error)
                      ? error
                      : "outcome_unknown")
                );
              }
            )
          ),
    } satisfies RecipeExtractorShape;
  });

const SpeechProviderNonNegativeInteger = Schema.Number.pipe(
  Schema.check(
    Schema.isFinite(),
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(0)
  )
);

const SpeechProviderSegmentMetadataInteger =
  SpeechProviderNonNegativeInteger.pipe(
    Schema.check(Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER))
  );

const SpeechProviderSegmentTokens = Schema.Array(
  SpeechProviderSegmentMetadataInteger
).pipe(Schema.check(Schema.isMaxLength(4096)));

const SpeechProviderFiniteNumber = Schema.Number.pipe(
  Schema.check(Schema.isFinite())
);

const SpeechProviderNonNegativeNumber = SpeechProviderFiniteNumber.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(0))
);

const SpeechProviderProbability = SpeechProviderFiniteNumber.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(1))
);

const SpeechProviderVtt = Schema.String.pipe(
  Schema.check(Schema.isMaxLength(2_097_152))
);

const SpeechProviderLabel = Schema.String.pipe(
  Schema.check(Schema.isTrimmed(), Schema.isNonEmpty(), Schema.isMaxLength(64))
);

const SpeechProviderSegmentText = Schema.String.pipe(
  Schema.check(Schema.isMaxLength(16_384))
);

const SpeechProviderTranscriptText = Schema.String.pipe(
  Schema.check(Schema.isMaxLength(1_048_576))
);

const LegacySpeechProviderWord = Schema.Struct({
  end: Schema.optionalKey(Schema.Union([Schema.Number, Schema.Null])),
  start: Schema.optionalKey(Schema.Union([Schema.Number, Schema.Null])),
  word: Schema.optionalKey(Schema.Union([Schema.String, Schema.Null])),
});

const GenericSpeechProviderResponse = Schema.Struct({
  text: SpeechProviderTranscriptText,
  vtt: Schema.optionalKey(Schema.Union([SpeechProviderVtt, Schema.Null])),
  word_count: Schema.optionalKey(
    Schema.Union([SpeechProviderNonNegativeInteger, Schema.Null])
  ),
  words: Schema.optionalKey(
    Schema.Union([
      Schema.Array(LegacySpeechProviderWord).pipe(
        Schema.check(Schema.isMaxLength(4096))
      ),
      Schema.Null,
    ])
  ),
});

const ModelSpecificSpeechProviderWord = Schema.Struct({
  end: Schema.optionalKey(SpeechProviderNonNegativeNumber),
  start: Schema.optionalKey(SpeechProviderNonNegativeNumber),
  word: Schema.optionalKey(SpeechProviderSegmentText),
});

const ModelSpecificSpeechProviderSegment = Schema.Struct({
  avg_logprob: Schema.optionalKey(SpeechProviderFiniteNumber),
  compression_ratio: Schema.optionalKey(SpeechProviderNonNegativeNumber),
  end: Schema.optionalKey(SpeechProviderNonNegativeNumber),
  id: Schema.optionalKey(SpeechProviderSegmentMetadataInteger),
  no_speech_prob: Schema.optionalKey(SpeechProviderProbability),
  seek: Schema.optionalKey(SpeechProviderSegmentMetadataInteger),
  start: Schema.optionalKey(SpeechProviderNonNegativeNumber),
  temperature: Schema.optionalKey(SpeechProviderNonNegativeNumber),
  text: Schema.optionalKey(SpeechProviderSegmentText),
  tokens: Schema.optionalKey(SpeechProviderSegmentTokens),
  words: Schema.optionalKey(
    Schema.Array(ModelSpecificSpeechProviderWord).pipe(
      Schema.check(Schema.isMaxLength(4096))
    )
  ),
});

const ModelSpecificSpeechProviderResponse = Schema.Struct({
  segments: Schema.optionalKey(
    Schema.Array(ModelSpecificSpeechProviderSegment).pipe(
      Schema.check(Schema.isMaxLength(4096))
    )
  ),
  text: SpeechProviderTranscriptText,
  transcription_info: Schema.optionalKey(
    Schema.Struct({
      duration: Schema.optionalKey(SpeechProviderNonNegativeNumber),
      duration_after_vad: Schema.optionalKey(SpeechProviderNonNegativeNumber),
      language: Schema.optionalKey(SpeechProviderLabel),
      language_probability: Schema.optionalKey(SpeechProviderProbability),
    })
  ),
  vtt: Schema.optionalKey(SpeechProviderVtt),
  word_count: Schema.optionalKey(SpeechProviderNonNegativeInteger),
});

const ModelSpecificSpeechResponseOptionalMetadataKeys: ReadonlySet<string> =
  new Set(["segments", "transcription_info", "vtt", "word_count"]);

const ModelSpecificSpeechTranscriptionInfoOptionalMetadataKeys: ReadonlySet<string> =
  new Set([
    "duration",
    "duration_after_vad",
    "language",
    "language_probability",
  ]);

const ModelSpecificSpeechSegmentOptionalMetadataKeys: ReadonlySet<string> =
  new Set([
    "avg_logprob",
    "compression_ratio",
    "end",
    "id",
    "no_speech_prob",
    "seek",
    "start",
    "temperature",
    "text",
    "tokens",
    "words",
  ]);

const ModelSpecificSpeechSegmentNullableMetadataKeys: ReadonlySet<string> =
  new Set([
    "avg_logprob",
    "compression_ratio",
    "end",
    "no_speech_prob",
    "start",
    "temperature",
    "text",
    "words",
  ]);

const ModelSpecificSpeechWordOptionalMetadataKeys: ReadonlySet<string> =
  new Set(["end", "start", "word"]);

const GenericSpeechProviderResponseKeys: ReadonlySet<string> = new Set([
  "text",
  "vtt",
  "word_count",
  "words",
]);

const ModelSpecificSpeechProviderResponseKeys: ReadonlySet<string> = new Set([
  "segments",
  "text",
  "transcription_info",
  "vtt",
  "word_count",
]);

const SpeechProviderResponseKeys: ReadonlySet<string> = new Set([
  ...GenericSpeechProviderResponseKeys,
  ...ModelSpecificSpeechProviderResponseKeys,
]);

const omitAllowlistedNullMetadata = (
  record: Readonly<Record<string, unknown>>,
  allowlist: ReadonlySet<string>
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(record).filter(
      ([key, value]) => value !== null || !allowlist.has(key)
    )
  );

const projectDocumentedSpeechResponse = (
  record: Readonly<Record<string, unknown>>,
  allowlist: ReadonlySet<string>
): Record<string, unknown> =>
  Object.fromEntries(
    [...allowlist]
      .filter((key) => Object.hasOwn(record, key))
      .map((key) => [key, record[key]])
  );

const normalizeModelSpecificSpeechProviderWord = (raw: unknown): unknown =>
  isUnknownRecord(raw)
    ? omitAllowlistedNullMetadata(
        projectDocumentedSpeechResponse(
          raw,
          ModelSpecificSpeechWordOptionalMetadataKeys
        ),
        ModelSpecificSpeechWordOptionalMetadataKeys
      )
    : raw;

const normalizeModelSpecificSpeechProviderSegment = (raw: unknown): unknown => {
  if (!isUnknownRecord(raw)) {
    return raw;
  }
  const normalized = omitAllowlistedNullMetadata(
    projectDocumentedSpeechResponse(
      raw,
      ModelSpecificSpeechSegmentOptionalMetadataKeys
    ),
    ModelSpecificSpeechSegmentNullableMetadataKeys
  );
  return Array.isArray(normalized["words"])
    ? {
        ...normalized,
        words: normalized["words"].map(
          normalizeModelSpecificSpeechProviderWord
        ),
      }
    : normalized;
};

const normalizeModelSpecificSpeechProviderResponse = (
  raw: Record<string, unknown>
): Record<string, unknown> => {
  const normalized = omitAllowlistedNullMetadata(
    raw,
    ModelSpecificSpeechResponseOptionalMetadataKeys
  );
  if (isUnknownRecord(normalized["transcription_info"])) {
    normalized["transcription_info"] = omitAllowlistedNullMetadata(
      projectDocumentedSpeechResponse(
        normalized["transcription_info"],
        ModelSpecificSpeechTranscriptionInfoOptionalMetadataKeys
      ),
      ModelSpecificSpeechTranscriptionInfoOptionalMetadataKeys
    );
  }
  if (Array.isArray(normalized["segments"])) {
    normalized["segments"] = normalized["segments"].map(
      normalizeModelSpecificSpeechProviderSegment
    );
  }
  return normalized;
};

const decodeGenericSpeechResponse = Schema.decodeUnknownOption(
  GenericSpeechProviderResponse,
  {
    onExcessProperty: "error",
  }
);

const decodeModelSpecificSpeechResponse = Schema.decodeUnknownOption(
  ModelSpecificSpeechProviderResponse,
  {
    onExcessProperty: "error",
  }
);

interface SpeechEnvelopeClassification {
  readonly failure: SpeechEnvelopeFailure | undefined;
  readonly family: SpeechEnvelopeFamily;
  readonly unsupportedLocation?: SpeechEnvelopeUnsupportedLocation;
  readonly unsupportedRootProperty?: SpeechEnvelopeUnsupportedRootProperty;
}

const hasUnsupportedProperty = (
  record: Readonly<Record<string, unknown>>,
  allowlist: ReadonlySet<string>
): boolean => Object.keys(record).some((key) => !allowlist.has(key));

const SpeechUnknownMetadataMaximumTraversalDepth = 64;
const SpeechUnknownMetadataMaximumTraversalNodes = 16_384;

interface SpeechUnknownMetadataTraversal {
  discoveredNodes: number;
  readonly visitedContainers: WeakSet<object>;
}

const makeSpeechUnknownMetadataTraversal =
  (): SpeechUnknownMetadataTraversal => ({
    discoveredNodes: 0,
    visitedContainers: new WeakSet<object>(),
  });

const unknownSpeechMetadataRequiresRejection = (
  values: Iterable<unknown>,
  traversal: SpeechUnknownMetadataTraversal
): boolean => {
  const pending: { readonly depth: number; readonly value: unknown }[] = [];
  const enqueue = (value: unknown, depth: number): boolean => {
    traversal.discoveredNodes += 1;
    if (
      traversal.discoveredNodes > SpeechUnknownMetadataMaximumTraversalNodes ||
      depth > SpeechUnknownMetadataMaximumTraversalDepth
    ) {
      return false;
    }
    if (typeof value === "object" && value !== null) {
      if (traversal.visitedContainers.has(value)) {
        return false;
      }
      traversal.visitedContainers.add(value);
    }
    pending.push({ depth, value });
    return true;
  };

  for (const value of values) {
    if (!enqueue(value, 0)) {
      return true;
    }
  }

  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) {
      continue;
    }
    if (isUnknownRecord(current.value)) {
      if (Object.hasOwn(current.value, "text")) {
        return true;
      }
      for (const value of Object.values(current.value)) {
        if (!enqueue(value, current.depth + 1)) {
          return true;
        }
      }
      continue;
    }
    if (Array.isArray(current.value)) {
      for (const value of current.value) {
        if (!enqueue(value, current.depth + 1)) {
          return true;
        }
      }
    }
  }

  return false;
};

const hasAmbiguousSpeechWrapper = (
  raw: Readonly<Record<string, unknown>>
): boolean =>
  Object.hasOwn(raw, "errors") ||
  Object.hasOwn(raw, "messages") ||
  Object.hasOwn(raw, "result") ||
  Object.hasOwn(raw, "success");

const unknownSpeechMetadataValues = function* unknownSpeechMetadataValues(
  raw: Readonly<Record<string, unknown>>,
  allowlist: ReadonlySet<string>
): Generator<unknown> {
  for (const key of Object.keys(raw)) {
    if (!allowlist.has(key)) {
      yield raw[key];
    }
  }
};

const unknownSpeechContainerMetadataRequiresRejection = (
  raw: Readonly<Record<string, unknown>>,
  allowlist: ReadonlySet<string>,
  traversal: SpeechUnknownMetadataTraversal
): boolean =>
  (!allowlist.has("text") && Object.hasOwn(raw, "text")) ||
  unknownSpeechMetadataRequiresRejection(
    unknownSpeechMetadataValues(raw, allowlist),
    traversal
  );

const isPresentNonNull = (
  record: Readonly<Record<string, unknown>>,
  key: string
): boolean => Object.hasOwn(record, key) && record[key] !== null;

const hasWrongRootMetadataType = (
  raw: Readonly<Record<string, unknown>>
): boolean =>
  (isPresentNonNull(raw, "vtt") && typeof raw["vtt"] !== "string") ||
  (isPresentNonNull(raw, "word_count") &&
    typeof raw["word_count"] !== "number");

const genericNestedContainersAreInvalid = (
  raw: Readonly<Record<string, unknown>>
): boolean => isPresentNonNull(raw, "words") && !Array.isArray(raw["words"]);

const modelSpecificNestedContainersAreInvalid = (
  raw: Readonly<Record<string, unknown>>
): boolean => {
  if (
    (isPresentNonNull(raw, "segments") && !Array.isArray(raw["segments"])) ||
    (isPresentNonNull(raw, "transcription_info") &&
      !isUnknownRecord(raw["transcription_info"]))
  ) {
    return true;
  }
  return (
    Array.isArray(raw["segments"]) &&
    raw["segments"].some(
      (segment) =>
        isUnknownRecord(segment) &&
        ((isPresentNonNull(segment, "tokens") &&
          !Array.isArray(segment["tokens"])) ||
          (isPresentNonNull(segment, "words") &&
            !Array.isArray(segment["words"])))
    )
  );
};

const genericNestedEntriesAreInvalid = (
  raw: Readonly<Record<string, unknown>>
): boolean =>
  Array.isArray(raw["words"]) &&
  raw["words"].some((word) => !isUnknownRecord(word));

const modelSpecificNestedEntriesAreInvalid = (
  raw: Readonly<Record<string, unknown>>
): boolean =>
  Array.isArray(raw["segments"]) &&
  raw["segments"].some(
    (segment) =>
      !isUnknownRecord(segment) ||
      (Array.isArray(segment["words"]) &&
        segment["words"].some((word) => !isUnknownRecord(word)))
  );

const hasWrongNullableNumberType = (
  record: Readonly<Record<string, unknown>>,
  key: string
): boolean => isPresentNonNull(record, key) && typeof record[key] !== "number";

const hasWrongNullableStringType = (
  record: Readonly<Record<string, unknown>>,
  key: string
): boolean => isPresentNonNull(record, key) && typeof record[key] !== "string";

const genericNestedMetadataTypesAreInvalid = (
  raw: Readonly<Record<string, unknown>>
): boolean =>
  Array.isArray(raw["words"]) &&
  raw["words"].some(
    (word) =>
      isUnknownRecord(word) &&
      (hasWrongNullableNumberType(word, "end") ||
        hasWrongNullableNumberType(word, "start") ||
        hasWrongNullableStringType(word, "word"))
  );

const modelSpecificNestedMetadataTypesAreInvalid = (
  raw: Readonly<Record<string, unknown>>
): boolean => {
  const transcriptionInfo = raw["transcription_info"];
  if (
    isUnknownRecord(transcriptionInfo) &&
    (hasWrongNullableNumberType(transcriptionInfo, "duration") ||
      hasWrongNullableNumberType(transcriptionInfo, "duration_after_vad") ||
      hasWrongNullableStringType(transcriptionInfo, "language") ||
      hasWrongNullableNumberType(transcriptionInfo, "language_probability"))
  ) {
    return true;
  }
  return (
    Array.isArray(raw["segments"]) &&
    raw["segments"].some((segment) => {
      if (!isUnknownRecord(segment)) {
        return false;
      }
      if (
        hasWrongNullableNumberType(segment, "avg_logprob") ||
        hasWrongNullableNumberType(segment, "compression_ratio") ||
        hasWrongNullableNumberType(segment, "end") ||
        hasWrongNullableNumberType(segment, "id") ||
        hasWrongNullableNumberType(segment, "no_speech_prob") ||
        hasWrongNullableNumberType(segment, "seek") ||
        hasWrongNullableNumberType(segment, "start") ||
        hasWrongNullableNumberType(segment, "temperature") ||
        hasWrongNullableStringType(segment, "text")
      ) {
        return true;
      }
      if (
        Array.isArray(segment["tokens"]) &&
        segment["tokens"].some((token) => typeof token !== "number")
      ) {
        return true;
      }
      return (
        Array.isArray(segment["words"]) &&
        segment["words"].some(
          (word) =>
            isUnknownRecord(word) &&
            (hasWrongNullableNumberType(word, "end") ||
              hasWrongNullableNumberType(word, "start") ||
              hasWrongNullableStringType(word, "word"))
        )
      );
    })
  );
};

const genericUnsupportedPropertyLocation = (
  raw: Readonly<Record<string, unknown>>
): SpeechEnvelopeUnsupportedLocation | undefined =>
  Array.isArray(raw["words"]) &&
  raw["words"].some(
    (word) =>
      isUnknownRecord(word) &&
      hasUnsupportedProperty(word, ModelSpecificSpeechWordOptionalMetadataKeys)
  )
    ? "word"
    : undefined;

const modelSpecificUnsupportedPropertyLocation = (
  raw: Readonly<Record<string, unknown>>,
  traversal: SpeechUnknownMetadataTraversal
): SpeechEnvelopeUnsupportedLocation | undefined => {
  const transcriptionInfo = raw["transcription_info"];
  if (
    isUnknownRecord(transcriptionInfo) &&
    unknownSpeechContainerMetadataRequiresRejection(
      transcriptionInfo,
      ModelSpecificSpeechTranscriptionInfoOptionalMetadataKeys,
      traversal
    )
  ) {
    return "transcription_info";
  }
  if (!Array.isArray(raw["segments"])) {
    return undefined;
  }
  for (const segment of raw["segments"]) {
    if (!isUnknownRecord(segment)) {
      continue;
    }
    if (
      unknownSpeechContainerMetadataRequiresRejection(
        segment,
        ModelSpecificSpeechSegmentOptionalMetadataKeys,
        traversal
      )
    ) {
      return "segment";
    }
  }
  for (const segment of raw["segments"]) {
    if (!isUnknownRecord(segment)) {
      continue;
    }
    if (!Array.isArray(segment["words"])) {
      continue;
    }
    for (const word of segment["words"]) {
      if (
        isUnknownRecord(word) &&
        unknownSpeechContainerMetadataRequiresRejection(
          word,
          ModelSpecificSpeechWordOptionalMetadataKeys,
          traversal
        )
      ) {
        return "word";
      }
    }
  }
  return undefined;
};

const classifySpeechEnvelopeFamily = (
  raw: Readonly<Record<string, unknown>>
): SpeechEnvelopeFamily => {
  const hasModelSpecificDiscriminator =
    Object.hasOwn(raw, "segments") || Object.hasOwn(raw, "transcription_info");
  const hasGenericDiscriminator = Object.hasOwn(raw, "words");
  if (hasModelSpecificDiscriminator && hasGenericDiscriminator) {
    return "unclassified";
  }
  return hasModelSpecificDiscriminator ? "model_specific" : "generic";
};

const classifySpeechEnvelope = (raw: unknown): SpeechEnvelopeClassification => {
  if (!isUnknownRecord(raw)) {
    return { failure: "not_object", family: "unclassified" };
  }
  const family = classifySpeechEnvelopeFamily(raw);
  if (!Object.hasOwn(raw, "text")) {
    return { failure: "required_text_missing", family };
  }
  if (typeof raw["text"] !== "string") {
    return { failure: "required_text_type", family };
  }
  if (hasWrongRootMetadataType(raw)) {
    return { failure: "root_metadata_type", family };
  }
  if (family === "unclassified") {
    return {
      failure: "unsupported_property",
      family,
      unsupportedLocation: "root",
      unsupportedRootProperty: "words",
    };
  }
  if (hasAmbiguousSpeechWrapper(raw)) {
    return {
      failure: "unsupported_property",
      family,
      unsupportedLocation: "root",
      unsupportedRootProperty: "other",
    };
  }
  const unknownMetadataTraversal = makeSpeechUnknownMetadataTraversal();
  if (
    unknownSpeechMetadataRequiresRejection(
      unknownSpeechMetadataValues(raw, SpeechProviderResponseKeys),
      unknownMetadataTraversal
    )
  ) {
    return {
      failure: "unsupported_property",
      family,
      unsupportedLocation: "root",
      unsupportedRootProperty: "other",
    };
  }
  if (
    family === "generic"
      ? genericNestedContainersAreInvalid(raw)
      : modelSpecificNestedContainersAreInvalid(raw)
  ) {
    return { failure: "nested_container_type", family };
  }
  if (
    family === "generic"
      ? genericNestedEntriesAreInvalid(raw)
      : modelSpecificNestedEntriesAreInvalid(raw)
  ) {
    return { failure: "nested_entry_type", family };
  }
  if (
    family === "generic"
      ? genericNestedMetadataTypesAreInvalid(raw)
      : modelSpecificNestedMetadataTypesAreInvalid(raw)
  ) {
    return { failure: "nested_metadata_type", family };
  }
  const unsupportedLocation =
    family === "generic"
      ? genericUnsupportedPropertyLocation(raw)
      : modelSpecificUnsupportedPropertyLocation(raw, unknownMetadataTraversal);
  if (unsupportedLocation !== undefined) {
    return {
      failure: "unsupported_property",
      family,
      unsupportedLocation,
    };
  }
  return { failure: undefined, family };
};

const decodeSpeechResponse = (
  raw: unknown
):
  | {
      readonly _tag: "Decoded";
      readonly text: string;
    }
  | {
      readonly _tag: "Rejected";
      readonly decodeReason:
        | "speech_envelope_schema_invalid"
        | "speech_transcript_normalization_invalid";
      readonly decodeStage: "speech_envelope" | "speech_transcript";
      readonly speechEnvelopeFailure: SpeechEnvelopeFailure;
      readonly speechEnvelopeFamily: SpeechEnvelopeFamily;
      readonly speechEnvelopeUnsupportedLocation?: SpeechEnvelopeUnsupportedLocation;
      readonly speechEnvelopeUnsupportedRootProperty?: SpeechEnvelopeUnsupportedRootProperty;
    } => {
  const classification = classifySpeechEnvelope(raw);
  if (!isUnknownRecord(raw) || classification.failure !== undefined) {
    return {
      _tag: "Rejected",
      decodeReason: "speech_envelope_schema_invalid",
      decodeStage: "speech_envelope",
      speechEnvelopeFailure: classification.failure ?? "not_object",
      speechEnvelopeFamily: classification.family,
      ...(classification.unsupportedLocation === undefined
        ? {}
        : {
            speechEnvelopeUnsupportedLocation:
              classification.unsupportedLocation,
          }),
      ...(classification.unsupportedRootProperty === undefined
        ? {}
        : {
            speechEnvelopeUnsupportedRootProperty:
              classification.unsupportedRootProperty,
          }),
    };
  }
  const isModelSpecific = classification.family === "model_specific";
  const projected = projectDocumentedSpeechResponse(
    raw,
    isModelSpecific
      ? ModelSpecificSpeechProviderResponseKeys
      : GenericSpeechProviderResponseKeys
  );
  const envelope = isModelSpecific
    ? decodeModelSpecificSpeechResponse(
        normalizeModelSpecificSpeechProviderResponse(projected)
      ).pipe(Option.map(({ text }) => text))
    : decodeGenericSpeechResponse(projected).pipe(
        Option.map(({ text }) => text)
      );
  if (Option.isNone(envelope)) {
    return {
      _tag: "Rejected",
      decodeReason: "speech_envelope_schema_invalid",
      decodeStage: "speech_envelope",
      speechEnvelopeFailure: classification.failure ?? "semantic_constraint",
      speechEnvelopeFamily: classification.family,
      ...(classification.unsupportedLocation === undefined
        ? {}
        : {
            speechEnvelopeUnsupportedLocation:
              classification.unsupportedLocation,
          }),
      ...(classification.unsupportedRootProperty === undefined
        ? {}
        : {
            speechEnvelopeUnsupportedRootProperty:
              classification.unsupportedRootProperty,
          }),
    };
  }
  const text = Schema.decodeUnknownOption(SpeechTranscript.fields.text)(
    envelope.value.trim()
  );
  return Option.match(text, {
    onNone: () => ({
      _tag: "Rejected" as const,
      decodeReason: "speech_transcript_normalization_invalid" as const,
      decodeStage: "speech_transcript" as const,
      speechEnvelopeFailure: "normalized_text_invalid" as const,
      speechEnvelopeFamily: classification.family,
    }),
    onSome: (normalizedText) => ({
      _tag: "Decoded" as const,
      text: normalizedText,
    }),
  });
};

const speechDecodeDiagnostics = (
  decoded: ReturnType<typeof decodeSpeechResponse>,
  transcript: Option.Option<SpeechTranscript>
) => {
  if (decoded._tag === "Rejected") {
    return {
      decodeReason: decoded.decodeReason,
      decodeStage: decoded.decodeStage,
      speechEnvelopeFailure: decoded.speechEnvelopeFailure,
      speechEnvelopeFamily: decoded.speechEnvelopeFamily,
      ...(decoded.speechEnvelopeUnsupportedLocation === undefined
        ? {}
        : {
            speechEnvelopeUnsupportedLocation:
              decoded.speechEnvelopeUnsupportedLocation,
          }),
      ...(decoded.speechEnvelopeUnsupportedRootProperty === undefined
        ? {}
        : {
            speechEnvelopeUnsupportedRootProperty:
              decoded.speechEnvelopeUnsupportedRootProperty,
          }),
    };
  }
  if (Option.isNone(transcript)) {
    return {
      decodeReason: "speech_transcript_normalization_invalid" as const,
      decodeStage: "speech_transcript" as const,
    };
  }
  return {};
};

const speechFailure = (
  code: SafeProviderFailureCode
): SpeechTranscriptionFailure =>
  adapterFailure("SpeechTranscriptionFailure", code);

type SpeechDispatchOutcome =
  | {
      readonly _tag: "Failed";
      readonly code: "malformed_response";
    }
  | {
      readonly _tag: "Transcribed";
      readonly transcript: SpeechTranscript;
    };

export const makeInstalledSpeechTranscriber = (input: {
  readonly client: QueryGatewayClient;
  readonly correlationId: ImportCorrelationId;
  readonly dispatch: ProviderDispatchGate;
  readonly model?: string;
}) =>
  Effect.gen(function* makeSpeechAdapter() {
    const model = input.model ?? InstalledSpeechModel;
    const traceStore = Option.getOrUndefined(
      yield* Effect.serviceOption(ImportObservabilityTraceStore)
    );
    const ai = yield* input.client.raw;
    const gatewayId = yield* input.client.id;
    return {
      transcribe: (request: SpeechTranscriptionInput) =>
        Effect.gen(function* transcribeSpeech() {
          const estimatedCostMicroUsd = Math.ceil(
            (request.audio.durationMilliseconds * 510) / 60_000
          );
          if (
            estimatedCostMicroUsd <= 0 ||
            estimatedCostMicroUsd > SpeechMaximumCostMicroUsd
          ) {
            return yield* Effect.fail("insufficient_evidence" as const);
          }
          const outcome = yield* input.dispatch.run({
            dispatchId: request.dispatchId,
            invoke: failAfter(
              Effect.gen(function* invokeSpeech() {
                const response = yield* Effect.tryPromise({
                  catch: (error) =>
                    isPilotProviderKnownZeroCostFailure(error)
                      ? error
                      : safeFailureCode(Cause.fail(error)),
                  try: () =>
                    runWorkersAi(
                      ai,
                      model,
                      {
                        audio: encodeBase64(request.audio.bytes),
                        condition_on_previous_text: false,
                        language: "en",
                        task: "transcribe",
                        vad_filter: true,
                      },
                      gatewayId
                    ),
                });
                yield* emitImportObservabilityEvent(
                  {
                    correlationId: input.correlationId,
                    event: "provider.response",
                    outcome: "received",
                    providerStage: "speech",
                  },
                  traceStore
                );
                if (!response.ok) {
                  return yield* Effect.fail({ status: response.status });
                }
                const raw = Option.getOrUndefined(
                  yield* Effect.tryPromise({
                    catch: () => "malformed_response" as const,
                    try: () => response.json(),
                  }).pipe(Effect.option)
                );
                const decoded = decodeSpeechResponse(raw);
                const transcript =
                  decoded._tag === "Rejected"
                    ? Option.none()
                    : Schema.decodeUnknownOption(SpeechTranscript)({
                        cost: {
                          certainty: "estimated",
                          currency: "USD",
                          estimatedMicroUsd: estimatedCostMicroUsd,
                        },
                        detectedLanguage: "en",
                        model,
                        provider: ProviderName,
                        segments: [
                          {
                            endMilliseconds: request.audio.durationMilliseconds,
                            startMilliseconds: 0,
                            text: decoded.text,
                          },
                        ],
                        text: decoded.text,
                        usage: {
                          audioDurationMilliseconds:
                            request.audio.durationMilliseconds,
                          inputBytes: request.audio.bytes.byteLength,
                        },
                      });
                yield* emitImportObservabilityEvent(
                  {
                    correlationId: input.correlationId,
                    ...speechDecodeDiagnostics(decoded, transcript),
                    event: "provider.decode",
                    outcome: Option.isSome(transcript)
                      ? "succeeded"
                      : "malformed",
                    providerStage: "speech",
                  },
                  traceStore
                );
                return {
                  cost: {
                    _tag: "Known" as const,
                    actualCostMicroUsd: estimatedCostMicroUsd,
                  },
                  value: Option.match(transcript, {
                    onNone: () =>
                      ({
                        _tag: "Failed",
                        code: "malformed_response",
                      }) satisfies SpeechDispatchOutcome,
                    onSome: (value) =>
                      ({
                        _tag: "Transcribed",
                        transcript: value,
                      }) satisfies SpeechDispatchOutcome,
                  }),
                };
              }),
              {
                correlationId: input.correlationId,
                providerStage: "speech",
                traceStore,
              }
            ).pipe(
              Effect.mapError((error) => {
                if (isPilotProviderKnownZeroCostFailure(error)) {
                  return error as PilotProviderKnownZeroCostFailure<SafeProviderFailureCode>;
                }
                return typeof error === "string"
                  ? error
                  : safeFailureCode(Cause.fail(error));
              })
            ),
            maximumCostMicroUsd: SpeechMaximumCostMicroUsd,
            providerStage: "speech",
            providerStageId: "speech-transcription",
          });
          if (outcome._tag === "Failed") {
            return yield* Effect.fail(outcome.code);
          }
          return outcome.transcript;
        }).pipe(
          // eslint-disable-next-line promise/prefer-await-to-callbacks -- Effect callbacks preserve the adapter error contract.
          Effect.mapError((error) =>
            speechFailure(
              typeof error === "object"
                ? "outcome_unknown"
                : (error as SafeProviderFailureCode)
            )
          )
        ),
    } satisfies SpeechTranscriberShape;
  });
