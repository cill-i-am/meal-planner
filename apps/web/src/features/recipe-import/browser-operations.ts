import {
  makeRecipeImportApiClientLayer,
  RecipeImportApiClient,
} from "@meal-planner/recipe-import-api";
import { Effect, Layer } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";

import { displayedIdentityHeaders } from "../auth/displayed-identity.js";
import type { DisplayedIdentity } from "../auth/displayed-identity.js";
import type { RecipeImportOperations } from "./operations.js";

const makeClientRunner = (baseUrl: string | URL, scope: DisplayedIdentity) => {
  const layer = makeRecipeImportApiClientLayer({
    baseUrl,
    headers: displayedIdentityHeaders(scope),
  }).pipe(Layer.provide(FetchHttpClient.layer));
  return <A, E>(
    operation: (client: RecipeImportApiClient) => Effect.Effect<A, E>
  ): Promise<A> =>
    Effect.runPromise(
      RecipeImportApiClient.pipe(
        Effect.flatMap(operation),
        Effect.provide(layer)
      )
    );
};

/** Browser-owned generated client. Native fetch sends same-origin cookies by default. */
export const makeBrowserRecipeImportOperations = (
  scope: DisplayedIdentity
): RecipeImportOperations => {
  let clientRunner: ReturnType<typeof makeClientRunner> | undefined;
  const run: ReturnType<typeof makeClientRunner> = (operation) => {
    clientRunner ??= makeClientRunner(globalThis.location.origin, scope);
    return clientRunner(operation);
  };
  return {
    answerAction: (input) =>
      run((client) =>
        client.recipeImportIntents.answerAction({
          headers: { "idempotency-key": input.idempotencyKey },
          params: { actionId: input.actionId, id: input.intentId },
          payload: input.request,
        })
      ),
    cancel: (input) =>
      run((client) =>
        client.recipeImportIntents.cancel({
          headers: { "idempotency-key": input.idempotencyKey },
          params: { id: input.intentId },
          payload: input.request,
        })
      ),
    confirmAction: (input) =>
      run((client) =>
        client.recipeImportIntents.confirmAction({
          headers: { "idempotency-key": input.idempotencyKey },
          params: { actionId: input.actionId, id: input.intentId },
          payload: input.request,
        })
      ),
    create: (input) =>
      run((client) =>
        client.recipeImportIntents
          .create({
            headers: { "idempotency-key": input.idempotencyKey },
            payload: input.request,
          })
          .pipe(Effect.map((response) => response.body))
      ),
    getAction: (input) =>
      run((client) =>
        client.recipeImportIntents.getAction({
          params: { actionId: input.actionId, id: input.intentId },
        })
      ),
    getIntent: (input) =>
      run((client) =>
        client.recipeImportIntents
          .get({ params: { id: input.intentId } })
          .pipe(Effect.map((response) => response.body))
      ),
    getRecipe: (input) =>
      run((client) =>
        client.recipes.get({ params: { recipeId: input.recipeId } })
      ),
  };
};
