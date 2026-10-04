import {
  RecipeImportIntent,
  RecipeImportIntentId,
} from "@meal-planner/recipe-import-api";
import { QueryClient, isCancelledError } from "@tanstack/react-query";
import { Effect, Schema } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiEffectQuery, browserApiRuntime } from "../api-client/index.js";
import { parseDisplayedIdentity } from "../auth/index.js";
import { makeRecipeImportEffectOperations } from "./browser-operations.js";

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
  it("aborts the generated-client read when its query is cancelled", async () => {
    let signal: AbortSignal | null | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_request: RequestInfo | URL, init?: RequestInit) => {
        signal = init?.signal;
        return new Promise<Response>(() => {});
      })
    );
    const operations = makeRecipeImportEffectOperations(
      parseDisplayedIdentity({
        organizationId: "organization-a",
        userId: "user-a",
      }),
      browserApiRuntime()
    );
    const queries = new QueryClient();
    const queryKey = ["recipe-import", "cancelled-read"];
    const pending = queries.fetchQuery(
      apiEffectQuery.queryOptions({
        queryFn: () => operations.getIntent({ intentId }),
        queryKey,
        retry: false,
      })
    );
    const cancelled = expect(pending).rejects.toSatisfy(isCancelledError);
    await vi.waitFor(() => expect(signal).toBeDefined());
    await queries.cancelQueries({ queryKey });
    expect(signal?.aborted).toBe(true);
    await cancelled;
    expect(queries.getQueryData(queryKey)).toBeUndefined();
    queries.clear();
  });

  it("uses the same-origin generated client without a bearer credential", async () => {
    const fetch = vi.fn(
      async (request: RequestInfo | URL, init?: RequestInit) => {
        const normalized = new Request(request, init);
        expect(normalized.url).toBe(
          `${globalThis.location.origin}/v1/recipe-import-intents/${intentId}`
        );
        expect(normalized.headers.has("authorization")).toBe(false);
        expect(normalized.headers.get("x-meal-planner-user")).toBe("user-a");
        expect(normalized.headers.get("x-meal-planner-household")).toBe(
          "organization-a"
        );
        expect(normalized.credentials).toBe("same-origin");
        return Response.json(processing);
      }
    );
    vi.stubGlobal("fetch", fetch);

    const operations = makeRecipeImportEffectOperations(
      parseDisplayedIdentity({
        organizationId: "organization-a",
        userId: "user-a",
      }),
      browserApiRuntime()
    );
    const result = await Effect.runPromise(operations.getIntent({ intentId }));

    expect(result.id).toBe(intentId);
    expect(fetch).toHaveBeenCalledOnce();
  });
});
