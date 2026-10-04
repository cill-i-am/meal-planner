import {
  HouseholdApiClient,
  makeHouseholdApiClientLayer,
} from "@meal-planner/household-api";
import { Data, Effect, Layer } from "effect";

import { apiHttpLayer } from "../api-client/index.js";
import type { ApiRuntime } from "../api-client/index.js";
import { displayedIdentityHeaders } from "../auth/index.js";
import type { DisplayedIdentity } from "../auth/index.js";

class HouseholdOperationError<Failure> extends Data.TaggedError(
  "HouseholdOperationError"
)<{ readonly cause: Failure }> {}

/** The server checks live membership against the displayed identity. */
export const makeHouseholdEffectOperations = (
  scope: DisplayedIdentity,
  runtime: ApiRuntime
) => {
  const layer = makeHouseholdApiClientLayer({
    baseUrl: runtime.baseUrl,
    headers: displayedIdentityHeaders(scope),
  }).pipe(Layer.provide(apiHttpLayer(runtime)));
  return {
    current: () =>
      HouseholdApiClient.pipe(
        Effect.flatMap((client) => client.households.current()),
        Effect.provide(layer),
        Effect.mapError((cause) => new HouseholdOperationError({ cause }))
      ),
  };
};

export type HouseholdOperations = ReturnType<
  typeof makeHouseholdEffectOperations
>;
