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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const decodeNativeForcedToolEnvelope = (
  text: string
): NativeForcedToolEnvelope | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  let envelope = parsed;
  if (Array.isArray(parsed)) {
    if (parsed.length !== 1) {
      return undefined;
    }
    [envelope] = parsed;
  }
  if (!isRecord(envelope)) {
    return undefined;
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
    return undefined;
  }

  const argumentsValue = hasArguments
    ? envelope["arguments"]
    : envelope["parameters"];
  if (!isRecord(argumentsValue)) {
    return undefined;
  }
  return {
    arguments: argumentsValue,
    name: envelope["name"],
  };
};

/**
 * Selects the one authoritative forced-tool argument object without exposing
 * native response text. Structured tool parts remain authoritative unless a
 * second valid native call makes the response ambiguous.
 */
export const decodeForcedToolResponse = (
  content: readonly unknown[],
  expectedName: string
): unknown | undefined => {
  const parts = content.filter(isRecord) as readonly ForcedToolResponsePart[];
  const structured = parts.filter((part) => part.type === "tool-call");
  const text = parts.filter(
    (part): part is ForcedToolResponsePart & { readonly text: string } =>
      part.type === "text" && typeof part.text === "string"
  );

  if (structured.length > 0) {
    const [call] = structured;
    const hasNativeCall = text.some(
      (part) => decodeNativeForcedToolEnvelope(part.text) !== undefined
    );
    return structured.length === 1 &&
      call?.name === expectedName &&
      !hasNativeCall
      ? call.params
      : undefined;
  }

  const [part] = text;
  if (part === undefined || text.length !== 1) {
    return undefined;
  }
  const envelope = decodeNativeForcedToolEnvelope(part.text);
  return envelope?.name === expectedName ? envelope.arguments : undefined;
};
