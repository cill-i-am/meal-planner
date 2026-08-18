import { Effect, Schema } from "effect";

import { TescoCatalogueResponseInvalid } from "./catalogue.errors.js";
import {
  ImageUrl,
  PageInformation,
  ProductId,
  ProductTitle,
  ProductTypeName,
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
import { defineReadOnlyGraphQlOperation } from "./graphql-read-operation.js";
import type { ReadOnlyGraphQlOperation } from "./graphql-read-operation.js";

type GraphQlVariables = Readonly<Record<string, Schema.Json>>;

/** Provider error envelope decoded by the shared Tesco GraphQL executor. */
export const TescoGraphQlErrorResponse = Schema.Struct({
  errors: Schema.NonEmptyArray(Schema.Unknown),
});

const TescoProductNodeDto = Schema.Struct({
  __typename: ProductTypeName,
  defaultImageUrl: Schema.optionalKey(Schema.NullishOr(ImageUrl)),
  id: ProductId,
  title: ProductTitle,
});

const TescoListingDto = Schema.Struct({
  options: Schema.optionalKey(
    Schema.Struct({ sortBy: Schema.optionalKey(SortBy) })
  ),
  pageInformation: PageInformation,
  results: Schema.Array(Schema.Struct({ node: TescoProductNodeDto })),
});

const TescoSearchGraphQlResponseDto = Schema.Struct({
  data: Schema.Struct({ search: TescoListingDto }),
  status: Schema.optionalKey(Schema.Number),
});

const TescoCategoryGraphQlResponseDto = Schema.Struct({
  data: Schema.Struct({ category: TescoListingDto }),
  status: Schema.optionalKey(Schema.Number),
});

const TescoSuggestionsResponseDto = Schema.Struct({
  results: Schema.Array(Schema.Struct({ query: SearchQuery })),
});

// GraphQL
const SearchReadOperation = defineReadOnlyGraphQlOperation({
  document: `
    query Search($query: String!, $page: Int!, $count: Int!, $sortBy: String!) {
    search(query: $query, page: $page, count: $count, sortBy: $sortBy) {
      pageInformation: info {
        total
        count
        pageNo: page
        pageSize
        matchType
        query {
          searchTerm
          actualTerm
          queryPhase
        }
      }
      results {
        node {
          __typename
          ... on ProductType {
            id
            title
            defaultImageUrl
          }
          ... on MPProduct {
            id
            title
            defaultImageUrl
          }
          ... on FNFProduct {
            id
            title
            defaultImageUrl
          }
        }
      }
      options {
        sortBy
      }
    }
  }
  `,
  operationName: "Search",
});

// GraphQL
const CategoryProductsReadOperation = defineReadOnlyGraphQlOperation({
  document: `
    query GetCategoryProducts(
      $facet: ID!
      $page: Int!
      $count: Int!
      $sortBy: String!
    ) {
    category(page: $page, count: $count, sortBy: $sortBy, facet: $facet) {
      pageInformation: info {
        total
        count
        pageNo: page
        pageSize
        matchType
        query {
          searchTerm
          actualTerm
          queryPhase
        }
      }
      results {
        node {
          __typename
          ... on ProductType {
            id
            title
            defaultImageUrl
          }
          ... on MPProduct {
            id
            title
            defaultImageUrl
          }
          ... on FNFProduct {
            id
            title
            defaultImageUrl
          }
        }
      }
      options {
        sortBy
      }
    }
  }
  `,
  operationName: "GetCategoryProducts",
});

/** One named read-only Tesco GraphQL query and its stable projection. */
interface TescoGraphQlQuery<Input, Output> {
  readonly decode: (
    input: Schema.Json
  ) => Effect.Effect<Output, TescoCatalogueResponseInvalid>;
  readonly operation: ReadOnlyGraphQlOperation;
  readonly variables: (input: Input) => GraphQlVariables;
}

const projectTescoListing = (
  listing: typeof TescoListingDto.Type
): CatalogueProductResults => {
  const results = listing.results.map(({ node }) => {
    const projected = {
      id: node.id,
      title: node.title,
      type: node.__typename,
    };
    return node.defaultImageUrl === null || node.defaultImageUrl === undefined
      ? projected
      : { ...projected, defaultImageUrl: node.defaultImageUrl };
  });
  const projected: CatalogueProductResults = {
    pageInformation: listing.pageInformation,
    results,
  };
  return listing.options?.sortBy === undefined
    ? projected
    : { ...projected, sortBy: listing.options.sortBy };
};

/** Named Tesco search document paired with its response codec and projection. */
export const TescoSearchQuery: TescoGraphQlQuery<
  SearchCatalogueInput,
  CatalogueProductResults
> = {
  decode: (input) =>
    Schema.decodeUnknownEffect(TescoSearchGraphQlResponseDto)(input).pipe(
      Effect.mapError(
        () => new TescoCatalogueResponseInvalid({ operation: "search" })
      ),
      Effect.map(({ data }) => projectTescoListing(data.search))
    ),
  operation: SearchReadOperation,
  variables: (input) => ({
    count: input.count,
    page: input.page,
    query: input.query,
    sortBy: input.sortBy,
  }),
};

/** Named Tesco category document paired with its response codec and projection. */
export const TescoCategoryProductsQuery: TescoGraphQlQuery<
  CategoryProductsInput,
  CatalogueProductResults
> = {
  decode: (input) =>
    Schema.decodeUnknownEffect(TescoCategoryGraphQlResponseDto)(input).pipe(
      Effect.mapError(
        () =>
          new TescoCatalogueResponseInvalid({
            operation: "category_products",
          })
      ),
      Effect.map(({ data }) => projectTescoListing(data.category))
    ),
  operation: CategoryProductsReadOperation,
  variables: (input) => ({
    count: input.count,
    facet: input.facet,
    page: input.page,
    sortBy: input.sortBy,
  }),
};

/** Tesco suggestions request mapper, response codec, and stable projection. */
export const TescoSuggestionsEndpoint = {
  decode: (
    input: Schema.Json
  ): Effect.Effect<CatalogueSuggestions, TescoCatalogueResponseInvalid> =>
    Schema.decodeUnknownEffect(TescoSuggestionsResponseDto)(input).pipe(
      Effect.mapError(
        () => new TescoCatalogueResponseInvalid({ operation: "suggestions" })
      ),
      Effect.map(({ results }) => ({ results }))
    ),
  request: ({
    input,
    locale,
    region,
  }: {
    readonly input: CatalogueSuggestionsInput;
    readonly locale: string;
    readonly region: string;
  }) => ({
    distchannel: "ghs",
    geo: region.toLowerCase(),
    lang: locale.slice(0, 2),
    limit: String(input.limit),
    query: input.query,
  }),
};
