import { Schema } from "effect";
import type { Effect } from "effect";

import type { AcquisitionGeneration } from "./import-media.model.js";
import type { ImportId } from "./import.contracts.js";

const TrimmedNonEmptyString = Schema.String.pipe(
  Schema.check(Schema.isTrimmed(), Schema.isNonEmpty())
);
const SafeInteger = Schema.Number.pipe(
  Schema.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(0),
    Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)
  )
);
const Confidence = Schema.Number.pipe(
  Schema.check(
    Schema.isFinite(),
    Schema.isGreaterThanOrEqualTo(0),
    Schema.isLessThanOrEqualTo(1)
  )
);

export const EvidenceOrigin = Schema.Literals(["creator_provided", "observed"]);
export type EvidenceOrigin = typeof EvidenceOrigin.Type;

export const RecipeEvidenceCitation = Schema.Struct({
  confidence: Confidence,
  evidenceId: TrimmedNonEmptyString,
  origin: EvidenceOrigin,
});
export type RecipeEvidenceCitation = typeof RecipeEvidenceCitation.Type;

const fact = <A extends Schema.Top>(value: A) =>
  Schema.Union([
    Schema.Struct({
      citations: Schema.NonEmptyArray(RecipeEvidenceCitation),
      origin: Schema.Literals(["creator_provided", "inferred", "observed"]),
      state: Schema.Literal("supported"),
      value,
    }),
    Schema.Struct({
      citations: Schema.Tuple([]),
      origin: Schema.Literal("unresolved"),
      reason: TrimmedNonEmptyString,
      state: Schema.Literal("unresolved"),
    }),
  ]);

export const RecipeStringFact = fact(
  TrimmedNonEmptyString.pipe(Schema.check(Schema.isMaxLength(4096)))
);
export type RecipeStringFact = typeof RecipeStringFact.Type;

export const RecipeNumberFact = fact(SafeInteger);
export type RecipeNumberFact = typeof RecipeNumberFact.Type;

export const RecipeFactList = Schema.Union([
  Schema.Struct({
    items: Schema.NonEmptyArray(RecipeStringFact).pipe(
      Schema.check(Schema.isMaxLength(256))
    ),
    state: Schema.Literal("supported"),
  }),
  Schema.Struct({
    items: Schema.Tuple([]),
    reason: TrimmedNonEmptyString,
    state: Schema.Literal("unresolved"),
  }),
]);
export type RecipeFactList = typeof RecipeFactList.Type;

export const RecipeUnresolvedField = Schema.Literals([
  "author",
  "category",
  "cook_time_minutes",
  "cuisine",
  "description",
  "ingredient_lines",
  "ingredient_quantities",
  "ingredient_units",
  "instructions",
  "name",
  "nutrition",
  "prep_time_minutes",
  "temperature_celsius",
  "tools",
  "total_time_minutes",
  "yield",
]);
export type RecipeUnresolvedField = typeof RecipeUnresolvedField.Type;

/** Evidence-grounded recipe facts. Provider candidates can never inhabit it. */
export const GroundedRecipeFacts = Schema.Struct({
  author: RecipeStringFact,
  category: RecipeStringFact,
  cookTimeMinutes: RecipeNumberFact,
  cuisine: RecipeStringFact,
  description: RecipeStringFact,
  ingredientLines: RecipeFactList,
  instructions: RecipeFactList,
  name: RecipeStringFact,
  nutrition: RecipeStringFact,
  prepTimeMinutes: RecipeNumberFact,
  sourceUrl: RecipeStringFact,
  supportedClaims: RecipeFactList,
  temperatureCelsius: RecipeNumberFact,
  tools: RecipeFactList,
  totalTimeMinutes: RecipeNumberFact,
  unresolvedFields: Schema.Array(RecipeUnresolvedField).pipe(
    Schema.check(Schema.isMaxLength(16))
  ),
  yield: RecipeStringFact,
});
export type GroundedRecipeFacts = typeof GroundedRecipeFacts.Type;

const RecipeProviderString = TrimmedNonEmptyString.pipe(
  Schema.check(Schema.isMaxLength(4096))
);

/**
 * Closed provider-facing selection contract.
 *
 * The model may select candidate values only. Source identity, citations,
 * origins, unresolved bookkeeping, and evidence authority are derived by the
 * trusted adapter after this shape decodes.
 */
