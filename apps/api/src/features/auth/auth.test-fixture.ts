import { BetterAuthApiError, isAPIErrorLike } from "@alchemy.run/better-auth";
import { Effect } from "effect";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

import type { MealPlannerAuthService } from "./auth.alchemy.js";
import type { MealPlannerAuth } from "./auth.js";
import {
  DelegatedAccess,
  makeDelegatedAccessBoundary,
  runWithNativeDelegation,
} from "./delegated-access.js";

const fromNative = <A>(operation: () => Promise<A>) =>
  DelegatedAccess.pipe(
    Effect.flatMap((grant) =>
      Effect.tryPromise({
        catch: (error) => {
          if (isAPIErrorLike(error)) {
            return BetterAuthApiError.fromAPIError(error);
          }
          throw error;
        },
        try: () => runWithNativeDelegation(grant, operation),
      })
    )
  );

/** Keep native Better Auth control-plane tests on their raw API seam. */
export const makeNativeAuthTestService = (
  auth: MealPlannerAuth
): MealPlannerAuthService => ({
  ...makeDelegatedAccessBoundary((body) =>
    auth.delegatedAccessEnabled
      ? fromNative(() => auth.api.resolveDelegatedAccess({ body }))
      : Effect.fail({ statusCode: 503 })
  ),
  api: {
    acceptInvitation: (input) =>
      fromNative(() => auth.api.acceptInvitation(input)),
    cancelInvitation: (input) =>
      fromNative(() => auth.api.cancelInvitation(input)),
    createOrganization: (input) =>
      fromNative(() => auth.api.createOrganization(input)),
    getActiveMember: (input) =>
      fromNative(() => auth.api.getActiveMember(input)),
    getActiveMemberRole: (input) =>
      fromNative(() => auth.api.getActiveMemberRole(input)),
    getSession: (input) =>
      DelegatedAccess.pipe(
        Effect.flatMap((grant) =>
          grant === undefined
            ? fromNative(() => auth.api.getSession(input))
            : fromNative(() =>
                auth.api.resolveDelegatedAccess({ body: grant })
              ).pipe(
                Effect.map((current) => ({
                  session: current.session,
                  user: current.user,
                }))
              )
        )
      ),
    getSetupInvitation: (input) =>
      fromNative(() => auth.api.getSetupInvitation(input)),
    leaveOrganization: (input) =>
      fromNative(() => auth.api.leaveOrganization(input)),
    rejectInvitation: (input) =>
      fromNative(() => auth.api.rejectInvitation(input)),
    removeMember: (input) => fromNative(() => auth.api.removeMember(input)),
  },
  createHouseholdInvitation: (request) =>
    fromNative(() => auth.createHouseholdInvitation(request)),
  delegatedAccessEnabled: auth.delegatedAccessEnabled,
  fetchHttpEffect: (request) =>
    Effect.promise(() => auth.fetch(request)).pipe(
      Effect.map(HttpServerResponse.fromWeb)
    ),
});
