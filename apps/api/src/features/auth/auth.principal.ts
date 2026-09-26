import { HouseholdOrganizationId, UserId } from "@meal-planner/household-api";
import {
  RecipeImportActorId,
  RecipeImportHouseholdScopeId,
  RecipeImportPrincipal,
} from "@meal-planner/recipe-import-api";
import { Context, Effect, Schema } from "effect";

import type { MealPlannerAuthService } from "./auth.alchemy.js";
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
  userId: UserId,
});
export type AuthenticatedOrganization = typeof AuthenticatedOrganization.Type;

/** Admit the active organization only after Better Auth proves membership. */
export const resolveAuthenticatedOrganization = (options: {
  readonly auth: MealPlannerAuthService;
  readonly headers: Headers;
}) =>
  Effect.gen(function* resolveOrganization() {
    const authSession = yield* options.auth.api.getSession({
      headers: options.headers,
    });
    if (authSession === null) {
      return yield* Effect.fail(
        new AuthPrincipalResolutionError({ reason: "invalid_session" })
      );
    }
    const expectedUser = options.headers.get("x-meal-planner-user");
    const expectedOrganization = options.headers.get(
      "x-meal-planner-household"
    );
    const organizationId = authSession.session.activeOrganizationId;
    if (
      (expectedUser !== null && expectedUser !== authSession.user.id) ||
      (expectedOrganization !== null && expectedOrganization !== organizationId)
    ) {
      return yield* Effect.fail(
        new AuthPrincipalResolutionError({ reason: "invalid_session" })
      );
    }
    if (organizationId === null || organizationId === undefined) {
      return yield* Effect.fail(
        new AuthPrincipalResolutionError({ reason: "missing_active_household" })
      );
    }
    const membership = yield* options.auth.api
      .getActiveMember({
        headers: options.headers,
      })
      .pipe(
        Effect.mapError(
          (error) =>
            new AuthPrincipalResolutionError({
              reason:
                error.body?.code === "MEMBER_NOT_FOUND"
                  ? "missing_membership"
                  : "invalid_session",
            })
        )
      );
    if (
      membership.organizationId !== organizationId ||
      membership.userId !== authSession.user.id
    ) {
      return yield* Effect.fail(
        new AuthPrincipalResolutionError({ reason: "missing_membership" })
      );
    }
    return yield* Schema.decodeUnknownEffect(AuthenticatedOrganization)({
      membershipRole: membership.role,
      organizationId,
      userId: authSession.user.id,
    });
  }).pipe(
    Effect.mapError((error) =>
      error instanceof AuthPrincipalResolutionError
        ? error
        : new AuthPrincipalResolutionError({ reason: "invalid_session" })
    ),
    // Alchemy exposes non-APIError provider failures as defects. Fail closed at admission.
    Effect.catchDefect(() =>
      Effect.fail(
        new AuthPrincipalResolutionError({ reason: "invalid_session" })
      )
    )
  );

/** Resolve the recipe-import principal from the admitted organization. */
export const resolveAuthPrincipal = (options: {
  readonly auth: MealPlannerAuthService;
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
  readonly auth: MealPlannerAuthService;
}): AuthPrincipalResolver => ({
  resolve: (headers) => resolveAuthPrincipal({ headers, ...options }),
});

export const makeAuthenticatedOrganizationResolver = (options: {
  readonly auth: MealPlannerAuthService;
}): AuthenticatedOrganizationResolver => ({
  resolve: (headers) =>
    resolveAuthenticatedOrganization({ headers, ...options }),
});
