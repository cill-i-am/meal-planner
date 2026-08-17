import {
  IdempotencyKey,
  RecipeImportApiClient,
  SourceUrl,
} from "@meal-planner/recipe-import-api";
import { Effect, Layer, Redacted, Schema } from "effect";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import { describe, expect, it } from "vitest";

import { makeWebRecipeImportApiClientLayer } from "./recipe-import-api-client.server.js";

const rawBearerToken = "web-generated-client-test-token";
const sourceUrl = Schema.decodeUnknownSync(SourceUrl)(
  "https://www.tiktok.com/@kitchen/video/7390123456789012345"
);
const idempotencyKey = Schema.decodeUnknownSync(IdempotencyKey)(
  "web-generated-client-admission"
);

describe("recipe import generated HTTP client", () => {
  it("uses only canonical /v1 generated-client routes and keeps its bearer out of returned data", async () => {
    const requests: Request[] = [];
    const httpClient = HttpClient.make((request, _url, signal) =>
      HttpClientRequest.toWeb(request, { signal }).pipe(
        Effect.orDie,
        Effect.map((webRequest) => {
          requests.push(webRequest);
          return Response.json(
            {
              activity: { type: "working" },
              createdAt: "2026-08-16T00:00:00.000Z",
              id: "11111111-1111-4111-8111-111111111111",
              intentVersion: 1,
              links: {
                self: "/v1/recipe-import-intents/11111111-1111-4111-8111-111111111111",
                timeline:
                  "/v1/recipe-import-intents/11111111-1111-4111-8111-111111111111/timeline",
              },
              object: "recipe_import_intent",
              processing: {
                startedAt: "2026-08-16T00:00:00.000Z",
                type: "resolving_source",
              },
              source: { kind: "tiktok", resolution: "pending" },
              status: "processing",
              updatedAt: "2026-08-16T00:00:00.000Z",
            },
            {
              headers: {
                location:
                  "/v1/recipe-import-intents/11111111-1111-4111-8111-111111111111",
                "retry-after": "2",
              },
              status: 201,
            }
          );
        }),
        Effect.map((response) => HttpClientResponse.fromWeb(request, response))
      )
    );

    const layer = makeWebRecipeImportApiClientLayer({
      baseUrl: "https://recipe-import.test",
      token: Redacted.make(rawBearerToken),
    }).pipe(Layer.provide(Layer.succeed(HttpClient.HttpClient, httpClient)));

    const result = await Effect.runPromise(
      Effect.gen(function* createIntent() {
        const client = yield* RecipeImportApiClient;
        return yield* client.recipeImportIntents.create({
          headers: { "idempotency-key": idempotencyKey },
          payload: { source: { kind: "tiktok", url: sourceUrl } },
        });
      }).pipe(Effect.provide(layer))
    );

    expect(requests).toHaveLength(1);
    expect(new URL(requests[0]?.url ?? "").pathname).toBe(
      "/v1/recipe-import-intents"
    );
    expect(requests[0]?.headers.get("authorization")).toBe(
      `Bearer ${rawBearerToken}`
    );
    expect(JSON.stringify(result)).not.toContain(rawBearerToken);
  });
});
