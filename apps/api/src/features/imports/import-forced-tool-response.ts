import { Option, Schema } from "effect";

const ForcedToolJsonObject = Schema.Record(Schema.String, Schema.Json);
type ForcedToolJsonObject = typeof ForcedToolJsonObject.Type;
const decodeForcedToolJsonObject =
  Schema.decodeUnknownOption(ForcedToolJsonObject);

const ForcedToolResponsePart = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  params: Schema.optionalKey(Schema.Json),
  text: Schema.optionalKey(Schema.String),
  type: Schema.optionalKey(Schema.String),
});
type ForcedToolResponsePart = typeof ForcedToolResponsePart.Type;
const decodeForcedToolResponsePart = Schema.decodeUnknownOption(
  ForcedToolResponsePart,
  { onExcessProperty: "ignore" }
);

interface NativeForcedToolEnvelope {
  readonly arguments: ForcedToolJsonObject;
  readonly name: string;
}

type NativeForcedToolDecode =
  | { readonly _tag: "Call"; readonly call: NativeForcedToolEnvelope }
  | { readonly _tag: "Invalid" }
  | { readonly _tag: "Prose" }
  | {
      readonly _tag: "Value";
      readonly value: ForcedToolJsonObject;
      readonly wrappedInArray: boolean;
    };

export type ForcedToolDecodeReason =
  | "invalid_arguments"
  | "invalid_cardinality"
  | "invalid_native_envelope"
  | "mirror_mismatch"
  | "missing_content"
  | "unexpected_tool_name";

export type ForcedToolResponseDecode =
  | { readonly _tag: "Decoded"; readonly value: ForcedToolJsonObject }
  | {
      readonly _tag: "Malformed";
      readonly reason: Exclude<ForcedToolDecodeReason, "missing_content">;
    }
  | { readonly _tag: "Missing"; readonly reason: "missing_content" };

const isRecord = (value: Schema.Json | undefined): value is Schema.JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const decodeArguments = (
  value: Schema.Json | undefined
): ForcedToolJsonObject | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (isRecord(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  try {
    return Option.getOrUndefined(decodeForcedToolJsonObject(JSON.parse(value)));
  } catch {
    return undefined;
  }
};

type ForcedToolJsonDecode =
  | { readonly _tag: "Parsed"; readonly value: Schema.Json }
  | Extract<NativeForcedToolDecode, { readonly _tag: "Invalid" | "Prose" }>;

const decodeForcedToolJson = (text: string): ForcedToolJsonDecode => {
  try {
    const decoded = Schema.decodeUnknownOption(Schema.Json)(JSON.parse(text));
    return Option.isSome(decoded)
      ? { _tag: "Parsed", value: decoded.value }
      : { _tag: "Invalid" };
  } catch {
    const trimmed = text.trimStart();
    return trimmed.startsWith("{") || trimmed.startsWith("[")
      ? { _tag: "Invalid" }
      : { _tag: "Prose" };
  }
};

const decodeNativeForcedToolEnvelope = (
  text: string
): NativeForcedToolDecode => {
  const decodedJson = decodeForcedToolJson(text);
  if (decodedJson._tag !== "Parsed") {
    return decodedJson;
  }
  const parsed = decodedJson.value;
  let envelope = parsed;
  const wrappedInArray = Array.isArray(parsed);
  if (Array.isArray(parsed)) {
    if (parsed.length !== 1) {
      return { _tag: "Invalid" };
    }
    [envelope] = parsed;
  }
  if (!isRecord(envelope)) {
    return { _tag: "Invalid" };
  }

  const keys = Object.keys(envelope).toSorted();
  const hasArguments = Object.hasOwn(envelope, "arguments");
  const hasParameters = Object.hasOwn(envelope, "parameters");
  const { name } = envelope;
  const isExactEnvelope =
    hasArguments !== hasParameters &&
    keys.length === 2 &&
    keys[0] === (hasArguments ? "arguments" : "name") &&
    keys[1] === (hasArguments ? "name" : "parameters") &&
    typeof name === "string";
  if (!isExactEnvelope) {
    return hasArguments || hasParameters || typeof name === "string"
      ? { _tag: "Invalid" }
      : { _tag: "Value", value: envelope, wrappedInArray };
  }
  if (typeof name !== "string") {
    return { _tag: "Invalid" };
  }

  const argumentsValue = hasArguments
    ? envelope["arguments"]
    : envelope["parameters"];
  const decodedArguments = decodeArguments(argumentsValue);
  if (decodedArguments === undefined) {
    return { _tag: "Invalid" };
  }
  return {
    _tag: "Call",
    call: {
      arguments: decodedArguments,
      name,
    },
  };
};

export const structurallyEqualJson = (
  left: Schema.Json | undefined,
  right: Schema.Json | undefined
): boolean => {
  if (Object.is(left, right)) {
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => structurallyEqualJson(value, right[index]))
    );
  }
  if (!isRecord(left) || !isRecord(right)) {
    return false;
  }
  const leftKeys = Object.keys(left).toSorted();
  const rightKeys = Object.keys(right).toSorted();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] && structurallyEqualJson(left[key], right[key])
    )
  );
};

