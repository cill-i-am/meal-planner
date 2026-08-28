import {
  HouseholdPeopleApiClient,
  makeHouseholdPeopleApiClientLayer,
} from "@meal-planner/household-api";
import { Effect, Layer } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";

import type { HouseholdPeopleOperations } from "./operations.js";

const makeClientRunner = (baseUrl: string | URL) => {
  const layer = makeHouseholdPeopleApiClientLayer({ baseUrl }).pipe(
    Layer.provide(FetchHttpClient.layer)
  );
  return <A, E>(
    operation: (client: HouseholdPeopleApiClient) => Effect.Effect<A, E>
  ): Promise<A> =>
    Effect.runPromise(
      HouseholdPeopleApiClient.pipe(
        Effect.flatMap(operation),
        Effect.provide(layer)
      )
    );
};

/** Same-origin generated client; membership authority remains server-side. */
export const makeBrowserHouseholdPeopleOperations =
  (): HouseholdPeopleOperations => {
    let clientRunner: ReturnType<typeof makeClientRunner> | undefined;
    const run: ReturnType<typeof makeClientRunner> = (operation) => {
      clientRunner ??= makeClientRunner(globalThis.location.origin);
      return clientRunner(operation);
    };
    return {
      archive: (personId, payload) =>
        run((client) =>
          client.people.archive({ params: { personId }, payload })
        ),
      bootstrapCreator: (payload) =>
        run((client) => client.people.bootstrapCreator({ payload })),
      create: (payload) => run((client) => client.people.create({ payload })),
      list: (includeArchived) =>
        run((client) =>
          client.people.list({
            query: { includeArchived: includeArchived ? "true" : "false" },
          })
        ),
      restore: (personId, payload) =>
        run((client) =>
          client.people.restore({ params: { personId }, payload })
        ),
    };
  };
