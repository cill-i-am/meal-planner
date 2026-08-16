import type { QueryGatewayClient } from "alchemy/Cloudflare/AI";
import { WorkflowStepContext } from "alchemy/Cloudflare/Workflows";
import { Cause, Effect, Option, Schema } from "effect";
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

export type SafeProviderFailureCode =
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

export const isSafeProviderFailureCode = (
  value: unknown
): value is SafeProviderFailureCode =>
  typeof value === "string" && SafeProviderFailureCodes.has(value);

export interface ProviderDispatchRequest<A, E> {
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

export const safeFailureCode = (
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

export const providerErrorDescription = (
  error: unknown
): string | undefined => {
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
  error: unknown
): ProviderDecodeReason | undefined =>
  providerNormalizationDecodeReasonFromDescription(
    providerErrorDescription(error)
  );

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

export const oneForcedToolCall = <Name extends string, S extends Schema.Top>(
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

const workersAiGatewayOptions = (gatewayId: string) =>
  ({
    gateway: {
      collectLog: false,
      id: gatewayId,
      skipCache: true,
    },
    returnRawResponse: true,
  }) as const;

export type WorkersAiBinding = Effect.Success<QueryGatewayClient["raw"]>;

export const runWorkersAi = (
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

export const isUnknownRecord = (
  value: unknown
): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const WorkersAiProviderResponseEnvelope = Schema.Struct({
  choices: Schema.optionalKey(Schema.Unknown),
  tool_calls: Schema.optionalKey(Schema.Unknown),
});
type WorkersAiProviderResponseEnvelope =
  typeof WorkersAiProviderResponseEnvelope.Type;
const decodeWorkersAiProviderResponseEnvelope = Schema.decodeUnknownOption(
  WorkersAiProviderResponseEnvelope,
  { onExcessProperty: "preserve" }
);

const ProviderToolCallEnvelope = Schema.Struct({
  arguments: Schema.optionalKey(Schema.Unknown),
  function: Schema.optionalKey(Schema.Unknown),
  id: Schema.optionalKey(Schema.Unknown),
  name: Schema.optionalKey(Schema.Unknown),
  type: Schema.optionalKey(Schema.Unknown),
});
type ProviderToolCallEnvelope = typeof ProviderToolCallEnvelope.Type;
const decodeProviderToolCallEnvelope = Schema.decodeUnknownOption(
  ProviderToolCallEnvelope
);

const ProviderToolFunctionEnvelope = Schema.Struct({
  arguments: Schema.optionalKey(Schema.Unknown),
  name: Schema.optionalKey(Schema.Unknown),
});
type ProviderToolFunctionEnvelope = typeof ProviderToolFunctionEnvelope.Type;
const decodeProviderToolFunctionEnvelope = Schema.decodeUnknownOption(
  ProviderToolFunctionEnvelope
);

const OpenAiProviderChoiceEnvelope = Schema.Struct({
  message: Schema.Unknown,
});
type OpenAiProviderChoiceEnvelope = typeof OpenAiProviderChoiceEnvelope.Type;
const decodeOpenAiProviderChoiceEnvelope = Schema.decodeUnknownOption(
  OpenAiProviderChoiceEnvelope,
  { onExcessProperty: "preserve" }
);

const OpenAiProviderMessageEnvelope = Schema.Struct({
  tool_calls: Schema.optionalKey(Schema.Unknown),
});
type OpenAiProviderMessageEnvelope = typeof OpenAiProviderMessageEnvelope.Type;
const decodeOpenAiProviderMessageEnvelope = Schema.decodeUnknownOption(
  OpenAiProviderMessageEnvelope,
  { onExcessProperty: "preserve" }
);

type CanonicalProviderToolCall =
  | {
      readonly arguments?: unknown;
      readonly id?: string;
      readonly name: string;
      readonly type?: string;
    }
  | {
      readonly function: {
        readonly arguments?: unknown;
        readonly name: string;
      };
      readonly id?: string;
      readonly type?: string;
    };

type RawToolCallAuthority =
  | { readonly _tag: "Absent" }
  | {
      readonly _tag: "Call";
      readonly arguments: unknown;
      readonly call: CanonicalProviderToolCall;
      readonly name: string;
    }
  | { readonly _tag: "Invalid" };

export type ProviderRawToolCall = Extract<
  RawToolCallAuthority,
  { readonly _tag: "Call" }
>;

export const comparableToolArguments = (value: unknown): unknown => {
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
  value: ProviderToolCallEnvelope
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
  value: ProviderToolCallEnvelope,
  functionValue: ProviderToolFunctionEnvelope
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

const decodeOpenAiToolAuthority = (choices: unknown): OpenAiToolAuthority => {
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
): Record<string, unknown> => {
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
  choices: unknown,
  call: ProviderRawToolCall
): Record<string, unknown> => {
  const canonicalNative = { ...value, tool_calls: [call.call] };
  return Array.isArray(choices) && choices.length === 0
    ? Object.fromEntries(
        Object.entries(canonicalNative).filter(([key]) => key !== "choices")
      )
    : canonicalNative;
};

const normalizeRawToolShape = (value: unknown): unknown => {
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

const withProviderNormalizationBoundary = (response: Response): Response => {
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
            return normalizeRawToolShape(raw);
          } catch {
            // Provider payloads and parser details must not cross the
            // observability boundary. Alchemy preserves this closed
            // description inside its typed AiError.UnknownError.
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
            return withProviderNormalizationBoundary(response);
          },
        }) as WorkersAiBinding
    )
  ) as QueryGatewayClient["raw"],
});
