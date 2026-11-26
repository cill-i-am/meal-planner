import { Option, Predicate, Schema } from "effect";

import { SpeechTranscript } from "./index.js";

const isUnknownRecord = (
  value: Schema.Json | undefined
): value is Schema.JsonObject => Predicate.isObject(value);

export const SpeechEnvelopeFamily = Schema.Literals([
  "generic",
  "model_specific",
  "unclassified",
]);
export type SpeechEnvelopeFamily = typeof SpeechEnvelopeFamily.Type;

export const SpeechEnvelopeFailure = Schema.Literals([
  "nested_container_type",
  "nested_entry_type",
  "nested_metadata_type",
  "normalized_text_invalid",
  "not_object",
  "required_text_missing",
  "required_text_type",
  "root_metadata_type",
  "semantic_constraint",
  "unsupported_property",
]);
export type SpeechEnvelopeFailure = typeof SpeechEnvelopeFailure.Type;

export const SpeechEnvelopeUnsupportedLocation = Schema.Literals([
  "root",
  "segment",
  "transcription_info",
  "word",
]);
export type SpeechEnvelopeUnsupportedLocation =
  typeof SpeechEnvelopeUnsupportedLocation.Type;

export const SpeechEnvelopeUnsupportedRootProperty = Schema.Literals([
  "duration",
  "duration_after_vad",
  "language",
  "language_probability",
  "multiple",
  "other",
  "task",
  "words",
]);
export type SpeechEnvelopeUnsupportedRootProperty =
  typeof SpeechEnvelopeUnsupportedRootProperty.Type;

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
  record: Schema.JsonObject,
  allowlist: ReadonlySet<string>
) => {
  const checkedResult: Schema.JsonObject = Object.fromEntries(
    Object.entries(record).filter(
      ([key, value]) => value !== null || !allowlist.has(key)
    )
  );
  return checkedResult;
};

const projectDocumentedSpeechResponse = (
  record: Schema.JsonObject,
  allowlist: ReadonlySet<string>
) => {
  const checkedResult: Schema.JsonObject = Object.fromEntries(
    [...allowlist].flatMap((key) => {
      const value = record[key];
      return Object.hasOwn(record, key) && value !== undefined
        ? [[key, value]]
        : [];
    })
  );
  return checkedResult;
};

const normalizeModelSpecificSpeechProviderWord = (raw: Schema.Json) => {
  const checkedResult: Schema.Json = isUnknownRecord(raw)
    ? omitAllowlistedNullMetadata(
        projectDocumentedSpeechResponse(
          raw,
          ModelSpecificSpeechWordOptionalMetadataKeys
        ),
        ModelSpecificSpeechWordOptionalMetadataKeys
      )
    : raw;
  return checkedResult;
};

const normalizeModelSpecificSpeechProviderSegment = (raw: Schema.Json) => {
  if (!isUnknownRecord(raw)) {
    const checkedResult: Schema.Json = raw;
    return checkedResult;
  }
  const normalized = omitAllowlistedNullMetadata(
    projectDocumentedSpeechResponse(
      raw,
      ModelSpecificSpeechSegmentOptionalMetadataKeys
    ),
    ModelSpecificSpeechSegmentNullableMetadataKeys
  );
  {
    const checkedResult: Schema.Json = Array.isArray(normalized["words"])
      ? {
          ...normalized,
          words: normalized["words"].map(
            normalizeModelSpecificSpeechProviderWord
          ),
        }
      : normalized;
    return checkedResult;
  }
};

const normalizeModelSpecificSpeechProviderResponse = (
  raw: Schema.JsonObject
) => {
  const normalized = omitAllowlistedNullMetadata(
    raw,
    ModelSpecificSpeechResponseOptionalMetadataKeys
  );
  const transcriptionInfo = isUnknownRecord(normalized["transcription_info"])
    ? omitAllowlistedNullMetadata(
        projectDocumentedSpeechResponse(
          normalized["transcription_info"],
          ModelSpecificSpeechTranscriptionInfoOptionalMetadataKeys
        ),
        ModelSpecificSpeechTranscriptionInfoOptionalMetadataKeys
      )
    : normalized["transcription_info"];
  const segments = Array.isArray(normalized["segments"])
    ? normalized["segments"].map(normalizeModelSpecificSpeechProviderSegment)
    : normalized["segments"];
  let response: Schema.JsonObject = { ...normalized };
  if (transcriptionInfo !== undefined) {
    response = { ...response, transcription_info: transcriptionInfo };
  }
  if (segments !== undefined) {
    response = { ...response, segments };
  }
  {
    const checkedResult: Schema.JsonObject = response;
    return checkedResult;
  }
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
  record: Schema.JsonObject,
  allowlist: ReadonlySet<string>
) => {
  const checkedResult: boolean = Object.keys(record).some(
    (key) => !allowlist.has(key)
  );
  return checkedResult;
};

