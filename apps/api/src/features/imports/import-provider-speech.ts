import type { QueryGatewayClient } from "alchemy/Cloudflare/AI";
import { Cause, Effect, Option, Schema } from "effect";

import { isPilotProviderKnownZeroCostFailure } from "../pilots/pilot-provider-budget.js";
import type { PilotProviderKnownZeroCostFailure } from "../pilots/pilot-provider-budget.js";
import type {
  ImportCorrelationId,
  SpeechEnvelopeFailure,
  SpeechEnvelopeFamily,
  SpeechEnvelopeUnsupportedLocation,
  SpeechEnvelopeUnsupportedRootProperty,
} from "./import-observability.js";
import {
  ImportObservabilityTraceStore,
  emitImportObservabilityEvent,
} from "./import-observability.js";
import {
  ProviderName,
  adapterFailure,
  failAfter,
  isUnknownRecord,
  runWorkersAi,
  safeFailureCode,
} from "./import-provider-kernel.js";
import type {
  ProviderDispatchGate,
  SafeProviderFailureCode,
} from "./import-provider-kernel.js";
import type {
  SpeechTranscriber,
  SpeechTranscriptionFailure,
  SpeechTranscriptionInput,
} from "./import-speech-transcriber.js";
import { SpeechTranscript } from "./import-speech-transcriber.js";

export const InstalledSpeechModel =
  "@cf/openai/whisper-large-v3-turbo" as const;

const SpeechMaximumCostMicroUsd = 50_000;

const encodeBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }
  return btoa(binary);
};

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
    } satisfies SpeechTranscriber;
  });
