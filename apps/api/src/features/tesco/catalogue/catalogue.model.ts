import { Schema } from "effect";

const TrimmedNonEmptyString = Schema.String.pipe(
  Schema.check(Schema.isTrimmed(), Schema.isNonEmpty())
);

const PositiveInteger = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(1))
);

const NonNegativeInteger = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(0))
);

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

export const ResultCount = PositiveInteger.pipe(Schema.brand("ResultCount"));
export type ResultCount = typeof ResultCount.Type;

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

/** Fully populated provider-free catalogue search input. */
export const SearchCatalogueInput = Schema.Struct({
  count: ResultCount,
  page: PageNumber,
  query: SearchQuery,
  sortBy: SortBy,
});
export type SearchCatalogueInput = typeof SearchCatalogueInput.Type;

/** Fully populated provider-free category listing input. */
export const CategoryProductsInput = Schema.Struct({
  count: ResultCount,
  facet: FacetId,
  page: PageNumber,
  sortBy: SortBy,
});
export type CategoryProductsInput = typeof CategoryProductsInput.Type;

/** Fully populated provider-free catalogue suggestions input. */
export const CatalogueSuggestionsInput = Schema.Struct({
  limit: ResultCount,
  query: SearchQuery,
});
export type CatalogueSuggestionsInput = typeof CatalogueSuggestionsInput.Type;

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

/** Stable provider-free catalogue listing result. */
export const CatalogueProductResults = Schema.Struct({
  pageInformation: PageInformation,
  results: Schema.Array(Product),
  sortBy: Schema.optionalKey(SortBy),
});
export type CatalogueProductResults = typeof CatalogueProductResults.Type;

export const Suggestion = Schema.Struct({
  query: SearchQuery,
});
export type Suggestion = typeof Suggestion.Type;

/** Stable catalogue suggestions without provider metadata. */
export const CatalogueSuggestions = Schema.Struct({
  results: Schema.Array(Suggestion),
});
/** Stable catalogue suggestions without provider metadata. */
export type CatalogueSuggestions = typeof CatalogueSuggestions.Type;
