import type { Effect } from "effect";
import { Context } from "effect";

import type { ApiError } from "../../../app/errors.js";
import type {
  CatalogueProductResults,
  CatalogueSuggestions,
  CatalogueSuggestionsInput,
  CategoryProductsInput,
  SearchCatalogueInput,
} from "./catalogue.model.js";

export interface TescoCatalogueShape {
  readonly search: (
    request: SearchCatalogueInput
  ) => Effect.Effect<CatalogueProductResults, ApiError>;
  readonly categoryProducts: (
    request: CategoryProductsInput
  ) => Effect.Effect<CatalogueProductResults, ApiError>;
  readonly suggestions: (
    request: CatalogueSuggestionsInput
  ) => Effect.Effect<CatalogueSuggestions, ApiError>;
}

export class TescoCatalogue extends Context.Service<
  TescoCatalogue,
  TescoCatalogueShape
>()("meal-planner/TescoCatalogue") {}
