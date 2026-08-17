import "@tanstack/react-start/server-only";
import {
  makeRecipeImportApiClientLayer,
  RecipeImportApiClient,
} from "@meal-planner/recipe-import-api";
import type { RecipeImportApiClientShape } from "@meal-planner/recipe-import-api";
import {
  Config,
  Context,
  Effect,
  Equivalence,
  Layer,
  ManagedRuntime,
  Redacted,
  Schema,
} from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";

import {
  RecipeImportProfileAlias,
  RecipeImportPublicProfileConfiguration,
} from "../profiles.js";
import type {
  RecipeImportProfileAlias as RecipeImportProfileAliasType,
  RecipeImportPublicProfileConfiguration as RecipeImportPublicProfileConfigurationType,
} from "../profiles.js";
import { RecipeImportProfileSelectionError } from "./recipe-import-profile-selection-error.server.js";
import { RecipeImportRuntimeConfigurationError } from "./recipe-import-runtime-configuration-error.server.js";

export { RecipeImportProfileSelectionError } from "./recipe-import-profile-selection-error.server.js";
export { RecipeImportRuntimeConfigurationError } from "./recipe-import-runtime-configuration-error.server.js";

const RequiredSecret = Schema.Redacted(
  Schema.String.pipe(Schema.check(Schema.isTrimmed(), Schema.isNonEmpty()))
);
const RequiredLabel = Schema.String.pipe(
  Schema.check(Schema.isTrimmed(), Schema.isLengthBetween(1, 48))
);

const RecipeImportRuntimeConfiguration = Config.all({
  baseUrl: Config.url("RECIPE_IMPORT_API_BASE_URL"),
  defaultAlias: Config.schema(
    RecipeImportProfileAlias,
    "RECIPE_IMPORT_DEFAULT_PROFILE_ALIAS"
  ),
  profileA: Config.all({
    alias: Config.schema(
      RecipeImportProfileAlias,
      "RECIPE_IMPORT_PROFILE_A_ALIAS"
    ),
    label: Config.schema(RequiredLabel, "RECIPE_IMPORT_PROFILE_A_LABEL"),
    token: Config.schema(RequiredSecret, "RECIPE_IMPORT_PROFILE_A_TOKEN"),
  }),
  profileB: Config.all({
    alias: Config.schema(
      RecipeImportProfileAlias,
      "RECIPE_IMPORT_PROFILE_B_ALIAS"
    ),
    label: Config.schema(RequiredLabel, "RECIPE_IMPORT_PROFILE_B_LABEL"),
    token: Config.schema(RequiredSecret, "RECIPE_IMPORT_PROFILE_B_TOKEN"),
  }),
});

export interface RecipeImportProfileRegistryShape {
  readonly clientFor: (
    alias: RecipeImportProfileAliasType
  ) => Effect.Effect<
    RecipeImportApiClientShape,
    RecipeImportProfileSelectionError
  >;
  readonly publicConfiguration: RecipeImportPublicProfileConfigurationType;
}

export class RecipeImportProfileRegistry extends Context.Service<
  RecipeImportProfileRegistry,
  RecipeImportProfileRegistryShape
>()("meal-planner/RecipeImportProfileRegistry") {}

export const makeWebRecipeImportApiClientLayer = (options: {
  readonly baseUrl: string | URL;
  readonly token: Redacted.Redacted<string>;
}) => makeRecipeImportApiClientLayer(options);

const redactedStringEquivalence = Redacted.makeEquivalence(
  Equivalence.strictEqual<string>()
);

/** Acquire the web-owned profile registry and construct both generated clients once. */
export const makeConfiguredWebRecipeImportProfileRegistryLayer = () =>
  Layer.effect(
    RecipeImportProfileRegistry,
    Effect.gen(function* makeProfileRegistry() {
      const configuration = yield* RecipeImportRuntimeConfiguration.pipe(
        Effect.mapError(() => new RecipeImportRuntimeConfigurationError())
      );
      const { profileA, profileB } = configuration;
      const aliasesAreDistinct = profileA.alias !== profileB.alias;
      const tokensAreDistinct = !redactedStringEquivalence(
        profileA.token,
        profileB.token
      );
      const labelsAreDistinct = profileA.label !== profileB.label;
      const defaultIsConfigured =
        configuration.defaultAlias === profileA.alias ||
        configuration.defaultAlias === profileB.alias;

      if (
        !aliasesAreDistinct ||
        !tokensAreDistinct ||
        !labelsAreDistinct ||
        !defaultIsConfigured
      ) {
        return yield* Effect.fail(new RecipeImportRuntimeConfigurationError());
      }

      const [clientA, clientB] = yield* Effect.all([
        RecipeImportApiClient.pipe(
          Effect.provide(
            makeWebRecipeImportApiClientLayer({
              baseUrl: configuration.baseUrl,
              token: profileA.token,
            })
          )
        ),
        RecipeImportApiClient.pipe(
          Effect.provide(
            makeWebRecipeImportApiClientLayer({
              baseUrl: configuration.baseUrl,
              token: profileB.token,
            })
          )
        ),
      ]);
      const clients = new Map<
        RecipeImportProfileAliasType,
        RecipeImportApiClientShape
      >([
        [profileA.alias, clientA],
        [profileB.alias, clientB],
      ]);
      const publicConfiguration = Schema.decodeUnknownSync(
        RecipeImportPublicProfileConfiguration,
        { onExcessProperty: "error" }
      )({
        defaultAlias: configuration.defaultAlias,
        profiles: [
          { alias: profileA.alias, label: profileA.label },
          { alias: profileB.alias, label: profileB.label },
        ],
      });

      return {
        clientFor: (alias) => {
          const client = clients.get(alias);
          return client === undefined
            ? Effect.fail(new RecipeImportProfileSelectionError())
            : Effect.succeed(client);
        },
        publicConfiguration,
      } satisfies RecipeImportProfileRegistryShape;
    })
  );

/** Compose the profile registry with the server's Fetch transport. */
export const makeRuntimeRecipeImportProfileRegistryLayer = () =>
  makeConfiguredWebRecipeImportProfileRegistryLayer().pipe(
    Layer.provide(FetchHttpClient.layer)
  );

/** The server-process runtime owns and reuses the closed configured registry. */
export const recipeImportProfileRuntime = ManagedRuntime.make(
  makeRuntimeRecipeImportProfileRegistryLayer()
);
