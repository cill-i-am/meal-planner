import {
  RecipeImportActionId,
  RecipeImportIntentId,
} from "@meal-planner/recipe-import-api";
import { Effect, Option, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { ImportPrincipal } from "./import-intent.js";
import { RecipeDraft } from "./import-recipe-draft.repository.d1.js";
import type { RecipeReviewCompatibilityRepositoryShape } from "./import-recipe-review.compatibility.js";
import { makeRecipeReviewCompatibility } from "./import-recipe-review.compatibility.js";
import type { RecipeReviewServiceShape } from "./import-recipe-review.js";
import {
  CorrectRecipeDraftRequest,
  RecipeReviewMutationOutcome,
  RecipeReviewMutationId,
  Review,
  TransitionRecipeDraftRequest,
} from "./import-recipe-review.js";
import { ImportId } from "./import.contracts.js";

const principal = Schema.decodeUnknownSync(ImportPrincipal)({
  actorId: "a".repeat(64),
  householdScopeId: "b".repeat(64),
});
const importId = Schema.decodeUnknownSync(ImportId)(
  "04fd071a-36dc-41b7-a8a6-a1ca4d82d751"
);
const intentId = Schema.decodeUnknownSync(RecipeImportIntentId)(importId);
const actionId = Schema.decodeUnknownSync(RecipeImportActionId)("c".repeat(64));
const instant = "2026-08-16T16:00:00.000Z";
const citation = {
  citations: [
    {
      confidence: 1,
      evidenceId: "caption:fixture",
      origin: "creator_provided" as const,
    },
  ],
  origin: "creator_provided" as const,
  state: "supported" as const,
};
const supportedString = (value: string) => ({ ...citation, value });
const supportedNumber = (value: number) => ({ ...citation, value });
const supportedList = (values: readonly string[]) => ({
  items: values.map(supportedString),
  state: "supported" as const,
});
const unresolved = (reason: string) => ({
  citations: [] as const,
  origin: "unresolved" as const,
  reason,
  state: "unresolved" as const,
});
const tags = {
  cuisines: ["Irish"],
  dietaryFit: "household_match",
  difficulty: "easy",
  leftovers: "one_meal",
  mealTypes: ["dinner"],
  totalTimeBand: "30_to_60_minutes",
} as const;

const draft = Schema.decodeUnknownSync(RecipeDraft)({
  createdAt: instant,
  evidenceFingerprint: "d".repeat(64),
  extraction: {
    author: supportedString("Fixture Cook"),
    category: supportedString("Dinner"),
    cookTimeMinutes: supportedNumber(20),
    cost: {
      certainty: "known",
      currency: "USD",
      estimatedMicroUsd: 0,
    },
    cuisine: supportedString("Irish"),
    description: supportedString("A deterministic fixture."),
    ingredientLines: supportedList(["1 onion", "2 tomatoes"]),
    instructions: supportedList(["Chop the onion.", "Simmer for 20 minutes."]),
    name: unresolved("The title was not visible."),
    nutrition: unresolved("Nutrition was not stated."),
    prepTimeMinutes: supportedNumber(10),
    sourceUrl: supportedString(
      "https://www.tiktok.com/@fixture/video/7520000000000000751"
    ),
    supportedClaims: supportedList(["Simmer for 20 minutes."]),
    temperatureCelsius: unresolved("Temperature was not stated."),
    tools: supportedList(["Saucepan"]),
    totalTimeMinutes: supportedNumber(30),
    unresolvedFields: [
      "name",
      "nutrition",
      "temperature_celsius",
      "ingredient_quantities",
      "ingredient_units",
    ],
    usage: {
      inputEvidenceItems: 1,
      inputTokens: 0,
      latencyMilliseconds: 0,
      modelCalls: 1,
      outputTokens: 0,
    },
    yield: supportedString("2 servings"),
  },
  extractionFingerprint: "e".repeat(64),
  extractor: {
    model: "fixture-v1",
    provider: "deterministic_fake",
    version: "schema-1",
  },
  generation: 1,
  importId,
  lifecycle: "needs_review",
  schemaVersion: 1,
});

const review = (version: number) =>
  Schema.decodeUnknownSync(Review)({
    _tag: "NeedsReview",
    corrections: [],
    draft: Schema.encodeSync(RecipeDraft)(draft),
    evidence: [],
    lifecycle: "needs_review",
    nullablePolicy: [],
    tags: version === 0 ? null : tags,
    transitions: [],
    unresolvedRequiredFields: version === 0 ? ["name"] : [],
    version,
  });

const readyReview = Schema.decodeUnknownSync(Review)({
  ...Schema.encodeSync(Review)(review(1)),
  corrections: [
    {
      actorId: principal.actorId,
      after: "Tomato and Onion Stew",
      before: null,
      correctedAt: instant,
      field: "name",
      reason: "The title is visible in the cited caption frame.",
      version: 1,
    },
  ],
});

const approvedReview = Schema.decodeUnknownSync(Review)({
  ...Schema.encodeSync(Review)(readyReview),
  _tag: "Approved",
  actorId: principal.actorId,
  approvedAt: instant,
  lifecycle: "approved",
  recipe: {
    ingredientLines: ["1 onion", "2 tomatoes"],
    instructions: ["Chop the onion.", "Simmer for 20 minutes."],
    name: "Tomato and Onion Stew",
  },
  transitions: [
    {
      actorId: principal.actorId,
      from: "needs_review",
      reason: "The household approved the grounded recipe.",
      to: "approved",
      transitionedAt: instant,
      version: 2,
    },
  ],
  version: 2,
});

const transitionRequest = Schema.decodeUnknownSync(
  TransitionRecipeDraftRequest
)({
  expectedVersion: 1,
  mutationId: "legacy-approval-751",
  reason: "The household approved the grounded recipe.",
});

const correctionRequest = Schema.decodeUnknownSync(CorrectRecipeDraftRequest)({
  correction: {
    field: "name",
    reason: "The title is visible in the cited caption frame.",
    value: "Tomato and Onion Stew",
  },
  expectedVersion: 0,
  mutationId: "legacy-correction-751",
  tags,
});

const failureTag = <A, E extends { readonly _tag: string }>(
  effect: Effect.Effect<A, E>
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.match({
        onFailure: (error) => error._tag,
        onSuccess: () => "Success",
      })
    )
  );

