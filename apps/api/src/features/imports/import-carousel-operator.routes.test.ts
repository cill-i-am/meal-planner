import {
  ProcessingRecipeImportIntent,
  RecipeImportIntentId,
} from "@meal-planner/recipe-import-api";
import { Effect, Layer, Schema } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { afterAll, describe, expect, it } from "vitest";

import { AuthPrincipalResolver } from "../auth/auth.principal.js";
import {
  MaximumOperatorCarouselRequestBytes,
  OperatorCarouselRoutes,
} from "./import-carousel-operator.routes.js";
import { OperatorCarouselImportService } from "./import-carousel-operator.service.js";
import type { OperatorCarouselImportServiceShape } from "./import-carousel-operator.service.js";
import { invalidCarouselBundle } from "./import.errors.js";
import {
  makeTestAuthPrincipalResolver,
  TestImportPrincipal,
} from "./import.test-fixtures.js";

const intentId = Schema.decodeUnknownSync(RecipeImportIntentId)(
  "018f47ad-91aa-7c35-b6fe-000000000162"
);
const timestamp = "2026-07-25T20:00:00.000Z";
const processingIntent = Schema.decodeUnknownSync(ProcessingRecipeImportIntent)(
  {
    activity: { type: "working" },
    createdAt: timestamp,
    id: intentId,
    intentVersion: 2,
    links: {
      self: `/v1/recipe-import-intents/${intentId}`,
      timeline: `/v1/recipe-import-intents/${intentId}/timeline`,
    },
    object: "recipe_import_intent",
    processing: {
      sourceKind: "carousel",
      startedAt: timestamp,
      type: "acquiring_media",
    },
    source: {
      canonicalUrl: "https://www.tiktok.com/@cook/photo/7520000000000000162",
      kind: "tiktok",
      resolution: "resolved",
    },
    status: "processing",
    updatedAt: timestamp,
  }
);
const completeJpegBase64 =
  "/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAADAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABgj/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABykX//Z";

const principalResolver = makeTestAuthPrincipalResolver("test-session");

const makeApp = (service: OperatorCarouselImportServiceShape) =>
  HttpRouter.toWebHandler(
    Layer.mergeAll(
      OperatorCarouselRoutes,
      Layer.succeed(
        AuthPrincipalResolver,
        AuthPrincipalResolver.of(principalResolver)
      ),
      Layer.succeed(
        OperatorCarouselImportService,
        OperatorCarouselImportService.of(service)
      )
    ),
    { disableLogger: true }
  );

describe("operator carousel route", () => {
  const apps: ReturnType<typeof makeApp>[] = [];

  afterAll(async () => {
    await Promise.all(apps.map(({ dispose }) => dispose()));
  });

  it("authenticates and admits a bounded typed bundle", async () => {
    const calls: unknown[][] = [];
    const app = makeApp({
      admit: (principal, bundle, idempotencyKey) =>
        Effect.sync(() => {
          calls.push([principal, bundle, idempotencyKey]);
          return processingIntent;
        }),
    });
    apps.push(app);
    const body = {
      declaredPageCount: 1,
      images: [
        {
          height: 3,
          jpegBase64: completeJpegBase64,
          orderIndex: 0,
          sha256:
            "7f593180ed96b891629067143da2fb44eb996b1a45e7561870a5754d5bba506e",
          width: 2,
        },
      ],
      source: {
        kind: "tiktok",
        url: "https://www.tiktok.com/@cook/photo/7520000000000000162",
      },
    };

    const unauthorized = await app.handler(
      new Request("https://meal-planner.test/imports/operator-carousel", {
        body: JSON.stringify(body),
        headers: {
          "content-type": "application/json",
          "idempotency-key": "operator-162",
        },
        method: "POST",
      })
    );
    const admitted = await app.handler(
      new Request("https://meal-planner.test/imports/operator-carousel", {
        body: JSON.stringify(body),
        headers: {
          "content-type": "application/json",
          cookie: "better-auth.session_token=test-session",
          "idempotency-key": "operator-162",
        },
        method: "POST",
      })
    );

    expect(unauthorized.status).toBe(401);
    expect(admitted.status).toBe(202);
    await expect(admitted.json()).resolves.toMatchObject({
      id: intentId,
      processing: { sourceKind: "carousel", type: "acquiring_media" },
      source: { resolution: "resolved" },
      status: "processing",
    });
    expect(calls).toEqual([
      [
        TestImportPrincipal,
        expect.objectContaining({ declaredPageCount: 1 }),
        "operator-162",
      ],
    ]);
  });

  it("rejects the body before decoding when it exceeds the route limit", async () => {
    const app = makeApp({ admit: () => Effect.die("must not be called") });
    apps.push(app);
    const unauthorized = await app.handler(
      new Request("https://meal-planner.test/imports/operator-carousel", {
        body: "x".repeat(MaximumOperatorCarouselRequestBytes + 1),
        headers: {
          "content-type": "application/json",
          "idempotency-key": "operator-oversized",
        },
        method: "POST",
      })
    );
    const response = await app.handler(
      new Request("https://meal-planner.test/imports/operator-carousel", {
        body: "x".repeat(MaximumOperatorCarouselRequestBytes + 1),
        headers: {
          "content-type": "application/json",
          cookie: "better-auth.session_token=test-session",
          "idempotency-key": "operator-oversized",
        },
        method: "POST",
      })
    );

    expect(unauthorized.status).toBe(401);
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "incomplete_carousel",
        message: "A complete ordered JPEG carousel is required.",
        recovery: "request_complete_carousel",
      },
    });
  });

  it.each([
    ["malformed JSON", "{"],
    [
      "schema-invalid JSON",
      JSON.stringify({
        declaredPageCount: 1,
        images: [],
        source: {
          kind: "tiktok",
          url: "https://www.tiktok.com/@cook/photo/7520000000000000162",
        },
      }),
    ],
  ])("returns complete-bundle recovery for %s", async (_name, body) => {
    const app = makeApp({ admit: () => Effect.die("must not be called") });
    apps.push(app);
    const response = await app.handler(
      new Request("https://meal-planner.test/imports/operator-carousel", {
        body,
        headers: {
          "content-type": "application/json",
          cookie: "better-auth.session_token=test-session",
          "idempotency-key": "operator-invalid-body",
        },
        method: "POST",
      })
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "incomplete_carousel",
        message: "A complete ordered JPEG carousel is required.",
        recovery: "request_complete_carousel",
      },
    });
  });

  it("returns the typed complete-bundle recovery without a draft response", async () => {
    const app = makeApp({
      admit: () => Effect.fail(invalidCarouselBundle()),
    });
    apps.push(app);
    const response = await app.handler(
      new Request("https://meal-planner.test/imports/operator-carousel", {
        body: JSON.stringify({
          declaredPageCount: 1,
          images: [
            {
              height: 1,
              jpegBase64: "/9j/wAALCAABAAEBAREA/9k=",
              orderIndex: 0,
              sha256: "0".repeat(64),
              width: 1,
            },
          ],
          source: {
            kind: "tiktok",
            url: "https://www.tiktok.com/@cook/photo/7520000000000000162",
          },
        }),
        headers: {
          "content-type": "application/json",
          cookie: "better-auth.session_token=test-session",
          "idempotency-key": "operator-invalid",
        },
        method: "POST",
      })
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "incomplete_carousel",
        message: "A complete ordered JPEG carousel is required.",
        recovery: "request_complete_carousel",
      },
    });
  });
});