const decodeTextOnlyForcedToolResponse = (
  text: readonly (ForcedToolResponsePart & { readonly text: string })[],
  expectedName: string,
  acceptUnwrappedObject: boolean
): ForcedToolResponseDecode => {
  const [part] = text;
  if (part === undefined) {
    return { _tag: "Missing", reason: "missing_content" };
  }
  if (text.length !== 1) {
    return { _tag: "Malformed", reason: "invalid_cardinality" };
  }
  const envelope = decodeNativeForcedToolEnvelope(part.text);
  if (
    envelope._tag === "Value" &&
    acceptUnwrappedObject &&
    !envelope.wrappedInArray
  ) {
    return { _tag: "Decoded", value: envelope.value };
  }
  if (envelope._tag !== "Call") {
    return { _tag: "Malformed", reason: "invalid_native_envelope" };
  }
  return envelope.call.name === expectedName
    ? { _tag: "Decoded", value: envelope.call.arguments }
    : { _tag: "Malformed", reason: "unexpected_tool_name" };
};

/**
 * Selects the one authoritative forced-tool argument object without exposing
 * native response text. The installed provider may mirror one call as both a
 * structured part and native JSON. A native mirror is authoritative only when
 * its decoded argument object is structurally identical to the structured
 * call. A caller may explicitly accept one direct bare object when its
 * downstream schema is the sole authority; array-wrapped or competing values
 * remain invalid.
 */
export const decodeForcedToolResponseResult = (
  content: readonly unknown[],
  expectedName: string,
  options?: {
    readonly acceptUnwrappedObject?: boolean;
  }
): ForcedToolResponseDecode => {
  const parts = content.flatMap((part) =>
    Option.match(decodeForcedToolResponsePart(part), {
      onNone: () => [],
      onSome: (decoded) => [decoded],
    })
  );
  const structured = parts.filter((part) => part.type === "tool-call");
  const text = parts.filter(
    (part): part is ForcedToolResponsePart & { readonly text: string } =>
      part.type === "text" && typeof part.text === "string"
  );

  if (structured.length > 0) {
    if (structured.length !== 1) {
      return { _tag: "Malformed", reason: "invalid_cardinality" };
    }
    const [call] = structured;
    if (call?.name !== expectedName) {
      return { _tag: "Malformed", reason: "unexpected_tool_name" };
    }
    const structuredArguments = decodeArguments(call.params);
    if (structuredArguments === undefined) {
      return { _tag: "Malformed", reason: "invalid_arguments" };
    }
    const native = text.map((part) =>
      decodeNativeForcedToolEnvelope(part.text)
    );
    if (native.some((result) => result._tag === "Invalid")) {
      return { _tag: "Malformed", reason: "invalid_native_envelope" };
    }
    const nativeMirrors = native.flatMap((result) =>
      result._tag === "Call" || result._tag === "Value" ? [result] : []
    );
    if (nativeMirrors.length === 0) {
      return { _tag: "Decoded", value: structuredArguments };
    }
    if (nativeMirrors.length !== 1) {
      return { _tag: "Malformed", reason: "invalid_cardinality" };
    }
    const [nativeMirror] = nativeMirrors;
    if (
      nativeMirror?._tag === "Call" &&
      nativeMirror.call.name !== expectedName
    ) {
      return { _tag: "Malformed", reason: "unexpected_tool_name" };
    }
    const mirroredArguments =
      nativeMirror?._tag === "Call"
        ? nativeMirror.call.arguments
        : nativeMirror?.value;
    return structurallyEqualJson(structuredArguments, mirroredArguments)
      ? { _tag: "Decoded", value: structuredArguments }
      : { _tag: "Malformed", reason: "mirror_mismatch" };
  }

  return decodeTextOnlyForcedToolResponse(
    text,
    expectedName,
    options?.acceptUnwrappedObject === true
  );
};

export const decodeForcedToolResponse = (
  content: readonly unknown[],
  expectedName: string
): ForcedToolJsonObject | undefined => {
  const result = decodeForcedToolResponseResult(content, expectedName);
  return result._tag === "Decoded" ? result.value : undefined;
};
