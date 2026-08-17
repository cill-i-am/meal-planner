import "@tanstack/react-start/server-only";
import { makeRecipeImportApiClientLayer } from "@meal-planner/recipe-import-api";
import { Layer } from "effect";
import type { Redacted } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";

export const makeWebRecipeImportApiClientLayer = (options: {
  readonly baseUrl: string | URL;
  readonly token: Redacted.Redacted<string>;
}) => makeRecipeImportApiClientLayer(options);

export const makeRuntimeRecipeImportApiClientLayer = (options: {
  readonly baseUrl: string | URL;
  readonly token: Redacted.Redacted<string>;
}) =>
  makeWebRecipeImportApiClientLayer(options).pipe(
    Layer.provide(FetchHttpClient.layer)
  );
