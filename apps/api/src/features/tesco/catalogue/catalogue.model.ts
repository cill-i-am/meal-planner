import { Effect, Schema, SchemaGetter } from "effect";

export const GraphQlVariables = Schema.Record(Schema.String, Schema.Unknown);

const TrimmedNonEmptyString = Schema.String.pipe(
  Schema.check(Schema.isTrimmed(), Schema.isNonEmpty())
);

const PositiveInteger = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(1))
);

const NonNegativeInteger = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(0))
);

const PositiveIntegerFromString = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[1-9]\d*$/u)),
  Schema.decodeTo(PositiveInteger, {
    decode: SchemaGetter.transform(Number),
    encode: SchemaGetter.transform(String),
  })
);

export const GraphQlOperationName = TrimmedNonEmptyString.pipe(
  Schema.brand("GraphQlOperationName")
);
export type GraphQlOperationName = typeof GraphQlOperationName.Type;

export const GraphQlDocument = Schema.String.pipe(
  Schema.check(Schema.isPattern(/\S/u)),
  Schema.brand("GraphQlDocument")
);
export type GraphQlDocument = typeof GraphQlDocument.Type;

export const SearchQuery = TrimmedNonEmptyString.pipe(
  Schema.brand("SearchQuery")
);
export type SearchQuery = typeof SearchQuery.Type;

export const FacetId = TrimmedNonEmptyString.pipe(Schema.brand("FacetId"));
export type FacetId = typeof FacetId.Type;

export const SortBy = TrimmedNonEmptyString.pipe(Schema.brand("SortBy"));
export type SortBy = typeof SortBy.Type;

export const PageNumber = PositiveInteger.pipe(Schema.brand("PageNumber"));
export type PageNumber = typeof PageNumber.Type;

export const DefaultPageNumber = Schema.decodeUnknownSync(PageNumber)(1);

export const PageNumberFromString = PositiveIntegerFromString.pipe(
  Schema.brand("PageNumber")
);

export const ResultCount = PositiveInteger.pipe(Schema.brand("ResultCount"));
export type ResultCount = typeof ResultCount.Type;

export const DefaultResultCount = Schema.decodeUnknownSync(ResultCount)(24);
export const DefaultSuggestionLimit = Schema.decodeUnknownSync(ResultCount)(10);

export const ResultCountFromString = PositiveIntegerFromString.pipe(
  Schema.brand("ResultCount")
);

export const ProductId = TrimmedNonEmptyString.pipe(Schema.brand("ProductId"));
export type ProductId = typeof ProductId.Type;

export const ProductTitle = TrimmedNonEmptyString.pipe(
  Schema.brand("ProductTitle")
);
export type ProductTitle = typeof ProductTitle.Type;

export const ProductTypeName = TrimmedNonEmptyString.pipe(
  Schema.brand("ProductTypeName")
);
export type ProductTypeName = typeof ProductTypeName.Type;

export const ImageUrl = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^https?:\/\//u)),
  Schema.brand("ImageUrl")
);
export type ImageUrl = typeof ImageUrl.Type;

export const DefaultSortBy = Schema.decodeUnknownSync(SortBy)("relevance");

const GraphQlVariablesWithDefault = GraphQlVariables.pipe(
  Schema.withDecodingDefaultTypeKey(Effect.succeed({}))
);

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

export const RawGraphQlRequest = Schema.Struct({
  operationName: GraphQlOperationName,
  query: GraphQlDocument,
  variables: GraphQlVariablesWithDefault,
});
export type RawGraphQlRequest = typeof RawGraphQlRequest.Type;

export const SearchRequest = Schema.Struct({
  count: ResultCountWithDefault,
  page: PageNumberWithDefault,
  query: SearchQuery,
  sortBy: SortByWithDefault,
});
export type SearchRequest = typeof SearchRequest.Type;

