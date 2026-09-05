import { Effect } from "effect";
import { HttpRouter } from "effect/unstable/http";

import {
  InvalidRequest,
  UpstreamAuthenticationUnavailable,
  UpstreamInvalidResponse,
  UpstreamRequestRejected,
  UpstreamUnavailable,
} from "../../../app/http/http-failure.js";
import type { HttpFailure } from "../../../app/http/http-failure.js";
import { decodeBody, routeJson } from "../../../app/http/responses.js";
import type { TescoCatalogueError } from "./catalogue.errors.js";
import {
  CategoryPathParams,
  CategoryProductsRequestBody,
  SearchRequestBody,
  categoryInputFromUrl,
  searchInputFromUrl,
  suggestionsInputFromUrl,
  toCatalogueProductResultsResponse,
  toCatalogueSuggestionsResponse,
} from "./catalogue.http.js";
import { TescoCatalogue } from "./catalogue.port.js";

const getCategoryPathParams = HttpRouter.schemaPathParams(
  CategoryPathParams
).pipe(Effect.mapError(() => new InvalidRequest({ location: "path" })));

const toHttpFailure = (error: TescoCatalogueError): HttpFailure => {
  switch (error._tag) {
    case "TescoCatalogueAuthenticationUnavailable": {
      return new UpstreamAuthenticationUnavailable({ upstream: "tesco" });
    }
    case "TescoCatalogueUnavailable": {
      return new UpstreamUnavailable({ upstream: "tesco" });
    }
    case "TescoCatalogueRequestRejected": {
      return new UpstreamRequestRejected({ upstream: "tesco" });
    }
    case "TescoCatalogueResponseInvalid": {
      return new UpstreamInvalidResponse({ upstream: "tesco" });
    }
    default: {
      return error satisfies never;
    }
  }
};

export const TescoCatalogueRoutes = [
  HttpRouter.route("GET", "/tesco/search", (request) =>
    routeJson(
      Effect.gen(function* () {
        const tesco = yield* TescoCatalogue;
        const search = yield* searchInputFromUrl(request.url);
        return toCatalogueProductResultsResponse(
          yield* tesco.search(search).pipe(Effect.mapError(toHttpFailure))
        );
      })
    )
  ),
  HttpRouter.route(
    "POST",
    "/tesco/search",
    routeJson(
      Effect.gen(function* () {
        const tesco = yield* TescoCatalogue;
        const search = yield* decodeBody(SearchRequestBody);
        return toCatalogueProductResultsResponse(
          yield* tesco.search(search).pipe(Effect.mapError(toHttpFailure))
        );
      })
    )
  ),
  HttpRouter.route("GET", "/tesco/categories/:facet/products", (request) =>
    routeJson(
      Effect.gen(function* () {
        const tesco = yield* TescoCatalogue;
        const { facet } = yield* getCategoryPathParams;
        const category = yield* categoryInputFromUrl(request.url, facet);
        return toCatalogueProductResultsResponse(
          yield* tesco
            .categoryProducts(category)
            .pipe(Effect.mapError(toHttpFailure))
        );
      })
    )
  ),
  HttpRouter.route(
    "POST",
    "/tesco/categories/:facet/products",
    routeJson(
      Effect.gen(function* () {
        const tesco = yield* TescoCatalogue;
        const { facet } = yield* getCategoryPathParams;
        const body = yield* decodeBody(CategoryProductsRequestBody);
        return toCatalogueProductResultsResponse(
          yield* tesco
            .categoryProducts({ facet, ...body })
            .pipe(Effect.mapError(toHttpFailure))
        );
      })
    )
  ),
  HttpRouter.route("GET", "/tesco/suggestions", (request) =>
    routeJson(
      Effect.gen(function* () {
        const tesco = yield* TescoCatalogue;
        const suggestions = yield* suggestionsInputFromUrl(request.url);
        return toCatalogueSuggestionsResponse(
          yield* tesco
            .suggestions(suggestions)
            .pipe(Effect.mapError(toHttpFailure))
        );
      })
    )
  ),
] as const;
