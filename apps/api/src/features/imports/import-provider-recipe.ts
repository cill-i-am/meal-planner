import type { QueryGatewayClient } from "alchemy/Cloudflare/AI";
import { Cause, Effect, Option, Schema } from "effect";
import type { SchemaIssue } from "effect";
import { Tool } from "effect/unstable/ai";

import {
  isPilotProviderKnownZeroCostFailure,
  pilotProviderKnownZeroCostFailure,
} from "../pilots/pilot-provider-budget.js";
import type {
  ImportCorrelationId,
  ImportObservabilityTraceStoreShape,
  ProviderDecodeReason,
} from "./import-observability.js";
import {
  ImportObservabilityTraceStore,
  emitImportObservabilityEvent,
} from "./import-observability.js";
import {
  ProviderKnownZeroSetupFailureMessage,
  ProviderName,
  ProviderNormalizationRejectionError,
  adapterFailure,
  comparableToolArguments,
  failAfter,
  isSafeProviderFailureCode,
  isUnknownRecord,
  noLogWorkersAiClient,
  pricedTokenUsage,
  providerErrorDescription,
  providerNormalizationDecodeReasonFromDescription,
  safeFailureCode,
} from "./import-provider-kernel.js";
import type {
  ProviderDispatchGate,
  ProviderDispatchRequest,
  ProviderRawToolCall,
  SafeProviderFailureCode,
  WorkersAiBinding,
} from "./import-provider-kernel.js";
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

export const InstalledRecipeModel =
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast" as const;

const RecipeMaximumCostMicroUsd = 100_000;

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

