import { once } from "node:events";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";

import { NodeHttpClient } from "@effect/platform-node";
import { Cause, Effect, Exit, Layer, Option, Redacted, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import { describe, expect, it } from "vitest";

import { TescoAuthSession } from "../auth/auth-session.port.js";
import { TescoCredentialsRejected } from "../auth/auth.errors.js";
import { TescoAuthorizationValue } from "../auth/auth.model.js";
import type { TescoAuthorization } from "../auth/auth.model.js";
import { TescoApiKeyValue, TescoLocale, TescoRegion } from "../tesco.config.js";
import type { TescoCatalogueConfig } from "../tesco.config.js";
import { makeTescoAuthenticatedGraphQlTransportLive } from "./authenticated-graphql-transport.js";
import {
  TescoAuthenticatedGraphQlTransport,
  TescoAuthenticatedRequestUnavailable,
} from "./authenticated-graphql-transport.port.js";
import type {
  AuthenticatedGraphQlRead,
  TescoAuthenticatedGraphQlTransportError,
} from "./authenticated-graphql-transport.port.js";
import {
  CatalogueSuggestionsInput,
  CategoryProductsInput,
  SearchCatalogueInput,
} from "./catalogue.model.js";
import { TescoCatalogue } from "./catalogue.port.js";
import { makeTescoXapiCatalogueLive } from "./xapi-catalogue.js";
import {
  TescoCategoryProductsQuery,
  TescoSearchQuery,
} from "./xapi.protocol.js";

const FixtureApiKey = "fixture-api-key";
const FixtureInitialAuthorization = "Bearer fixture-initial";
const FixtureRefreshedAuthorization = "Bearer fixture-refreshed";

const CapturedGraphQlRequest = Schema.Struct({
  operationName: Schema.String,
  query: Schema.String,
  variables: Schema.Record(Schema.String, Schema.Json),
});

const authorization = (value: string): TescoAuthorization =>
  Redacted.make(Schema.decodeUnknownSync(TescoAuthorizationValue)(value));

const listen = async (server: Server): Promise<string> => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Test server did not expose a TCP address");
  }
  return `http://${address.address}:${address.port}`;
};

const close = async (server: Server): Promise<void> => {
  server.close();
  await once(server, "close");
};

const readRequestBody = (request: IncomingMessage): Promise<string> =>
  // eslint-disable-next-line promise/avoid-new -- Node request streams expose callback-only completion events.
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    request.on("error", reject);
  });

const makeConfig = (mangoUrl: URL): TescoCatalogueConfig => ({
  locale: Schema.decodeUnknownSync(TescoLocale)("en-IE"),
  mangoApiKey: Redacted.make(
    Schema.decodeUnknownSync(TescoApiKeyValue)(FixtureApiKey)
  ),
  mangoUrl,
  region: Schema.decodeUnknownSync(TescoRegion)("IE"),
  releaseBranch: null,
  suggestionUrl: new URL(mangoUrl),
  transactionPurpose: null,
});

const makeLive = (
  mangoUrl: URL,
  options: {
    readonly onRefresh?: () => void;
    readonly refreshedAuthorization?: TescoAuthorization;
  } = {}
) => {
  const initialAuthorization = authorization(FixtureInitialAuthorization);
  const AuthSessionTest = Layer.succeed(
    TescoAuthSession,
    TescoAuthSession.of({
      authorization: Effect.succeed(initialAuthorization),
      refreshAfterUnauthorized: () =>
        Effect.sync(() => {
          options.onRefresh?.();
          return options.refreshedAuthorization ?? initialAuthorization;
        }),
    })
  );

  const config = makeConfig(mangoUrl);
  const TransportLive = makeTescoAuthenticatedGraphQlTransportLive(config).pipe(
    Layer.provide(Layer.mergeAll(AuthSessionTest, NodeHttpClient.layerUndici))
  );

  return makeTescoXapiCatalogueLive(config).pipe(
    Layer.provide(Layer.mergeAll(TransportLive, NodeHttpClient.layerUndici))
  );
};

const searchRequest = (query: string) =>
  Schema.decodeUnknownSync(SearchCatalogueInput)({
    count: 24,
    page: 1,
    query,
    sortBy: "relevance",
  });

const searchResponse = {
  data: {
    search: {
      options: { sortBy: "relevance" },
      pageInformation: {
        count: 1,
        pageNo: 1,
        pageSize: 24,
        query: { searchTerm: "milk" },
        total: 1,
      },
      results: [
        {
          node: {
            __typename: "ProductType",
            defaultImageUrl: "https://example.test/milk.jpg",
            id: "product-1",
            title: "Milk",
          },
        },
      ],
    },
  },
};

