import { Effect } from "effect";
import { HttpRouter } from "effect/unstable/http";

import { BadRequestError } from "../../../app/errors.js";
import { decodeBody, routeJson } from "../../../app/http/responses.js";
import {
  CategoryPathParams,
  CategoryProductsRequestBody,
  SearchRequestBody,
  categoryInputFromBody,
  categoryInputFromUrl,
  searchInputFromUrl,
  suggestionsInputFromUrl,
  toCatalogueProductResultsResponse,
  toCatalogueSuggestionsResponse,
} from "./catalogue.http.js";
import { TescoCatalogue } from "./catalogue.port.js";

const getCategoryPathParams = HttpRouter.schemaPathParams(
  CategoryPathParams
).pipe(
  Effect.mapError(
    (cause) => new BadRequestError(`Invalid category path: ${String(cause)}`)
  )
);

export const TescoCatalogueRoutes = [
  HttpRouter.route("GET", "/tesco/search", (request) =>
    routeJson(
      Effect.gen(function* () {
        const tesco = yield* TescoCatalogue;
        const search = yield* searchInputFromUrl(request.url);
        return toCatalogueProductResultsResponse(yield* tesco.search(search));
      })
    )
  ),
  HttpRouter.route(
    "POST",
    "/tesco/search",
    routeJson(
      Effect.gen(function* () {
        const tesco = yield* TescoCatalogue;
        const search = yield* decodeBody(SearchRequestBody, "search");
        return toCatalogueProductResultsResponse(yield* tesco.search(search));
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
          yield* tesco.categoryProducts(category)
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
        const body = yield* decodeBody(
          CategoryProductsRequestBody,
          "category products"
        );
        const category = categoryInputFromBody(facet, body);
        return toCatalogueProductResultsResponse(
          yield* tesco.categoryProducts(category)
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
          yield* tesco.suggestions(suggestions)
        );
      })
    )
  ),
] as const;
