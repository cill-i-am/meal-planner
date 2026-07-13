import { Effect, Schema } from "effect";
import { HttpRouter } from "effect/unstable/http";

import { BadRequestError } from "../../../app/errors.js";
import {
  optionalParam,
  requiredParam,
  urlFromRequest,
} from "../../../app/http/query-params.js";
import { decodeBody, routeJson } from "../../../app/http/responses.js";
import {
  CategoryProductsRequest,
  FacetId,
  PageNumber,
  PageNumberFromString,
  RawGraphQlRequest,
  ResultCount,
  ResultCountFromString,
  SearchRequest,
  SearchQuery,
  SortBy,
  SuggestionRequest,
} from "./catalogue.model.js";
import { TescoCatalogue } from "./catalogue.port.js";

const CategoryPathParams = Schema.Struct({
  facet: FacetId,
});

const CategoryProductsBody = Schema.Struct({
  count: Schema.optionalKey(ResultCount),
  page: Schema.optionalKey(PageNumber),
  sortBy: Schema.optionalKey(SortBy),
});

const decodeRequest = <A, I, RD, RE>(
  schema: Schema.Codec<A, I, RD, RE>,
  name: string,
  value: unknown
): Effect.Effect<A, BadRequestError, RD> =>
  Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError(
      (cause) => new BadRequestError(`Invalid ${name}: ${String(cause)}`)
    )
  );

const searchFromUrl = (
  requestUrl: string
): Effect.Effect<SearchRequest, BadRequestError> =>
  Effect.gen(function* () {
    const url = urlFromRequest(requestUrl);
    const query = yield* requiredParam(url, "query", SearchQuery);
    const page = yield* optionalParam(url, "page", PageNumberFromString);
    const count = yield* optionalParam(url, "count", ResultCountFromString);
    const sortBy = yield* optionalParam(url, "sortBy", SortBy);

    return yield* decodeRequest(SearchRequest, "search query", {
      query,
      ...(page === undefined ? {} : { page }),
      ...(count === undefined ? {} : { count }),
      ...(sortBy === undefined ? {} : { sortBy }),
    });
  });

const suggestionsFromUrl = (
  requestUrl: string
): Effect.Effect<SuggestionRequest, BadRequestError> =>
  Effect.gen(function* () {
    const url = urlFromRequest(requestUrl);
    const query = yield* requiredParam(url, "query", SearchQuery);
    const limit = yield* optionalParam(url, "limit", ResultCountFromString);
    return yield* decodeRequest(SuggestionRequest, "suggestions query", {
      query,
      ...(limit === undefined ? {} : { limit }),
    });
  });

const categoryFromUrl = (
  requestUrl: string,
  facet: FacetId
): Effect.Effect<CategoryProductsRequest, BadRequestError> =>
  Effect.gen(function* () {
    const url = urlFromRequest(requestUrl);
    const page = yield* optionalParam(url, "page", PageNumberFromString);
    const count = yield* optionalParam(url, "count", ResultCountFromString);
    const sortBy = yield* optionalParam(url, "sortBy", SortBy);
    return yield* decodeRequest(CategoryProductsRequest, "category query", {
      facet,
      ...(page === undefined ? {} : { page }),
      ...(count === undefined ? {} : { count }),
      ...(sortBy === undefined ? {} : { sortBy }),
    });
  });

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
        const search = yield* searchFromUrl(request.url);
        return yield* tesco.search(search);
      })
    )
  ),
  HttpRouter.route(
    "POST",
    "/tesco/search",
    routeJson(
      Effect.gen(function* () {
        const tesco = yield* TescoCatalogue;
        const search = yield* decodeBody(SearchRequest, "search");
        return yield* tesco.search(search);
      })
    )
  ),
  HttpRouter.route("GET", "/tesco/categories/:facet/products", (request) =>
    routeJson(
      Effect.gen(function* () {
        const tesco = yield* TescoCatalogue;
        const { facet } = yield* getCategoryPathParams;
        const category = yield* categoryFromUrl(request.url, facet);
        return yield* tesco.categoryProducts(category);
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
          CategoryProductsBody,
          "category products"
        );
        const category = yield* decodeRequest(
          CategoryProductsRequest,
          "category products",
          {
            facet,
            ...(body.page === undefined ? {} : { page: body.page }),
            ...(body.count === undefined ? {} : { count: body.count }),
            ...(body.sortBy === undefined ? {} : { sortBy: body.sortBy }),
          }
        );
        return yield* tesco.categoryProducts(category);
      })
    )
  ),
  HttpRouter.route("GET", "/tesco/suggestions", (request) =>
    routeJson(
      Effect.gen(function* () {
        const tesco = yield* TescoCatalogue;
        const suggestions = yield* suggestionsFromUrl(request.url);
        return yield* tesco.suggestions(suggestions);
      })
    )
  ),
  HttpRouter.route(
    "POST",
    "/tesco/graphql",
    routeJson(
      Effect.gen(function* () {
        const tesco = yield* TescoCatalogue;
        const request = yield* decodeBody(RawGraphQlRequest, "GraphQL");
        return yield* tesco.graphQl(request);
      })
    )
  ),
] as const;
