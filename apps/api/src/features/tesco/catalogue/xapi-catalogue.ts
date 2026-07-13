import { Effect, Layer, Option, Schema } from "effect";
import { HttpBody, HttpClient, HttpClientRequest } from "effect/unstable/http";

import { AppConfig } from "../../../app/config.js";
import type { ApiError } from "../../../app/errors.js";
import { TescoAuthSession } from "../auth/auth-session.port.js";
import type { TescoAuthorization } from "../auth/auth.model.js";
import type { TescoConfig } from "../tesco.config.js";
import {
  TescoDecodeError,
  TescoGraphQlError,
  TescoHttpError,
  TescoRequestBodyError,
} from "../tesco.errors.js";
import {
  mapTescoListing,
  TescoCategoryGraphQlResponse,
  TescoGraphQlErrorResponse,
  TescoSearchGraphQlResponse,
  SuggestionsResponse as SuggestionsResponseSchema,
} from "./catalogue.model.js";
import type {
  CategoryProductsRequest,
  RawGraphQlRequest,
  SearchRequest,
  SuggestionRequest,
} from "./catalogue.model.js";
import { TescoCatalogue } from "./catalogue.port.js";
import {
  CategoryProductsOperationName,
  CategoryProductsDocument,
  SearchDocument,
  SearchOperationName,
} from "./graphql-documents.js";

const decodeUnknown = <A, I, RD, RE>(
  schema: Schema.Codec<A, I, RD, RE>,
  input: unknown,
  context: string
): Effect.Effect<A, TescoDecodeError, RD> =>
  Schema.decodeUnknownEffect(schema)(input).pipe(
    Effect.mapError(
      (cause) =>
        new TescoDecodeError(`Unexpected ${context} response shape`, cause)
    )
  );

const bodyJson = (body: unknown) =>
  HttpBody.json(body).pipe(
    Effect.mapError(
      (cause) =>
        new TescoRequestBodyError("Could not encode Tesco request body", cause)
    )
  );

const graphQlErrorMessage = (value: unknown): string | null =>
  Schema.decodeUnknownOption(TescoGraphQlErrorResponse)(value).pipe(
    Option.match({
      onNone: () => null,
      onSome: (response) => response.errors[0].message,
    })
  );

const mangoHeaders = (
  config: TescoConfig,
  authorization: TescoAuthorization
): Record<string, string> => {
  const headers: Record<string, string> = {
    accept: "application/json",
    "accept-language": config.locale,
    "apollographql-client-name": "meal-planner-api",
    "apollographql-client-version": "0.1.0",
    authorization,
    "content-type": "application/json",
    language: config.locale,
    region: config.region,
    "x-apikey": config.mangoApiKey,
  };

  if (config.transactionPurpose !== null) {
    headers["transaction-purpose"] = config.transactionPurpose;
  }
  if (config.releaseBranch !== null) {
    headers["release-branch"] = config.releaseBranch;
  }

  return headers;
};

const searchVariables = (request: SearchRequest): Record<string, unknown> => ({
  count: request.count,
  page: request.page,
  query: request.query,
  sortBy: request.sortBy,
});

const categoryVariables = (
  request: CategoryProductsRequest
): Record<string, unknown> => ({
  count: request.count,
  facet: request.facet,
  page: request.page,
  sortBy: request.sortBy,
});

export const TescoXapiCatalogueLive = Layer.effect(
  TescoCatalogue,
  Effect.gen(function* () {
    const config = yield* AppConfig;
    const authSession = yield* TescoAuthSession;
    const client = yield* HttpClient.HttpClient;

    const executeGraphQlOnce = (
      request: RawGraphQlRequest,
      authorization: TescoAuthorization
    ): Effect.Effect<Schema.Json, ApiError> =>
      Effect.gen(function* () {
        const requestBody = yield* bodyJson({
          operationName: request.operationName,
          query: request.query,
          variables: request.variables,
        });
        const httpRequest = HttpClientRequest.post(config.tesco.mangoUrl, {
          body: requestBody,
          headers: mangoHeaders(config.tesco, authorization),
        });
        const response = yield* client
          .execute(httpRequest)
          .pipe(
            Effect.mapError(
              () => new TescoHttpError("Tesco GraphQL request failed", 502)
            )
          );

        if (response.status < 200 || response.status >= 300) {
          return yield* Effect.fail(
            new TescoHttpError(
              "Tesco GraphQL returned a non-success status",
              response.status
            )
          );
        }

        const json = yield* response.json.pipe(
          Effect.mapError(
            () =>
              new TescoHttpError("Tesco GraphQL returned unreadable JSON", 502)
          )
        );
        const graphQlError = graphQlErrorMessage(json);
        if (graphQlError !== null) {
          return yield* Effect.fail(new TescoGraphQlError(graphQlError));
        }
        return json;
      });

    const graphQl = (
      request: RawGraphQlRequest
    ): Effect.Effect<Schema.Json, ApiError> =>
      Effect.gen(function* () {
        const authorization = yield* authSession.authorization;
        return yield* executeGraphQlOnce(request, authorization).pipe(
          Effect.catchTag("TescoHttpError", (error) =>
            error.status === 401
              ? Effect.gen(function* () {
                  const refreshedAuthorization =
                    yield* authSession.refreshAfterUnauthorized(authorization);
                  return yield* executeGraphQlOnce(
                    request,
                    refreshedAuthorization
                  );
                })
              : Effect.fail(error)
          )
        );
      });

    const search = (request: SearchRequest) =>
      Effect.gen(function* () {
        const json = yield* graphQl({
          operationName: SearchOperationName,
          query: SearchDocument,
          variables: searchVariables(request),
        });
        const decoded = yield* decodeUnknown(
          TescoSearchGraphQlResponse,
          json,
          "Tesco search"
        );
        return mapTescoListing(decoded.data.search);
      });

    const categoryProducts = (request: CategoryProductsRequest) =>
      Effect.gen(function* () {
        const json = yield* graphQl({
          operationName: CategoryProductsOperationName,
          query: CategoryProductsDocument,
          variables: categoryVariables(request),
        });
        const decoded = yield* decodeUnknown(
          TescoCategoryGraphQlResponse,
          json,
          "Tesco category"
        );
        return mapTescoListing(decoded.data.category);
      });

    const suggestions = (request: SuggestionRequest) =>
      Effect.gen(function* () {
        const url = new URL(config.tesco.suggestionUrl);
        url.searchParams.set("distchannel", "ghs");
        url.searchParams.set("limit", String(request.limit));
        url.searchParams.set("query", request.query);
        url.searchParams.set("geo", config.tesco.region.toLowerCase());
        url.searchParams.set("lang", config.tesco.locale.slice(0, 2));

        const response = yield* client
          .get(url, {
            headers: {
              "accept-language": config.tesco.locale,
              teamnumber: "272",
            },
          })
          .pipe(
            Effect.mapError(
              () => new TescoHttpError("Tesco suggestions request failed", 502)
            )
          );

        if (response.status < 200 || response.status >= 300) {
          return yield* Effect.fail(
            new TescoHttpError(
              "Tesco suggestions returned a non-success status",
              response.status
            )
          );
        }

        const json = yield* response.json.pipe(
          Effect.mapError(
            () =>
              new TescoHttpError(
                "Tesco suggestions returned unreadable JSON",
                502
              )
          )
        );
        return yield* decodeUnknown(
          SuggestionsResponseSchema,
          json,
          "Tesco suggestions"
        );
      });

    return TescoCatalogue.of({
      categoryProducts,
      graphQl,
      search,
      suggestions,
    });
  })
);
