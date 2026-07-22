import { Effect, Layer, Redacted } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type {
  RecipeReviewServiceShape,
  RecipeReviewerActorId,
} from "./import-recipe-review.js";
import {
  RecipeReviewService,
  recipeReviewVersionConflict,
} from "./import-recipe-review.js";
import { RecipeReviewRoutes } from "./import-recipe-review.routes.js";
import type { ImportAuthorizerShape } from "./import.auth.js";
import { ImportAuthorizer, makeImportAuthorizer } from "./import.auth.js";

const importId = "018f47ad-91aa-7c35-b6fe-000000000321";
const validCorrection = {
  correction: {
    field: "name",
    reason: "The title is visible in the cited caption frame.",
    value: "Tomato and Onion Stew",
  },
  expectedVersion: 0,
  tags: {
    cuisines: ["Irish"],
    dietaryFit: "household_match",
    difficulty: "easy",
    leftovers: "one_meal",
    mealTypes: ["dinner"],
    totalTimeBand: "30_to_60_minutes",
  },
};

let authorizer: ImportAuthorizerShape;

beforeAll(async () => {
  authorizer = await Effect.runPromise(
    makeImportAuthorizer(Redacted.make("test-review-token"))
  );
});

const makeApp = (service: RecipeReviewServiceShape) =>
  HttpRouter.toWebHandler(
    Layer.mergeAll(
      RecipeReviewRoutes,
      Layer.succeed(ImportAuthorizer, ImportAuthorizer.of(authorizer)),
      Layer.succeed(RecipeReviewService, RecipeReviewService.of(service))
    ),
    { disableLogger: true }
  );

const unreachableService = (called: () => void): RecipeReviewServiceShape => ({
  approve: () => {
    called();
    return Effect.die("unreachable");
  },
  correct: () => {
    called();
    return Effect.die("unreachable");
  },
  get: () => {
    called();
    return Effect.die("unreachable");
  },
  listApproved: () => {
    called();
    return Effect.die("unreachable");
  },
  reject: () => {
    called();
    return Effect.die("unreachable");
  },
  returnToReview: () => {
    called();
    return Effect.die("unreachable");
  },
});

describe("recipe review routes", () => {
  const apps: ReturnType<typeof makeApp>[] = [];

  afterAll(async () => {
    await Promise.all(apps.map(({ dispose }) => dispose()));
  });

  it.each([
    ["GET", `/recipe-drafts/${importId}`, undefined],
    ["PATCH", `/recipe-drafts/${importId}`, validCorrection],
    [
      "POST",
      `/recipe-drafts/${importId}/approve`,
      { expectedVersion: 1, reason: "Approved." },
    ],
    [
      "POST",
      `/recipe-drafts/${importId}/reject`,
      { expectedVersion: 1, reason: "Rejected." },
    ],
    [
      "POST",
      `/recipe-drafts/${importId}/return-to-review`,
      { expectedVersion: 1, reason: "Review again." },
    ],
    ["GET", "/recipe-bank", undefined],
  ] as const)(
    "requires authentication for %s %s",
    async (method, path, body) => {
      let calls = 0;
      const app = makeApp(unreachableService(() => calls++));
      apps.push(app);
      const response = await app.handler(
        new Request(`https://meal-planner.test${path}`, {
          ...(body === undefined
            ? {}
            : {
                body: JSON.stringify(body),
                headers: { "content-type": "application/json" },
              }),
          method,
        })
      );

      expect(response.status).toBe(401);
      expect(calls).toBe(0);
    }
  );

  it("attributes an authorized write to the configured private credential", async () => {
    let auditedActor: RecipeReviewerActorId | undefined;
    const service: RecipeReviewServiceShape = {
      ...unreachableService(() => undefined),
      correct: (_id, _request, actorId) => {
        auditedActor = actorId;
        return Effect.fail(recipeReviewVersionConflict(0, 1));
      },
    };
    const app = makeApp(service);
    apps.push(app);
    const response = await app.handler(
      new Request(`https://meal-planner.test/recipe-drafts/${importId}`, {
        body: JSON.stringify(validCorrection),
        headers: {
          authorization: "Bearer test-review-token",
          "content-type": "application/json",
        },
        method: "PATCH",
      })
    );

    expect(response.status).toBe(409);
    expect(auditedActor).toBe("private_api_credential");
    await expect(response.json()).resolves.toEqual({
      error: {
        actualVersion: 1,
        code: "version_conflict",
        expectedVersion: 0,
        message: "The recipe draft changed before this write was applied.",
      },
    });
  });
});
