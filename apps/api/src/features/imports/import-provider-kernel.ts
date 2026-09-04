import type { RuntimeContext } from "alchemy";
import { makeLanguageModel as makeAlchemyLanguageModel } from "alchemy/Cloudflare/AI";
import type {
  LanguageModelClient,
  QueryGatewayClient,
} from "alchemy/Cloudflare/AI";
import { WorkflowStepContext } from "alchemy/Cloudflare/Workflows";
import { Effect, Option, Schema } from "effect";
import type { LanguageModel, Prompt } from "effect/unstable/ai";
import { Tool, Toolkit } from "effect/unstable/ai";

import {
  ProviderAccountingDispatchId,
  ProviderAccountingProviderStageId,
  isProviderKnownZeroCostFailure,
  providerKnownZeroCostFailure,
  runAccountedProviderDispatch,
} from "../provider-accounting/provider-accounting.js";
import type {
  ProviderAccountingRunId,
  ProviderAccountingTimestamp,
  ProviderAccountingConservativeReplayValue,
  ProviderKnownZeroCostFailure,
  ProviderAccountingRepository,
} from "../provider-accounting/provider-accounting.js";
import {
  decodeForcedToolResponseResult,
  structurallyEqualJson,
} from "./import-forced-tool-response.js";
import type {
  ImportCorrelationId,
  ImportObservabilityTraceStore,
  ProviderDecodeReason,
} from "./import-observability.js";
import { emitImportObservabilityEvent } from "./import-observability.js";

export const ProviderName = "cloudflare-workers-ai" as const;

const ProviderTimeout = "150 seconds";

const ProviderTransportUnavailableMessage =
  "provider_transport_unavailable" as const;
const ProviderNormalizationInvalidMessage =
  "provider_normalization_invalid" as const;
const ProviderNormalizationBodyInvalidMessage =
  "provider_normalization_body_invalid" as const;

export const ProviderKnownZeroSetupFailureMessage =
  "provider_known_zero_setup_failure" as const;

export const SafeProviderFailureCode = Schema.Literals([
  "insufficient_evidence",
  "malformed_response",
  "model_refusal",
  "outcome_unknown",
  "provider_unavailable",
  "throttled",
  "timeout",
]);
export type SafeProviderFailureCode = typeof SafeProviderFailureCode.Type;

type SafeProviderFailureCandidate = string | object;

export const isSafeProviderFailureCode = (
  value: SafeProviderFailureCandidate
): value is SafeProviderFailureCode =>
  Schema.is(SafeProviderFailureCode)(value);

export interface ProviderDispatchRequest<A, E> {
  readonly conservativeReplay?: {
    readonly decode: (
      replay: ProviderAccountingConservativeReplayValue
    ) => Effect.Effect<A, E>;
    readonly encode: (
      value: A
    ) => Effect.Effect<ProviderAccountingConservativeReplayValue, E>;
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
export const makeProviderDispatchGate = (input: {
  readonly correlationId: ImportCorrelationId;
  readonly now: () => ProviderAccountingTimestamp;
  readonly repository: ProviderAccountingRepository;
  readonly runId: ProviderAccountingRunId;
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
        dispatchId: Schema.decodeUnknownSync(ProviderAccountingDispatchId)(
          retryDispatchId(request.dispatchId, attempt)
        ),
        maximumCostMicroUsd: request.maximumCostMicroUsd,
        providerStageId: Schema.decodeUnknownSync(
          ProviderAccountingProviderStageId
        )(request.providerStageId),
        runId: input.runId,
        timestamp,
      };
      const commonDispatch = {
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
        onSettlement: (outcome: "conservative" | "known" | "unknown") =>
          emitImportObservabilityEvent({
            correlationId: input.correlationId,
            event: "provider.settlement",
            outcome,
            providerStage: request.providerStage,
          }),
        repository: input.repository,
        reservation,
      };
      const replayDispatch =
        request.conservativeReplay === undefined
          ? commonDispatch
          : {
              ...commonDispatch,
              conservativeReplay: request.conservativeReplay,
            };
      const dispatch =
        attempt === 1
          ? replayDispatch
          : {
              ...replayDispatch,
              previousAttempt: {
                ...reservation,
                dispatchId: Schema.decodeUnknownSync(
                  ProviderAccountingDispatchId
                )(retryDispatchId(request.dispatchId, attempt - 1)),
              },
            };
      return yield* runAccountedProviderDispatch(dispatch);
    }).pipe(
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
          Schema.is(
            Schema.Struct({ _tag: Schema.Literal("ProviderAccountingError") })
          )(error)
        ) {
          return dispatchRejected;
        }
        return error as E | typeof dispatchRejected;
      })
    ),
});

