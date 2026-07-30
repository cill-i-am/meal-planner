interface ForcedToolResponsePart {
  readonly name?: string;
  readonly params?: unknown;
  readonly text?: string;
  readonly type?: string;
}

interface NativeForcedToolEnvelope {
  readonly arguments: Record<string, unknown>;
  readonly name: string;
}

type NativeForcedToolDecode =
  | { readonly _tag: "Call"; readonly call: NativeForcedToolEnvelope }
  | { readonly _tag: "Invalid" }
  | { readonly _tag: "Prose" }
  | { readonly _tag: "Value"; readonly value: Record<string, unknown> };

export type ForcedToolDecodeReason =
  | "invalid_arguments"
  | "invalid_cardinality"
  | "invalid_native_envelope"
  | "mirror_mismatch"
  | "missing_content"
  | "unexpected_tool_name";

export type ForcedToolResponseDecode =
  | { readonly _tag: "Decoded"; readonly value: Record<string, unknown> }
  | {
      readonly _tag: "Malformed";
      readonly reason: Exclude<ForcedToolDecodeReason, "missing_content">;
    }
  | { readonly _tag: "Missing"; readonly reason: "missing_content" };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const decodeArguments = (
  value: unknown
): Record<string, unknown> | undefined => {
  if (isRecord(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const decodeNativeForcedToolEnvelope = (
  text: string
): NativeForcedToolDecode => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    const trimmed = text.trimStart();
    return trimmed.startsWith("{") || trimmed.startsWith("[")
      ? { _tag: "Invalid" }
      : { _tag: "Prose" };
  }
  let envelope = parsed;
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
      : { _tag: "Value", value: envelope };
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

const structurallyEqualJson = (left: unknown, right: unknown): boolean => {
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

/**
 * Selects the one authoritative forced-tool argument object without exposing
 * native response text. The installed provider may mirror one call as both a
 * structured part and native JSON. A native mirror is authoritative only when
 * its decoded argument object is structurally identical to the structured
 * call; a bare object is never accepted without that structured authority.
 */
export const decodeForcedToolResponseResult = (
  content: readonly unknown[],
  expectedName: string
): ForcedToolResponseDecode => {
  const parts = content.filter(isRecord) as readonly ForcedToolResponsePart[];
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

  const [part] = text;
  if (part === undefined) {
    return { _tag: "Missing", reason: "missing_content" };
  }
  if (text.length !== 1) {
    return { _tag: "Malformed", reason: "invalid_cardinality" };
  }
  const envelope = decodeNativeForcedToolEnvelope(part.text);
  if (envelope._tag !== "Call") {
    return { _tag: "Malformed", reason: "invalid_native_envelope" };
  }
  return envelope.call.name === expectedName
    ? { _tag: "Decoded", value: envelope.call.arguments }
    : { _tag: "Malformed", reason: "unexpected_tool_name" };
};

export const decodeForcedToolResponse = (
  content: readonly unknown[],
  expectedName: string
): unknown | undefined => {
  const result = decodeForcedToolResponseResult(content, expectedName);
  return result._tag === "Decoded" ? result.value : undefined;
};
