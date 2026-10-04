import {
  HouseholdPeopleApiClient,
  HouseholdProfileProblem,
  HouseholdUnauthorizedProblem,
  makeHouseholdPeopleApiClientLayer,
} from "@meal-planner/household-api";
import type {
  HouseholdPersonId,
  MutatePersonProfilePayload,
} from "@meal-planner/household-api";
import { Cause, Effect, Layer, Option, Result, Schema } from "effect";

import { apiHttpLayer } from "../api-client/index.js";
import type { ApiRuntime } from "../api-client/index.js";
import { displayedIdentityHeaders } from "../auth/index.js";
import type { DisplayedIdentity } from "../auth/index.js";
import { ProfileOperationError } from "./operations.js";

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

export const makeHouseholdProfileEffectOperations = (
  scope: DisplayedIdentity,
  runtime: ApiRuntime
) => {
  const layer = makeHouseholdPeopleApiClientLayer({
    baseUrl: runtime.baseUrl,
    headers: displayedIdentityHeaders(scope),
  }).pipe(Layer.provide(apiHttpLayer(runtime)));
  const run = <A, E>(
    operation: (client: HouseholdPeopleApiClient) => Effect.Effect<A, E>
  ) =>
    HouseholdPeopleApiClient.pipe(
      Effect.flatMap(operation),
      Effect.provide(layer),
      Effect.catchCause((cause) => {
        if (Cause.hasInterrupts(cause)) {
          const failure = Cause.findError(cause);
          if (Result.isFailure(failure)) {
            return Effect.failCause(failure.failure);
          }
        }
        return Effect.fail(classifyProfileCause(cause));
      })
    );
  return {
    get: (personId: HouseholdPersonId) =>
      run((client) =>
        client.people.getProfile({
          params: { familyId: scope.organizationId, personId },
        })
      ),
    mutate: (
      personId: HouseholdPersonId,
      payload: MutatePersonProfilePayload
    ) =>
      run((client) =>
        client.people.mutateProfile({
          params: { familyId: scope.organizationId, personId },
          payload,
        })
      ),
    versions: (personId: HouseholdPersonId, beforeVersion?: number) =>
      run((client) =>
        client.people.listProfileVersions({
          params: { familyId: scope.organizationId, personId },
          query: beforeVersion === undefined ? {} : { beforeVersion },
        })
      ),
  };
};

export type HouseholdProfileOperations = ReturnType<
  typeof makeHouseholdProfileEffectOperations
>;
