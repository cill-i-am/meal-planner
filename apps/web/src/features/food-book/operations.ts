import {
  HouseholdPlanningContentApiClient,
  makeHouseholdPlanningContentApiClientLayer,
} from "@meal-planner/household-api";
import type { MutatePlanningContentPayload } from "@meal-planner/household-api";
import {
  makeRecipeImportApiClientLayer,
  RecipeId,
  RecipeImportApiClient,
} from "@meal-planner/recipe-import-api";
import type { QueryClient } from "@tanstack/react-query";
import { Data, Effect, Layer, Schema } from "effect";
import { createEffectQuery } from "effect-query";

import { apiHttpLayer } from "../api-client/index.js";
import type { ApiRuntime } from "../api-client/index.js";
import { displayedIdentityHeaders } from "../auth/index.js";
import type { DisplayedIdentity } from "../auth/index.js";

const effectQuery = createEffectQuery(Layer.empty);

export class FoodBookOperationFailure extends Data.TaggedError(
  "FoodBookOperationFailure"
)<{
  readonly cause: unknown;
}> {}

export const foodBookKey = (scope: DisplayedIdentity) =>
  ["food-book", scope.userId, scope.organizationId] as const;

export const invalidatePlanningContent = (
  client: QueryClient,
  scope: DisplayedIdentity
) => client.invalidateQueries({ queryKey: foodBookKey(scope) });

const withClient = <A, E>(
  runtime: ApiRuntime,
  scope: DisplayedIdentity,
  operation: (api: HouseholdPlanningContentApiClient) => Effect.Effect<A, E>
) =>
  HouseholdPlanningContentApiClient.use(operation).pipe(
    Effect.provide(
      makeHouseholdPlanningContentApiClientLayer({
        baseUrl: runtime.baseUrl,
        headers: displayedIdentityHeaders(scope),
      })
    ),
    Effect.provide(apiHttpLayer(runtime)),
    Effect.mapError((cause) => new FoodBookOperationFailure({ cause }))
  );

export const foodBookQueryOptions = (
  runtime: ApiRuntime,
  scope: DisplayedIdentity
) =>
  effectQuery.queryOptions({
    queryFn: () =>
      withClient(runtime, scope, (api) => api.planningContent.read()),
    queryKey: foodBookKey(scope),
    retry: false,
    staleTime: 30_000,
  });

export const foodBookMutationOptions = (
  runtime: ApiRuntime,
  scope: DisplayedIdentity
) =>
  effectQuery.mutationOptions({
    mutationFn: (payload: MutatePlanningContentPayload) =>
      withClient(runtime, scope, (api) =>
        api.planningContent.mutate({ payload })
      ),
    mutationKey: [...foodBookKey(scope), "mutate"],
  });

export const savedRecipesQueryOptions = (
  runtime: ApiRuntime,
  scope: DisplayedIdentity,
  cursor?: string
) =>
  effectQuery.queryOptions({
    queryFn: () =>
      withClient(runtime, scope, (api) =>
        api.planningContent.listSavedRecipes({
          query: cursor === undefined ? {} : { cursor },
        })
      ),
    queryKey: [...foodBookKey(scope), "saved-recipes", cursor ?? "first"],
    retry: false,
    staleTime: 30_000,
  });

export const recipeDetailQueryOptions = (
  runtime: ApiRuntime,
  scope: DisplayedIdentity,
  recipeImportId: string
) =>
  effectQuery.queryOptions({
    queryFn: () =>
      RecipeImportApiClient.use((api) =>
        api.recipes.get({
          params: {
            recipeId: Schema.decodeUnknownSync(RecipeId)(recipeImportId),
          },
        })
      ).pipe(
        Effect.provide(
          makeRecipeImportApiClientLayer({
            baseUrl: runtime.baseUrl,
            headers: displayedIdentityHeaders(scope),
          })
        ),
        Effect.provide(apiHttpLayer(runtime)),
        Effect.mapError((cause) => new FoodBookOperationFailure({ cause }))
      ),
    queryKey: [...foodBookKey(scope), "recipe", recipeImportId],
    retry: false,
    staleTime: 30_000,
  });
