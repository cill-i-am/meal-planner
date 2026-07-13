import type { Effect, Schema } from "effect";
import { Context } from "effect";

import type { ApiError } from "../../../app/errors.js";
import type {
  CategoryProductsRequest,
  ProductResults,
  RawGraphQlRequest,
  SearchRequest,
  SuggestionRequest,
  SuggestionsResponse,
} from "./catalogue.model.js";

export interface TescoCatalogueShape {
  readonly search: (
    request: SearchRequest
  ) => Effect.Effect<ProductResults, ApiError>;
  readonly categoryProducts: (
    request: CategoryProductsRequest
  ) => Effect.Effect<ProductResults, ApiError>;
  readonly suggestions: (
    request: SuggestionRequest
  ) => Effect.Effect<SuggestionsResponse, ApiError>;
  readonly graphQl: (
    request: RawGraphQlRequest
  ) => Effect.Effect<Schema.Json, ApiError>;
}

export class TescoCatalogue extends Context.Service<
  TescoCatalogue,
  TescoCatalogueShape
>()("meal-planner/TescoCatalogue") {}
