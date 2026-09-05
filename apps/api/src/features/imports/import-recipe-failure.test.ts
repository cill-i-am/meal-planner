import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  AcquisitionGeneration,
  VerifiedSourceMetadata,
} from "./import-media.model.js";
import {
  RecipeDraftPipelineFailure,
  produceRecipeDraftFromEvidence,
  projectRecipeExtractionFailure,
} from "./import-recipe-draft.js";
import type { RecipeDraftRepository } from "./import-recipe-draft.repository.js";
import { RecipeExtractionFailure } from "./import-recipe-extractor.js";
import type {
  RecipeEvidenceAssembly,
  RecipeExtractionFailureCode,
  RecipeExtractor,
} from "./import-recipe-extractor.js";
import { ImportId, ImportTimestamp } from "./import.contracts.js";

const matrix = [
  [
    "insufficient_evidence",
    "insufficient_evidence",
    "insufficient_evidence",
    "none",
  ],
  ["malformed_response", "invalid_schema", "invalid_schema", "none"],
  ["model_refusal", "model_refusal", "model_refusal", "none"],
  ["outcome_unknown", "outcome_unknown", null, "operator_reconcile"],
  ["provider_error", "provider_error", "provider_error", "durable_recovery"],
  ["provider_unavailable", "provider_unavailable", null, "dispatch_retry"],
  ["throttled", "throttled", null, "dispatch_retry"],
  ["timeout", "timeout", null, "dispatch_retry"],
] as const satisfies readonly (readonly [
  RecipeExtractionFailureCode,
  string,
  string | null,
  string,
])[];

describe("recipe extraction failure projection", () => {
  it.each(matrix)(
    "projects %s exhaustively into pipeline, durable, and recovery policy",
    (extractorCode, pipelineCode, durableCode, recoveryPolicy) => {
      const disposition = projectRecipeExtractionFailure(extractorCode);

      expect(disposition).toEqual({
        durableCode,
        pipelineCode,
        recoveryPolicy,
      });
      expect(
        Schema.is(RecipeDraftPipelineFailure)(
          new RecipeDraftPipelineFailure({ code: disposition.pipelineCode })
        )
      ).toBe(true);
    }
  );

  it.each(matrix)(
    "drives %s through the typed pipeline and durable write policy",
    async (extractorCode, pipelineCode, durableCode) => {
      const persisted: string[] = [];
      const repository: RecipeDraftRepository = {
        claim: () => Effect.die("unexpected repository claim"),
        claimCarousel: () => Effect.die("unexpected carousel claim"),
        complete: () => Effect.die("unexpected recipe completion"),
        fail: ({ failureCode }) =>
          Effect.sync(() => {
            persisted.push(failureCode);
          }),
      };
      const extractor: RecipeExtractor = {
        descriptor: {
          model: "fake-model",
          provider: "fake-provider",
          version: "fake-version",
        },
        extract: () =>
          Effect.fail(new RecipeExtractionFailure({ code: extractorCode })),
      };
      const assembly: RecipeEvidenceAssembly = {
        evidenceFingerprint: "a".repeat(64),
        generation: Schema.decodeUnknownSync(AcquisitionGeneration)(1),
        importId: Schema.decodeUnknownSync(ImportId)(
          "019b37f2-1a6e-7f3a-8a5a-7f0d8f6c2b1a"
        ),
        items: [
          {
            artifactReference: "private:evidence",
            evidenceId: "evidence-1",
            kind: "caption",
            origin: "creator_provided",
            value: "landed evidence",
          },
        ],
      };
      const now = Schema.decodeUnknownSync(ImportTimestamp)(
        "2026-08-15T20:00:00.000Z"
      );
      const source = Schema.decodeUnknownSync(VerifiedSourceMetadata)({
        canonicalUrl: "https://example.com/recipe",
        caption: "landed evidence",
        creator: { displayName: null, handle: null, id: null },
        observedAt: "2026-08-15T19:00:00.000Z",
        provenance: {
          canonicalUrl: "operator_supplied",
          caption: "creator_provided",
          creator: { displayName: null, handle: null, id: null },
          publishedAt: null,
        },
        publishedAt: null,
      });

      const failure = await Effect.runPromise(
        Effect.flip(
          produceRecipeDraftFromEvidence({
            assembly,
            claim: () => Effect.succeed({ _tag: "DispatchClaimed" }),
            extractionFingerprint: "b".repeat(64),
            extractor,
            now,
            recipeRepository: repository,
            source,
            transcript: { status: "available" },
          })
        )
      );

      expect(failure).toMatchObject({
        _tag: "RecipeDraftPipelineFailure",
        code: pipelineCode,
      });
      expect(persisted).toEqual(durableCode === null ? [] : [durableCode]);
    }
  );
});
