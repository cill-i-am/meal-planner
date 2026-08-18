import { Cause, Effect, Exit, Layer, Option, Redacted, Schema } from "effect";
import {
  HttpClient,
  HttpClientError,
  HttpClientResponse,
} from "effect/unstable/http";
import type { HttpClientRequest } from "effect/unstable/http";
import { describe, expect, it } from "vitest";

import { TescoAuthSession } from "../auth/auth-session.port.js";
import { TescoAuthorizationValue } from "../auth/auth.model.js";
import { TescoApiKeyValue, TescoLocale, TescoRegion } from "../tesco.config.js";
import type { TescoCatalogueConfig } from "../tesco.config.js";
import { makeTescoAuthenticatedGraphQlTransportLive } from "./authenticated-graphql-transport.js";
import { TescoAuthenticatedGraphQlTransport } from "./authenticated-graphql-transport.port.js";
import { defineReadOnlyGraphQlOperation } from "./graphql-read-operation.js";

const initialAuthorization = Redacted.make(
  Schema.decodeUnknownSync(TescoAuthorizationValue)("Bearer initial-token")
);
const refreshedAuthorization = Redacted.make(
  Schema.decodeUnknownSync(TescoAuthorizationValue)("Bearer refreshed-token")
);

const searchRead = defineReadOnlyGraphQlOperation({
  document: "query Search { search { results { node { id } } } }",
  operationName: "Search",
});

const catalogueConfig: TescoCatalogueConfig = {
  locale: Schema.decodeUnknownSync(TescoLocale)("en-IE"),
  mangoApiKey: Redacted.make(
    Schema.decodeUnknownSync(TescoApiKeyValue)("test-api-key-secret")
  ),
  mangoUrl: new URL("https://xapi.tesco.com/"),
  region: Schema.decodeUnknownSync(TescoRegion)("IE"),
  releaseBranch: null,
  suggestionUrl: new URL("https://search.api.tesco.com/search/suggestion/"),
  transactionPurpose: null,
};

interface StubResponse {
  readonly body?: Schema.Json;
  readonly kind?: "interrupt" | "response" | "transportFailure";
  readonly rawBody?: string;
  readonly status: number;
}

const makeHttpClient = (
  responses: readonly StubResponse[],
  requests: HttpClientRequest.HttpClientRequest[]
) => {
  let responseIndex = 0;
  return HttpClient.make((request) =>
    Effect.suspend(() => {
      requests.push(request);
      const response = responses[responseIndex];
      responseIndex += 1;
      if (response === undefined) {
        return Effect.die("Unexpected Tesco HTTP request in test");
      }
      if (response.kind === "interrupt") {
        return Effect.interrupt;
      }
      if (response.kind === "transportFailure") {
        return Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({ request }),
          })
        );
      }
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response(response.rawBody ?? JSON.stringify(response.body), {
            status: response.status,
          })
        )
      );
    })
  );
};

const runTransport = (responses: readonly StubResponse[]) => {
  const requests: HttpClientRequest.HttpClientRequest[] = [];
  let refreshCount = 0;
  const AuthLive = Layer.succeed(
    TescoAuthSession,
    TescoAuthSession.of({
      authorization: Effect.succeed(initialAuthorization),
      refreshAfterUnauthorized: () => {
        refreshCount += 1;
        return Effect.succeed(refreshedAuthorization);
      },
    })
  );
  const HttpLive = Layer.succeed(
    HttpClient.HttpClient,
    makeHttpClient(responses, requests)
  );
  const Live = makeTescoAuthenticatedGraphQlTransportLive(catalogueConfig).pipe(
    Layer.provide(Layer.mergeAll(AuthLive, HttpLive))
  );

  const effect = Effect.gen(function* executeTransport() {
    const transport = yield* TescoAuthenticatedGraphQlTransport;
    return yield* transport.execute({
      operation: "search",
      read: searchRead,
      variables: {},
    });
  }).pipe(Effect.provide(Live));

  return { effect, getRefreshCount: () => refreshCount, requests };
};

