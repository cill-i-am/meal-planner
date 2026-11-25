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

type ForcedToolDecodeReason =
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
  Schema.is(ForcedToolJsonObject)(value);

const decodeArguments = (value: Schema.Json | undefined) => {
  if (value === undefined) {
    const checkedResult: ForcedToolJsonObject | undefined = undefined;
    return checkedResult;
  }
  if (isRecord(value)) {
    const checkedResult: ForcedToolJsonObject | undefined = value;
    return checkedResult;
  }
  if (!Schema.is(Schema.String)(value)) {
    const checkedResult: ForcedToolJsonObject | undefined = undefined;
    return checkedResult;
  }
  try {
    const checkedResult: ForcedToolJsonObject | undefined =
      Option.getOrUndefined(decodeForcedToolJsonObject(JSON.parse(value)));
    return checkedResult;
  } catch {
    const checkedResult: ForcedToolJsonObject | undefined = undefined;
    return checkedResult;
  }
};

type ForcedToolJsonDecode =
  | { readonly _tag: "Parsed"; readonly value: Schema.Json }
  | Extract<NativeForcedToolDecode, { readonly _tag: "Invalid" | "Prose" }>;

const decodeForcedToolJson = (text: string) => {
  try {
    const decoded = Schema.decodeUnknownOption(Schema.Json)(JSON.parse(text));
    {
      const checkedResult: ForcedToolJsonDecode = Option.isSome(decoded)
        ? { _tag: "Parsed", value: decoded.value }
        : { _tag: "Invalid" };
      return checkedResult;
    }
  } catch {
    const trimmed = text.trimStart();
    {
      const checkedResult: ForcedToolJsonDecode =
        trimmed.startsWith("{") || trimmed.startsWith("[")
          ? { _tag: "Invalid" }
          : { _tag: "Prose" };
      return checkedResult;
    }
  }
};

const decodeNativeForcedToolEnvelope = (text: string) => {
  const decodedJson = decodeForcedToolJson(text);
  if (decodedJson._tag !== "Parsed") {
    const checkedResult: NativeForcedToolDecode = decodedJson;
    return checkedResult;
  }
  const parsed = decodedJson.value;
  let envelope = parsed;
  const wrappedInArray = Array.isArray(parsed);
  if (Array.isArray(parsed)) {
    if (parsed.length !== 1) {
      const checkedResult: NativeForcedToolDecode = { _tag: "Invalid" };
      return checkedResult;
    }
    [envelope] = parsed;
  }
  if (!isRecord(envelope)) {
    const checkedResult: NativeForcedToolDecode = { _tag: "Invalid" };
    return checkedResult;
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
    Schema.is(Schema.String)(name);
  if (!isExactEnvelope) {
    const checkedResult: NativeForcedToolDecode =
      hasArguments || hasParameters || Schema.is(Schema.String)(name)
        ? { _tag: "Invalid" }
        : { _tag: "Value", value: envelope, wrappedInArray };
    return checkedResult;
  }
  if (!Schema.is(Schema.String)(name)) {
    const checkedResult: NativeForcedToolDecode = { _tag: "Invalid" };
    return checkedResult;
  }

  const argumentsValue = hasArguments
    ? envelope["arguments"]
    : envelope["parameters"];
  const decodedArguments = decodeArguments(argumentsValue);
  if (decodedArguments === undefined) {
    const checkedResult: NativeForcedToolDecode = { _tag: "Invalid" };
    return checkedResult;
  }
  {
    const checkedResult: NativeForcedToolDecode = {
      _tag: "Call",
      call: {
        arguments: decodedArguments,
        name,
      },
    };
    return checkedResult;
  }
};

export const structurallyEqualJson: (
  left: Schema.Json | undefined,
  right: Schema.Json | undefined
) => boolean = (left, right) => {
  if (Object.is(left, right)) {
    const checkedResult = true;
    return checkedResult;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    const checkedResult =
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => structurallyEqualJson(value, right[index]));
    return checkedResult;
  }
  if (!isRecord(left) || !isRecord(right)) {
    const checkedResult = false;
    return checkedResult;
  }
  const leftKeys = Object.keys(left).toSorted();
  const rightKeys = Object.keys(right).toSorted();
  {
    const checkedResult =
      leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (key, index) =>
          key === rightKeys[index] &&
          structurallyEqualJson(left[key], right[key])
      );
    return checkedResult;
  }
};

