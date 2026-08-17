import "@tanstack/react-start/server-only";
import { makeRecipeImportApiClientLayer } from "@meal-planner/recipe-import-api";
import { Config, Data, Effect, Layer, ManagedRuntime, Schema } from "effect";
import type { Redacted } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";

const RequiredSecret = Schema.Redacted(
  Schema.String.pipe(Schema.check(Schema.isTrimmed(), Schema.isNonEmpty()))
);

const RecipeImportRuntimeConfiguration = Config.all({
  baseUrl: Config.url("RECIPE_IMPORT_API_BASE_URL"),
  token: Config.schema(RequiredSecret, "RECIPE_IMPORT_API_TOKEN"),
});

export class RecipeImportRuntimeConfigurationError extends Data.TaggedError(
  "RecipeImportRuntimeConfigurationError"
) {
  override readonly message = "Recipe import runtime configuration is invalid.";
}

export const makeWebRecipeImportApiClientLayer = (options: {
  readonly baseUrl: string | URL;
  readonly token: Redacted.Redacted<string>;
}) => makeRecipeImportApiClientLayer(options);

/** Acquire the web-owned runtime configuration and construct the generated client once. */
export const makeConfiguredWebRecipeImportApiClientLayer = () =>
  Layer.unwrap(
    RecipeImportRuntimeConfiguration.pipe(
      Effect.mapError(() => new RecipeImportRuntimeConfigurationError()),
      Effect.map(makeWebRecipeImportApiClientLayer)
    )
  );

/** Compose the configured generated client with the server's Fetch transport. */
export const makeRuntimeRecipeImportApiClientLayer = () =>
  makeConfiguredWebRecipeImportApiClientLayer().pipe(
    Layer.provide(FetchHttpClient.layer)
  );

/** The server-process runtime owns and reuses one configured generated client. */
export const recipeImportApiRuntime = ManagedRuntime.make(
  makeRuntimeRecipeImportApiClientLayer()
);