describe("TescoAuthenticatedGraphQlTransportLive", () => {
  it("refreshes and replays a classified read exactly once after its first 401", async () => {
    const run = runTransport([
      { body: { error: "unauthorized" }, status: 401 },
      { body: { data: { search: {} } }, status: 200 },
    ]);

    await expect(Effect.runPromise(run.effect)).resolves.toStrictEqual({
      data: { search: {} },
    });
    expect(run.getRefreshCount()).toBe(1);
    expect(run.requests).toHaveLength(2);
    expect(
      run.requests.map((request) => request.headers["authorization"])
    ).toStrictEqual(["Bearer initial-token", "Bearer refreshed-token"]);
    expect(run.requests[0]?.headers["x-apikey"]).toBe("test-api-key-secret");
    expect(
      JSON.stringify({ catalogueConfig, initialAuthorization })
    ).not.toContain("test-api-key-secret");
    expect(
      JSON.stringify({ catalogueConfig, initialAuthorization })
    ).not.toContain("initial-token");
  });

  it("stops after one replay when Tesco returns a second 401", async () => {
    const run = runTransport([
      { body: { error: "unauthorized" }, status: 401 },
      { body: { error: "still unauthorized" }, status: 401 },
    ]);

    await expect(Effect.runPromise(run.effect)).rejects.toMatchObject({
      _tag: "TescoCredentialsRejected",
    });
    expect(run.getRefreshCount()).toBe(1);
    expect(run.requests).toHaveLength(2);
  });

  it("rejects a GraphQL error envelope without exporting its provider message", async () => {
    const providerMessage = "provider-secret-do-not-export";
    const run = runTransport([
      {
        body: { errors: [{ message: providerMessage }] },
        status: 200,
      },
    ]);

    const exit = await Effect.runPromiseExit(run.effect);
    if (Exit.isSuccess(exit)) {
      throw new Error("Expected Tesco GraphQL errors to be rejected");
    }
    const failure = Option.getOrThrow(Cause.findErrorOption(exit.cause));
    expect(failure).toMatchObject({
      _tag: "TescoAuthenticatedRequestRejected",
      operation: "search",
    });
    expect(JSON.stringify(failure)).not.toContain(providerMessage);
    expect(failure).not.toHaveProperty("cause");
    expect(failure).not.toHaveProperty("status");
  });

  it("classifies rate limits and server statuses as unavailable", async () => {
    await Promise.all(
      [429, 503].map(async (status) => {
        const run = runTransport([{ body: {}, status }]);
        await expect(Effect.runPromise(run.effect)).rejects.toMatchObject({
          _tag: "TescoAuthenticatedRequestUnavailable",
          operation: "search",
        });
      })
    );
  });

  it("classifies other non-success statuses as rejected", async () => {
    const run = runTransport([{ body: {}, status: 403 }]);

    await expect(Effect.runPromise(run.effect)).rejects.toMatchObject({
      _tag: "TescoAuthenticatedRequestRejected",
      operation: "search",
    });
  });

  it("classifies unreadable JSON as an invalid response", async () => {
    const run = runTransport([{ rawBody: "not json", status: 200 }]);

    await expect(Effect.runPromise(run.effect)).rejects.toMatchObject({
      _tag: "TescoAuthenticatedResponseInvalid",
      operation: "search",
    });
  });

  it("classifies an HTTP transport failure as unavailable", async () => {
    const run = runTransport([{ kind: "transportFailure", status: 0 }]);

    await expect(Effect.runPromise(run.effect)).rejects.toMatchObject({
      _tag: "TescoAuthenticatedRequestUnavailable",
      operation: "search",
    });
  });

  it("preserves interruption instead of converting it to an expected failure", async () => {
    const run = runTransport([{ kind: "interrupt", status: 0 }]);

    const exit = await Effect.runPromiseExit(run.effect);
    expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true);
  });
});
