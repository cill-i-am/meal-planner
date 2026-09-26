import {
  HouseholdPeopleApiClient,
  makeHouseholdPeopleApiClientLayer,
} from "@meal-planner/household-api";
import { Cause, Effect, Exit, Option, Predicate, Result, Schema } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as HttpClientError from "effect/unstable/http/HttpClientError";

import { displayedIdentityHeaders } from "../auth/displayed-identity.js";
import type { DisplayedIdentity } from "../auth/displayed-identity.js";
import {
  decodeHouseholdPeopleOperationFailure,
  HouseholdPeopleOperationError,
} from "./operations.js";
import type {
  HouseholdPeopleEffectOperations,
  HouseholdPeopleOperations,
} from "./operations.js";

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
  let hasDie = false;
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
          hasDie = true;
          pending.push(dieReason.value.defect);
        }
      }
      continue;
    }
    errors.push(current);
    if (Predicate.hasProperty(current, "cause")) {
      pending.push(current.cause);
    }
  }
  return { errors, hasDie };
};

const isAmbiguousClientFailure = (candidate: object) => {
  if (Schema.isSchemaError(candidate)) {
    return true;
  }
  if (HttpClientError.isHttpClientError(candidate)) {
    const { reason } = candidate;
    return (
      reason._tag === "DecodeError" ||
      reason._tag === "EmptyBodyError" ||
      reason._tag === "TransportError" ||
      (reason._tag === "StatusCodeError" && reason.response.status >= 500)
    );
  }
  if (Option.isSome(decodeAmbiguousHttpClientFailure(candidate))) {
    return true;
  }
  const status = decodeHttpStatusFailure(candidate);
  return Option.isSome(status)
    ? status.value.reason.response.status >= 500
    : Option.isSome(decodeStructuralSchemaFailure(candidate));
};

