import { Effect, Layer, Schema } from "effect";
import {
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
  HttpRouter,
} from "effect/http";
import { HttpApiClient } from "effect/http-api";
import { afterAll, describe, expect, it } from "vitest";

import { JsonHttpPlatformServices } from "../../../infrastructure/json-http-platform.js";
import { TescoCatalogueApi } from "./catalogue.http.js";
import {
  CatalogueProductResults,
  CatalogueSuggestions,
  CatalogueSuggestionsInput,
  CategoryProductsInput,
  SearchCatalogueInput,
} from "./catalogue.model.js";
import { TescoCatalogue } from "./catalogue.port.js";
import { TescoCatalogueRoutes } from "./catalogue.routes.js";

const results = Schema.decodeUnknownSync(CatalogueProductResults)({
  pageInformation: { count: 1, pageNo: 1, pageSize: 24, total: 1 },
  results: [{ id: "123", title: "Milk", type: "Product" }],
});
const suggestions = Schema.decodeUnknownSync(CatalogueSuggestions)({
  results: [{ query: "milk" }],
});

describe("catalogue HTTP contract", () => {
  const apps: ReturnType<typeof HttpRouter.toWebHandler>[] = [];
  afterAll(async () => {
    await Promise.all(apps.map((app) => app.dispose()));
  });

  const makeApp = (output: CatalogueProductResults = results) => {
    const calls: unknown[] = [];
    const app = HttpRouter.toWebHandler(
      TescoCatalogueRoutes.pipe(
        Layer.provide(
          Layer.succeed(TescoCatalogue, {
            categoryProducts: (input) =>
              Effect.sync(() => {
                calls.push(input);
                return output;
              }),
            search: (input) =>
              Effect.sync(() => {
                calls.push(input);
                return output;
              }),
            suggestions: (input) =>
              Effect.sync(() => {
                calls.push(input);
                return suggestions;
              }),
          })
        ),
        Layer.provide(JsonHttpPlatformServices)
      ),
      { disableLogger: true }
    );
    apps.push(app);
    return { ...app, calls };
  };

  it.each([
    {
      expected: { count: 24, page: 1, query: "milk", sortBy: "relevance" },
      method: "GET",
      path: "/tesco/search?query=milk",
    },
    {
      body: { query: "milk" },
      expected: { count: 24, page: 1, query: "milk", sortBy: "relevance" },
      method: "POST",
      path: "/tesco/search",
    },
    {
      expected: {
        count: 24,
        facet: "fresh-food",
        page: 1,
        sortBy: "relevance",
      },
      method: "GET",
      path: "/tesco/categories/fresh-food/products",
    },
    {
      body: {},
      expected: {
        count: 24,
        facet: "fresh-food",
        page: 1,
        sortBy: "relevance",
      },
      method: "POST",
      path: "/tesco/categories/fresh-food/products",
    },
    {
      expected: { limit: 10, query: "milk" },
      method: "GET",
      path: "/tesco/suggestions?query=milk",
    },
  ])(
    "decodes defaults before $method $path dispatch",
    async ({ path, method, body, expected }) => {
      const app = makeApp();
      const init: RequestInit = { method };
      if (body !== undefined) {
        init.body = JSON.stringify(body);
        init.headers = { "content-type": "application/json" };
      }
      const response = await app.handler(
        new Request(`https://meal-planner.test${path}`, init)
      );
      expect(response.status).toBe(200);
      expect(app.calls).toStrictEqual([expected]);
      await expect(response.json()).resolves.toStrictEqual(
        path.startsWith("/tesco/suggestions") ? suggestions : results
      );
    }
  );

  it.each(["0", "-1", "1.5", "1e2", "+1", "", "01", "9007199254740992"])(
    "rejects invalid query count %j without dispatch",
    async (count) => {
      const app = makeApp();
      const response = await app.handler(
        new Request(
          `https://meal-planner.test/tesco/search?query=milk&count=${encodeURIComponent(
            count
          )}`
        )
      );
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toStrictEqual({
        error: "invalid_request",
        message: "The request is invalid.",
      });
      expect(app.calls).toStrictEqual([]);
    }
  );

  it.each([
    { method: "GET", path: "/tesco/categories/%20/products" },
    { body: "{", method: "POST", path: "/tesco/search" },
    {
      body: JSON.stringify({ page: 1.5, query: "milk" }),
      method: "POST",
      path: "/tesco/search",
    },
    { method: "GET", path: "/tesco/suggestions?query=milk&limit=0" },
  ])(
    "rejects invalid $method $path before dispatch",
    async ({ path, method, body }) => {
      const app = makeApp();
      const init: RequestInit = { method };
      if (body !== undefined) {
        init.body = body;
        init.headers = { "content-type": "application/json" };
      }
      const response = await app.handler(
        new Request(`https://meal-planner.test${path}`, init)
      );
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toStrictEqual({
        error: "invalid_request",
        message: "The request is invalid.",
      });
      expect(app.calls).toStrictEqual([]);
    }
  );

  it("encodes only the public product fields", async () => {
    const canary = "provider-account-secret";
    const app = makeApp({
      ...results,
      results: results.results.map((product) => ({
        ...product,
        providerSecret: canary,
      })),
    });
    const response = await app.handler(
      new Request("https://meal-planner.test/tesco/search?query=milk")
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toStrictEqual(results);
    expect(JSON.stringify(body)).not.toContain(canary);
  });

  it("round-trips all five operations through the generated client", async () => {
    const app = makeApp();
    const search = Schema.decodeUnknownSync(SearchCatalogueInput)({
      count: 12,
      page: 2,
      query: "milk",
      sortBy: "price",
    });
    const category = Schema.decodeUnknownSync(CategoryProductsInput)({
      count: 12,
      facet: "fresh-food",
      page: 2,
      sortBy: "price",
    });
    const suggestion = Schema.decodeUnknownSync(CatalogueSuggestionsInput)({
      limit: 5,
      query: "milk",
    });
    const client = HttpClient.make((request, _url, signal) =>
      HttpClientRequest.toWeb(request, { signal }).pipe(
        Effect.flatMap((web) => Effect.promise(() => app.handler(web))),
        Effect.map((response) => HttpClientResponse.fromWeb(request, response)),
        Effect.orDie
      )
    );
    await Effect.runPromise(
      Effect.gen(function* generatedCatalogueClient() {
        const api = yield* HttpApiClient.makeWith(TescoCatalogueApi, {
          baseUrl: "https://meal-planner.test",
          httpClient: client,
        });
        expect(yield* api.catalogue.search({ query: search })).toStrictEqual(
          results
        );
        expect(
          yield* api.catalogue.searchBody({ payload: search })
        ).toStrictEqual(results);
        expect(
          yield* api.catalogue.categoryProducts({
            params: { facet: category.facet },
            query: category,
          })
        ).toStrictEqual(results);
        expect(
          yield* api.catalogue.categoryProductsBody({
            params: { facet: category.facet },
            payload: category,
          })
        ).toStrictEqual(results);
        expect(
          yield* api.catalogue.suggestions({ query: suggestion })
        ).toStrictEqual(suggestions);
      }).pipe(Effect.scoped)
    );
    expect(app.calls).toStrictEqual([
      search,
      search,
      category,
      category,
      suggestion,
    ]);
  });
});
