import {
  HouseholdPeopleApiClient,
  makeHouseholdPeopleApiClientLayer,
} from "@meal-planner/household-api";
import { Effect, Exit, Layer, Option, Predicate, Schema } from "effect";
import type { Cause } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";

import {
  decodeHouseholdPeopleOperationFailure,
  HouseholdPeopleOperationError,
} from "./operations.js";
import type { HouseholdPeopleOperations } from "./operations.js";

const AmbiguousHttpClientFailureReason = Schema.Struct({
  _tag: Schema.Literals(["DecodeError", "EmptyBodyError", "TransportError"]),
});

const AmbiguousHttpClientFailure = Schema.Struct({
  _tag: Schema.Literal("HttpClientError"),
  reason: AmbiguousHttpClientFailureReason,
});
const decodeAmbiguousHttpClientFailure = Schema.decodeUnknownOption(
  AmbiguousHttpClientFailure
);

const HttpStatusFailure = Schema.Struct({
  _tag: Schema.Literal("HttpClientError"),
  reason: Schema.Struct({
    _tag: Schema.Literal("StatusCodeError"),
    response: Schema.Struct({ status: Schema.Number }),
  }),
});
const decodeHttpStatusFailure = Schema.decodeUnknownOption(HttpStatusFailure);

const StructuralSchemaFailure = Schema.Struct({
  _tag: Schema.Literal("SchemaError"),
});
const decodeStructuralSchemaFailure = Schema.decodeUnknownOption(
  StructuralSchemaFailure
);

const errorCause = Schema.Struct({ cause: Schema.Unknown });

const StructuralCause = Schema.Struct({
  reasons: Schema.Array(Schema.Unknown),
  "~effect/Cause": Schema.Literal("~effect/Cause"),
});
const decodeStructuralCause = Schema.decodeUnknownOption(StructuralCause);

const StructuralFailReason = Schema.Struct({
  _tag: Schema.Literal("Fail"),
  error: Schema.Unknown,
  "~effect/Cause/Reason": Schema.Literal("~effect/Cause/Reason"),
});
const decodeStructuralFailReason =
  Schema.decodeUnknownOption(StructuralFailReason);

const StructuralDieReason = Schema.Struct({
  _tag: Schema.Literal("Die"),
  defect: Schema.Unknown,
  "~effect/Cause/Reason": Schema.Literal("~effect/Cause/Reason"),
});
const decodeStructuralDieReason =
  Schema.decodeUnknownOption(StructuralDieReason);

const completeErrors = (cause: Cause.Cause<unknown>) => {
  const errors: unknown[] = [];
  const pending: unknown[] = [cause];
  const visited = new WeakSet<object>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (Predicate.isObjectKeyword(current)) {
      if (visited.has(current)) {
        continue;
      }
      visited.add(current);
    }
    const structuralCause = decodeStructuralCause(current);
    if (Option.isSome(structuralCause)) {
      for (const reason of structuralCause.value.reasons) {
        const failReason = decodeStructuralFailReason(reason);
        if (Option.isSome(failReason)) {
          pending.push(failReason.value.error);
          continue;
        }
        const dieReason = decodeStructuralDieReason(reason);
        if (Option.isSome(dieReason)) {
          pending.push(dieReason.value.defect);
        }
      }
      continue;
    }
    errors.push(current);
    const decoded = Schema.decodeUnknownOption(errorCause)(current);
    if (Option.isSome(decoded)) {
      pending.push(decoded.value.cause);
    }
  }
  return errors;
};

const describeCauseTopology = (root: Cause.Cause<unknown>) => {
  const nodes: Record<string, unknown>[] = [];
  const pending: unknown[] = [root];
  const visited = new WeakSet<object>();
  while (pending.length > 0 && nodes.length < 32) {
    const current = pending.pop();
    if (!Predicate.isObjectKeyword(current)) {
      nodes.push({ object: false });
      continue;
    }
    if (visited.has(current)) {
      nodes.push({ cycle: true });
      continue;
    }
    visited.add(current);
    const stringKeys = Object.keys(current).toSorted();
    const symbolKeys = Object.getOwnPropertySymbols(current)
      .map((key) => key.description ?? "")
      .toSorted();
    const record = current as Record<string, unknown>;
    nodes.push({
      brand: stringKeys
        .filter((key) => key.startsWith("~effect/"))
        .map((key) => key),
      keys: stringKeys,
      symbolKeys,
      tag: Predicate.isString(record["_tag"]) ? record["_tag"] : undefined,
    });
    for (const key of ["cause", "defect", "error", "reason", "reasons"]) {
      const value = record[key];
      if (Array.isArray(value)) {
        pending.push(...value);
      } else if (value !== undefined) {
        pending.push(value);
      }
    }
  }
  return nodes;
};

export const classifyHouseholdPeopleOperationCause = (
  cause: Cause.Cause<unknown>
) => {
  const errors = completeErrors(cause);
  const [error] = errors;
  const ambiguous = errors.some((candidate) => {
    if (Option.isSome(decodeAmbiguousHttpClientFailure(candidate))) {
      return true;
    }
    const status = decodeHttpStatusFailure(candidate);
    return Option.isSome(status)
      ? status.value.reason.response.status >= 500
      : Option.isSome(decodeStructuralSchemaFailure(candidate));
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
  console.error(
    "[DEBUG-HP-CAUSE-1]",
    JSON.stringify(describeCauseTopology(cause))
  );
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
