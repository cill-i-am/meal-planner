import {
  AnswerReviewRecipeActionRequest,
  CancelRecipeImportIntentRequest,
  ConfirmRecipeImportActionRequest,
  CreateRecipeImportIntentRequest,
  IdempotencyKey,
  RecipeId,
  RecipeImportActionId,
  RecipeImportIntentId,
} from "@meal-planner/recipe-import-api";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { makeRecipeImportOperations } from "./operations.js";
import type { RecipeImportServerOperations } from "./operations.js";
import { RecipeImportProfileAlias } from "./profiles.js";

const profileAlias = Schema.decodeUnknownSync(RecipeImportProfileAlias)("home");
const intentId = Schema.decodeUnknownSync(RecipeImportIntentId)(
  "11111111-1111-4111-8111-111111111111"
);
const actionId = Schema.decodeUnknownSync(RecipeImportActionId)("a".repeat(64));
const recipeId = Schema.decodeUnknownSync(RecipeId)(
  "22222222-2222-4222-8222-222222222222"
);
const idempotencyKey = Schema.decodeUnknownSync(IdempotencyKey)(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
);

describe("profile-bound recipe import operations", () => {
  it("passes the selected alias through every server-function boundary", async () => {
    const calls: { readonly data: Record<string, unknown> }[] = [];
    const record = async (options: {
      readonly data: Record<string, unknown>;
    }): Promise<never> => {
      calls.push(options);
      throw new Error("recorded");
    };
    const serverOperations: RecipeImportServerOperations = {
      answerAction: record,
      cancel: record,
      confirmAction: record,
      create: record,
      getAction: record,
      getIntent: record,
      getRecipe: record,
    };
    const operations = makeRecipeImportOperations(
      profileAlias,
      serverOperations
    );

    await Promise.allSettled([
      operations.answerAction({
        actionId,
        idempotencyKey,
        intentId,
        request: Schema.decodeUnknownSync(AnswerReviewRecipeActionRequest)({
          answers: [{ field: "name", value: "Recipe" }],
          expectedActionVersion: 1,
        }),
      }),
      operations.cancel({
        idempotencyKey,
        intentId,
        request: Schema.decodeUnknownSync(CancelRecipeImportIntentRequest)({
          expectedIntentVersion: 1,
        }),
      }),
      operations.confirmAction({
        actionId,
        idempotencyKey,
        intentId,
        request: Schema.decodeUnknownSync(ConfirmRecipeImportActionRequest)({
          expectedActionVersion: 1,
        }),
      }),
      operations.create({
        idempotencyKey,
        request: Schema.decodeUnknownSync(CreateRecipeImportIntentRequest)({
          source: {
            kind: "tiktok",
            url: "https://www.tiktok.com/@cook/video/7390123456789012345",
          },
        }),
      }),
      operations.getAction({ actionId, intentId }),
      operations.getIntent({ intentId }),
      operations.getRecipe({ recipeId }),
    ]);

    expect(calls).toHaveLength(7);
    expect(
      calls.every((call) => call.data["profileAlias"] === profileAlias)
    ).toBe(true);
  });
});
