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

import { RecipeImportProfileAlias } from "../profiles.js";
import {
  makeConfiguredWebRecipeImportProfileRegistryLayer,
  makeWebRecipeImportApiClientLayer,
  RecipeImportProfileRegistry,
  RecipeImportProfileSelectionError,
  RecipeImportRuntimeConfigurationError,
} from "./recipe-import-api-client.server.js";

const rawBearerTokenA = "web-generated-client-test-token-a";
const rawBearerTokenB = "web-generated-client-test-token-b";
const profileAliasA = Schema.decodeUnknownSync(RecipeImportProfileAlias)(
  "home"
);
const profileAliasB = Schema.decodeUnknownSync(RecipeImportProfileAlias)(
  "test-kitchen"
);
const validConfiguration = {
  RECIPE_IMPORT_API_BASE_URL: "https://recipe-import.test",
  RECIPE_IMPORT_DEFAULT_PROFILE_ALIAS: profileAliasA,
  RECIPE_IMPORT_PROFILE_A_ALIAS: profileAliasA,
  RECIPE_IMPORT_PROFILE_A_LABEL: "Our household",
  RECIPE_IMPORT_PROFILE_A_TOKEN: rawBearerTokenA,
  RECIPE_IMPORT_PROFILE_B_ALIAS: profileAliasB,
  RECIPE_IMPORT_PROFILE_B_LABEL: "Test kitchen",
  RECIPE_IMPORT_PROFILE_B_TOKEN: rawBearerTokenB,
};
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
  const layer = makeConfiguredWebRecipeImportProfileRegistryLayer().pipe(
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
      ...validConfiguration,
      RECIPE_IMPORT_PROFILE_A_TOKEN: malformedSecret,
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
        ...validConfiguration,
        RECIPE_IMPORT_PROFILE_B_TOKEN: undefined,
      },
      name: "missing token",
    },
    {
      configuration: {
        ...validConfiguration,
        RECIPE_IMPORT_API_BASE_URL: "invalid-runtime-url-canary",
      },
      name: "invalid base URL",
    },
    {
      configuration: {
        ...validConfiguration,
        RECIPE_IMPORT_PROFILE_B_ALIAS: profileAliasA,
      },
      name: "duplicate alias",
    },
    {
      configuration: {
        ...validConfiguration,
        RECIPE_IMPORT_PROFILE_B_TOKEN: rawBearerTokenA,
      },
      name: "duplicate token",
    },
    {
      configuration: {
        ...validConfiguration,
        RECIPE_IMPORT_PROFILE_B_LABEL: "Our household",
      },
      name: "duplicate label",
    },
    {
      configuration: {
        ...validConfiguration,
        RECIPE_IMPORT_DEFAULT_PROFILE_ALIAS: "unknown",
      },
      name: "unknown default",
    },
  ])("rejects $name configuration explicitly", async ({ configuration }) => {
    const error = await acquireConfigurationError(
      Object.fromEntries(
        Object.entries(configuration).filter((entry) => entry[1] !== undefined)
      ) as Record<string, string>
    );

    expect(error).toBeInstanceOf(RecipeImportRuntimeConfigurationError);
    expect(error).toMatchObject({
      _tag: "RecipeImportRuntimeConfigurationError",
      message: "Recipe import runtime configuration is invalid.",
    });
  });

  it("publishes only alias and label while selecting and reusing the correct Redacted client", async () => {
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
    const layer = makeConfiguredWebRecipeImportProfileRegistryLayer().pipe(
      Layer.provide(Layer.succeed(HttpClient.HttpClient, httpClient)),
      Layer.provide(
        ConfigProvider.layer(ConfigProvider.fromUnknown(validConfiguration))
      )
    );
    const runtime = ManagedRuntime.make(layer);

    try {
      const registry = await runtime.runPromise(RecipeImportProfileRegistry);
      const firstClient = await runtime.runPromise(
        registry.clientFor(profileAliasA)
      );
      const secondClient = await runtime.runPromise(
        registry.clientFor(profileAliasA)
      );
      const profileBClient = await runtime.runPromise(
        registry.clientFor(profileAliasB)
      );
      await runtime.runPromiseExit(
        firstClient.recipeImportIntents.create({
          headers: { "idempotency-key": idempotencyKey },
          payload: { source: { kind: "tiktok", url: sourceUrl } },
        })
      );
      await runtime.runPromiseExit(
        profileBClient.recipeImportIntents.create({
          headers: { "idempotency-key": idempotencyKey },
          payload: { source: { kind: "tiktok", url: sourceUrl } },
        })
      );

      expect(firstClient).toBe(secondClient);
      expect(firstClient).not.toBe(profileBClient);
      expect(requests).toHaveLength(2);
      expect(requests[0]?.headers.get("authorization")).toBe(
        `Bearer ${rawBearerTokenA}`
      );
      expect(requests[1]?.headers.get("authorization")).toBe(
        `Bearer ${rawBearerTokenB}`
      );
      expect(registry.publicConfiguration).toEqual({
        defaultAlias: profileAliasA,
        profiles: [
          { alias: profileAliasA, label: "Our household" },
          { alias: profileAliasB, label: "Test kitchen" },
        ],
      });
      const serialized = JSON.stringify(registry.publicConfiguration);
      expect(serialized).not.toContain(rawBearerTokenA);
      expect(serialized).not.toContain(rawBearerTokenB);
      expect(serialized).not.toContain("baseUrl");
    } finally {
      await runtime.dispose();
    }
  });

  it("fails closed when a well-formed alias is not configured", async () => {
    const unusedHttpClient = HttpClient.make(() =>
      Effect.die("Unknown aliases must not acquire HTTP")
    );
    const runtime = ManagedRuntime.make(
      makeConfiguredWebRecipeImportProfileRegistryLayer().pipe(
        Layer.provide(Layer.succeed(HttpClient.HttpClient, unusedHttpClient)),
        Layer.provide(
          ConfigProvider.layer(ConfigProvider.fromUnknown(validConfiguration))
        )
      )
    );

    try {
      const registry = await runtime.runPromise(RecipeImportProfileRegistry);
      const error = await runtime.runPromise(
        Effect.flip(
          registry.clientFor(
            Schema.decodeUnknownSync(RecipeImportProfileAlias)("unknown")
          )
        )
      );

      expect(error).toBeInstanceOf(RecipeImportProfileSelectionError);
      expect(JSON.stringify(error)).not.toContain(rawBearerTokenA);
      expect(JSON.stringify(error)).not.toContain(rawBearerTokenB);
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
      token: Redacted.make(rawBearerTokenA),
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
      `Bearer ${rawBearerTokenA}`
    );
    expect(JSON.stringify(result)).not.toContain(rawBearerTokenA);
  });
});
