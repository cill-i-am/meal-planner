import { HouseholdOrganizationId } from "@meal-planner/household-api";
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

export interface AuthPrincipalResolver {
  readonly resolve: (
    headers: Headers
  ) => Effect.Effect<
    typeof RecipeImportPrincipal.Type,
    AuthPrincipalResolutionError
  >;
}

export interface AuthenticatedOrganizationResolver {
  readonly resolve: (
    headers: Headers
  ) => Effect.Effect<AuthenticatedOrganization, AuthPrincipalResolutionError>;
}

export const AuthenticatedOrganizationResolver =
  Context.Service<AuthenticatedOrganizationResolver>(
    "meal-planner/AuthenticatedOrganizationResolver"
  );

export const AuthPrincipalResolver = Context.Service<AuthPrincipalResolver>(
  "meal-planner/AuthPrincipalResolver"
);

const sha256 = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
};

const AuthenticatedOrganization = Schema.Struct({
  membershipRole: Schema.String.pipe(
    Schema.check(Schema.isTrimmed(), Schema.isNonEmpty())
  ),
  organizationId: HouseholdOrganizationId,
  userId: Schema.String.pipe(
    Schema.check(Schema.isTrimmed(), Schema.isNonEmpty())
  ),
});
export type AuthenticatedOrganization = typeof AuthenticatedOrganization.Type;

/** Admit the active organization only after Better Auth proves membership. */
export const resolveAuthenticatedOrganization = (options: {
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
      let membership: Awaited<
        ReturnType<typeof options.auth.api.getActiveMember>
      >;
      try {
        membership = await options.auth.api.getActiveMember({
          headers: options.headers,
        });
      } catch (error) {
        if (isAPIError(error) && error.body?.code === "MEMBER_NOT_FOUND") {
          throw new AuthPrincipalResolutionError({
            reason: "missing_membership",
          });
        }
        throw new AuthPrincipalResolutionError({ reason: "invalid_session" });
      }
      if (
        membership.organizationId !== organizationId ||
        membership.userId !== authSession.user.id
      ) {
        throw new AuthPrincipalResolutionError({
          reason: "missing_membership",
        });
      }
      return Schema.decodeUnknownSync(AuthenticatedOrganization)({
        membershipRole: membership.role,
        organizationId,
        userId: authSession.user.id,
      });
    },
  });

/** Resolve the recipe-import principal from the admitted organization. */
export const resolveAuthPrincipal = (options: {
  readonly auth: MealPlannerAuth;
  readonly headers: Headers;
}) =>
  resolveAuthenticatedOrganization(options).pipe(
    Effect.flatMap((principal) =>
      Effect.tryPromise({
        catch: () =>
          new AuthPrincipalResolutionError({ reason: "invalid_session" }),
        try: async () =>
          Schema.decodeUnknownSync(RecipeImportPrincipal)({
            actorId: Schema.decodeUnknownSync(RecipeImportActorId)(
              await sha256(principal.userId)
            ),
            householdScopeId: Schema.decodeUnknownSync(
              RecipeImportHouseholdScopeId
            )(await sha256(principal.organizationId)),
          }),
      })
    )
  );

export const makeAuthPrincipalResolver = (options: {
  readonly auth: MealPlannerAuth;
}): AuthPrincipalResolver => ({
  resolve: (headers) => resolveAuthPrincipal({ headers, ...options }),
});

export const makeAuthenticatedOrganizationResolver = (options: {
  readonly auth: MealPlannerAuth;
}): AuthenticatedOrganizationResolver => ({
  resolve: (headers) =>
    resolveAuthenticatedOrganization({ headers, ...options }),
});
