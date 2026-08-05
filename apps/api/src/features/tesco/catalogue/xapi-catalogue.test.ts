import { once } from "node:events";
import { createServer } from "node:http";
import type { Server } from "node:http";

import { NodeHttpClient } from "@effect/platform-node";
import { Effect, Layer, Redacted, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { TescoAuthSession } from "../auth/auth-session.port.js";
import { TescoAuthorizationValue } from "../auth/auth.model.js";
import { TescoApiKeyValue, TescoLocale, TescoRegion } from "../tesco.config.js";
import type { TescoCatalogueConfig } from "../tesco.config.js";
import {
  GraphQlDocument,
  GraphQlOperationName,
  RawGraphQlRequest,
} from "./catalogue.model.js";
import { TescoCatalogue } from "./catalogue.port.js";
import { makeTescoXapiCatalogueLive } from "./xapi-catalogue.js";

const FixtureApiKey = "fixture-api-key";
const FixtureInitialAuthorization = "Bearer fixture-initial";
const FixtureRefreshedAuthorization = "Bearer fixture-refreshed";

const authorization = (value: string) =>
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

const graphQlRequest = Schema.decodeUnknownSync(RawGraphQlRequest)({
  operationName: Schema.decodeUnknownSync(GraphQlOperationName)("Fixture"),
  query: Schema.decodeUnknownSync(GraphQlDocument)("query Fixture { ok }"),
  variables: {},
});

describe("makeTescoXapiCatalogueLive", () => {
  it("unwraps credentials only for the outbound Mango request", async () => {
    const initialAuthorization = authorization(FixtureInitialAuthorization);
    let sawAuthorization = false;
    let sawApiKey = false;

    const server = createServer((request, response) => {
      sawAuthorization =
        request.headers.authorization === FixtureInitialAuthorization;
      sawApiKey = request.headers["x-apikey"] === FixtureApiKey;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: { ok: true } }));
    });

    const baseUrl = await listen(server);
    try {
      const AuthSessionTest = Layer.succeed(
        TescoAuthSession,
        TescoAuthSession.of({
          authorization: Effect.succeed(initialAuthorization),
          refreshAfterUnauthorized: () =>
            Effect.die("refresh should not be called"),
        })
      );
      const Live = makeTescoXapiCatalogueLive(
        makeConfig(new URL(baseUrl))
      ).pipe(
        Layer.provide(
          Layer.mergeAll(AuthSessionTest, NodeHttpClient.layerUndici)
        )
      );

      await Effect.runPromise(
        Effect.gen(function* runCatalogueRequest() {
          const catalogue = yield* TescoCatalogue;
          yield* catalogue.graphQl(graphQlRequest);
        }).pipe(Effect.provide(Live))
      );

      expect(sawAuthorization).toBe(true);
      expect(sawApiKey).toBe(true);
    } finally {
      await close(server);
    }
  });

  it("refreshes once after 401 and retries with the refreshed authorization", async () => {
    const initialAuthorization = authorization(FixtureInitialAuthorization);
    const refreshedAuthorization = authorization(FixtureRefreshedAuthorization);
    const observations: {
      readonly apiKeyMatches: boolean;
      readonly authorizationMatches: boolean;
    }[] = [];
    let requestCount = 0;
    let refreshCount = 0;

    const server = createServer((request, response) => {
      requestCount += 1;
      observations.push({
        apiKeyMatches: request.headers["x-apikey"] === FixtureApiKey,
        authorizationMatches:
          request.headers.authorization ===
          (requestCount === 1
            ? FixtureInitialAuthorization
            : FixtureRefreshedAuthorization),
      });

      if (requestCount === 1) {
        response.writeHead(401);
        response.end();
        return;
      }

      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: { ok: true } }));
    });

    const baseUrl = await listen(server);
    try {
      const AuthSessionTest = Layer.succeed(
        TescoAuthSession,
        TescoAuthSession.of({
          authorization: Effect.succeed(initialAuthorization),
          refreshAfterUnauthorized: () => {
            refreshCount += 1;
            return Effect.succeed(refreshedAuthorization);
          },
        })
      );
      const Live = makeTescoXapiCatalogueLive(
        makeConfig(new URL(baseUrl))
      ).pipe(
        Layer.provide(
          Layer.mergeAll(AuthSessionTest, NodeHttpClient.layerUndici)
        )
      );

      await Effect.runPromise(
        Effect.gen(function* runCatalogueRequest() {
          const catalogue = yield* TescoCatalogue;
          yield* catalogue.graphQl(graphQlRequest);
        }).pipe(Effect.provide(Live))
      );

      expect(requestCount).toBe(2);
      expect(refreshCount).toBe(1);
      expect(observations).toEqual([
        { apiKeyMatches: true, authorizationMatches: true },
        { apiKeyMatches: true, authorizationMatches: true },
      ]);
    } finally {
      await close(server);
    }
  });

  it("returns the second 401 without refreshing again", async () => {
    const initialAuthorization = authorization(FixtureInitialAuthorization);
    const refreshedAuthorization = authorization(FixtureRefreshedAuthorization);
    let requestCount = 0;
    let refreshCount = 0;

    const server = createServer((_request, response) => {
      requestCount += 1;
      response.writeHead(401);
      response.end();
    });

    const baseUrl = await listen(server);
    try {
      const AuthSessionTest = Layer.succeed(
        TescoAuthSession,
        TescoAuthSession.of({
          authorization: Effect.succeed(initialAuthorization),
          refreshAfterUnauthorized: () => {
            refreshCount += 1;
            return Effect.succeed(refreshedAuthorization);
          },
        })
      );
      const Live = makeTescoXapiCatalogueLive(
        makeConfig(new URL(baseUrl))
      ).pipe(
        Layer.provide(
          Layer.mergeAll(AuthSessionTest, NodeHttpClient.layerUndici)
        )
      );

      const error = await Effect.runPromise(
        Effect.gen(function* runCatalogueRequest() {
          const catalogue = yield* TescoCatalogue;
          return yield* catalogue.graphQl(graphQlRequest);
        }).pipe(Effect.provide(Live), Effect.flip)
      );

      expect(error._tag).toBe("TescoHttpError");
      if (error._tag !== "TescoHttpError") {
        throw new Error("Expected TescoHttpError");
      }
      expect(error.status).toBe(401);
      expect(requestCount).toBe(2);
      expect(refreshCount).toBe(1);
    } finally {
      await close(server);
    }
  });
});
