import { Effect, Layer, Option, Redacted, Schema } from "effect";
import { HttpBody, HttpClient, HttpClientRequest } from "effect/unstable/http";

import type { ApiError } from "../../../app/errors.js";
import { TescoAuthSession } from "../auth/auth-session.port.js";
import type { TescoAuthorization } from "../auth/auth.model.js";
import type { TescoCatalogueConfig } from "../tesco.config.js";
import {
  TescoGraphQlError,
  TescoHttpError,
  TescoRequestBodyError,
} from "../tesco.errors.js";
import type {
  CatalogueSuggestionsInput,
  CategoryProductsInput,
  SearchCatalogueInput,
} from "./catalogue.model.js";
import { TescoCatalogue } from "./catalogue.port.js";
import {
  TescoCategoryProductsQuery,
  TescoGraphQlErrorResponse,
  TescoSearchQuery,
  TescoSuggestionsEndpoint,
} from "./xapi.protocol.js";
import type { RawGraphQlRequest } from "./xapi.protocol.js";

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
  config: TescoCatalogueConfig,
  authorization: TescoAuthorization
): Record<string, string> => {
  const headers: Record<string, string> = {
    accept: "application/json",
    "accept-language": config.locale,
    "apollographql-client-name": "meal-planner-api",
    "apollographql-client-version": "0.1.0",
    authorization: Redacted.value(authorization),
    "content-type": "application/json",
    language: config.locale,
    region: config.region,
    "x-apikey": Redacted.value(config.mangoApiKey),
  };

  if (config.transactionPurpose !== null) {
    headers["transaction-purpose"] = config.transactionPurpose;
  }
  if (config.releaseBranch !== null) {
    headers["release-branch"] = config.releaseBranch;
  }

  return headers;
};

export const makeTescoXapiCatalogueLive = (config: TescoCatalogueConfig) =>
  Layer.effect(
    TescoCatalogue,
    Effect.gen(function* () {
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
          const httpRequest = HttpClientRequest.post(config.mangoUrl, {
            body: requestBody,
            headers: mangoHeaders(config, authorization),
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
                new TescoHttpError(
                  "Tesco GraphQL returned unreadable JSON",
                  502
                )
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
                      yield* authSession.refreshAfterUnauthorized(
                        authorization
                      );
                    return yield* executeGraphQlOnce(
                      request,
                      refreshedAuthorization
                    );
                  })
                : Effect.fail(error)
            )
          );
        });

      const search = (request: SearchCatalogueInput) =>
        Effect.gen(function* () {
          const json = yield* graphQl(TescoSearchQuery.request(request));
          return yield* TescoSearchQuery.decode(json);
        });

      const categoryProducts = (request: CategoryProductsInput) =>
        Effect.gen(function* () {
          const json = yield* graphQl(
            TescoCategoryProductsQuery.request(request)
          );
          return yield* TescoCategoryProductsQuery.decode(json);
        });

      const suggestions = (request: CatalogueSuggestionsInput) =>
        Effect.gen(function* () {
          const url = new URL(config.suggestionUrl);
          const query = TescoSuggestionsEndpoint.request({
            input: request,
            locale: config.locale,
            region: config.region,
          });
          for (const [name, value] of Object.entries(query)) {
            url.searchParams.set(name, value);
          }

          const response = yield* client
            .get(url, {
              headers: {
                "accept-language": config.locale,
                teamnumber: "272",
              },
            })
            .pipe(
              Effect.mapError(
                () =>
                  new TescoHttpError("Tesco suggestions request failed", 502)
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
          return yield* TescoSuggestionsEndpoint.decode(json);
        });

      return TescoCatalogue.of({
        categoryProducts,
        graphQl,
        search,
        suggestions,
      });
    })
  );
