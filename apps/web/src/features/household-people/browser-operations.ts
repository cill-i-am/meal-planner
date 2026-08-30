import {
  HouseholdPeopleApiClient,
  makeHouseholdPeopleApiClientLayer,
} from "@meal-planner/household-api";
import { Cause, Effect, Exit, Layer, Option, Schema } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as HttpClientError from "effect/unstable/http/HttpClientError";

import {
  decodeHouseholdPeopleOperationFailure,
  HouseholdPeopleOperationError,
} from "./operations.js";
import type { HouseholdPeopleOperations } from "./operations.js";

const isAmbiguousHttpFailure = (error: HttpClientError.HttpClientError) => {
  const { reason } = error;
  if (
    reason._tag === "TransportError" ||
    reason._tag === "DecodeError" ||
    reason._tag === "EmptyBodyError"
  ) {
    return true;
  }
  return reason._tag === "StatusCodeError" && reason.response.status >= 500;
};

const makeClientRunner = (baseUrl: string | URL) => {
  const layer = makeHouseholdPeopleApiClientLayer({ baseUrl }).pipe(
    Layer.provide(FetchHttpClient.layer)
  );
  return async <A, E>(
    operation: (client: HouseholdPeopleApiClient) => Effect.Effect<A, E>
  ): Promise<A> => {
    const exit = await Effect.runPromiseExit(
      HouseholdPeopleApiClient.pipe(
        Effect.flatMap(operation),
        Effect.provide(layer)
      )
    );
    if (Exit.isSuccess(exit)) {
      return exit.value;
    }
    const error = Option.getOrUndefined(Cause.findErrorOption(exit.cause));
    const code = Option.getOrUndefined(
      decodeHouseholdPeopleOperationFailure(error)
    )?.code;
    if (code !== undefined) {
      throw new HouseholdPeopleOperationError(code, { cause: error });
    }
    if (
      (HttpClientError.isHttpClientError(error) &&
        isAmbiguousHttpFailure(error)) ||
      Schema.isSchemaError(error)
    ) {
      throw new HouseholdPeopleOperationError("transport_unavailable", {
        cause: error,
      });
    }
    throw new HouseholdPeopleOperationError("unexpected_failure", {
      cause: error,
    });
  };
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
