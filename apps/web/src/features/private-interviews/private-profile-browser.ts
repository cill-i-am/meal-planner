import { Effect, Result } from "effect";

import { browserApiRuntime } from "../api-client/index.js";
import { displayedIdentityHeaders } from "../auth/index.js";
import type { DisplayedIdentity } from "../auth/index.js";
import { makeHouseholdPeopleEffectOperations } from "../household-people/index.js";
import {
  makeHouseholdProfileEffectOperations,
  ProfileOperationError,
} from "../household-profiles/index.js";
import { browserObservedFetch } from "../observability/browser-observability.js";

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

export const continuePrivateConfirmation = async (
  sessionReference: string,
  mutationId: string,
  generation: string,
  signal: AbortSignal,
  scope: DisplayedIdentity
): Promise<"accepted" | "authentication_required" | "unavailable"> => {
  const response = await browserObservedFetch(
    `/v1/private-interviews/${encodeURIComponent(sessionReference)}/confirmations/${encodeURIComponent(mutationId)}`,
    {
      credentials: "same-origin",
      headers: {
        ...displayedIdentityHeaders(scope),
        "x-private-output-generation": generation,
      },
      method: "POST",
      signal,
    }
  );
  if (response.status === 401) {
    return "authentication_required";
  }
  return response.status === 204 ? "accepted" : "unavailable";
};
