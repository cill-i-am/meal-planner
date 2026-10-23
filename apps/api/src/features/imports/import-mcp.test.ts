import { makeRecipeContent } from "@meal-planner/recipe-domain";
import {
  RecipeImportAction,
  RecipeImportActionVersion,
  RecipeImportIntent,
  RecipeImportTimeline,
} from "@meal-planner/recipe-import-api";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { prepareRecipeReview, projectImportPreparation } from "./import-mcp.js";

const intentId = "018f47ad-91aa-7c35-b6fe-000000000001";
const actionId = "a".repeat(64);
const at = "2026-10-23T12:00:00.000Z";
const commonIntent = {
  createdAt: at,
  id: intentId,
  intentVersion: 3,
  links: {
    self: `/v1/recipe-import-intents/${intentId}`,
    timeline: `/v1/recipe-import-intents/${intentId}/timeline`,
  },
  object: "recipe_import_intent",
  source: {
    canonicalUrl: "https://www.tiktok.com/@household/video/123",
    kind: "tiktok",
    resolution: "resolved",
  },
  updatedAt: at,
} as const;
const actionReference = {
  id: actionId,
  link: `/v1/recipe-import-intents/${intentId}/actions/${actionId}`,
  type: "review_recipe",
} as const;
const recipe = makeRecipeContent({
  author: { name: "Recipe author", url: "https://example.com/author" },
  categories: ["Soup"],
  cuisines: ["Irish"],
  description: "A complete recipe with reviewed details.",
  dietary: [
    {
      kind: "allergen",
      name: "milk",
      original: "Contains milk",
      source: "provided",
      value: true,
    },
  ],
  equipment: ["Large pot"],
  ingredients: [
    {
      group: "Soup",
      ingredientId: "potato",
      localName: "Rooster potatoes",
      name: "Potatoes",
      note: "Use floury potatoes",
      optional: false,
      original: "500–600 g large potatoes, peeled",
      preparation: "peeled",
      quantity: { max: 600, unit: "g", value: 500 },
      size: "large",
    },
  ],
  instructions: [
    {
      duration: { seconds: 1200 },
      equipment: ["Large pot"],
      group: "Soup",
      ingredients: ["potato"],
      step: 1,
      techniques: ["Simmer"],
      temperature: { unit: "C", value: 95 },
      text: "Simmer the potatoes for 20 minutes at 95°C, until tender.",
    },
  ],
  language: "en",
  media: [
    {
      alt: "A pot of soup",
      caption: "The finished soup",
      role: "hero",
      step: null,
      type: "image",
      url: "https://example.com/soup.jpg",
    },
  ],
  name: "Potato soup",
  notes: ["Taste before seasoning."],
  nutrition: {
    basis: { description: "One bowl", servings: 1, type: "serving" },
    nutrients: [{ amount: { unit: "kcal", value: 200 }, name: "Energy" }],
    original: "200 kcal per bowl",
    source: "provided",
  },
  servings: { max: 6, original: "Serves 4–6", quantity: 4, unit: "servings" },
  sourceTags: ["Family recipe"],
  times: {
    cook: { seconds: 1200 },
    inactive: { seconds: 60 },
    prep: { seconds: 300 },
    total: { seconds: 1560 },
  },
});
const tags = {
  cuisines: ["Irish", "European"],
  difficulty: "easy",
  leftovers: "one_meal",
  mealTypes: ["lunch", "dinner"],
  totalTimeBand: "under_30_minutes",
} as const;
const action = Schema.decodeUnknownSync(RecipeImportAction)({
  actionVersion: 2,
  id: actionId,
  intentId,
  object: "recipe_import_action",
  review: {
    answers: [],
    blockers: { invalidFields: [], unresolvedRequiredFields: [] },
    editableFields: ["name", "tags"],
    recipe,
    tags,
  },
  status: "active",
  type: "review_recipe",
});
const timelineFrom = (...events: readonly unknown[]) =>
  Schema.decodeUnknownSync(RecipeImportTimeline)({
    data: [
      { at, intentVersion: 1, type: "intent_admitted" },
      {
        at,
        canonicalUrl: commonIntent.source.canonicalUrl,
        intentVersion: 2,
        type: "source_resolved",
      },
      ...events,
    ],
    object: "list",
  });
