import { Schema } from "effect";
import type { Effect } from "effect";

import { AcquisitionGeneration, Sha256Hex } from "./import-media.model.js";
import {
  RecipeExtraction,
  RecipeExtractorDescriptor,
} from "./import-recipe-extractor.js";
import type { DurableRecipeExtractionFailureCode } from "./import-recipe-extractor.js";
import { ImportId, ImportTimestamp } from "./import.contracts.js";
import type { ImportTransitionError } from "./import.repository.js";

export const RecipeDraft = Schema.Struct({
  createdAt: ImportTimestamp,
  evidenceFingerprint: Sha256Hex,
  extraction: RecipeExtraction,
  extractionFingerprint: Sha256Hex,
  extractor: RecipeExtractorDescriptor,
  generation: AcquisitionGeneration,
  importId: ImportId,
  lifecycle: Schema.Literal("needs_review"),
  schemaVersion: Schema.Literal(1),
  transcript: Schema.Union([
    Schema.Struct({ status: Schema.Literal("available") }),
    Schema.Struct({
      reason: Schema.Literal("source_type_carousel"),
      status: Schema.Literal("not_applicable"),
    }),
  ]),
});

export type RecipeDraft = typeof RecipeDraft.Type;

export type RecipeExtractionFailureCode = DurableRecipeExtractionFailureCode;

export type RecipeDispatchClaim =
  | { readonly _tag: "DispatchClaimed" }
  | { readonly _tag: "Failed"; readonly code: RecipeExtractionFailureCode }
  | { readonly _tag: "NeedsReview"; readonly draft: RecipeDraft }
  | { readonly _tag: "ResumeDispatch" };

export interface RecipeDraftRepository {
  readonly claim: (input: {
    readonly descriptor: typeof RecipeExtractorDescriptor.Type;
    readonly evidenceFingerprint: string;
    readonly extractionFingerprint: string;
    readonly generation: typeof AcquisitionGeneration.Type;
    readonly importId: typeof ImportId.Type;
    readonly sourceMediaSha256: string;
    readonly startedAt: typeof ImportTimestamp.Type;
    readonly transcriptSha256: string;
    readonly visualManifestSha256: string;
  }) => Effect.Effect<RecipeDispatchClaim, ImportTransitionError>;
  readonly claimCarousel: (input: {
    readonly carouselManifestSha256: string;
    readonly descriptor: typeof RecipeExtractorDescriptor.Type;
    readonly evidenceFingerprint: string;
    readonly extractionFingerprint: string;
    readonly generation: typeof AcquisitionGeneration.Type;
    readonly importId: typeof ImportId.Type;
    readonly startedAt: typeof ImportTimestamp.Type;
  }) => Effect.Effect<RecipeDispatchClaim, ImportTransitionError>;
  readonly complete: (
    draft: RecipeDraft
  ) => Effect.Effect<RecipeDraft, ImportTransitionError>;
  readonly fail: (input: {
    readonly completedAt: typeof ImportTimestamp.Type;
    readonly extractionFingerprint: string;
    readonly failureCode: RecipeExtractionFailureCode;
  }) => Effect.Effect<void, ImportTransitionError>;
}
