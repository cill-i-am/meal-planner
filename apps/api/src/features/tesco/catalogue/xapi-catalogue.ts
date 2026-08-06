import { Effect, Layer } from "effect";
import { HttpClient } from "effect/unstable/http";

import type { TescoCatalogueConfig } from "../tesco.config.js";
import { TescoAuthenticatedGraphQlTransport } from "./authenticated-graphql-transport.port.js";
import type { TescoAuthenticatedGraphQlTransportError } from "./authenticated-graphql-transport.port.js";
import {
  TescoCatalogueAuthenticationUnavailable,
  TescoCatalogueRequestRejected,
  TescoCatalogueResponseInvalid,
  TescoCatalogueUnavailable,
} from "./catalogue.errors.js";
import type { TescoCatalogueOperation } from "./catalogue.errors.js";
import type {
  CatalogueSuggestionsInput,
  CategoryProductsInput,
  SearchCatalogueInput,
} from "./catalogue.model.js";
import { TescoCatalogue } from "./catalogue.port.js";
import {
  TescoCategoryProductsQuery,
  TescoSearchQuery,
  TescoSuggestionsEndpoint,
} from "./xapi.protocol.js";

const isUnavailableStatus = (status: number): boolean =>
  status === 429 || status >= 500;

const mapTransportError = (
  error: TescoAuthenticatedGraphQlTransportError,
  operation: TescoCatalogueOperation
) => {
  switch (error._tag) {
    case "TescoCredentialsRejected":
    case "TescoSoftLoginUnavailable":
    case "TescoSoftLoginResponseInvalid":
    case "TescoRefreshTokenExpired":
    case "TescoAccessTokenNotRenewed": {
      return new TescoCatalogueAuthenticationUnavailable({ operation });
    }
    case "TescoAuthenticatedRequestUnavailable": {
      return new TescoCatalogueUnavailable({ operation });
    }
    case "TescoAuthenticatedRequestRejected": {
      return new TescoCatalogueRequestRejected({ operation });
    }
    case "TescoAuthenticatedResponseInvalid": {
      return new TescoCatalogueResponseInvalid({ operation });
    }
    default: {
      return error satisfies never;
    }
  }
};

const mapSearchTransportError = (
  error: TescoAuthenticatedGraphQlTransportError
) => mapTransportError(error, "search");

const mapCategoryTransportError = (
  error: TescoAuthenticatedGraphQlTransportError
) => mapTransportError(error, "category_products");

/** Stable Tesco catalogue adapter over named reads and isolated provider DTOs. */
export const makeTescoXapiCatalogueLive = (config: TescoCatalogueConfig) =>
  Layer.effect(
    TescoCatalogue,
    Effect.gen(function* makeTescoXapiCatalogue() {
      const transport = yield* TescoAuthenticatedGraphQlTransport;
      const client = yield* HttpClient.HttpClient;

      const search = (request: SearchCatalogueInput) =>
        transport
          .execute({
            operation: "search",
            read: TescoSearchQuery.operation,
            variables: TescoSearchQuery.variables(request),
          })
          .pipe(
            Effect.mapError(mapSearchTransportError),
            Effect.flatMap(TescoSearchQuery.decode)
          );

      const categoryProducts = (request: CategoryProductsInput) =>
        transport
          .execute({
            operation: "category_products",
            read: TescoCategoryProductsQuery.operation,
            variables: TescoCategoryProductsQuery.variables(request),
          })
          .pipe(
            Effect.mapError(mapCategoryTransportError),
            Effect.flatMap(TescoCategoryProductsQuery.decode)
          );

      const suggestions = (request: CatalogueSuggestionsInput) =>
        Effect.gen(function* executeSuggestions() {
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
                  new TescoCatalogueUnavailable({ operation: "suggestions" })
              )
            );

          if (isUnavailableStatus(response.status)) {
            return yield* new TescoCatalogueUnavailable({
              operation: "suggestions",
            });
          }
          if (response.status < 200 || response.status >= 300) {
            return yield* new TescoCatalogueRequestRejected({
              operation: "suggestions",
            });
          }

          const json = yield* response.json.pipe(
            Effect.mapError(
              () =>
                new TescoCatalogueResponseInvalid({
                  operation: "suggestions",
                })
            )
          );
          return yield* TescoSuggestionsEndpoint.decode(json);
        });

      return TescoCatalogue.of({ categoryProducts, search, suggestions });
    })
  );
