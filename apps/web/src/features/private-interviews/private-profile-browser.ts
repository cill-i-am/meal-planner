import { displayedIdentityHeaders } from "../auth/index.js";
import type { DisplayedIdentity } from "../auth/index.js";
import { makeBrowserHouseholdPeopleOperations } from "../household-people/index.js";
import {
  makeBrowserHouseholdProfileOperations,
  ProfileOperationError,
} from "../household-profiles/index.js";

/** The roster supplies the currently linked participant; there is no target selector. */
export const readCurrentPrivateProfile = async (scope: DisplayedIdentity) => {
  const roster = await makeBrowserHouseholdPeopleOperations(scope).list(false);
  if (roster.currentPersonId === null) {
    throw new ProfileOperationError("self_required");
  }
  return makeBrowserHouseholdProfileOperations(scope).get(
    roster.currentPersonId
  );
};

export const continuePrivateConfirmation = async (
  sessionReference: string,
  mutationId: string,
  generation: string,
  signal: AbortSignal,
  scope: DisplayedIdentity
): Promise<"accepted" | "authentication_required" | "unavailable"> => {
  const response = await fetch(
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