const SpeechUnknownMetadataMaximumTraversalDepth = 64;
const SpeechUnknownMetadataMaximumTraversalNodes = 16_384;

interface SpeechUnknownMetadataTraversal {
  discoveredNodes: number;
  readonly visitedContainers: WeakSet<object>;
}

const makeSpeechUnknownMetadataTraversal = () => {
  const checkedResult: SpeechUnknownMetadataTraversal = {
    discoveredNodes: 0,
    visitedContainers: new WeakSet<object>(),
  };
  return checkedResult;
};

const unknownSpeechMetadataRequiresRejection = (
  values: Iterable<Schema.Json>,
  traversal: SpeechUnknownMetadataTraversal
) => {
  const pending: { readonly depth: number; readonly value: Schema.Json }[] = [];
  const enqueue = (value: Schema.Json, depth: number) => {
    traversal.discoveredNodes += 1;
    if (
      traversal.discoveredNodes > SpeechUnknownMetadataMaximumTraversalNodes ||
      depth > SpeechUnknownMetadataMaximumTraversalDepth
    ) {
      const checkedResult = false;
      return checkedResult;
    }
    if (Predicate.isObjectOrArray(value)) {
      if (traversal.visitedContainers.has(value)) {
        const checkedResult = false;
        return checkedResult;
      }
      traversal.visitedContainers.add(value);
    }
    pending.push({ depth, value });
    {
      const checkedResult = true;
      return checkedResult;
    }
  };

  for (const value of values) {
    if (!enqueue(value, 0)) {
      const checkedResult = true;
      return checkedResult;
    }
  }

  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) {
      continue;
    }
    if (isUnknownRecord(current.value)) {
      if (Object.hasOwn(current.value, "text")) {
        const checkedResult = true;
        return checkedResult;
      }
      for (const value of Object.values(current.value)) {
        if (!enqueue(value, current.depth + 1)) {
          const checkedResult = true;
          return checkedResult;
        }
      }
      continue;
    }
    if (Array.isArray(current.value)) {
      for (const value of current.value) {
        if (!enqueue(value, current.depth + 1)) {
          const checkedResult = true;
          return checkedResult;
        }
      }
    }
  }

  {
    const checkedResult = false;
    return checkedResult;
  }
};

const hasAmbiguousSpeechWrapper = (raw: Schema.JsonObject) => {
  const checkedResult: boolean =
    Object.hasOwn(raw, "errors") ||
    Object.hasOwn(raw, "messages") ||
    Object.hasOwn(raw, "result") ||
    Object.hasOwn(raw, "success");
  return checkedResult;
};

const unknownSpeechMetadataValues = function* unknownSpeechMetadataValues(
  raw: Schema.JsonObject,
  allowlist: ReadonlySet<string>
) {
  for (const key of Object.keys(raw)) {
    const value = raw[key];
    if (!allowlist.has(key) && value !== undefined) {
      yield value;
    }
  }
};

const unknownSpeechContainerMetadataRequiresRejection = (
  raw: Schema.JsonObject,
  allowlist: ReadonlySet<string>,
  traversal: SpeechUnknownMetadataTraversal
) => {
  const checkedResult: boolean =
    (!allowlist.has("text") && Object.hasOwn(raw, "text")) ||
    unknownSpeechMetadataRequiresRejection(
      unknownSpeechMetadataValues(raw, allowlist),
      traversal
    );
  return checkedResult;
};

const isPresentNonNull = (record: Schema.JsonObject, key: string) => {
  const checkedResult: boolean =
    Object.hasOwn(record, key) && record[key] !== null;
  return checkedResult;
};