const reviewAvailableEvent = {
  action: actionReference,
  at,
  intentVersion: 3,
  type: "action_available",
} as const;

describe("recipe preparation projection", () => {
  it("preserves processing progress and retry information without another lifecycle", () => {
    const intent = Schema.decodeUnknownSync(RecipeImportIntent)({
      ...commonIntent,
      activity: { attempt: 2, nextAttemptAt: at, type: "retrying" },
      processing: { startedAt: at, type: "extracting_recipe" },
      status: "processing",
    });
    const timeline = timelineFrom({
      at,
      intentVersion: 3,
      nextAttemptAt: at,
      type: "retrying",
    });
    expect(projectImportPreparation(intent, timeline)).toEqual({
      _tag: "Working",
      intent,
    });
  });

  it.each([
    {
      action: actionReference,
      event: reviewAvailableEvent,
      isError: false,
      outcome: { action: actionReference, intentId, type: "draft_ready" },
      status: "requires_action",
    },
    {
      completedAt: at,
      event: {
        at,
        intentVersion: 3,
        recipeId: "018f47ad-91aa-7c35-b6fe-000000000003",
        type: "intent_succeeded",
      },
      isError: false,
      outcome: {
        intentId,
        recipeId: "018f47ad-91aa-7c35-b6fe-000000000003",
        type: "published",
      },
      result: { recipeId: "018f47ad-91aa-7c35-b6fe-000000000003" },
      status: "succeeded",
    },
    {
      error: {
        code: "analysis_failed",
        message: "Analysis could not be completed.",
        recovery: "contact_support",
      },
      event: {
        at,
        code: "analysis_failed",
        intentVersion: 3,
        type: "intent_failed",
      },
      failedAt: at,
      isError: true,
      outcome: { code: "analysis_failed", intentId, type: "failed" },
      status: "failed",
    },
    {
      event: {
        at,
        intentVersion: 3,
        redirect: {
          intentId: "018f47ad-91aa-7c35-b6fe-000000000002",
          link: "/v1/recipe-import-intents/018f47ad-91aa-7c35-b6fe-000000000002",
        },
        type: "intent_redirected",
      },
      isError: false,
      outcome: {
        intentId,
        redirect: {
          intentId: "018f47ad-91aa-7c35-b6fe-000000000002",
          link: "/v1/recipe-import-intents/018f47ad-91aa-7c35-b6fe-000000000002",
        },
        type: "redirected",
      },
      redirect: {
        intentId: "018f47ad-91aa-7c35-b6fe-000000000002",
        link: "/v1/recipe-import-intents/018f47ad-91aa-7c35-b6fe-000000000002",
      },
      redirectedAt: at,
      status: "redirected",
    },
  ])(
    "completes preparation for $status with a stable event result",
    ({ event, isError, outcome, ...state }) => {
      const intent = Schema.decodeUnknownSync(RecipeImportIntent)({
        ...commonIntent,
        ...state,
      });
      const timeline = timelineFrom(event);
      expect(projectImportPreparation(intent, timeline)).toEqual({
        _tag: "Completed",
        completedAt: intent.createdAt,
        isError,
        result: outcome,
      });
    }
  );

  it("projects cancellation without following or changing another import", () => {
    const intent = Schema.decodeUnknownSync(RecipeImportIntent)({
      ...commonIntent,
      cancelledAt: at,
      status: "cancelled",
    });
    const timeline = timelineFrom({
      at,
      intentVersion: 3,
      type: "intent_cancelled",
    });
    expect(projectImportPreparation(intent, timeline)).toEqual({
      _tag: "Cancelled",
      completedAt: intent.createdAt,
      intentId,
    });
  });

  it.each(["cancelled", "succeeded"] as const)(
    "keeps a prepared draft complete after the import is %s",
    (status) => {
      const ready = Schema.decodeUnknownSync(RecipeImportIntent)({
        ...commonIntent,
        action: actionReference,
        status: "requires_action",
      });
      const later = "2026-10-23T13:00:00.000Z";
      const result = { recipeId: "018f47ad-91aa-7c35-b6fe-000000000003" };
      const subsequent =
        status === "cancelled"
          ? { cancelledAt: later, status }
          : { completedAt: later, result, status };
      const version = status === "cancelled" ? 4 : 5;
      const current = Schema.decodeUnknownSync(RecipeImportIntent)({
        ...commonIntent,
        ...subsequent,
        intentVersion: version,
        updatedAt: later,
      });
      const subsequentEvents =
        status === "cancelled"
          ? [{ at: later, intentVersion: 4, type: "intent_cancelled" }]
          : [
              {
                at: later,
                intentVersion: 4,
                processing: { startedAt: later, type: "finalizing_recipe" },
                type: "processing_stage_changed",
              },
              {
                at: later,
                intentVersion: 5,
                recipeId: result.recipeId,
                type: "intent_succeeded",
              },
            ];
      expect(
        projectImportPreparation(
          current,
          timelineFrom(reviewAvailableEvent, ...subsequentEvents)
        )
      ).toEqual(
        projectImportPreparation(ready, timelineFrom(reviewAvailableEvent))
      );
    }
  );

  it("keeps a failed preparation complete after operator recovery starts processing again", () => {
    const failureEvent = {
      at,
      code: "analysis_failed",
      intentVersion: 3,
      type: "intent_failed",
    };
    const failed = Schema.decodeUnknownSync(RecipeImportIntent)({
      ...commonIntent,
      error: {
        code: "analysis_failed",
        message: "Analysis failed.",
        recovery: "contact_support",
      },
      failedAt: at,
      status: "failed",
    });
    const later = "2026-10-23T13:00:00.000Z";
    const recovered = Schema.decodeUnknownSync(RecipeImportIntent)({
      ...commonIntent,
      activity: { type: "working" },
      intentVersion: 4,
      processing: { startedAt: later, type: "extracting_recipe" },
      status: "processing",
      updatedAt: later,
    });
    expect(
      projectImportPreparation(
        recovered,
        timelineFrom(failureEvent, {
          at: "2026-10-23T11:59:59.000Z",
          intentVersion: 4,
          type: "recovered",
        })
      )
    ).toEqual(projectImportPreparation(failed, timelineFrom(failureEvent)));
  });

  it("fails closed when terminal history is absent", () => {
    const intent = Schema.decodeUnknownSync(RecipeImportIntent)({
      ...commonIntent,
      action: actionReference,
      status: "requires_action",
    });
    expect(
      projectImportPreparation(intent, { data: [], object: "list" })
    ).toEqual({
      _tag: "Unavailable",
      reason: "missing_history",
    });
    expect(
      projectImportPreparation(
        intent,
        timelineFrom({
          at,
          intentVersion: 3,
          type: "recovered",
        })
      )
    ).toEqual({ _tag: "Unavailable", reason: "missing_history" });
  });

  it("rejects incomplete, unordered and racing timeline snapshots", () => {
    const intent = Schema.decodeUnknownSync(RecipeImportIntent)({
      ...commonIntent,
      action: actionReference,
      status: "requires_action",
    });
    const timeline = timelineFrom(reviewAvailableEvent);
    for (const data of [
      timeline.data.slice(1),
      timeline.data.toReversed(),
      timeline.data.slice(0, 2),
      [...timeline.data, ...timeline.data],
    ]) {
      expect(
        projectImportPreparation(intent, { data, object: "list" })
      ).toEqual({
        _tag: "Unavailable",
        reason: "inconsistent_history",
      });
    }
  });
});

