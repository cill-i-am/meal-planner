import {
  RecipeImportActorId,
  RecipeImportHouseholdScopeId,
  RecipeImportPrincipal,
} from "@meal-planner/recipe-import-api";
import { isAPIError } from "better-auth/api";
import { Context, Effect, Schema } from "effect";

import type { MealPlannerAuth } from "./auth.js";
import { AuthPrincipalResolutionError } from "./auth.principal.error.js";

export { AuthPrincipalResolutionError } from "./auth.principal.error.js";

export interface AuthPrincipalResolverShape {
  readonly resolve: (
    headers: Headers
  ) => Effect.Effect<
    typeof RecipeImportPrincipal.Type,
    AuthPrincipalResolutionError
  >;
}

export class AuthPrincipalResolver extends Context.Service<
  AuthPrincipalResolver,
  AuthPrincipalResolverShape
>()("meal-planner/AuthPrincipalResolver") {}

const sha256 = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
};

/** Resolve a domain principal through Better Auth's session and organization APIs. */
export const resolveAuthPrincipal = (options: {
  readonly auth: MealPlannerAuth;
  readonly headers: Headers;
}) =>
  Effect.tryPromise({
    catch: (error) =>
      error instanceof AuthPrincipalResolutionError
        ? error
        : new AuthPrincipalResolutionError({ reason: "invalid_session" }),
    try: async () => {
      const authSession = await options.auth.api.getSession({
        headers: options.headers,
      });
      if (authSession === null) {
        throw new AuthPrincipalResolutionError({
          reason: "invalid_session",
        });
      }
      const organizationId = authSession.session.activeOrganizationId;
      if (organizationId === null || organizationId === undefined) {
        throw new AuthPrincipalResolutionError({
          reason: "missing_active_household",
        });
      }
      const membership = await options.auth.api
        .getActiveMember({ headers: options.headers })
        .catch((error: unknown) => {
          if (isAPIError(error) && error.body?.code === "MEMBER_NOT_FOUND") {
            throw new AuthPrincipalResolutionError({
              reason: "missing_membership",
            });
          }
          throw error;
        });
      if (
        membership.organizationId !== organizationId ||
        membership.userId !== authSession.user.id
      ) {
        throw new AuthPrincipalResolutionError({
          reason: "missing_membership",
        });
      }
      return Schema.decodeUnknownSync(RecipeImportPrincipal)({
        actorId: Schema.decodeUnknownSync(RecipeImportActorId)(
          await sha256(authSession.user.id)
        ),
        householdScopeId: Schema.decodeUnknownSync(
          RecipeImportHouseholdScopeId
        )(await sha256(organizationId)),
      });
    },
  });

export const makeAuthPrincipalResolver = (options: {
  readonly auth: MealPlannerAuth;
}): AuthPrincipalResolverShape => ({
  resolve: (headers) => resolveAuthPrincipal({ headers, ...options }),
});
