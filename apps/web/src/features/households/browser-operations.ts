import {
  HouseholdApiClient,
  makeHouseholdApiClientLayer,
} from "@meal-planner/household-api";
import { Effect, Layer } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";

import { displayedIdentityHeaders } from "../auth/displayed-identity.js";
import type { DisplayedIdentity } from "../auth/displayed-identity.js";
import type { HouseholdOperations } from "./operations.js";

const makeClientRunner = (baseUrl: string | URL, scope: DisplayedIdentity) => {
  const layer = makeHouseholdApiClientLayer({
    baseUrl,
    headers: displayedIdentityHeaders(scope),
  }).pipe(Layer.provide(FetchHttpClient.layer));
  return <A, E>(
    operation: (client: HouseholdApiClient) => Effect.Effect<A, E>
  ): Promise<A> =>
    Effect.runPromise(
      HouseholdApiClient.pipe(Effect.flatMap(operation), Effect.provide(layer))
    );
};

/** The server verifies that the live session still matches the displayed identity. */
export const makeBrowserHouseholdOperations = (
  scope: DisplayedIdentity
): HouseholdOperations => {
  let clientRunner: ReturnType<typeof makeClientRunner> | undefined;
  const run: ReturnType<typeof makeClientRunner> = (operation) => {
    clientRunner ??= makeClientRunner(globalThis.location.origin, scope);
    return clientRunner(operation);
  };
  return {
    current: () => run((client) => client.households.current()),
  };
};