describe("recipe publication review preparation", () => {
  it("shows every current recipe fact and planning tag while preserving the exact review identity", () => {
    const before = JSON.stringify(action);
    const review = prepareRecipeReview(action, action.actionVersion);
    expect(review).toMatchObject({
      _tag: "Ready",
      actionId: action.id,
      actionVersion: action.actionVersion,
      intentId: action.intentId,
    });
    if (review._tag !== "Ready") {
      throw new Error("Expected complete review");
    }
    expect(review.message).toContain("Publish this recipe");
    expect(review.message).toContain(
      "Declining or cancelling leaves the draft unchanged"
    );
    const jsonStart = review.message.indexOf("{\n");
    expect(jsonStart).toBeGreaterThan(0);
    expect(JSON.parse(review.message.slice(jsonStart))).toEqual({
      recipe,
      tags,
    });
    expect(JSON.stringify(action)).toBe(before);
  });

  it("rejects a version changed by a correction even when intentVersion did not change", () => {
    expect(
      prepareRecipeReview(
        action,
        Schema.decodeUnknownSync(RecipeImportActionVersion)(1)
      )
    ).toMatchObject({ _tag: "Unavailable", reason: "version_conflict" });
  });

  it("does not ask to publish an already confirmed action", () => {
    const completed = Schema.decodeUnknownSync(RecipeImportAction)({
      ...action,
      completion: { confirmedAt: at, type: "confirmed" },
      status: "completed",
    });
    expect(
      prepareRecipeReview(completed, completed.actionVersion)
    ).toMatchObject({
      _tag: "Unavailable",
      reason: "inactive",
    });
  });

  it.each(["name", "ingredients", "instructions"] as const)(
    "recomputes the domain requirement for %s despite stale empty blocker arrays",
    (field) => {
      const blocked = Schema.decodeUnknownSync(RecipeImportAction)({
        ...action,
        review: { ...action.review, recipe: { ...recipe, [field]: null } },
      });
      expect(prepareRecipeReview(blocked, blocked.actionVersion)).toMatchObject(
        {
          _tag: "Unavailable",
          reason: "unpublishable",
        }
      );
    }
  );

  it("uses the domain cross-field invariants rather than trusting stored blockers", () => {
    const blocked = Schema.decodeUnknownSync(RecipeImportAction)({
      ...action,
      review: {
        ...action.review,
        recipe: {
          ...recipe,
          times: { ...recipe.times, total: { seconds: 60 } },
        },
      },
    });
    expect(prepareRecipeReview(blocked, blocked.actionVersion)).toMatchObject({
      _tag: "Unavailable",
      reason: "unpublishable",
    });
  });

  it("requires the reviewed planning tags before publication", () => {
    const blocked = { ...action, review: { ...action.review, tags: null } };
    expect(prepareRecipeReview(blocked, blocked.actionVersion)).toMatchObject({
      _tag: "Unavailable",
      reason: "unpublishable",
    });
  });

  it("refuses an oversized complete preview instead of hiding facts or inviting publication", () => {
    const oversized = Schema.decodeUnknownSync(RecipeImportAction)({
      ...action,
      review: {
        ...action.review,
        recipe: {
          ...recipe,
          notes: Array.from({ length: 16 }, () => "🍲".repeat(1024)),
        },
      },
    });
    expect(
      JSON.stringify({ recipe: oversized.review.recipe, tags }).length
    ).toBeLessThan(64 * 1024);
    expect(
      prepareRecipeReview(oversized, oversized.actionVersion)
    ).toMatchObject({
      _tag: "Unavailable",
      message: expect.stringContaining("Open the recipe import in the app"),
      reason: "preview_too_large",
    });
  });
});
