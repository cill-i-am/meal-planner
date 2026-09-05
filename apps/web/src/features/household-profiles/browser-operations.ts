import {
  HouseholdPeopleApiClient,
  HouseholdProfileProblem,
  HouseholdUnauthorizedProblem,
  makeHouseholdPeopleApiClientLayer,
} from "@meal-planner/household-api";
import { Cause, Effect, Exit, Layer, Option, Schema } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";

import { ProfileOperationError } from "./operations.js";
import type { HouseholdProfileOperations } from "./operations.js";

/** Only a sole, decoded server rejection is definitive. Defects and mixed causes stay ambiguous. */
export const classifyProfileCause = <E>(
  cause: Cause.Cause<E>
): ProfileOperationError => {
  const [reason] = cause.reasons;
  if (
    cause.reasons.length !== 1 ||
    reason === undefined ||
    !Cause.isFailReason(reason)
  ) {
    return new ProfileOperationError("ambiguous");
  }
  if (
    Option.isSome(
      Schema.decodeUnknownOption(HouseholdUnauthorizedProblem)(reason.error)
    )
  ) {
    return new ProfileOperationError("authentication_required");
  }
  const problem = Schema.decodeUnknownOption(HouseholdProfileProblem)(
    reason.error
  );
  if (Option.isNone(problem) || problem.value.code === "profile_unavailable") {
    return new ProfileOperationError("ambiguous");
  }
  return new ProfileOperationError(problem.value.code);
};

export const makeBrowserHouseholdProfileOperations =
  (): HouseholdProfileOperations => {
    const run = async <A, E>(
      operation: (client: HouseholdPeopleApiClient) => Effect.Effect<A, E>
    ): Promise<A> => {
      const layer = makeHouseholdPeopleApiClientLayer({
        baseUrl: globalThis.location.origin,
      }).pipe(Layer.provide(FetchHttpClient.layer));
      const exit = await Effect.runPromiseExit(
        HouseholdPeopleApiClient.pipe(
          Effect.flatMap(operation),
          Effect.provide(layer)
        )
      );
      if (Exit.isSuccess(exit)) {
        return exit.value;
      }
      throw classifyProfileCause(exit.cause);
    };
    return {
      get: (personId) =>
        run((client) => client.people.getProfile({ params: { personId } })),
      mutate: (personId, payload) =>
        run((client) =>
          client.people.mutateProfile({ params: { personId }, payload })
        ),
      versions: (personId, beforeVersion) =>
        run((client) =>
          client.people.listProfileVersions({
            params: { personId },
            query: beforeVersion === undefined ? {} : { beforeVersion },
          })
        ),
    };
  };