const ProviderErrorDetails = Schema.Struct({
  _tag: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
  status: Schema.optionalKey(Schema.Number),
});
const ProviderFailureEvidence = Schema.Struct({
  _tag: Schema.optionalKey(Schema.String),
  cause: Schema.optionalKey(ProviderErrorDetails),
  description: Schema.optionalKey(Schema.String),
  reason: Schema.optionalKey(ProviderErrorDetails),
  status: Schema.optionalKey(Schema.Number),
});
export type ProviderFailureEvidence = typeof ProviderFailureEvidence.Type;
export const decodeProviderFailureEvidence = Schema.decodeUnknownOption(
  ProviderFailureEvidence,
  { onExcessProperty: "ignore" }
);

export interface ProviderFailure {
  readonly code: SafeProviderFailureCode;
  readonly description?: string;
}

export const providerFailureFromEvidence = (
  evidence: ProviderFailureEvidence | undefined
): ProviderFailure => {
  if (evidence !== undefined) {
    const reason = evidence.reason ?? evidence;
    const original = evidence.cause ?? evidence;
    const tag = String(
      original._tag ?? reason._tag ?? evidence._tag ?? ""
    ).toLowerCase();
    const status = original.status ?? reason.status ?? evidence.status;
    if (status === 429 || tag.includes("rate") || tag.includes("throttl")) {
      return reason.description === undefined
        ? { code: "throttled" }
        : { code: "throttled", description: reason.description };
    }
    if (tag.includes("refusal") || tag.includes("contentfilter")) {
      return reason.description === undefined
        ? { code: "model_refusal" }
        : { code: "model_refusal", description: reason.description };
    }
    const description = reason.description ?? evidence.description;
    return description === undefined
      ? { code: "provider_unavailable" }
      : { code: "provider_unavailable", description };
  }
  return { code: "provider_unavailable" };
};

export const providerFailureFromStatus = (status: number): ProviderFailure =>
  status === 429 ? { code: "throttled" } : { code: "provider_unavailable" };

export const safeFailureCode = (
  failure: ProviderFailure
): SafeProviderFailureCode => failure.code;

export const providerErrorDescription = (
  failure: ProviderFailure
): string | undefined => failure.description;

const hasProviderErrorDescription = (
  failure: ProviderFailure,
  description: string
): boolean => providerErrorDescription(failure) === description;

export const providerNormalizationDecodeReasonFromDescription = (
  description: string | undefined
): ProviderDecodeReason | undefined => {
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
  return reason.length === 0 ? undefined : (reason as ProviderDecodeReason);
};

const providerNormalizationDecodeReason = (
  failure: ProviderFailure
): ProviderDecodeReason | undefined =>
  providerNormalizationDecodeReasonFromDescription(
    providerErrorDescription(failure)
  );

const isProviderNormalizationFailure = (failure: ProviderFailure): boolean =>
  providerNormalizationDecodeReason(failure) !== undefined;

const isProviderNormalizationBodyFailure = (
  failure: ProviderFailure
): boolean =>
  hasProviderErrorDescription(failure, ProviderNormalizationBodyInvalidMessage);

