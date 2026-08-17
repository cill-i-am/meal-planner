import {
  RecipeImportActorId,
  RecipeImportHouseholdScopeId,
  RecipeImportPrincipal,
} from "@meal-planner/recipe-import-api";
import { and, eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { Context, Effect, Schema } from "effect";

import { member } from "./auth.database-schema.js";
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

/** Resolve a domain principal from the authoritative Better Auth session and membership row. */
export const resolveAuthPrincipal = (options: {
  readonly auth: MealPlannerAuth;
  readonly database: DrizzleD1Database;
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
      const [membership] = await options.database
        .select({ id: member.id })
        .from(member)
        .where(
          and(
            eq(member.organizationId, organizationId),
            eq(member.userId, authSession.user.id)
          )
        )
        .limit(1);
      if (membership === undefined) {
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
  readonly database: DrizzleD1Database;
}): AuthPrincipalResolverShape => ({
  resolve: (headers) => resolveAuthPrincipal({ headers, ...options }),
});
