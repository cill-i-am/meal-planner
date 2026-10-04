import { Effect, Result } from "effect";

import { browserApiRuntime } from "../api-client/index.js";
import type { DisplayedIdentity } from "../auth/index.js";
import { makeHouseholdPeopleEffectOperations } from "../household-people/index.js";
import {
  makeHouseholdProfileEffectOperations,
  ProfileOperationError,
} from "../household-profiles/index.js";

/** The roster supplies the currently linked participant; there is no target selector. */
export const readCurrentPrivateProfile = async (scope: DisplayedIdentity) => {
  const result = await Effect.runPromise(
    Effect.result(
      makeHouseholdPeopleEffectOperations(scope, browserApiRuntime()).list(
        false
      )
    )
  );
  if (Result.isFailure(result)) {
    throw result.failure;
  }
  const roster = result.success;
  if (roster.currentPersonId === null) {
    throw new ProfileOperationError("self_required");
  }
  const profile = await Effect.runPromise(
    Effect.result(
      makeHouseholdProfileEffectOperations(scope, browserApiRuntime()).get(
        roster.currentPersonId
      )
    )
  );
  if (Result.isFailure(profile)) {
    throw profile.failure;
  }
  return profile.success;
};