const categoryResponse = {
  data: {
    category: {
      options: { sortBy: "price-ascending" },
      pageInformation: {
        count: 1,
        pageNo: 2,
        pageSize: 12,
        total: 13,
      },
      results: [
        {
          node: {
            __typename: "MPProduct",
            id: "category-product-1",
            title: "Category product",
          },
        },
      ],
    },
  },
};

const suggestionsRequest = Schema.decodeUnknownSync(CatalogueSuggestionsInput)({
  limit: 10,
  query: "milk",
});

const makeUnitLive = (
  execute: (
    operation: AuthenticatedGraphQlRead
  ) => Effect.Effect<Schema.Json, TescoAuthenticatedGraphQlTransportError>,
  response = Response.json({ results: [] })
) => {
  const config = makeConfig(new URL("https://xapi.tesco.test/graphql"));
  const TransportTest = Layer.succeed(
    TescoAuthenticatedGraphQlTransport,
    TescoAuthenticatedGraphQlTransport.of({ execute })
  );
  const HttpTest = Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.succeed(HttpClientResponse.fromWeb(request, response))
    )
  );
  return makeTescoXapiCatalogueLive(config).pipe(
    Layer.provide(Layer.mergeAll(TransportTest, HttpTest))
  );
};

const respondJson = (response: ServerResponse, body: Schema.Json): void => {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
};

