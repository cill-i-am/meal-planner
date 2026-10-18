import { Context, Effect, Schema } from "effect";

import {
  CatalogueProductResults,
  CatalogueSuggestions,
  FacetId,
  PageNumber,
  ResultCount,
  SearchQuery,
  SortBy,
} from "../catalogue/catalogue.model.js";
import { TescoConnectionHealth } from "./session.model.js";
import type { TescoSessionFailure } from "./session.model.js";

const defaultValue = <S extends Schema.Top>(schema: S, value: S["Type"]) =>
  schema.pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(value)));
const count = ResultCount.check(Schema.isLessThanOrEqualTo(48));
const listing = {
  count: defaultValue(count, Schema.decodeUnknownSync(count)(24)),
  page: defaultValue(PageNumber, Schema.decodeUnknownSync(PageNumber)(1)),
  sortBy: defaultValue(SortBy, Schema.decodeUnknownSync(SortBy)("relevance")),
};

export const TescoMcpSearch = Schema.Struct({ ...listing, query: SearchQuery });
export const TescoMcpCategory = Schema.Struct({ ...listing, facet: FacetId });
export const TescoMcpSuggestions = Schema.Struct({
  limit: defaultValue(count, Schema.decodeUnknownSync(count)(10)),
  query: SearchQuery,
});

export interface TescoMcpCapabilities {
  readonly search: (
    input: typeof TescoMcpSearch.Type
  ) => Effect.Effect<typeof CatalogueProductResults.Type, TescoSessionFailure>;
  readonly categoryProducts: (
    input: typeof TescoMcpCategory.Type
  ) => Effect.Effect<typeof CatalogueProductResults.Type, TescoSessionFailure>;
  readonly suggestions: (
    input: typeof TescoMcpSuggestions.Type
  ) => Effect.Effect<typeof CatalogueSuggestions.Type, TescoSessionFailure>;
  readonly connectionHealth: Effect.Effect<
    TescoConnectionHealth,
    TescoSessionFailure
  >;
}
export const TescoMcpCapabilities = Context.Service<TescoMcpCapabilities>(
  "meal-planner/tesco/mcp/Capabilities"
);

/** One schema owns protocol discovery, input decoding and native-DO ingress. */
export const TescoMcpTools = [
  {
    description:
      "Search the Irish Tesco product catalogue. Read-only; prices and availability may vary by store.",
    input: TescoMcpSearch,
    name: "search_products",
    output: CatalogueProductResults,
  },
  {
    description:
      "List Irish Tesco catalogue products for a category facet identifier.",
    input: TescoMcpCategory,
    name: "list_category_products",
    output: CatalogueProductResults,
  },
  {
    description: "Suggest Irish Tesco product search terms.",
    input: TescoMcpSuggestions,
    name: "suggest_products",
    output: CatalogueSuggestions,
  },
  {
    description:
      "Check whether the private Tesco session is connected or needs an operator to sign in again. Never returns credentials.",
    input: Schema.Struct({}),
    name: "connection_status",
    output: TescoConnectionHealth,
  },
] as const;
