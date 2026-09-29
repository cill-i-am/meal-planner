import {
  CanonicalTikTokUrl,
  IdempotencyKey,
  RecipeReviewActionView,
  SucceededRecipeImportIntent,
} from "@meal-planner/recipe-import-api";
import { Effect, Schema } from "effect";

import type { HouseholdDomainWorkerMethods } from "../features/households/household-domain-worker.js";
import {
  HouseholdActiveRecipeImportActionResult,
  HouseholdAdmitRecipeImportResult,
  HouseholdImportMutationId,
} from "../features/households/recipe-import/household-recipe-import.contract.js";
import type { HouseholdMemberAdmission } from "../features/households/rpc/command-envelope.js";

const videoId = "7000000000000000099";
const sourceUrl = `https://www.tiktok.com/@mealplanner/video/${videoId}`;
const review = {
  answers: [],
  blockers: { invalidFields: [], unresolvedRequiredFields: [] },
  editableFields: ["name", "ingredient_lines", "instructions", "tags"],
  recipe: {
    author: null,
    category: null,
    cookTimeMinutes: 15,
    cuisine: "Italian",
    description: "Provider-free native fixture recipe.",
    ingredientLines: ["500 g pasta", "1 jar pesto"],
    ingredientQuantities: null,
    ingredientUnits: null,
    instructions: ["Boil the pasta.", "Drain and stir through the pesto."],
    name: "Pasta night",
    nutrition: null,
    prepTimeMinutes: 5,
    temperatureCelsius: null,
    tools: ["Hob", "Pot"],
    totalTimeMinutes: 20,
    yield: "4 servings",
  },
  tags: {
    cuisines: ["Italian"],
    dietaryFit: "household_match",
    difficulty: "easy",
    leftovers: "one_meal",
    mealTypes: ["dinner"],
    totalTimeBand: "under_30_minutes",
  },
};

const digest = async (value: string) => {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
};

/** Seeds through the same admitted import lifecycle that publishes a recipe. */
export const seedNativeRecipe = (
  domain: HouseholdDomainWorkerMethods,
  admission: typeof HouseholdMemberAdmission.Type
) =>
  Effect.gen(function* seedNativeRecipeEffect() {
    const nonce = crypto.randomUUID();
    const systemAdmission = {
      actor: {
        _tag: "System" as const,
        purpose: "recipe_import_lifecycle_commit" as const,
      },
      organizationId: admission.organizationId,
    };
    const admittedWire = yield* domain
      .admitRecipeImport({
        admission,
        idempotencyKey: Schema.decodeUnknownSync(IdempotencyKey)(
          `seed-${nonce}`
        ),
        source: { kind: "tiktok", url: sourceUrl },
      })
      .pipe(
        Effect.mapError(
          (error) =>
            new Error(
              `Native recipe admission failed: ${JSON.stringify(error)}`
            )
        )
      );
    const admitted = Schema.decodeUnknownSync(HouseholdAdmitRecipeImportResult)(
      admittedWire
    );
    const nextId = (step: string) =>
      Effect.promise(() => digest(`${nonce}:${step}`)).pipe(
        Effect.map(Schema.decodeUnknownSync(HouseholdImportMutationId))
      );
    yield* domain
      .resolveRecipeImportSource({
        admission: systemAdmission,
        canonicalSourceId: `tiktok:video:${videoId}`,
        canonicalUrl: Schema.decodeUnknownSync(CanonicalTikTokUrl)(sourceUrl),
        expectedGeneration: 1,
        intentId: admitted.intent.id,
        mutationId: yield* nextId("resolve"),
        sourceKind: "video",
      })
      .pipe(
        Effect.mapError(
          (error) =>
            new Error(
              `Native recipe resolution failed: ${JSON.stringify(error)}`
            )
        )
      );
    const draftWire = yield* domain
      .commitRecipeImportDraft({
        admission: systemAdmission,
        evidenceFingerprint: yield* nextId("evidence"),
        expectedGeneration: 1,
        extractionFingerprint: yield* nextId("extraction"),
        intentId: admitted.intent.id,
        mutationId: yield* nextId("draft"),
        review: Schema.decodeUnknownSync(RecipeReviewActionView)(review),
      })
      .pipe(
        Effect.mapError(
          (error) =>
            new Error(`Native recipe review failed: ${JSON.stringify(error)}`)
        )
      );
    const draft = Schema.decodeUnknownSync(
      HouseholdActiveRecipeImportActionResult
    )(draftWire);
    const confirmedWire = yield* domain
      .confirmRecipeImportAction({
        actionId: draft.action.id,
        admission,
        idempotencyKey: Schema.decodeUnknownSync(IdempotencyKey)(
          `fixture-confirm-${nonce}`
        ),
        intentId: admitted.intent.id,
        request: { expectedActionVersion: draft.action.actionVersion },
      })
      .pipe(
        Effect.mapError(
          (error) =>
            new Error(
              `Native recipe confirmation failed: ${JSON.stringify(error)}`
            )
        )
      );
    const confirmed = Schema.decodeUnknownSync(SucceededRecipeImportIntent)(
      confirmedWire
    );
    return {
      importId: admitted.intent.id,
      recipeId: confirmed.result.recipeId,
    };
  });
