import { Effect, Schema, SchemaGetter } from "effect";

import { InvalidRequest } from "../../../app/http/http-failure.js";
import type { RequestLocation } from "../../../app/http/http-failure.js";
import {
  optionalParam,
  requiredParam,
  urlFromRequest,
} from "../../../app/http/query-params.js";
import {
  FacetId,
  PageNumber,
  ResultCount,
  SearchQuery,
  SortBy,
} from "./catalogue.model.js";
import type {
  CatalogueProductResults,
  CatalogueSuggestions,
  CatalogueSuggestionsInput,
  CategoryProductsInput,
  SearchCatalogueInput,
} from "./catalogue.model.js";

const PageNumberFromString = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[1-9]\d*$/u)),
  Schema.decodeTo(PageNumber, {
    decode: SchemaGetter.transform(Number),
    encode: SchemaGetter.transform(String),
  })
);

const ResultCountFromString = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[1-9]\d*$/u)),
  Schema.decodeTo(ResultCount, {
    decode: SchemaGetter.transform(Number),
    encode: SchemaGetter.transform(String),
  })
);

const DefaultPageNumber = Schema.decodeUnknownSync(PageNumber)(1);
const DefaultResultCount = Schema.decodeUnknownSync(ResultCount)(24);
const DefaultSuggestionLimit = Schema.decodeUnknownSync(ResultCount)(10);
const DefaultSortBy = Schema.decodeUnknownSync(SortBy)("relevance");

const PageNumberWithDefault = PageNumber.pipe(
  Schema.withDecodingDefaultTypeKey(Effect.succeed(DefaultPageNumber))
);

const ResultCountWithDefault = ResultCount.pipe(
  Schema.withDecodingDefaultTypeKey(Effect.succeed(DefaultResultCount))
);

const SuggestionLimitWithDefault = ResultCount.pipe(
  Schema.withDecodingDefaultTypeKey(Effect.succeed(DefaultSuggestionLimit))
);

const SortByWithDefault = SortBy.pipe(
  Schema.withDecodingDefaultTypeKey(Effect.succeed(DefaultSortBy))
);

/** Public POST body accepted by the catalogue search route. */
export const SearchRequestBody = Schema.Struct({
  count: ResultCountWithDefault,
  page: PageNumberWithDefault,
  query: SearchQuery,
  sortBy: SortByWithDefault,
});

/** Public path parameters accepted by catalogue category routes. */
export const CategoryPathParams = Schema.Struct({ facet: FacetId });

/** Public POST body accepted by the category products route. */
export const CategoryProductsRequestBody = Schema.Struct({
  count: ResultCountWithDefault,
  page: PageNumberWithDefault,
  sortBy: SortByWithDefault,
});

const decodeRequest = <A, I, RD, RE>(
  schema: Schema.Codec<A, I, RD, RE>,
  location: RequestLocation,
  value: unknown
): Effect.Effect<A, InvalidRequest, RD> =>
  Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError(() => new InvalidRequest({ location }))
  );

/** Decode one search URL into a fully populated stable catalogue input. */
export const searchInputFromUrl = (
  requestUrl: string
): Effect.Effect<SearchCatalogueInput, InvalidRequest> =>
  Effect.gen(function* decodeSearchUrl() {
    const url = urlFromRequest(requestUrl);
    const query = yield* requiredParam(url, "query", SearchQuery);
    const page = yield* optionalParam(url, "page", PageNumberFromString);
    const count = yield* optionalParam(url, "count", ResultCountFromString);
    const sortBy = yield* optionalParam(url, "sortBy", SortBy);

    return yield* decodeRequest(SearchRequestBody, "query", {
      query,
      ...(page === undefined ? {} : { page }),
      ...(count === undefined ? {} : { count }),
      ...(sortBy === undefined ? {} : { sortBy }),
    });
  });

/** Decode one category URL into a fully populated stable catalogue input. */
export const categoryInputFromUrl = (
  requestUrl: string,
  facet: FacetId
): Effect.Effect<CategoryProductsInput, InvalidRequest> =>
  Effect.gen(function* decodeCategoryUrl() {
    const url = urlFromRequest(requestUrl);
    const page = yield* optionalParam(url, "page", PageNumberFromString);
    const count = yield* optionalParam(url, "count", ResultCountFromString);
    const sortBy = yield* optionalParam(url, "sortBy", SortBy);
    const body = yield* decodeRequest(CategoryProductsRequestBody, "query", {
      ...(page === undefined ? {} : { page }),
      ...(count === undefined ? {} : { count }),
      ...(sortBy === undefined ? {} : { sortBy }),
    });
    return { facet, ...body };
  });

/** Add a decoded category path value to its decoded HTTP request body. */
export const categoryInputFromBody = (
  facet: FacetId,
  body: typeof CategoryProductsRequestBody.Type
): CategoryProductsInput => ({ facet, ...body });

/** Decode one suggestions URL into a fully populated stable catalogue input. */
export const suggestionsInputFromUrl = (
  requestUrl: string
): Effect.Effect<CatalogueSuggestionsInput, InvalidRequest> =>
  Effect.gen(function* decodeSuggestionsUrl() {
    const url = urlFromRequest(requestUrl);
    const query = yield* requiredParam(url, "query", SearchQuery);
    const limit = yield* optionalParam(url, "limit", ResultCountFromString);

    return yield* decodeRequest(
      Schema.Struct({ limit: SuggestionLimitWithDefault, query: SearchQuery }),
      "query",
      {
        query,
        ...(limit === undefined ? {} : { limit }),
      }
    );
  });

/** Explicit HTTP projection for one stable catalogue listing. */
export const toCatalogueProductResultsResponse = (
  result: CatalogueProductResults
) => ({
  pageInformation: result.pageInformation,
  results: result.results.map((product) => ({
    id: product.id,
    title: product.title,
    type: product.type,
    ...(product.defaultImageUrl === undefined
      ? {}
      : { defaultImageUrl: product.defaultImageUrl }),
  })),
  ...(result.sortBy === undefined ? {} : { sortBy: result.sortBy }),
});

/** Explicit HTTP projection for stable catalogue suggestions. */
export const toCatalogueSuggestionsResponse = (
  suggestions: CatalogueSuggestions
) => ({
  results: suggestions.results.map(({ query }) => ({ query })),
});