const hasWrongRootMetadataType = (raw: Schema.JsonObject) => {
  const checkedResult: boolean =
    (isPresentNonNull(raw, "vtt") && !Schema.is(Schema.String)(raw["vtt"])) ||
    (isPresentNonNull(raw, "word_count") &&
      !Schema.is(Schema.Number)(raw["word_count"]));
  return checkedResult;
};

const genericNestedContainersAreInvalid = (raw: Schema.JsonObject) => {
  const checkedResult: boolean =
    isPresentNonNull(raw, "words") && !Array.isArray(raw["words"]);
  return checkedResult;
};

const modelSpecificNestedContainersAreInvalid = (raw: Schema.JsonObject) => {
  if (
    (isPresentNonNull(raw, "segments") && !Array.isArray(raw["segments"])) ||
    (isPresentNonNull(raw, "transcription_info") &&
      !isUnknownRecord(raw["transcription_info"]))
  ) {
    const checkedResult = true;
    return checkedResult;
  }
  {
    const checkedResult: boolean =
      Array.isArray(raw["segments"]) &&
      raw["segments"].some(
        (segment) =>
          isUnknownRecord(segment) &&
          ((isPresentNonNull(segment, "tokens") &&
            !Array.isArray(segment["tokens"])) ||
            (isPresentNonNull(segment, "words") &&
              !Array.isArray(segment["words"])))
      );
    return checkedResult;
  }
};

const genericNestedEntriesAreInvalid = (raw: Schema.JsonObject) => {
  const checkedResult: boolean =
    Array.isArray(raw["words"]) &&
    raw["words"].some((word) => !isUnknownRecord(word));
  return checkedResult;
};

const modelSpecificNestedEntriesAreInvalid = (raw: Schema.JsonObject) => {
  const checkedResult: boolean =
    Array.isArray(raw["segments"]) &&
    raw["segments"].some(
      (segment) =>
        !isUnknownRecord(segment) ||
        (Array.isArray(segment["words"]) &&
          segment["words"].some((word) => !isUnknownRecord(word)))
    );
  return checkedResult;
};

const hasWrongNullableNumberType = (record: Schema.JsonObject, key: string) => {
  const checkedResult: boolean =
    isPresentNonNull(record, key) && !Schema.is(Schema.Number)(record[key]);
  return checkedResult;
};

const hasWrongNullableStringType = (record: Schema.JsonObject, key: string) => {
  const checkedResult: boolean =
    isPresentNonNull(record, key) && !Schema.is(Schema.String)(record[key]);
  return checkedResult;
};

const genericNestedMetadataTypesAreInvalid = (raw: Schema.JsonObject) => {
  const checkedResult: boolean =
    Array.isArray(raw["words"]) &&
    raw["words"].some(
      (word) =>
        isUnknownRecord(word) &&
        (hasWrongNullableNumberType(word, "end") ||
          hasWrongNullableNumberType(word, "start") ||
          hasWrongNullableStringType(word, "word"))
    );
  return checkedResult;
};

const modelSpecificNestedMetadataTypesAreInvalid = (raw: Schema.JsonObject) => {
  const transcriptionInfo = raw["transcription_info"];
  if (
    isUnknownRecord(transcriptionInfo) &&
    (hasWrongNullableNumberType(transcriptionInfo, "duration") ||
      hasWrongNullableNumberType(transcriptionInfo, "duration_after_vad") ||
      hasWrongNullableStringType(transcriptionInfo, "language") ||
      hasWrongNullableNumberType(transcriptionInfo, "language_probability"))
  ) {
    const checkedResult = true;
    return checkedResult;
  }
  {
    const checkedResult: boolean =
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
          segment["tokens"].some((token) => !Schema.is(Schema.Number)(token))
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
      });
    return checkedResult;
  }
};

const genericUnsupportedPropertyLocation = (raw: Schema.JsonObject) => {
  const checkedResult: SpeechEnvelopeUnsupportedLocation | undefined =
    Array.isArray(raw["words"]) &&
    raw["words"].some(
      (word) =>
        isUnknownRecord(word) &&
        hasUnsupportedProperty(
          word,
          ModelSpecificSpeechWordOptionalMetadataKeys
        )
    )
      ? "word"
      : undefined;
  return checkedResult;
};