const unreachableLegacy = (): RecipeReviewServiceShape => ({
  approve: () => Effect.die("legacy approve must not run"),
  correct: () => Effect.die("legacy correct must not run"),
  get: () => Effect.die("legacy get not configured"),
  listApproved: () => Effect.die("legacy list must not run"),
  reject: () => Effect.die("legacy reject must not run"),
  returnToReview: () => Effect.die("legacy return must not run"),
});

describe("recipe review compatibility", () => {
  it("delegates an intent-managed correction with stable replay identity", async () => {
    let current = review(0);
    let canonicalWrites = 0;
    const calls: unknown[] = [];
    const seenKeys = new Set<string>();
    const repository: RecipeReviewCompatibilityRepositoryShape = {
      classify: () =>
        Effect.succeed({
          _tag: "OwnedIntent" as const,
          actionId: Option.some(actionId),
          intentId,
        }),
      listSucceededImportIds: () => Effect.succeed([]),
    };
    const legacy: RecipeReviewServiceShape = {
      ...unreachableLegacy(),
      get: () => Effect.succeed(current),
    };
    const compatibility = makeRecipeReviewCompatibility({
      intentReviews: {
        answerAction: (
          receivedPrincipal,
          receivedIntentId,
          receivedActionId,
          request,
          key
        ) => {
          calls.push({
            actionId: receivedActionId,
            intentId: receivedIntentId,
            key,
            principal: receivedPrincipal,
            request,
          });
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            canonicalWrites += 1;
            current = review(1);
          }
          return Effect.void;
        },
        confirmAction: () => Effect.die("canonical confirm must not run"),
      },
      legacy,
      repository,
    });
    const request = correctionRequest;

    const applied = await Effect.runPromise(
      compatibility.correct(principal, importId, request)
    );
    const replayed = await Effect.runPromise(
      compatibility.correct(principal, importId, request)
    );

    expect(canonicalWrites).toBe(1);
    expect(calls).toEqual([
      {
        actionId,
        intentId,
        key: request.mutationId,
        principal,
        request: {
          answers: [
            {
              field: request.correction.field,
              value: request.correction.value,
            },
            { field: "tags", value: tags },
          ],
          expectedActionVersion: 1,
        },
      },
      {
        actionId,
        intentId,
        key: request.mutationId,
        principal,
        request: {
          answers: [
            {
              field: request.correction.field,
              value: request.correction.value,
            },
            { field: "tags", value: tags },
          ],
          expectedActionVersion: 1,
        },
      },
    ]);
    expect(applied).toEqual(
      RecipeReviewMutationOutcome.make({
        _tag: "Applied",
        mutationId: Schema.decodeUnknownSync(RecipeReviewMutationId)(
          request.mutationId
        ),
        resultingVersion: 1,
        review: current,
      })
    );
    expect(replayed._tag).toBe("Replayed");
  });

  it("preserves the principal-derived actor for non-intent legacy reviews", async () => {
    const calls: unknown[] = [];
    const outcome = RecipeReviewMutationOutcome.make({
      _tag: "Applied",
      mutationId: correctionRequest.mutationId,
      resultingVersion: 1,
      review: readyReview,
    });
    const transitionOutcome = RecipeReviewMutationOutcome.make({
      _tag: "Applied",
      mutationId: transitionRequest.mutationId,
      resultingVersion: 2,
      review: approvedReview,
    });
    const legacy: RecipeReviewServiceShape = {
      approve: (id, request, actorId) => {
        calls.push(["approve", id, request, actorId]);
        return Effect.succeed(transitionOutcome);
      },
      correct: (id, request, actorId) => {
        calls.push(["correct", id, request, actorId]);
        return Effect.succeed(outcome);
      },
      get: (id) => {
        calls.push(["get", id]);
        return Effect.succeed(readyReview);
      },
      listApproved: () => Effect.die("legacy global bank must not run"),
      reject: (id, request, actorId) => {
        calls.push(["reject", id, request, actorId]);
        return Effect.succeed(transitionOutcome);
      },
      returnToReview: (id, request, actorId) => {
        calls.push(["return", id, request, actorId]);
        return Effect.succeed(transitionOutcome);
      },
    };
    const compatibility = makeRecipeReviewCompatibility({
      intentReviews: {
        answerAction: () => Effect.die("canonical answer must not run"),
        confirmAction: () => Effect.die("canonical confirm must not run"),
      },
      legacy,
      repository: {
        classify: () => Effect.succeed({ _tag: "Legacy" as const }),
        listSucceededImportIds: () => Effect.succeed([]),
      },
    });

    await Effect.runPromise(
      compatibility.correct(principal, importId, correctionRequest)
    );
    await Effect.runPromise(
      compatibility.approve(principal, importId, transitionRequest)
    );
    await Effect.runPromise(
      compatibility.reject(principal, importId, transitionRequest)
    );
    await Effect.runPromise(
      compatibility.returnToReview(principal, importId, transitionRequest)
    );
    await Effect.runPromise(compatibility.get(principal, importId));

    expect(calls).toEqual([
      ["correct", importId, correctionRequest, principal.actorId],
      ["approve", importId, transitionRequest, principal.actorId],
      ["reject", importId, transitionRequest, principal.actorId],
      ["return", importId, transitionRequest, principal.actorId],
      ["get", importId],
    ]);
  });

  it("fences legacy reject and return-to-review for intent-managed rows", async () => {
    let legacyWrites = 0;
    const compatibility = makeRecipeReviewCompatibility({
      intentReviews: {
        answerAction: () => Effect.die("canonical answer must not run"),
        confirmAction: () => Effect.die("canonical confirm must not run"),
      },
      legacy: {
        ...unreachableLegacy(),
        get: () => Effect.succeed(readyReview),
        reject: () => {
          legacyWrites += 1;
          return Effect.die("legacy reject must be fenced");
        },
        returnToReview: () => {
          legacyWrites += 1;
          return Effect.die("legacy return must be fenced");
        },
      },
      repository: {
        classify: () =>
          Effect.succeed({
            _tag: "OwnedIntent" as const,
            actionId: Option.some(actionId),
            intentId,
          }),
        listSucceededImportIds: () => Effect.succeed([]),
      },
    });

    const [rejected, returned] = await Promise.all([
      failureTag(compatibility.reject(principal, importId, transitionRequest)),
      failureTag(
        compatibility.returnToReview(principal, importId, transitionRequest)
      ),
    ]);

    expect([rejected, returned]).toEqual([
      "RecipeReviewTransitionRejected",
      "RecipeReviewTransitionRejected",
    ]);
    expect(legacyWrites).toBe(0);
  });

  it("does not expose or mutate an intent owned by another household", async () => {
    let legacyCalls = 0;
    const compatibility = makeRecipeReviewCompatibility({
      intentReviews: {
        answerAction: () => Effect.die("canonical answer must not run"),
        confirmAction: () => Effect.die("canonical confirm must not run"),
      },
      legacy: {
        ...unreachableLegacy(),
        correct: () => {
          legacyCalls += 1;
          return Effect.die("foreign intent must not use the legacy writer");
        },
        get: () => {
          legacyCalls += 1;
          return Effect.die("foreign intent must not be readable");
        },
      },
      repository: {
        classify: () => Effect.succeed({ _tag: "ForeignIntent" as const }),
        listSucceededImportIds: () => Effect.succeed([]),
      },
    });

    const [read, write] = await Promise.all([
      failureTag(compatibility.get(principal, importId)),
      failureTag(compatibility.correct(principal, importId, correctionRequest)),
    ]);

    expect([read, write]).toEqual([
      "RecipeReviewNotFound",
      "RecipeReviewNotFound",
    ]);
    expect(legacyCalls).toBe(0);
  });

  it("builds the recipe bank only from succeeded intents in the caller household", async () => {
    const otherPrincipal = Schema.decodeUnknownSync(ImportPrincipal)({
      actorId: "f".repeat(64),
      householdScopeId: "e".repeat(64),
    });
    const observedScopes: string[] = [];
    const compatibility = makeRecipeReviewCompatibility({
      intentReviews: {
        answerAction: () => Effect.die("canonical answer must not run"),
        confirmAction: () => Effect.die("canonical confirm must not run"),
      },
      legacy: {
        ...unreachableLegacy(),
        get: (id) =>
          id === importId
            ? Effect.succeed(approvedReview)
            : Effect.die("unexpected recipe-bank import"),
      },
      repository: {
        classify: () => Effect.die("bank must not classify individual rows"),
        listSucceededImportIds: (receivedPrincipal) => {
          observedScopes.push(receivedPrincipal.householdScopeId);
          return Effect.succeed(
            receivedPrincipal.householdScopeId === principal.householdScopeId
              ? [importId]
              : []
          );
        },
      },
    });

    const [own, other] = await Promise.all([
      Effect.runPromise(compatibility.listApproved(principal)),
      Effect.runPromise(compatibility.listApproved(otherPrincipal)),
    ]);

    expect(own).toHaveLength(1);
    expect(own[0]?.importId).toBe(importId);
    expect(other).toEqual([]);
    expect(observedScopes).toEqual([
      principal.householdScopeId,
      otherPrincipal.householdScopeId,
    ]);
  });

  it("preserves the legacy approval-blocked response before canonical confirmation", async () => {
    let confirms = 0;
    const blockedRequest = Schema.decodeUnknownSync(
      TransitionRecipeDraftRequest
    )({
      ...transitionRequest,
      expectedVersion: 0,
      mutationId: "legacy-approval-blocked-751",
    });
    const compatibility = makeRecipeReviewCompatibility({
      intentReviews: {
        answerAction: () => Effect.die("canonical answer must not run"),
        confirmAction: () => {
          confirms += 1;
          return Effect.die("blocked approval must not reach canonical write");
        },
      },
      legacy: {
        ...unreachableLegacy(),
        get: () => Effect.succeed(review(0)),
      },
      repository: {
        classify: () =>
          Effect.succeed({
            _tag: "OwnedIntent" as const,
            actionId: Option.some(actionId),
            intentId,
          }),
        listSucceededImportIds: () => Effect.succeed([]),
      },
    });

    expect(
      await failureTag(
        compatibility.approve(principal, importId, blockedRequest)
      )
    ).toBe("RecipeApprovalBlocked");
    expect(confirms).toBe(0);
  });

  it("replays an intent-managed approval after success without a duplicate write", async () => {
    let current = readyReview;
    let canonicalWrites = 0;
    const calls: unknown[] = [];
    const seenKeys = new Set<string>();
    const compatibility = makeRecipeReviewCompatibility({
      intentReviews: {
        answerAction: () => Effect.die("canonical answer must not run"),
        confirmAction: (
          receivedPrincipal,
          receivedIntentId,
          receivedActionId,
          request,
          key
        ) => {
          calls.push({
            actionId: receivedActionId,
            intentId: receivedIntentId,
            key,
            principal: receivedPrincipal,
            request,
          });
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            canonicalWrites += 1;
            current = approvedReview;
          }
          return Effect.void;
        },
      },
      legacy: {
        ...unreachableLegacy(),
        get: () => Effect.succeed(current),
      },
      repository: {
        classify: () =>
          Effect.succeed({
            _tag: "OwnedIntent" as const,
            // The D1 adapter recovers this from action_available history after
            // success clears recipe_imports.active_action_id.
            actionId: Option.some(actionId),
            intentId,
          }),
        listSucceededImportIds: () => Effect.succeed([]),
      },
    });

    const applied = await Effect.runPromise(
      compatibility.approve(principal, importId, transitionRequest)
    );
    const replayed = await Effect.runPromise(
      compatibility.approve(principal, importId, transitionRequest)
    );

    expect(canonicalWrites).toBe(1);
    expect(calls).toEqual([
      {
        actionId,
        intentId,
        key: transitionRequest.mutationId,
        principal,
        request: { expectedActionVersion: 2 },
      },
      {
        actionId,
        intentId,
        key: transitionRequest.mutationId,
        principal,
        request: { expectedActionVersion: 2 },
      },
    ]);
    expect(applied).toEqual(
      RecipeReviewMutationOutcome.make({
        _tag: "Applied",
        mutationId: transitionRequest.mutationId,
        resultingVersion: 2,
        review: approvedReview,
      })
    );
    expect(replayed._tag).toBe("Replayed");
  });
});
