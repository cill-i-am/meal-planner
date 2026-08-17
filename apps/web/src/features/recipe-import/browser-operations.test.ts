// @vitest-environment jsdom

import {
  RecipeImportIntent,
  RecipeImportIntentId,
} from "@meal-planner/recipe-import-api";
import { Schema } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import { makeBrowserRecipeImportOperations } from "./browser-operations.js";

afterEach(() => vi.unstubAllGlobals());

const intentId = Schema.decodeUnknownSync(RecipeImportIntentId)(
  "11111111-1111-4111-8111-111111111111"
);
const processing = Schema.encodeSync(RecipeImportIntent)(
  Schema.decodeUnknownSync(RecipeImportIntent)({
    activity: { type: "working" },
    createdAt: "2026-08-17T00:00:00.000Z",
    id: intentId,
    intentVersion: 1,
    links: {
      self: `/v1/recipe-import-intents/${intentId}`,
      timeline: `/v1/recipe-import-intents/${intentId}/timeline`,
    },
    object: "recipe_import_intent",
    processing: {
      startedAt: "2026-08-17T00:00:00.000Z",
      type: "resolving_source",
    },
    source: { kind: "tiktok", resolution: "pending" },
    status: "processing",
    updatedAt: "2026-08-17T00:00:00.000Z",
  })
);

describe("browser recipe import operations", () => {
  it("uses the same-origin generated client without a bearer credential", async () => {
    const fetch = vi.fn(
      async (request: RequestInfo | URL, init?: RequestInit) => {
        const normalized = new Request(request, init);
        expect(normalized.url).toBe(
          `${globalThis.location.origin}/v1/recipe-import-intents/${intentId}`
        );
        expect(normalized.headers.has("authorization")).toBe(false);
        expect(normalized.credentials).toBe("same-origin");
        return Response.json(processing);
      }
    );
    vi.stubGlobal("fetch", fetch);

    const operations = makeBrowserRecipeImportOperations();
    const result = await operations.getIntent({ intentId });

    expect(result.id).toBe(intentId);
    expect(fetch).toHaveBeenCalledOnce();
  });
});