const decodeTextOnlyForcedToolResponse = (
  text: readonly (ForcedToolResponsePart & { readonly text: string })[],
  expectedName: string,
  acceptUnwrappedObject: boolean
) => {
  const [part] = text;
  if (part === undefined) {
    const checkedResult: ForcedToolResponseDecode = {
      _tag: "Missing",
      reason: "missing_content",
    };
    return checkedResult;
  }
  if (text.length !== 1) {
    const checkedResult: ForcedToolResponseDecode = {
      _tag: "Malformed",
      reason: "invalid_cardinality",
    };
    return checkedResult;
  }
  const envelope = decodeNativeForcedToolEnvelope(part.text);
  if (
    envelope._tag === "Value" &&
    acceptUnwrappedObject &&
    !envelope.wrappedInArray
  ) {
    const checkedResult: ForcedToolResponseDecode = {
      _tag: "Decoded",
      value: envelope.value,
    };
    return checkedResult;
  }
  if (envelope._tag !== "Call") {
    const checkedResult: ForcedToolResponseDecode = {
      _tag: "Malformed",
      reason: "invalid_native_envelope",
    };
    return checkedResult;
  }
  {
    const checkedResult: ForcedToolResponseDecode =
      envelope.call.name === expectedName
        ? { _tag: "Decoded", value: envelope.call.arguments }
        : { _tag: "Malformed", reason: "unexpected_tool_name" };
    return checkedResult;
  }
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
) => {
  const parts = content.flatMap((part) =>
    Option.match(decodeForcedToolResponsePart(part), {
      onNone: () => [],
      onSome: (decoded) => [decoded],
    })
  );
  const structured = parts.filter((part) => part.type === "tool-call");
  const text = parts.filter(
    (part): part is ForcedToolResponsePart & { readonly text: string } =>
      part.type === "text" && part.text !== undefined
  );

  if (structured.length > 0) {
    if (structured.length !== 1) {
      const checkedResult: ForcedToolResponseDecode = {
        _tag: "Malformed",
        reason: "invalid_cardinality",
      };
      return checkedResult;
    }
    const [call] = structured;
    if (call?.name !== expectedName) {
      const checkedResult: ForcedToolResponseDecode = {
        _tag: "Malformed",
        reason: "unexpected_tool_name",
      };
      return checkedResult;
    }
    const structuredArguments = decodeArguments(call.params);
    if (structuredArguments === undefined) {
      const checkedResult: ForcedToolResponseDecode = {
        _tag: "Malformed",
        reason: "invalid_arguments",
      };
      return checkedResult;
    }
    const native = text.map((part) =>
      decodeNativeForcedToolEnvelope(part.text)
    );
    if (native.some((result) => result._tag === "Invalid")) {
      const checkedResult: ForcedToolResponseDecode = {
        _tag: "Malformed",
        reason: "invalid_native_envelope",
      };
      return checkedResult;
    }
    const nativeMirrors = native.flatMap((result) =>
      result._tag === "Call" || result._tag === "Value" ? [result] : []
    );
    if (nativeMirrors.length === 0) {
      const checkedResult: ForcedToolResponseDecode = {
        _tag: "Decoded",
        value: structuredArguments,
      };
      return checkedResult;
    }
    if (nativeMirrors.length !== 1) {
      const checkedResult: ForcedToolResponseDecode = {
        _tag: "Malformed",
        reason: "invalid_cardinality",
      };
      return checkedResult;
    }
    const [nativeMirror] = nativeMirrors;
    if (
      nativeMirror?._tag === "Call" &&
      nativeMirror.call.name !== expectedName
    ) {
      const checkedResult: ForcedToolResponseDecode = {
        _tag: "Malformed",
        reason: "unexpected_tool_name",
      };
      return checkedResult;
    }
    const mirroredArguments =
      nativeMirror?._tag === "Call"
        ? nativeMirror.call.arguments
        : nativeMirror?.value;
    {
      const checkedResult: ForcedToolResponseDecode = structurallyEqualJson(
        structuredArguments,
        mirroredArguments
      )
        ? { _tag: "Decoded", value: structuredArguments }
        : { _tag: "Malformed", reason: "mirror_mismatch" };
      return checkedResult;
    }
  }

  {
    const checkedResult: ForcedToolResponseDecode =
      decodeTextOnlyForcedToolResponse(
        text,
        expectedName,
        options?.acceptUnwrappedObject === true
      );
    return checkedResult;
  }
};
