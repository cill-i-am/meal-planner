import {
  AnswerReviewRecipeActionRequest,
  ConfirmRecipeImportActionRequest,
  IdempotencyKey,
  RecipeImportActionId,
  RecipeImportIntentId,
} from "@meal-planner/recipe-import-api";
import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  recipeImportActionAnswerDigest,
  recipeImportActionConfirmDigest,
  recipeImportActionMutationId,
  succeededRecipeMutationId,
} from "./import-intent-review.js";
import {
  ImportPrincipal,
  LegacyPrivateImportPrincipal,
} from "./import-intent.js";

const intentId = Schema.decodeUnknownSync(RecipeImportIntentId)(
  "05c75f4c-41cc-43bd-bc9e-b344aa6abb1f"
);
const actionId = Schema.decodeUnknownSync(RecipeImportActionId)("a".repeat(64));
const idempotencyKey = Schema.decodeUnknownSync(IdempotencyKey)("action-key");
const principal = Schema.decodeUnknownSync(ImportPrincipal)(
  LegacyPrivateImportPrincipal
);

const answerRequest = (reverse = false) =>
  Schema.decodeUnknownSync(AnswerReviewRecipeActionRequest)({
    answers: reverse
      ? [
          { field: "name", value: "Safe recipe" },
          {
            field: "tags",
            value: {
              cuisines: ["Irish"],
              dietaryFit: "household_match",
              difficulty: "easy",
              leftovers: "one_meal",
              mealTypes: ["dinner"],
              totalTimeBand: "under_30_minutes",
            },
          },
        ]
      : [
          {
            field: "tags",
            value: {
              cuisines: ["Irish"],
              dietaryFit: "household_match",
              difficulty: "easy",
              leftovers: "one_meal",
              mealTypes: ["dinner"],
              totalTimeBand: "under_30_minutes",
            },
          },
          { field: "name", value: "Safe recipe" },
        ],
    expectedActionVersion: 1,
  });

describe("recipe import action mutation identity", () => {
  it("shares one caller-key identity across answer and confirm commands", async () => {
    const mutationId = await Effect.runPromise(
      recipeImportActionMutationId({
        actionId,
        idempotencyKey,
        intentId,
        principal,
      })
    );
    const replayIdentity = await Effect.runPromise(
      recipeImportActionMutationId({
        actionId,
        idempotencyKey,
        intentId,
        principal,
      })
    );
    const succeededIdentity = await Effect.runPromise(
      succeededRecipeMutationId(mutationId)
    );

    expect(replayIdentity).toBe(mutationId);
    expect(succeededIdentity).not.toBe(mutationId);
  });

  it("canonicalizes answer order and separates answer from confirm digests", async () => {
    const first = await Effect.runPromise(
      recipeImportActionAnswerDigest({
        actionId,
        intentId,
        principal,
        request: answerRequest(),
      })
    );
    const reversed = await Effect.runPromise(
      recipeImportActionAnswerDigest({
        actionId,
        intentId,
        principal,
        request: answerRequest(true),
      })
    );
    const confirm = await Effect.runPromise(
      recipeImportActionConfirmDigest({
        actionId,
        intentId,
        principal,
        request: Schema.decodeUnknownSync(ConfirmRecipeImportActionRequest)({
          expectedActionVersion: 1,
        }),
      })
    );

    expect(reversed).toBe(first);
    expect(confirm).not.toBe(first);
  });
});
