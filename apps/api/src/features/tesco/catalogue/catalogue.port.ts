import type { Effect } from "effect";
import { Context } from "effect";

import type { TescoCatalogueError } from "./catalogue.errors.js";
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
  ) => Effect.Effect<CatalogueProductResults, TescoCatalogueError>;
  readonly categoryProducts: (
    request: CategoryProductsInput
  ) => Effect.Effect<CatalogueProductResults, TescoCatalogueError>;
  readonly suggestions: (
    request: CatalogueSuggestionsInput
  ) => Effect.Effect<CatalogueSuggestions, TescoCatalogueError>;
}

export class TescoCatalogue extends Context.Service<
  TescoCatalogue,
  TescoCatalogueShape
>()("meal-planner/TescoCatalogue") {}
