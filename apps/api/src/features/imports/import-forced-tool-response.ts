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
  | { readonly _tag: "Prose" };

export type ForcedToolResponseDecode =
  | { readonly _tag: "Decoded"; readonly value: Record<string, unknown> }
  | { readonly _tag: "Malformed" }
  | { readonly _tag: "Missing" };

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
  if (
    hasArguments === hasParameters ||
    keys.length !== 2 ||
    keys[0] !== (hasArguments ? "arguments" : "name") ||
    keys[1] !== (hasArguments ? "name" : "parameters") ||
    typeof envelope["name"] !== "string"
  ) {
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
      name: envelope["name"],
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
 * structured part and a native JSON envelope; that pair is authoritative only
 * when the decoded names and argument objects are structurally identical.
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
    const [call] = structured;
    const structuredArguments = decodeArguments(call?.params);
    if (
      structured.length !== 1 ||
      call?.name !== expectedName ||
      structuredArguments === undefined
    ) {
      return { _tag: "Malformed" };
    }
    const native = text.map((part) =>
      decodeNativeForcedToolEnvelope(part.text)
    );
    if (native.some((result) => result._tag === "Invalid")) {
      return { _tag: "Malformed" };
    }
    const nativeCalls = native.flatMap((result) =>
      result._tag === "Call" ? [result.call] : []
    );
    if (nativeCalls.length === 0) {
      return { _tag: "Decoded", value: structuredArguments };
    }
    const [nativeCall] = nativeCalls;
    return nativeCalls.length === 1 &&
      nativeCall?.name === expectedName &&
      structurallyEqualJson(structuredArguments, nativeCall.arguments)
      ? { _tag: "Decoded", value: structuredArguments }
      : { _tag: "Malformed" };
  }

  const [part] = text;
  if (part === undefined) {
    return { _tag: "Missing" };
  }
  if (text.length !== 1) {
    return { _tag: "Malformed" };
  }
  const envelope = decodeNativeForcedToolEnvelope(part.text);
  return envelope._tag === "Call" && envelope.call.name === expectedName
    ? { _tag: "Decoded", value: envelope.call.arguments }
    : { _tag: "Malformed" };
};

export const decodeForcedToolResponse = (
  content: readonly unknown[],
  expectedName: string
): unknown | undefined => {
  const result = decodeForcedToolResponseResult(content, expectedName);
  return result._tag === "Decoded" ? result.value : undefined;
};