const modelSpecificUnsupportedPropertyLocation = (
  raw: Schema.JsonObject,
  traversal: SpeechUnknownMetadataTraversal
) => {
  const transcriptionInfo = raw["transcription_info"];
  if (
    isUnknownRecord(transcriptionInfo) &&
    unknownSpeechContainerMetadataRequiresRejection(
      transcriptionInfo,
      ModelSpecificSpeechTranscriptionInfoOptionalMetadataKeys,
      traversal
    )
  ) {
    const checkedResult: SpeechEnvelopeUnsupportedLocation | undefined =
      "transcription_info";
    return checkedResult;
  }
  if (!Array.isArray(raw["segments"])) {
    const checkedResult: SpeechEnvelopeUnsupportedLocation | undefined =
      undefined;
    return checkedResult;
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
      const checkedResult: SpeechEnvelopeUnsupportedLocation | undefined =
        "segment";
      return checkedResult;
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
        const checkedResult: SpeechEnvelopeUnsupportedLocation | undefined =
          "word";
        return checkedResult;
      }
    }
  }
  {
    const checkedResult: SpeechEnvelopeUnsupportedLocation | undefined =
      undefined;
    return checkedResult;
  }
};

const classifySpeechEnvelopeFamily = (raw: Schema.JsonObject) => {
  const hasModelSpecificDiscriminator =
    Object.hasOwn(raw, "segments") || Object.hasOwn(raw, "transcription_info");
  const hasGenericDiscriminator = Object.hasOwn(raw, "words");
  if (hasModelSpecificDiscriminator && hasGenericDiscriminator) {
    const checkedResult: SpeechEnvelopeFamily = "unclassified";
    return checkedResult;
  }
  {
    const checkedResult: SpeechEnvelopeFamily = hasModelSpecificDiscriminator
      ? "model_specific"
      : "generic";
    return checkedResult;
  }
};

const classifySpeechEnvelope = (raw: Schema.Json | undefined) => {
  if (!isUnknownRecord(raw)) {
    const checkedResult: SpeechEnvelopeClassification = {
      failure: "not_object",
      family: "unclassified",
    };
    return checkedResult;
  }
  const family = classifySpeechEnvelopeFamily(raw);
  if (!Object.hasOwn(raw, "text")) {
    const checkedResult: SpeechEnvelopeClassification = {
      failure: "required_text_missing",
      family,
    };
    return checkedResult;
  }
  if (!Schema.is(Schema.String)(raw["text"])) {
    const checkedResult: SpeechEnvelopeClassification = {
      failure: "required_text_type",
      family,
    };
    return checkedResult;
  }
  if (hasWrongRootMetadataType(raw)) {
    const checkedResult: SpeechEnvelopeClassification = {
      failure: "root_metadata_type",
      family,
    };
    return checkedResult;
  }
  if (family === "unclassified") {
    const checkedResult: SpeechEnvelopeClassification = {
      failure: "unsupported_property",
      family,
      unsupportedLocation: "root",
      unsupportedRootProperty: "words",
    };
    return checkedResult;
  }
  if (hasAmbiguousSpeechWrapper(raw)) {
    const checkedResult: SpeechEnvelopeClassification = {
      failure: "unsupported_property",
      family,
      unsupportedLocation: "root",
      unsupportedRootProperty: "other",
    };
    return checkedResult;
  }
  const unknownMetadataTraversal = makeSpeechUnknownMetadataTraversal();
  if (
    unknownSpeechMetadataRequiresRejection(
      unknownSpeechMetadataValues(raw, SpeechProviderResponseKeys),
      unknownMetadataTraversal
    )
  ) {
    const checkedResult: SpeechEnvelopeClassification = {
      failure: "unsupported_property",
      family,
      unsupportedLocation: "root",
      unsupportedRootProperty: "other",
    };
    return checkedResult;
  }
  if (
    family === "generic"
      ? genericNestedContainersAreInvalid(raw)
      : modelSpecificNestedContainersAreInvalid(raw)
  ) {
    const checkedResult: SpeechEnvelopeClassification = {
      failure: "nested_container_type",
      family,
    };
    return checkedResult;
  }
  if (
    family === "generic"
      ? genericNestedEntriesAreInvalid(raw)
      : modelSpecificNestedEntriesAreInvalid(raw)
  ) {
    const checkedResult: SpeechEnvelopeClassification = {
      failure: "nested_entry_type",
      family,
    };
    return checkedResult;
  }
  if (
    family === "generic"
      ? genericNestedMetadataTypesAreInvalid(raw)
      : modelSpecificNestedMetadataTypesAreInvalid(raw)
  ) {
    const checkedResult: SpeechEnvelopeClassification = {
      failure: "nested_metadata_type",
      family,
    };
    return checkedResult;
  }
  const unsupportedLocation =
    family === "generic"
      ? genericUnsupportedPropertyLocation(raw)
      : modelSpecificUnsupportedPropertyLocation(raw, unknownMetadataTraversal);
  if (unsupportedLocation !== undefined) {
    const checkedResult: SpeechEnvelopeClassification = {
      failure: "unsupported_property",
      family,
      unsupportedLocation,
    };
    return checkedResult;
  }
  {
    const checkedResult: SpeechEnvelopeClassification = {
      failure: undefined,
      family,
    };
    return checkedResult;
  }
};

