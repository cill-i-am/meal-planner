import { BetterAuthApiError, isAPIErrorLike } from "@alchemy.run/better-auth";
import { Effect } from "effect";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import type { MealPlannerAuthService } from "./auth.alchemy.js";
import type { MealPlannerAuth } from "./auth.js";

const fromNative = <A>(operation: () => Promise<A>) =>
  Effect.tryPromise({
    catch: (error) => {
      if (isAPIErrorLike(error)) {
        return BetterAuthApiError.fromAPIError(error);
      }
      throw error;
    },
    try: operation,
  });

/** Keep native Better Auth control-plane tests on their raw API seam. */
export const makeNativeAuthTestService = (
  auth: MealPlannerAuth
): MealPlannerAuthService => ({
  api: {
    cancelInvitation: (input) =>
      fromNative(() => auth.api.cancelInvitation(input)),
    createOrganization: (input) =>
      fromNative(() => auth.api.createOrganization(input)),
    getActiveMember: (input) =>
      fromNative(() => auth.api.getActiveMember(input)),
    getSession: (input) => fromNative(() => auth.api.getSession(input)),
    leaveOrganization: (input) =>
      fromNative(() => auth.api.leaveOrganization(input)),
    listOrganizations: (input) =>
      fromNative(() => auth.api.listOrganizations(input)),
    removeMember: (input) => fromNative(() => auth.api.removeMember(input)),
    saveSetupProgress: (input) =>
      fromNative(() => auth.api.saveSetupProgress(input)),
    setActiveOrganization: (input) =>
      fromNative(() => auth.api.setActiveOrganization(input)),
  },
  createHouseholdInvitation: (request) =>
    fromNative(() => auth.createHouseholdInvitation(request)),
  fetchHttpEffect: (request) =>
    Effect.promise(() => auth.fetch(request)).pipe(
      Effect.map(HttpServerResponse.fromWeb)
    ),
});