export const classifyHouseholdPeopleOperationCause = (
  cause: Cause.Cause<unknown>
) => {
  const { errors, hasDie } = completeErrors(cause);
  const [error] = errors;
  const ambiguous = errors.some(
    (candidate) =>
      Predicate.isObjectKeyword(candidate) &&
      isAmbiguousClientFailure(candidate)
  );
  if (ambiguous || hasDie) {
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

const makeClientRunner = (scope: DisplayedIdentity) => {
  let layer: ReturnType<typeof makeHouseholdPeopleApiClientLayer> | undefined;
  return <A, E>(
    operation: (client: HouseholdPeopleApiClient) => Effect.Effect<A, E>
  ) =>
    Effect.suspend(() => {
      layer ??= makeHouseholdPeopleApiClientLayer({
        baseUrl: globalThis.location.origin,
        headers: displayedIdentityHeaders(scope),
      });
      return HouseholdPeopleApiClient.pipe(
        Effect.flatMap(operation),
        Effect.provide(layer),
        Effect.provide(FetchHttpClient.layer),
        Effect.catchCause((cause) => {
          if (Cause.hasInterrupts(cause)) {
            const failure = Cause.findError(cause);
            if (Result.isFailure(failure)) {
              return Effect.failCause(failure.failure);
            }
            return Effect.interrupt;
          }
          const { errors, hasDie } = completeErrors(cause);
          if (
            hasDie &&
            !errors.some(
              (candidate) =>
                Predicate.isObjectKeyword(candidate) &&
                isAmbiguousClientFailure(candidate)
            )
          ) {
            const failure = Cause.findError(cause);
            if (Result.isFailure(failure)) {
              return Effect.failCause(failure.failure);
            }
          }
          return Effect.fail(classifyHouseholdPeopleOperationCause(cause));
        })
      );
    });
};

const runEffectOperation = async <A>(
  effect: Effect.Effect<A, unknown>
): Promise<A> => {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) {
    return exit.value;
  }
  const failure = Cause.findErrorOption(exit.cause);
  if (Option.isSome(failure)) {
    throw failure.value;
  }
  return Effect.runPromise(Effect.failCause(exit.cause));
};

/** Same-origin generated client; membership authority remains server-side. */
export const makeBrowserHouseholdPeopleEffectOperations = (
  scope: DisplayedIdentity
): HouseholdPeopleEffectOperations => {
  const run = makeClientRunner(scope);
  return {
    archive: (personId, payload) =>
      run((client) => client.people.archive({ params: { personId }, payload })),
    associateInvitation: (payload) =>
      run((client) => client.people.associateInvitation({ payload })),
    bootstrapCreator: (payload) =>
      run((client) => client.people.bootstrapCreator({ payload })),
    cancelDeparture: (operationId, payload) =>
      run((client) =>
        client.people.cancelDeparture({
          params: { operationId },
          payload,
        })
      ),
    completeAdultLink: (payload) =>
      run((client) => client.people.completeAdultLink({ payload })),
    create: (payload) => run((client) => client.people.create({ payload })),
    departAdult: (payload) =>
      run((client) => client.people.departAdult({ payload })),
    getDeparture: (operationId) =>
      run((client) => client.people.getDeparture({ params: { operationId } })),
    getDepartureByMutation: (mutationId) =>
      run((client) =>
        client.people.getDepartureByMutation({ params: { mutationId } })
      ),
    inviteAdult: (payload) =>
      run((client) => client.people.inviteAdult({ payload })),
    list: (includeArchived) =>
      run((client) =>
        client.people.list({
          query: { includeArchived: includeArchived ? "true" : "false" },
        })
      ),
    remove: (personId, payload) =>
      run((client) => client.people.remove({ params: { personId }, payload })),
    rename: (personId, payload) =>
      run((client) => client.people.rename({ params: { personId }, payload })),
    repairAdultLink: (payload) =>
      run((client) => client.people.repairAdultLink({ payload })),
    restore: (personId, payload) =>
      run((client) => client.people.restore({ params: { personId }, payload })),
    retryDeparture: (operationId, payload) =>
      run((client) =>
        client.people.retryDeparture({
          params: { operationId },
          payload,
        })
      ),
    returnAdult: (payload) =>
      run((client) => client.people.returnAdult({ payload })),
  };
};

/** Promise facade for consumers outside Effect query and mutation adapters. */
export const makeBrowserHouseholdPeopleOperations = (
  scope: DisplayedIdentity
): HouseholdPeopleOperations => {
  const operations = makeBrowserHouseholdPeopleEffectOperations(scope);
  return {
    archive: (personId, payload) =>
      runEffectOperation(operations.archive(personId, payload)),
    associateInvitation: (payload) =>
      runEffectOperation(operations.associateInvitation(payload)),
    bootstrapCreator: (payload) =>
      runEffectOperation(operations.bootstrapCreator(payload)),
    cancelDeparture: (operationId, payload) =>
      runEffectOperation(operations.cancelDeparture(operationId, payload)),
    completeAdultLink: (payload) =>
      runEffectOperation(operations.completeAdultLink(payload)),
    create: (payload) => runEffectOperation(operations.create(payload)),
    departAdult: (payload) =>
      runEffectOperation(operations.departAdult(payload)),
    getDeparture: (operationId) =>
      runEffectOperation(operations.getDeparture(operationId)),
    getDepartureByMutation: (mutationId) =>
      runEffectOperation(operations.getDepartureByMutation(mutationId)),
    inviteAdult: (payload) =>
      runEffectOperation(operations.inviteAdult(payload)),
    list: (includeArchived) =>
      runEffectOperation(operations.list(includeArchived)),
    remove: (personId, payload) =>
      runEffectOperation(operations.remove(personId, payload)),
    rename: (personId, payload) =>
      runEffectOperation(operations.rename(personId, payload)),
    repairAdultLink: (payload) =>
      runEffectOperation(operations.repairAdultLink(payload)),
    restore: (personId, payload) =>
      runEffectOperation(operations.restore(personId, payload)),
    retryDeparture: (operationId, payload) =>
      runEffectOperation(operations.retryDeparture(operationId, payload)),
    returnAdult: (payload) =>
      runEffectOperation(operations.returnAdult(payload)),
  };
};
