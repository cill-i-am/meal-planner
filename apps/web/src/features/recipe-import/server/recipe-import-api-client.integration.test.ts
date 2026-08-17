import {
  IdempotencyKey,
  RecipeImportApiClient,
  SourceUrl,
} from "@meal-planner/recipe-import-api";
import {
  ConfigProvider,
  Effect,
  Layer,
  ManagedRuntime,
  Redacted,
  Schema,
} from "effect";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import { describe, expect, it } from "vitest";

import {
  makeConfiguredWebRecipeImportApiClientLayer,
  makeWebRecipeImportApiClientLayer,
  RecipeImportRuntimeConfigurationError,
} from "./recipe-import-api-client.server.js";

const rawBearerToken = "web-generated-client-test-token";
const sourceUrl = Schema.decodeUnknownSync(SourceUrl)(
  "https://www.tiktok.com/@kitchen/video/7390123456789012345"
);
const idempotencyKey = Schema.decodeUnknownSync(IdempotencyKey)(
  "web-generated-client-admission"
);

const acquireConfigurationError = (configuration: Record<string, string>) => {
  const unusedHttpClient = HttpClient.make(() =>
    Effect.die("Configuration failure must precede HTTP acquisition")
  );
  const layer = makeConfiguredWebRecipeImportApiClientLayer().pipe(
    Layer.provide(Layer.succeed(HttpClient.HttpClient, unusedHttpClient))
  );

  return Effect.runPromise(
    Effect.scoped(Layer.build(layer)).pipe(
      Effect.provide(
        ConfigProvider.layer(ConfigProvider.fromUnknown(configuration))
      ),
      Effect.flip
    )
  );
};

describe("recipe import generated HTTP client", () => {
  it("fails configuration acquisition explicitly without retaining a malformed secret", async () => {
    const malformedSecret = " malformed-runtime-secret-canary ";
    const error = await acquireConfigurationError({
      RECIPE_IMPORT_API_BASE_URL: "https://recipe-import.test",
      RECIPE_IMPORT_API_TOKEN: malformedSecret,
    });

    expect(error).toBeInstanceOf(RecipeImportRuntimeConfigurationError);
    expect(error).toMatchObject({
      _tag: "RecipeImportRuntimeConfigurationError",
      message: "Recipe import runtime configuration is invalid.",
    });
    expect(JSON.stringify(error)).not.toContain(malformedSecret);
  });

  it.each([
    {
      configuration: {
        RECIPE_IMPORT_API_BASE_URL: "https://recipe-import.test",
      },
      name: "missing token",
    },
    {
      configuration: {
        RECIPE_IMPORT_API_BASE_URL: "invalid-runtime-url-canary",
        RECIPE_IMPORT_API_TOKEN: rawBearerToken,
      },
      name: "invalid base URL",
    },
  ])("rejects $name configuration explicitly", async ({ configuration }) => {
    const error = await acquireConfigurationError(configuration);

    expect(error).toBeInstanceOf(RecipeImportRuntimeConfigurationError);
    expect(error).toMatchObject({
      _tag: "RecipeImportRuntimeConfigurationError",
      message: "Recipe import runtime configuration is invalid.",
    });
  });

  it("acquires app-local configuration once and reuses the generated client", async () => {
    const requests: Request[] = [];
    const httpClient = HttpClient.make((request, _url, signal) =>
      HttpClientRequest.toWeb(request, { signal }).pipe(
        Effect.orDie,
        Effect.map((webRequest) => {
          requests.push(webRequest);
          return new Response(null, { status: 500 });
        }),
        Effect.map((response) => HttpClientResponse.fromWeb(request, response))
      )
    );
    const layer = makeConfiguredWebRecipeImportApiClientLayer().pipe(
      Layer.provide(Layer.succeed(HttpClient.HttpClient, httpClient)),
      Layer.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({
            RECIPE_IMPORT_API_BASE_URL: "https://recipe-import.test",
            RECIPE_IMPORT_API_TOKEN: rawBearerToken,
          })
        )
      )
    );
    const runtime = ManagedRuntime.make(layer);

    try {
      const firstClient = await runtime.runPromise(RecipeImportApiClient);
      const secondClient = await runtime.runPromise(RecipeImportApiClient);
      await runtime.runPromiseExit(
        firstClient.recipeImportIntents.create({
          headers: { "idempotency-key": idempotencyKey },
          payload: { source: { kind: "tiktok", url: sourceUrl } },
        })
      );

      expect(firstClient).toBe(secondClient);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.headers.get("authorization")).toBe(
        `Bearer ${rawBearerToken}`
      );
    } finally {
      await runtime.dispose();
    }
  });

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