export const failAfter = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  observability: {
    readonly correlationId: ImportCorrelationId;
    readonly providerStage: "recipe" | "speech" | "visual";
    readonly traceStore?: ImportObservabilityTraceStore | undefined;
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

export const oneForcedToolCall = <Name extends string, S extends Schema.Top>(
  service: LanguageModel.Service,
  input: {
    readonly acceptUnwrappedObject?: boolean;
    readonly description: string;
    readonly name: Name;
    readonly normalizeValue?: (value: Schema.Json) => S["Encoded"];
    readonly prompt: Prompt.RawInput;
    readonly providerNormalizationFallback?: () => S["Type"];
    readonly schema: S;
    readonly toolSchema?: Schema.Top;
  },
  observability: {
    readonly correlationId: ImportCorrelationId;
    readonly providerStage: "recipe" | "visual";
    readonly traceStore: ImportObservabilityTraceStore | undefined;
  }
): Effect.Effect<
  {
    readonly inputTokens: number | undefined;
    readonly outputTokens: number | undefined;
    readonly value: S["Type"];
  },
  | SafeProviderFailureCode
  | ProviderKnownZeroCostFailure<SafeProviderFailureCode>,
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
      const failure = providerFailureFromEvidence(
        Option.getOrUndefined(decodeProviderFailureEvidence(error))
      );
      const decodeReason = providerNormalizationDecodeReason(failure);
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
      (error) => {
        const failure = providerFailureFromEvidence(
          Option.getOrUndefined(decodeProviderFailureEvidence(error))
        );
        return (
          isProviderNormalizationBodyFailure(failure) &&
          input.providerNormalizationFallback !== undefined
        );
      },
      () =>
        Effect.succeed({
          _tag: "ProviderNormalizationFallback" as const,
          value: input.providerNormalizationFallback?.() as S["Type"],
        })
    ),
    // eslint-disable-next-line promise/prefer-await-to-callbacks -- Effect callbacks preserve the typed error channel.
    Effect.mapError((error) => {
      if (Schema.is(Schema.String)(error)) {
        return error;
      }
      const failure = providerFailureFromEvidence(
        Option.getOrUndefined(decodeProviderFailureEvidence(error))
      );
      if (isProviderNormalizationFailure(failure)) {
        return "malformed_response" as const;
      }
      if (
        hasProviderErrorDescription(
          failure,
          ProviderKnownZeroSetupFailureMessage
        )
      ) {
        return providerKnownZeroCostFailure("provider_unavailable" as const);
      }
      return safeFailureCode(failure);
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

export const adapterFailure = <Tag extends string>(
  tag: Tag,
  code: SafeProviderFailureCode
) => ({ _tag: tag, code });

export const pricedTokenUsage = (
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

const WorkersAiGatewayOptions = Schema.Struct({
  gateway: Schema.Struct({
    collectLog: Schema.Literal(false),
    id: Schema.String,
    skipCache: Schema.Literal(true),
  }),
  returnRawResponse: Schema.Literal(true),
});

const workersAiGatewayOptions = (gatewayId: string) =>
  Schema.decodeUnknownSync(WorkersAiGatewayOptions)({
    gateway: {
      collectLog: false,
      id: gatewayId,
      skipCache: true,
    },
    returnRawResponse: true,
  });

export type WorkersAiBinding = Effect.Success<QueryGatewayClient["raw"]>;

export const runWorkersAi = (
  ai: WorkersAiBinding,
  model: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- TODO(ASU001 alchemy@2.0.0-beta.76): LanguageModel.callRaw -> Ai.run(model, body) erases the model-correlated visual request; Schema can validate JSON but cannot restore that vendor generic without changing the forced-tool protocol. Remove when Alchemy provides a public precise visual request transport.
  body: unknown,
  gatewayId: string
): Promise<Response> =>
  ai.run(
    model as never,
    body as never,
    workersAiGatewayOptions(gatewayId) as never
  ) as Promise<Response>;

export const InstalledRecipeModel = Schema.decodeUnknownSync(
  Schema.Literal("@cf/meta/llama-3.3-70b-instruct-fp8-fast")
)("@cf/meta/llama-3.3-70b-instruct-fp8-fast");
export const InstalledSpeechModel = Schema.decodeUnknownSync(
  Schema.Literal("@cf/openai/whisper-large-v3-turbo")
)("@cf/openai/whisper-large-v3-turbo");
export const InstalledVisualModel = Schema.decodeUnknownSync(
  Schema.Literal("@cf/meta/llama-4-scout-17b-16e-instruct")
)("@cf/meta/llama-4-scout-17b-16e-instruct");

export const RecipeWorkersAiRequest = Schema.Struct({
  max_tokens: Schema.Number,
  messages: Schema.Array(
    Schema.Struct({ content: Schema.String, role: Schema.Literal("user") })
  ),
  response_format: Schema.Struct({
    json_schema: Schema.Json,
    type: Schema.Literal("json_schema"),
  }),
  temperature: Schema.Number,
});
export type RecipeWorkersAiRequest = typeof RecipeWorkersAiRequest.Type;

export const SpeechWorkersAiRequest = Schema.Struct({
  audio: Schema.String,
  condition_on_previous_text: Schema.Literal(false),
  language: Schema.Literal("en"),
  task: Schema.Literal("transcribe"),
  vad_filter: Schema.Literal(true),
});
export type SpeechWorkersAiRequest = typeof SpeechWorkersAiRequest.Type;

export interface WorkersAiTransport {
  readonly recipe: {
    readonly model: typeof InstalledRecipeModel;
    readonly run: (body: RecipeWorkersAiRequest) => Promise<Response>;
  };
  readonly speech: {
    readonly model: typeof InstalledSpeechModel;
    readonly run: (body: SpeechWorkersAiRequest) => Promise<Response>;
  };
  readonly visual: {
    readonly makeLanguageModel: (parameters: {
      readonly maxTokens?: number;
      readonly temperature?: number;
    }) => Effect.Effect<LanguageModel.Service, never, RuntimeContext>;
    readonly model: typeof InstalledVisualModel;
  };
}

type ProviderInvocationOutcome =
  | { readonly _tag: "Success"; readonly response: Response }
  | { readonly _tag: "KnownZeroCostFailure" }
  | { readonly _tag: "TransportUnavailable" };

class ProviderInvocationFailureError extends Error {
  readonly description:
    | typeof ProviderKnownZeroSetupFailureMessage
    | typeof ProviderTransportUnavailableMessage;

  constructor(
    description:
      | typeof ProviderKnownZeroSetupFailureMessage
      | typeof ProviderTransportUnavailableMessage
  ) {
    super(description);
    this.description = description;
    this.name = "ProviderInvocationFailureError";
  }
}

export const isUnknownRecord = (
  value: Schema.Json | undefined
): value is Schema.JsonObject =>
  Schema.is(Schema.Record(Schema.String, Schema.Json))(value);

const WorkersAiProviderResponseEnvelope = Schema.Struct({
  choices: Schema.optionalKey(Schema.Json),
  tool_calls: Schema.optionalKey(Schema.Json),
});
type WorkersAiProviderResponseEnvelope =
  typeof WorkersAiProviderResponseEnvelope.Type;
const decodeWorkersAiProviderResponseEnvelope = Schema.decodeUnknownOption(
  WorkersAiProviderResponseEnvelope,
  { onExcessProperty: "preserve" }
);

const ProviderToolCallEnvelope = Schema.Struct({
  arguments: Schema.optionalKey(Schema.Json),
  function: Schema.optionalKey(Schema.Json),
  id: Schema.optionalKey(Schema.Json),
  name: Schema.optionalKey(Schema.Json),
  type: Schema.optionalKey(Schema.Json),
});
type ProviderToolCallEnvelope = typeof ProviderToolCallEnvelope.Type;
const decodeProviderToolCallEnvelope = Schema.decodeUnknownOption(
  ProviderToolCallEnvelope
);

const ProviderToolFunctionEnvelope = Schema.Struct({
  arguments: Schema.optionalKey(Schema.Json),
  name: Schema.optionalKey(Schema.Json),
});
type ProviderToolFunctionEnvelope = typeof ProviderToolFunctionEnvelope.Type;
const decodeProviderToolFunctionEnvelope = Schema.decodeUnknownOption(
  ProviderToolFunctionEnvelope
);

const OpenAiProviderChoiceEnvelope = Schema.Struct({
  message: Schema.Json,
});
type OpenAiProviderChoiceEnvelope = typeof OpenAiProviderChoiceEnvelope.Type;
const decodeOpenAiProviderChoiceEnvelope = Schema.decodeUnknownOption(
  OpenAiProviderChoiceEnvelope,
  { onExcessProperty: "preserve" }
);

const OpenAiProviderMessageEnvelope = Schema.Struct({
  tool_calls: Schema.optionalKey(Schema.Json),
});
type OpenAiProviderMessageEnvelope = typeof OpenAiProviderMessageEnvelope.Type;
const decodeOpenAiProviderMessageEnvelope = Schema.decodeUnknownOption(
  OpenAiProviderMessageEnvelope,
  { onExcessProperty: "preserve" }
);

type CanonicalProviderToolCall =
  | {
      readonly arguments?: Schema.Json;
      readonly id?: string;
      readonly name: string;
      readonly type?: string;
    }
  | {
      readonly function: {
        readonly arguments?: Schema.Json;
        readonly name: string;
      };
      readonly id?: string;
      readonly type?: string;
    };

type RawToolCallAuthority =
  | { readonly _tag: "Absent" }
  | {
      readonly _tag: "Call";
      readonly arguments: Schema.Json | undefined;
      readonly call: CanonicalProviderToolCall;
      readonly name: string;
    }
  | { readonly _tag: "Invalid" };

export type ProviderRawToolCall = Extract<
  RawToolCallAuthority,
  { readonly _tag: "Call" }
>;

export const comparableToolArguments = (
  value: Schema.Json | undefined
): Schema.Json | undefined => {
  if (!Schema.is(Schema.String)(value)) {
    return value;
  }
  try {
    return Option.getOrElse(
      Schema.decodeUnknownOption(Schema.Json)(JSON.parse(value)),
      () => value
    );
  } catch {
    return value;
  }
};

const decodeFlatRawToolCall = (
  value: ProviderToolCallEnvelope
): RawToolCallAuthority => {
  const { arguments: toolArguments, id, name, type } = value;
  if (!Schema.is(Schema.String)(name) || name.length === 0) {
    return { _tag: "Invalid" };
  }
  const hasArguments = Object.hasOwn(value, "arguments");
  let call: CanonicalProviderToolCall = { name };
  if (Schema.is(Schema.String)(id)) {
    call = { ...call, id };
  }
  if (Schema.is(Schema.String)(type)) {
    call = { ...call, type };
  }
  if (hasArguments && toolArguments !== undefined) {
    call = { ...call, arguments: toolArguments };
  }
  return {
    _tag: "Call",
    arguments: toolArguments,
    call,
    name,
  };
};

const decodeNestedRawToolCall = (
  value: ProviderToolCallEnvelope,
  functionValue: ProviderToolFunctionEnvelope
): RawToolCallAuthority => {
  const { arguments: flatArguments, id, name: flatName, type } = value;
  const hasFlatName = Object.hasOwn(value, "name");
  const hasFlatArguments = Object.hasOwn(value, "arguments");
  const { arguments: functionArguments, name: functionName } = functionValue;
  if (!Schema.is(Schema.String)(functionName) || functionName.length === 0) {
    return { _tag: "Invalid" };
  }
  if (
    hasFlatName &&
    (!Schema.is(Schema.String)(flatName) ||
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
  let toolFunction: { arguments?: Schema.Json; name: string } = {
    name: functionName,
  };
  if (
    (hasFunctionArguments || hasFlatArguments) &&
    toolArguments !== undefined
  ) {
    toolFunction = { ...toolFunction, arguments: toolArguments };
  }
  let call: CanonicalProviderToolCall = { function: toolFunction };
  if (Schema.is(Schema.String)(id)) {
    call = { ...call, id };
  }
  if (Schema.is(Schema.String)(type)) {
    call = { ...call, type };
  }

  return {
    _tag: "Call",
    arguments: toolArguments,
    call,
    name: functionName,
  };
};

const decodeRawToolCall = (value: Schema.Json): RawToolCallAuthority => {
  const decoded = decodeProviderToolCallEnvelope(value);
  if (Option.isNone(decoded)) {
    return { _tag: "Invalid" };
  }
  const providerCall = decoded.value;
  const { function: functionValue } = providerCall;
  if (functionValue === undefined || functionValue === null) {
    return decodeFlatRawToolCall(providerCall);
  }
  const decodedFunction = decodeProviderToolFunctionEnvelope(functionValue);
  return Option.isSome(decodedFunction)
    ? decodeNestedRawToolCall(providerCall, decodedFunction.value)
    : { _tag: "Invalid" };
};

const decodeRawToolCalls = (
  value: Schema.Json | undefined
): RawToolCallAuthority => {
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

const sameRawToolAuthority = (
  left: ProviderRawToolCall,
  right: ProviderRawToolCall
): boolean =>
  left.name === right.name &&
  structurallyEqualJson(
    comparableToolArguments(left.arguments),
    comparableToolArguments(right.arguments)
  );

interface OpenAiToolAuthority {
  readonly authority: RawToolCallAuthority;
  readonly choice?: {
    readonly choice: OpenAiProviderChoiceEnvelope;
    readonly message: OpenAiProviderMessageEnvelope;
  };
}

const decodeOpenAiToolAuthority = (
  choices: Schema.Json | undefined
): OpenAiToolAuthority => {
  if (choices === undefined || choices === null) {
    return { authority: { _tag: "Absent" } };
  }
  if (!Array.isArray(choices) || choices.length > 1) {
    throw new Error(ProviderNormalizationInvalidMessage);
  }
  const [choice] = choices;
  if (choice === undefined) {
    return { authority: { _tag: "Absent" } };
  }
  const decodedChoice = decodeOpenAiProviderChoiceEnvelope(choice);
  if (Option.isNone(decodedChoice)) {
    throw new Error(ProviderNormalizationInvalidMessage);
  }
  const decodedMessage = decodeOpenAiProviderMessageEnvelope(
    decodedChoice.value.message
  );
  if (Option.isNone(decodedMessage)) {
    throw new Error(ProviderNormalizationInvalidMessage);
  }
  const authority = decodeRawToolCalls(decodedMessage.value.tool_calls);
  if (authority._tag === "Invalid") {
    throw new Error(ProviderNormalizationInvalidMessage);
  }
  return {
    authority,
    choice: {
      choice: decodedChoice.value,
      message: decodedMessage.value,
    },
  };
};

const withOpenAiToolCall = (
  value: WorkersAiProviderResponseEnvelope,
  openAiChoice: NonNullable<OpenAiToolAuthority["choice"]>,
  call: ProviderRawToolCall
): Schema.JsonObject => {
  const { tool_calls: _nativeToolCalls, ...withoutNativeToolCalls } = value;
  return {
    ...withoutNativeToolCalls,
    choices: [
      {
        ...openAiChoice.choice,
        message: {
          ...openAiChoice.message,
          tool_calls: [call.call],
        },
      },
    ],
  };
};

const withNativeToolCall = (
  value: WorkersAiProviderResponseEnvelope,
  choices: Schema.Json | undefined,
  call: ProviderRawToolCall
): Schema.JsonObject => {
  const canonicalNative = { ...value, tool_calls: [call.call] };
  return Array.isArray(choices) && choices.length === 0
    ? Object.fromEntries(
        Object.entries(canonicalNative).filter(([key]) => key !== "choices")
      )
    : canonicalNative;
};

const normalizeProviderToolPayload = (value: Schema.Json): Schema.Json => {
  const decoded = decodeWorkersAiProviderResponseEnvelope(value);
  if (Option.isNone(decoded)) {
    return value;
  }

  const providerResponse = decoded.value;
  const { choices, tool_calls: nativeToolCalls } = providerResponse;
  const nativeAuthority = decodeRawToolCalls(nativeToolCalls);
  if (nativeAuthority._tag === "Invalid") {
    throw new Error(ProviderNormalizationInvalidMessage);
  }

  const openAi = decodeOpenAiToolAuthority(choices);

  if (
    openAi.authority._tag === "Call" &&
    nativeAuthority._tag === "Call" &&
    !sameRawToolAuthority(openAi.authority, nativeAuthority)
  ) {
    throw new Error(ProviderNormalizationInvalidMessage);
  }

  if (openAi.authority._tag === "Call" && openAi.choice !== undefined) {
    return withOpenAiToolCall(
      providerResponse,
      openAi.choice,
      openAi.authority
    );
  }

  if (nativeAuthority._tag === "Call") {
    return openAi.choice === undefined
      ? withNativeToolCall(providerResponse, choices, nativeAuthority)
      : withOpenAiToolCall(providerResponse, openAi.choice, nativeAuthority);
  }

  return providerResponse;
};

export const normalizeWorkersAiResponse = (response: Response): Response => {
  const parseJson = response.json.bind(response);
  return new Proxy(response, {
    get: (target, property) => {
      if (property === "json") {
        return async (): Promise<Schema.Json> => {
          let decoded: Option.Option<Schema.Json>;
          try {
            const raw = await parseJson();
            decoded = Schema.decodeUnknownOption(Schema.Json)(raw);
          } catch {
            // The raw body is untrusted and must never cross this boundary.
            // Preserve only enough internal authority for the optional visual
            // stage to degrade without weakening structural tool validation.
            throw new Error(ProviderNormalizationBodyInvalidMessage);
          }
          if (Option.isNone(decoded)) {
            throw new Error(ProviderNormalizationBodyInvalidMessage);
          }
          try {
            return normalizeProviderToolPayload(decoded.value);
          } catch {
            // Provider payloads and parser details must not cross the
            // observability boundary.
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
export const noLogWorkersAiClient = (
  client: QueryGatewayClient,
  correlationId: ImportCorrelationId,
  providerStage: "visual"
): QueryGatewayClient => ({
  ...client,
  raw: Effect.all([client.raw, client.id]).pipe(
    Effect.map(
      ([ai, gatewayId]) =>
        ({
          run: async (
            // oxlint-disable-next-line anti-slop/no-unknown-parameters -- TODO(ASU002 alchemy@2.0.0-beta.76): LanguageModel.callRaw -> Ai.run(model, body) erases the model-correlated visual request; Schema cannot establish the missing behavioral model/body relationship. Remove when Alchemy provides a public precise visual request transport.
            model: unknown,
            // oxlint-disable-next-line anti-slop/no-unknown-parameters -- TODO(ASU003 alchemy@2.0.0-beta.76): LanguageModel.callRaw -> Ai.run(model, body) erases the model-correlated visual request; Schema can validate JSON but cannot restore that vendor generic without changing the forced-tool protocol. Remove when Alchemy provides a public precise visual request transport.
            body: unknown
          ) => {
            let response: Response;
            try {
              response = await runWorkersAi(ai, String(model), body, gatewayId);
            } catch (error) {
              if (isProviderKnownZeroCostFailure(error)) {
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
              emitImportObservabilityEvent({
                correlationId,
                event: "provider.response",
                outcome: "received",
                providerStage,
              })
            );
            return normalizeWorkersAiResponse(response);
          },
        }) as WorkersAiBinding
    )
  ) as QueryGatewayClient["raw"],
});

export const makeWorkersAiTransport = (
  client: QueryGatewayClient,
  correlationId: ImportCorrelationId
) =>
  Effect.gen(function* makeProviderTransport() {
    const ai = yield* client.raw;
    const gatewayId = yield* client.id;
    const runProviderRequest = async (
      providerStage: "recipe" | "speech" | "visual",
      invoke: () => Promise<Response>
    ): Promise<Response> => {
      let outcome: ProviderInvocationOutcome;
      try {
        outcome = { _tag: "Success", response: await invoke() };
      } catch (error) {
        outcome = isProviderKnownZeroCostFailure(error)
          ? { _tag: "KnownZeroCostFailure" }
          : { _tag: "TransportUnavailable" };
      }
      if (outcome._tag === "KnownZeroCostFailure") {
        throw new ProviderInvocationFailureError(
          ProviderKnownZeroSetupFailureMessage
        );
      }
      if (outcome._tag === "TransportUnavailable") {
        throw new ProviderInvocationFailureError(
          ProviderTransportUnavailableMessage
        );
      }
      await Effect.runPromise(
        emitImportObservabilityEvent({
          correlationId,
          event: "provider.response",
          outcome: "received",
          providerStage,
        })
      );
      return normalizeWorkersAiResponse(outcome.response);
    };
    const languageModelClient: LanguageModelClient = noLogWorkersAiClient(
      client,
      correlationId,
      "visual"
    );
    return {
      recipe: {
        model: InstalledRecipeModel,
        run: (body) =>
          runProviderRequest("recipe", () =>
            ai.run(
              InstalledRecipeModel,
              {
                max_tokens: body.max_tokens,
                messages: body.messages.map(({ content, role }) => ({
                  content,
                  role,
                })),
                response_format: body.response_format,
                temperature: body.temperature,
              },
              workersAiGatewayOptions(gatewayId)
            )
          ),
      },
      speech: {
        model: InstalledSpeechModel,
        run: (body) =>
          runProviderRequest("speech", () =>
            ai.run(
              InstalledSpeechModel,
              body,
              workersAiGatewayOptions(gatewayId)
            )
          ),
      },
      visual: {
        makeLanguageModel: (parameters) =>
          makeAlchemyLanguageModel({
            client: languageModelClient,
            model: InstalledVisualModel,
            parameters,
          }),
        model: InstalledVisualModel,
      },
    } satisfies WorkersAiTransport;
  });