describe("makeTescoXapiCatalogueLive", () => {
  it("maps authenticated transport failures to semantic catalogue failures", async () => {
    const cases = [
      {
        expected: "TescoCatalogueUnavailable",
        failure: new TescoAuthenticatedRequestUnavailable({
          operation: "search",
        }),
      },
      {
        expected: "TescoCatalogueAuthenticationUnavailable",
        failure: new TescoCredentialsRejected(),
      },
    ] as const;

    await Promise.all(
      cases.map(async ({ expected, failure }) => {
        const Live = makeUnitLive(() => Effect.fail(failure));
        const effect = Effect.gen(function* runMappedFailure() {
          const catalogue = yield* TescoCatalogue;
          return yield* catalogue.search(searchRequest("milk"));
        }).pipe(Effect.provide(Live));

        await expect(Effect.runPromise(effect)).rejects.toMatchObject({
          _tag: expected,
          operation: "search",
        });
      })
    );
  });

  it("rejects an undecodable successful search without provider detail", async () => {
    const canary = "provider-secret-invalid-search";
    const Live = makeUnitLive(() => Effect.succeed({ providerDetail: canary }));
    const effect = Effect.gen(function* runInvalidSearch() {
      const catalogue = yield* TescoCatalogue;
      return yield* catalogue.search(searchRequest("milk"));
    }).pipe(Effect.provide(Live));
    const exit = await Effect.runPromiseExit(effect);
    if (Exit.isSuccess(exit)) {
      throw new Error("Expected an invalid Tesco search response");
    }
    const failure = Option.getOrThrow(Cause.findErrorOption(exit.cause));

    expect(failure).toMatchObject({
      _tag: "TescoCatalogueResponseInvalid",
      operation: "search",
    });
    expect(JSON.stringify(failure)).not.toContain(canary);
  });

  it.each([
    { expected: "TescoCatalogueUnavailable", status: 429 },
    { expected: "TescoCatalogueUnavailable", status: 503 },
    { expected: "TescoCatalogueRequestRejected", status: 403 },
  ])(
    "maps suggestion status $status to $expected",
    async ({ expected, status }) => {
      const Live = makeUnitLive(
        () => Effect.die("Unexpected authenticated request"),
        new Response("{}", { status })
      );
      const effect = Effect.gen(function* runSuggestionFailure() {
        const catalogue = yield* TescoCatalogue;
        return yield* catalogue.suggestions(suggestionsRequest);
      }).pipe(Effect.provide(Live));

      await expect(Effect.runPromise(effect)).rejects.toMatchObject({
        _tag: expected,
        operation: "suggestions",
      });
    }
  );

  it("classifies invalid suggestion JSON without provider leakage", async () => {
    const canary = "provider-secret-invalid-suggestions";
    const Live = makeUnitLive(
      () => Effect.die("Unexpected authenticated request"),
      Response.json({ providerDetail: canary })
    );
    const effect = Effect.gen(function* runInvalidSuggestions() {
      const catalogue = yield* TescoCatalogue;
      return yield* catalogue.suggestions(suggestionsRequest);
    }).pipe(Effect.provide(Live));
    const exit = await Effect.runPromiseExit(effect);
    if (Exit.isSuccess(exit)) {
      throw new Error("Expected an invalid Tesco suggestions response");
    }
    const failure = Option.getOrThrow(Cause.findErrorOption(exit.cause));

    expect(failure).toMatchObject({
      _tag: "TescoCatalogueResponseInvalid",
      operation: "suggestions",
    });
    expect(JSON.stringify(failure)).not.toContain(canary);
    expect(failure).not.toHaveProperty("cause");
    expect(failure).not.toHaveProperty("status");
  });

  it("unwraps credentials only for the outbound Mango request", async () => {
    let sawAuthorization = false;
    let sawApiKey = false;
    const server = createServer((request, response) => {
      sawAuthorization =
        request.headers.authorization === FixtureInitialAuthorization;
      sawApiKey = request.headers["x-apikey"] === FixtureApiKey;
      respondJson(response, searchResponse);
    });
    const baseUrl = await listen(server);

    try {
      const Live = makeLive(new URL(`${baseUrl}/graphql`));

      await Effect.runPromise(
        Effect.gen(function* runCatalogueRequest() {
          const catalogue = yield* TescoCatalogue;
          yield* catalogue.search(searchRequest("milk"));
        }).pipe(Effect.provide(Live))
      );

      expect(sawAuthorization).toBe(true);
      expect(sawApiKey).toBe(true);
    } finally {
      await close(server);
    }
  });

  it("sends only the approved search document while request text stays in variables", async () => {
    const capturedBodies: string[] = [];
    const server = createServer((request, response) => {
      void (async () => {
        try {
          capturedBodies.push(await readRequestBody(request));
          respondJson(response, searchResponse);
        } catch {
          response.destroy();
        }
      })();
    });
    const baseUrl = await listen(server);

    try {
      const Live = makeLive(new URL(`${baseUrl}/graphql`));
      const attackerText =
        'mutation WriteBasket { addItem(productId: "product-1") }';

      const result = await Effect.runPromise(
        Effect.gen(function* searchProgram() {
          const catalogue = yield* TescoCatalogue;
          return yield* catalogue.search(searchRequest(attackerText));
        }).pipe(Effect.provide(Live))
      );

      expect(result.results).toStrictEqual([
        {
          defaultImageUrl: "https://example.test/milk.jpg",
          id: "product-1",
          title: "Milk",
          type: "ProductType",
        },
      ]);
      expect(capturedBodies).toHaveLength(1);
      const body = Schema.decodeUnknownSync(CapturedGraphQlRequest)(
        JSON.parse(capturedBodies[0] ?? "")
      );
      expect(body.operationName).toBe(TescoSearchQuery.operation.operationName);
      expect(body.query).toBe(TescoSearchQuery.operation.document);
      expect(body.variables["query"]).toBe(attackerText);
      expect(body.query).not.toContain(attackerText);
    } finally {
      await close(server);
    }
  });

  it("uses the approved category operation and converts its listing", async () => {
    const capturedBodies: string[] = [];
    const server = createServer((request, response) => {
      void (async () => {
        try {
          capturedBodies.push(await readRequestBody(request));
          respondJson(response, categoryResponse);
        } catch {
          response.destroy();
        }
      })();
    });
    const baseUrl = await listen(server);

    try {
      const Live = makeLive(new URL(`${baseUrl}/graphql`));
      const request = Schema.decodeUnknownSync(CategoryProductsInput)({
        count: 12,
        facet: "facet-123",
        page: 2,
        sortBy: "price-ascending",
      });

      const result = await Effect.runPromise(
        Effect.gen(function* categoryProgram() {
          const catalogue = yield* TescoCatalogue;
          return yield* catalogue.categoryProducts(request);
        }).pipe(Effect.provide(Live))
      );

      expect(result).toStrictEqual({
        pageInformation: {
          count: 1,
          pageNo: 2,
          pageSize: 12,
          total: 13,
        },
        results: [
          {
            id: "category-product-1",
            title: "Category product",
            type: "MPProduct",
          },
        ],
        sortBy: "price-ascending",
      });
      expect(capturedBodies).toHaveLength(1);
      const body = Schema.decodeUnknownSync(CapturedGraphQlRequest)(
        JSON.parse(capturedBodies[0] ?? "")
      );
      expect(body).toStrictEqual({
        operationName: TescoCategoryProductsQuery.operation.operationName,
        query: TescoCategoryProductsQuery.operation.document,
        variables: {
          count: 12,
          facet: "facet-123",
          page: 2,
          sortBy: "price-ascending",
        },
      });
    } finally {
      await close(server);
    }
  });

  it("refreshes once after 401 and retries the same proven read", async () => {
    const capturedBodies: string[] = [];
    const credentialObservations: {
      readonly apiKeyMatches: boolean;
      readonly authorizationMatches: boolean;
    }[] = [];
    let refreshCount = 0;
    const server = createServer((request, response) => {
      void (async () => {
        try {
          capturedBodies.push(await readRequestBody(request));
          credentialObservations.push({
            apiKeyMatches: request.headers["x-apikey"] === FixtureApiKey,
            authorizationMatches:
              request.headers.authorization ===
              (capturedBodies.length === 1
                ? FixtureInitialAuthorization
                : FixtureRefreshedAuthorization),
          });
          if (capturedBodies.length === 1) {
            response.writeHead(401);
            response.end();
            return;
          }
          respondJson(response, searchResponse);
        } catch {
          response.destroy();
        }
      })();
    });
    const baseUrl = await listen(server);

    try {
      const Live = makeLive(new URL(`${baseUrl}/graphql`), {
        onRefresh: () => {
          refreshCount += 1;
        },
        refreshedAuthorization: authorization(FixtureRefreshedAuthorization),
      });
      const request = Schema.decodeUnknownSync(SearchCatalogueInput)({
        count: 8,
        page: 3,
        query: "oats",
        sortBy: "relevance",
      });

      await Effect.runPromise(
        Effect.gen(function* retryProgram() {
          const catalogue = yield* TescoCatalogue;
          yield* catalogue.search(request);
        }).pipe(Effect.provide(Live))
      );

      expect(refreshCount).toBe(1);
      expect(capturedBodies).toHaveLength(2);
      const firstBody = Schema.decodeUnknownSync(CapturedGraphQlRequest)(
        JSON.parse(capturedBodies[0] ?? "")
      );
      const secondBody = Schema.decodeUnknownSync(CapturedGraphQlRequest)(
        JSON.parse(capturedBodies[1] ?? "")
      );
      expect(secondBody).toStrictEqual(firstBody);
      expect(firstBody).toStrictEqual({
        operationName: TescoSearchQuery.operation.operationName,
        query: TescoSearchQuery.operation.document,
        variables: {
          count: 8,
          page: 3,
          query: "oats",
          sortBy: "relevance",
        },
      });
      expect(credentialObservations).toStrictEqual([
        { apiKeyMatches: true, authorizationMatches: true },
        { apiKeyMatches: true, authorizationMatches: true },
      ]);
    } finally {
      await close(server);
    }
  });

  it("returns the second 401 without refreshing again", async () => {
    let requestCount = 0;
    let refreshCount = 0;
    const server = createServer((_request, response) => {
      requestCount += 1;
      response.writeHead(401);
      response.end();
    });
    const baseUrl = await listen(server);

    try {
      const Live = makeLive(new URL(`${baseUrl}/graphql`), {
        onRefresh: () => {
          refreshCount += 1;
        },
        refreshedAuthorization: authorization(FixtureRefreshedAuthorization),
      });

      const error = await Effect.runPromise(
        Effect.gen(function* retryProgram() {
          const catalogue = yield* TescoCatalogue;
          return yield* catalogue.search(searchRequest("milk"));
        }).pipe(Effect.provide(Live), Effect.flip)
      );

      expect(error).toMatchObject({
        _tag: "TescoCatalogueAuthenticationUnavailable",
        operation: "search",
      });
      expect(error).not.toHaveProperty("status");
      expect(requestCount).toBe(2);
      expect(refreshCount).toBe(1);
    } finally {
      await close(server);
    }
  });

  it("replaces upstream GraphQL error details with a fixed safe error", async () => {
    const providerDetail =
      "provider-internal-detail-that-must-never-cross-the-boundary";
    const server = createServer((_request, response) => {
      respondJson(response, { errors: [{ message: providerDetail }] });
    });
    const baseUrl = await listen(server);

    try {
      const Live = makeLive(new URL(`${baseUrl}/graphql`));

      const error = await Effect.runPromise(
        Effect.gen(function* errorProgram() {
          const catalogue = yield* TescoCatalogue;
          return yield* catalogue.search(searchRequest("milk"));
        }).pipe(Effect.flip, Effect.provide(Live))
      );

      expect(error).toMatchObject({
        _tag: "TescoCatalogueRequestRejected",
        operation: "search",
      });
      expect(error).not.toHaveProperty("cause");
      expect(error).not.toHaveProperty("status");
      if (JSON.stringify(error).includes(providerDetail)) {
        throw new Error("Adapter exposed provider GraphQL error detail");
      }
    } finally {
      await close(server);
    }
  });
});