export const CategoryProductsRequest = Schema.Struct({
  count: ResultCountWithDefault,
  facet: FacetId,
  page: PageNumberWithDefault,
  sortBy: SortByWithDefault,
});
export type CategoryProductsRequest = typeof CategoryProductsRequest.Type;

export const SuggestionRequest = Schema.Struct({
  limit: SuggestionLimitWithDefault,
  query: SearchQuery,
});
export type SuggestionRequest = typeof SuggestionRequest.Type;

export const PageQuery = Schema.Struct({
  actualTerm: Schema.optionalKey(Schema.String),
  queryPhase: Schema.optionalKey(Schema.String),
  searchTerm: Schema.optionalKey(Schema.String),
});
export type PageQuery = typeof PageQuery.Type;

export const PageInformation = Schema.Struct({
  count: NonNegativeInteger,
  matchType: Schema.optionalKey(Schema.String),
  pageNo: PageNumber,
  pageSize: NonNegativeInteger,
  query: Schema.optionalKey(PageQuery),
  total: NonNegativeInteger,
});
export type PageInformation = typeof PageInformation.Type;

export const Product = Schema.Struct({
  defaultImageUrl: Schema.optionalKey(ImageUrl),
  id: ProductId,
  title: ProductTitle,
  type: ProductTypeName,
});
export type Product = typeof Product.Type;

export const ProductResults = Schema.Struct({
  pageInformation: PageInformation,
  results: Schema.Array(Product),
  sortBy: Schema.optionalKey(SortBy),
});
export type ProductResults = typeof ProductResults.Type;

export const Suggestion = Schema.Struct({
  query: SearchQuery,
});
export type Suggestion = typeof Suggestion.Type;

export const SuggestionsResponse = Schema.Struct({
  config: TrimmedNonEmptyString,
  results: Schema.Array(Suggestion),
});
export type SuggestionsResponse = typeof SuggestionsResponse.Type;

const TescoProductNode = Schema.Struct({
  __typename: ProductTypeName,
  defaultImageUrl: Schema.optionalKey(Schema.NullishOr(ImageUrl)),
  id: ProductId,
  title: ProductTitle,
});

const TescoResultNode = Schema.Struct({
  node: TescoProductNode,
});

const TescoOptions = Schema.Struct({
  sortBy: Schema.optionalKey(SortBy),
});

const TescoListing = Schema.Struct({
  options: Schema.optionalKey(TescoOptions),
  pageInformation: PageInformation,
  results: Schema.Array(TescoResultNode),
});

export const TescoSearchGraphQlResponse = Schema.Struct({
  data: Schema.Struct({
    search: TescoListing,
  }),
  status: Schema.optionalKey(Schema.Number),
});
export type TescoSearchGraphQlResponse = typeof TescoSearchGraphQlResponse.Type;

export const TescoCategoryGraphQlResponse = Schema.Struct({
  data: Schema.Struct({
    category: TescoListing,
  }),
  status: Schema.optionalKey(Schema.Number),
});
export type TescoCategoryGraphQlResponse =
  typeof TescoCategoryGraphQlResponse.Type;

const TescoGraphQlErrorMessage = Schema.Struct({
  message: TrimmedNonEmptyString,
});

export const TescoGraphQlErrorResponse = Schema.Struct({
  errors: Schema.NonEmptyArray(TescoGraphQlErrorMessage),
});
export type TescoGraphQlErrorResponse = typeof TescoGraphQlErrorResponse.Type;

export const mapTescoListing = (
  listing: typeof TescoListing.Type
): ProductResults => ({
  pageInformation: listing.pageInformation,
  results: listing.results.map(({ node }) => ({
    id: node.id,
    title: node.title,
    type: node.__typename,
    ...(node.defaultImageUrl === null || node.defaultImageUrl === undefined
      ? {}
      : { defaultImageUrl: node.defaultImageUrl }),
  })),
  ...(listing.options?.sortBy === undefined
    ? {}
    : { sortBy: listing.options.sortBy }),
});