const rejectedSpeechEnvelope = (
  classification: ReturnType<typeof classifySpeechEnvelope>,
  defaultFailure: SpeechEnvelopeFailure
) => {
  let rejected: {
    readonly _tag: "Rejected";
    readonly decodeReason: "speech_envelope_schema_invalid";
    readonly decodeStage: "speech_envelope";
    readonly speechEnvelopeFailure: SpeechEnvelopeFailure;
    readonly speechEnvelopeFamily: SpeechEnvelopeFamily;
    readonly speechEnvelopeUnsupportedLocation?: SpeechEnvelopeUnsupportedLocation;
    readonly speechEnvelopeUnsupportedRootProperty?: SpeechEnvelopeUnsupportedRootProperty;
  } = {
    _tag: "Rejected",
    decodeReason: "speech_envelope_schema_invalid",
    decodeStage: "speech_envelope",
    speechEnvelopeFailure: classification.failure ?? defaultFailure,
    speechEnvelopeFamily: classification.family,
  };
  if (classification.unsupportedLocation !== undefined) {
    rejected = {
      ...rejected,
      speechEnvelopeUnsupportedLocation: classification.unsupportedLocation,
    };
  }
  if (classification.unsupportedRootProperty !== undefined) {
    rejected = {
      ...rejected,
      speechEnvelopeUnsupportedRootProperty:
        classification.unsupportedRootProperty,
    };
  }
  return rejected;
};

type SpeechResponse =
  | { readonly _tag: "Decoded"; readonly text: string }
  | { readonly _tag: "Absent" }
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
    };

export const decodeWorkersAiSpeechResponse = (raw: Schema.Json | undefined) => {
  const classification = classifySpeechEnvelope(raw);
  if (!isUnknownRecord(raw) || classification.failure !== undefined) {
    const checkedResult: SpeechResponse = rejectedSpeechEnvelope(
      classification,
      "not_object"
    );
    return checkedResult;
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
    const checkedResult: SpeechResponse = rejectedSpeechEnvelope(
      classification,
      "semantic_constraint"
    );
    return checkedResult;
  }
  const normalized = envelope.value.trim();
  if (normalized.length === 0) {
    const segmentWords = Array.isArray(raw["segments"])
      ? raw["segments"].map((entry) =>
          isUnknownRecord(entry) ? entry["words"] : undefined
        )
      : [];
    const nestedText =
      [raw["segments"], raw["words"], ...segmentWords].some(
        (entries) =>
          Array.isArray(entries) &&
          entries.some(
            (entry) =>
              isUnknownRecord(entry) &&
              [entry["text"], entry["word"]].some(
                (value) => Predicate.isString(value) && value.trim().length > 0
              )
          )
      ) ||
      (Predicate.isNumber(raw["word_count"]) && raw["word_count"] > 0);
    {
      const checkedResult: SpeechResponse = nestedText
        ? rejectedSpeechEnvelope(classification, "semantic_constraint")
        : { _tag: "Absent" };
      return checkedResult;
    }
  }
  const text = Schema.decodeUnknownOption(SpeechTranscript.fields.text)(
    normalized
  );
  {
    const checkedResult: SpeechResponse = Option.match(text, {
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
    return checkedResult;
  }
};

/** Build the speech request without owning credentials, transport, or dispatch. */
export const workersAiSpeechRequest = <Language extends string>(
  audio: Uint8Array,
  language: Language
) =>
  ({
    audio: encodeBase64(audio),
    condition_on_previous_text: false,
    language,
    task: "transcribe",
    vad_filter: true,
  }) as const;