export const RecipeCandidate = Schema.Struct({
  category: Schema.NullOr(RecipeProviderString),
  cookTimeMinutes: Schema.NullOr(SafeInteger),
  cuisine: Schema.NullOr(RecipeProviderString),
  description: Schema.NullOr(RecipeProviderString),
  ingredientLines: Schema.Array(RecipeProviderString).pipe(
    Schema.check(Schema.isMaxLength(256))
  ),
  instructions: Schema.Array(RecipeProviderString).pipe(
    Schema.check(Schema.isMaxLength(256))
  ),
  name: Schema.NullOr(RecipeProviderString),
  nutrition: Schema.NullOr(RecipeProviderString),
  prepTimeMinutes: Schema.NullOr(SafeInteger),
  supportedClaims: Schema.Array(RecipeProviderString).pipe(
    Schema.check(Schema.isMaxLength(256))
  ),
  temperatureCelsius: Schema.NullOr(SafeInteger),
  tools: Schema.Array(RecipeProviderString).pipe(
    Schema.check(Schema.isMaxLength(256))
  ),
  totalTimeMinutes: Schema.NullOr(SafeInteger),
  yield: Schema.NullOr(RecipeProviderString),
});
export type RecipeCandidate = typeof RecipeCandidate.Type;

/** Strict provider-neutral recipe result. Raw adapter output is decoded here. */
export const RecipeExtraction = Schema.Struct({
  ...GroundedRecipeFacts.fields,
  cost: Schema.Struct({
    certainty: Schema.Literals(["estimated", "known"]),
    currency: Schema.Literal("USD"),
    estimatedMicroUsd: SafeInteger,
  }),
  usage: Schema.Struct({
    inputEvidenceItems: SafeInteger.pipe(Schema.check(Schema.isGreaterThan(0))),
    inputTokens: SafeInteger,
    latencyMilliseconds: SafeInteger,
    modelCalls: Schema.Literal(1),
    outputTokens: SafeInteger,
  }),
});
export type RecipeExtraction = typeof RecipeExtraction.Type;

export const decodeRecipeExtraction = Schema.decodeUnknownEffect(
  RecipeExtraction,
  {
    onExcessProperty: "error",
  }
);

export interface RecipeEvidenceItem {
  readonly artifactReference: string;
  readonly evidenceId: string;
  readonly kind:
    | "caption"
    | "creator"
    | "source_url"
    | "transcript"
    | "visual_observation";
  readonly origin: EvidenceOrigin;
  /** Private transient input. Never persisted in the recipe draft ledger. */
  readonly value: string;
}

export interface RecipeEvidenceAssembly {
  readonly dispatchId?: string;
  readonly evidenceFingerprint: string;
  readonly generation: AcquisitionGeneration;
  readonly importId: ImportId;
  readonly items: readonly RecipeEvidenceItem[];
}

export const RecipeExtractorDescriptor = Schema.Struct({
  model: TrimmedNonEmptyString.pipe(Schema.check(Schema.isMaxLength(64))),
  provider: TrimmedNonEmptyString.pipe(Schema.check(Schema.isMaxLength(64))),
  version: TrimmedNonEmptyString.pipe(Schema.check(Schema.isMaxLength(64))),
});
export type RecipeExtractorDescriptor = typeof RecipeExtractorDescriptor.Type;

export const RecipeExtractionFailureCode = Schema.Literals([
  "insufficient_evidence",
  "malformed_response",
  "model_refusal",
  "outcome_unknown",
  "provider_error",
  "provider_unavailable",
  "throttled",
  "timeout",
]);
export type RecipeExtractionFailureCode =
  typeof RecipeExtractionFailureCode.Type;

export const DurableRecipeExtractionFailureCode = Schema.Literals([
  "insufficient_evidence",
  "invalid_schema",
  "model_refusal",
  "provider_error",
]);
export type DurableRecipeExtractionFailureCode =
  typeof DurableRecipeExtractionFailureCode.Type;

export interface RecipeExtractionFailure {
  readonly _tag: "RecipeExtractionFailure";
  readonly code: RecipeExtractionFailureCode;
}
export const RecipeExtractionFailure =
  // eslint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is Effect's constructor factory, not a thrown expression.
  Schema.TaggedError<RecipeExtractionFailure>()("RecipeExtractionFailure", {
    code: RecipeExtractionFailureCode,
  });

export interface RecipeExtractor {
  readonly descriptor: RecipeExtractorDescriptor;
  readonly extract: (
    input: RecipeEvidenceAssembly
  ) => Effect.Effect<Schema.Json, RecipeExtractionFailure>;
}

/** Replaceable provider-neutral recipe extraction capability. */
