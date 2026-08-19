import {
  HouseholdApiClient,
  makeHouseholdApiClientLayer,
} from "@meal-planner/household-api";
import { Effect, Layer } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";

import type { HouseholdOperations } from "./operations.js";

const makeClientRunner = (baseUrl: string | URL) => {
  const layer = makeHouseholdApiClientLayer({ baseUrl }).pipe(
    Layer.provide(FetchHttpClient.layer)
  );
  return <A, E>(
    operation: (client: HouseholdApiClient) => Effect.Effect<A, E>
  ): Promise<A> =>
    Effect.runPromise(
      HouseholdApiClient.pipe(Effect.flatMap(operation), Effect.provide(layer))
    );
};

/** Browser-owned same-origin tracer; organization identity never enters its request. */
export const makeBrowserHouseholdOperations = (): HouseholdOperations => {
  let clientRunner: ReturnType<typeof makeClientRunner> | undefined;
  const run: ReturnType<typeof makeClientRunner> = (operation) => {
    clientRunner ??= makeClientRunner(globalThis.location.origin);
    return clientRunner(operation);
  };
  return {
    current: () => run((client) => client.households.current()),
  };
};