type RecipeDispatchOutcome =
  | {
      readonly _tag: "Extracted";
      readonly extraction: RecipeExtraction;
    }
  | {
      readonly _tag: "Failed";
      readonly code: SafeProviderFailureCode;
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
    RecipeDispatchOutcome,
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
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "_tag" in parsed &&
        parsed._tag === "Failed" &&
        "code" in parsed &&
        isSafeProviderFailureCode(parsed.code)
      ) {
        return {
          _tag: "Failed" as const,
          code: parsed.code,
        };
      }
      const extraction = yield* Schema.decodeUnknownEffect(RecipeExtraction, {
        onExcessProperty: "error",
      })(parsed).pipe(Effect.mapError(() => "malformed_response" as const));
      return {
        _tag: "Extracted" as const,
        extraction,
      };
    }),
  encode: (value) =>
    Effect.gen(function* encodeRecipeReplay() {
      const encodedValue =
        value._tag === "Failed"
          ? value
          : Schema.encodeSync(RecipeExtraction)(value.extraction);
      const valueJson = JSON.stringify(encodedValue);
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

const recipePromptText = (input: RecipeEvidenceAssembly) =>
  [
    "Select only recipe values supported by the supplied evidence. " +
      "Copy short exact phrases from the evidence whenever possible. " +
      "Return null for an unsupported scalar and an empty array for an " +
      "unsupported list. If the content is not food or not a recipe, return " +
      "null scalars and empty ingredientLines and instructions.",
    "Select ingredientLines as individual ingredient phrases and instructions " +
      "as individual cooking-action phrases. When the evidence contains both " +
      "an ingredient phrase and a cooking-action phrase, ingredientLines and " +
      "instructions must each contain at least one short exact supported phrase. " +
      "Do not reject recipe narration merely because quantities, timings, title, " +
      "or other fields are missing. Include a numeric value only when the exact " +
      "number and its unit occur in the evidence. Do not return source identity, " +
      "citations, provenance, confidence, state, reasons, or unresolved-field " +
      "bookkeeping; the trusted adapter derives those.",
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
const RecipeJsonModeTransportEnvelope = Schema.Struct({
  response: Schema.Unknown,
  usage: Schema.optionalKey(Schema.Unknown),
});
const decodeRecipeTransportUsage = Schema.decodeUnknownOption(
  RecipeTransportUsage,
  { onExcessProperty: "error" }
);
const decodeRecipeJsonModeTransportEnvelope = Schema.decodeUnknownResult(
  RecipeJsonModeTransportEnvelope,
  { onExcessProperty: "error" }
);

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

const canonicalizeRawRecipeToolCall = (
  call: ProviderRawToolCall
): ProviderRawToolCall => {
  if (call.name !== "record_recipe") {
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

const recipeJsonModeRequest = (request: RecipeEvidenceAssembly) => ({
  max_tokens: 16_384,
  messages: [{ content: recipePromptText(request), role: "user" as const }],
  response_format: {
    json_schema: Tool.getJsonSchemaFromSchema(RecipeProviderToolArguments),
    type: "json_schema" as const,
  },
  temperature: 0,
});

type RecipeJsonModeOutcome =
  | {
      readonly _tag: "Decoded";
      readonly inputTokens: number | undefined;
      readonly outputTokens: number | undefined;
      readonly value: typeof RecipeExtractionSemantics.Type;
    }
  | {
      readonly _tag: "Failed";
      readonly code: SafeProviderFailureCode;
    };

const runRecipeJsonMode = (
  ai: WorkersAiBinding,
  model: string,
  request: RecipeEvidenceAssembly,
  observability: {
    readonly correlationId: ImportCorrelationId;
    readonly traceStore: ImportObservabilityTraceStoreShape | undefined;
  }
) =>
  failAfter(
    Effect.gen(function* invokeRecipeJsonMode() {
      const response = yield* Effect.tryPromise({
        catch: (error) => error,
        try: () =>
          (
            ai.run as unknown as (
              model: string,
              body: unknown
            ) => Promise<Response>
          )(model, recipeJsonModeRequest(request)),
      });
      if (!response.ok) {
        return {
          _tag: "Failed" as const,
          code: safeFailureCode(Cause.fail({ status: response.status })),
        } satisfies RecipeJsonModeOutcome;
      }
      const raw = Option.getOrUndefined(
        yield* Effect.tryPromise({
          catch: () => "malformed_response" as const,
          try: () => response.json(),
        }).pipe(Effect.option)
      );
      if (raw === undefined) {
        return {
          _tag: "Failed" as const,
          code: "malformed_response" as const,
        } satisfies RecipeJsonModeOutcome;
      }
      const envelope = decodeRecipeJsonModeTransportEnvelope(raw);
      if (envelope._tag === "Failure") {
        yield* emitImportObservabilityEvent(
          {
            correlationId: observability.correlationId,
            decodeReason: "json_mode_envelope_invalid",
            decodeStage: "json_mode_envelope",
            event: "provider.decode",
            outcome: "malformed",
            providerStage: "recipe",
          },
          observability.traceStore
        );
        return {
          _tag: "Failed" as const,
          code: "malformed_response" as const,
        } satisfies RecipeJsonModeOutcome;
      }
      const selection = decodeRecipeProviderSelection(
        envelope.success.response
      );
      if (selection._tag === "Failure") {
        yield* emitImportObservabilityEvent(
          {
            correlationId: observability.correlationId,
            decodeReason: "json_mode_schema_invalid",
            decodeStage: "recipe_schema",
            event: "provider.decode",
            outcome: "malformed",
            providerStage: "recipe",
          },
          observability.traceStore
        );
        return {
          _tag: "Failed" as const,
          code: "malformed_response" as const,
        } satisfies RecipeJsonModeOutcome;
      }
      const usage =
        envelope.success.usage === undefined
          ? undefined
          : Option.getOrUndefined(
              decodeRecipeTransportUsage(envelope.success.usage)
            );
      if (
        envelope.success.usage !== undefined &&
        (usage === undefined ||
          usage.prompt_tokens + usage.completion_tokens !== usage.total_tokens)
      ) {
        yield* emitImportObservabilityEvent(
          {
            correlationId: observability.correlationId,
            decodeReason: "json_mode_envelope_invalid",
            decodeStage: "json_mode_envelope",
            event: "provider.decode",
            outcome: "malformed",
            providerStage: "recipe",
          },
          observability.traceStore
        );
        return {
          _tag: "Failed" as const,
          code: "malformed_response" as const,
        } satisfies RecipeJsonModeOutcome;
      }
      yield* emitImportObservabilityEvent(
        {
          correlationId: observability.correlationId,
          event: "provider.decode",
          outcome: "succeeded",
          providerStage: "recipe",
        },
        observability.traceStore
      );
      return {
        _tag: "Decoded" as const,
        inputTokens: usage?.prompt_tokens,
        outputTokens: usage?.completion_tokens,
        value: selection.success,
      } satisfies RecipeJsonModeOutcome;
    }),
    {
      correlationId: observability.correlationId,
      providerStage: "recipe",
      traceStore: observability.traceStore,
    }
  ).pipe(
    // eslint-disable-next-line promise/prefer-await-to-callbacks -- Effect callbacks preserve the typed error channel.
    Effect.tapError((error) => {
      const decodeReason = providerNormalizationDecodeReasonFromDescription(
        error instanceof Error ? error.message : providerErrorDescription(error)
      );
      return decodeReason === undefined
        ? Effect.void
        : emitImportObservabilityEvent(
            {
              correlationId: observability.correlationId,
              decodeReason,
              decodeStage: "provider_normalization",
              event: "provider.decode",
              outcome: "malformed",
              providerStage: "recipe",
            },
            observability.traceStore
          );
    }),
    // eslint-disable-next-line promise/prefer-await-to-callbacks -- Effect callbacks preserve the typed error channel.
    Effect.mapError((error) => {
      if (typeof error === "string") {
        return error;
      }
      if (
        providerNormalizationDecodeReasonFromDescription(
          error instanceof Error
            ? error.message
            : providerErrorDescription(error)
        ) !== undefined
      ) {
        return "malformed_response" as const;
      }
      if (
        (error instanceof Error
          ? error.message
          : providerErrorDescription(error)) ===
        ProviderKnownZeroSetupFailureMessage
      ) {
        return pilotProviderKnownZeroCostFailure(
          "provider_unavailable" as const
        );
      }
      return safeFailureCode(Cause.fail(error));
    })
  );

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
      traceStore,
      {
        root: canonicalizeRecipeTransportRoot,
        toolCall: canonicalizeRawRecipeToolCall,
      }
    );
    const ai = yield* client.raw;
    return {
      descriptor: Schema.decodeUnknownSync(RecipeExtractorDescriptor)({
        model,
        provider: ProviderName,
        version: "installed-workers-ai-json-schema-v1",
      }),
      extract: (request) =>
        input.dispatch
          .run({
            conservativeReplay: recipeConservativeReplay(request),
            dispatchId:
              request.dispatchId ??
              `recipe:${request.importId}:${request.generation}:${request.evidenceFingerprint}`,
            invoke: Effect.gen(function* extractRecipeSemantics() {
              const startedAt = yield* Effect.sync(() => Date.now());
              const result = yield* runRecipeJsonMode(ai, model, request, {
                correlationId: input.correlationId,
                traceStore,
              });
              if (result._tag === "Failed") {
                return {
                  cost: {
                    _tag: "Conservative" as const,
                    conservativeChargeMicroUsd: RecipeMaximumCostMicroUsd,
                  },
                  value: {
                    _tag: "Failed" as const,
                    code: result.code,
                  } satisfies RecipeDispatchOutcome,
                };
              }
              const { inputTokens, outputTokens, value } = result;
              const completedAt = yield* Effect.sync(() => Date.now());
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
                  _tag: "Extracted" as const,
                  extraction: {
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
                } satisfies RecipeDispatchOutcome,
              };
            }),
            maximumCostMicroUsd: RecipeMaximumCostMicroUsd,
            providerStage: "recipe",
            providerStageId: "recipe-extraction",
          })
          .pipe(
            Effect.flatMap((outcome) =>
              outcome._tag === "Failed"
                ? Effect.fail(outcome.code)
                : Effect.succeed(outcome.extraction)
            ),
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
