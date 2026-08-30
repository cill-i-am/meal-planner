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

const HttpClientFailureReason = Schema.Struct({
  _tag: Schema.Literals([
    "DecodeError",
    "EmptyBodyError",
    "StatusCodeError",
    "TransportError",
  ]),
});

const HttpClientFailure = Schema.Struct({
  _tag: Schema.Literal("HttpClientError"),
  reason: HttpClientFailureReason,
});
const decodeHttpClientFailure = Schema.decodeUnknownOption(HttpClientFailure);

const errorCause = Schema.Struct({ cause: Schema.Unknown });

const completeErrors = (cause: Cause.Cause<unknown>) => {
  const errors: unknown[] = [];
  for (const reason of cause.reasons) {
    if (!Cause.isFailReason(reason)) {
      continue;
    }
    let current: unknown = reason.error;
    for (let depth = 0; depth < 8; depth += 1) {
      errors.push(current);
      const decoded = Schema.decodeUnknownOption(errorCause)(current);
      if (Option.isNone(decoded) || decoded.value.cause === current) {
        break;
      }
      current = decoded.value.cause;
    }
  }
  return errors;
};

export const classifyHouseholdPeopleOperationCause = (
  cause: Cause.Cause<unknown>
) => {
  const errors = completeErrors(cause);
  const [error] = errors;
  const ambiguous = errors.some((candidate) => {
    if (
      HttpClientError.isHttpClientError(candidate) &&
      isAmbiguousHttpFailure(candidate)
    ) {
      return true;
    }
    const decoded = decodeHttpClientFailure(candidate);
    return (
      (Option.isSome(decoded) &&
        decoded.value.reason._tag !== "StatusCodeError") ||
      Schema.isSchemaError(candidate)
    );
  });
  if (ambiguous) {
    return new HouseholdPeopleOperationError("transport_unavailable", {
      cause: error,
    });
  }
  const code = errors
    .map((candidate) =>
      Option.getOrUndefined(decodeHouseholdPeopleOperationFailure(candidate))
    )
    .find((candidate) => candidate !== undefined)?.code;
  if (code !== undefined) {
    return new HouseholdPeopleOperationError(code, { cause: error });
  }
  return new HouseholdPeopleOperationError("unexpected_failure", {
    cause: error,
  });
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
    throw classifyHouseholdPeopleOperationCause(exit.cause);
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
