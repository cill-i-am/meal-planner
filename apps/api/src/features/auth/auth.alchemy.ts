import {
  BetterAuth,
  BetterAuthApiError,
  Database,
  isAPIErrorLike,
} from "@alchemy.run/better-auth";
import type { BetterAuthInstance } from "@alchemy.run/better-auth";
import type { RuntimeContext } from "alchemy";
import { Effect, Redacted, Scope } from "effect";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

import {
  fetchGuardedMealPlannerAuth,
  makeMealPlannerAuthConfiguration,
} from "./auth.js";
import type {
  HouseholdInvitationRequest,
  MealPlannerAuth,
  MealPlannerAuthConfiguration,
  MealPlannerAuthOptions,
} from "./auth.js";
import {
  DelegatedAccess,
  makeDelegatedAccessBoundary,
  runWithNativeDelegation,
} from "./delegated-access.js";
import type { DelegatedAccessBoundary } from "./delegated-access.js";

type AuthProps = Omit<MealPlannerAuthConfiguration, "database" | "secret"> & {
  readonly migrate: false;
  readonly secret: Redacted.Redacted<string>;
};
type AlchemyAuth = BetterAuthInstance<AuthProps>;
type AuthOperation =
  | "acceptInvitation"
  | "rejectInvitation"
  | "getSetupInvitation"
  | "cancelInvitation"
  | "createOrganization"
  | "getSession"
  | "getActiveMember"
  | "getActiveMemberRole"
  | "leaveOrganization"
  | "removeMember";
type BoundAuthApi = {
  readonly [K in AuthOperation]: AlchemyAuth["api"][K] extends (
    ...args: infer Args
  ) => Effect.Effect<infer A, infer E, RuntimeContext>
    ? (...args: Args) => Effect.Effect<A, E>
    : never;
};

/** Only the application operations needed outside the native HTTP auth routes. */
export interface MealPlannerAuthService extends DelegatedAccessBoundary {
  readonly delegatedAccessEnabled: boolean;
  readonly api: BoundAuthApi;
  readonly createHouseholdInvitation: (
    request: HouseholdInvitationRequest
  ) => Effect.Effect<
    Awaited<ReturnType<MealPlannerAuth["api"]["createInvitation"]>>,
    BetterAuthApiError
  >;
  readonly fetchHttpEffect: (
    request: Request
  ) => Effect.Effect<HttpServerResponse.HttpServerResponse>;
}

type AlchemyMealPlannerAuthOptions = Omit<
  MealPlannerAuthOptions,
  "secret" | "sendPasswordResetEmail"
> &
  Required<Pick<MealPlannerAuthOptions, "sendPasswordResetEmail">> & {
    readonly secret: Redacted.Redacted<string>;
  };

/** Construct Alchemy's auth instance with the canonical Better Auth configuration. */
export const makeAlchemyMealPlannerAuth = (
  options: AlchemyMealPlannerAuthOptions
) =>
  Effect.gen(function* makeAlchemyAuth() {
    // This service and Alchemy's per-execution auth memo share the request scope.
    yield* Scope.Scope;
    const security = makeMealPlannerAuthConfiguration({
      ...options,
      secret: Redacted.value(options.secret),
    });
    const {
      database,
      secret: _secret,
      ...configuration
    } = security.configuration;
    const context = yield* Effect.context<RuntimeContext>();
    const auth = yield* BetterAuth({
      ...configuration,
      migrate: false,
      secret: options.secret,
    }).pipe(
      Effect.provideService(Database, {
        provider: "sqlite",
        // Existing relations-v2 adapter and output fence remain authoritative.
        // Drizzle Kit owns schema changes for this D1 database.
        runtime: Effect.succeed(database),
      })
    );
    const provideRuntime = <A, E>(
      effect: Effect.Effect<A, E, RuntimeContext>
    ): Effect.Effect<A, E> => Effect.provideContext(effect, context);
    const callNative = <A>(
      operation: (native: MealPlannerAuth) => Promise<A>
    ) =>
      Effect.gen(function* invokeNativeAuth() {
        const native = yield* provideRuntime(auth.auth);
        const grant = yield* DelegatedAccess;
        return yield* Effect.tryPromise({
          catch: (error) => {
            if (isAPIErrorLike(error)) {
              return BetterAuthApiError.fromAPIError(error);
            }
            throw error;
          },
          try: () =>
            runWithNativeDelegation(grant, () =>
              operation({
                ...native,
                createHouseholdInvitation: ({ invitationId, ...request }) =>
                  security.invitationIdentity.run(invitationId, () =>
                    native.api.createInvitation(request)
                  ),
                delegatedAccessEnabled: security.delegatedAccessEnabled,
              })
            ),
        });
      });

    const service: MealPlannerAuthService = {
      ...makeDelegatedAccessBoundary((body) =>
        security.delegatedAccessEnabled
          ? callNative((native) => native.api.resolveDelegatedAccess({ body }))
          : Effect.fail({ statusCode: 503 })
      ),
      api: {
        acceptInvitation: (input) =>
          callNative((native) => native.api.acceptInvitation(input)),
        cancelInvitation: (input) =>
          callNative((native) => native.api.cancelInvitation(input)),
        createOrganization: (input) =>
          callNative((native) => native.api.createOrganization(input)),
        getActiveMember: (input) =>
          callNative((native) => native.api.getActiveMember(input)),
        getActiveMemberRole: (input) =>
          callNative((native) => native.api.getActiveMemberRole(input)),
        getSession: (input) =>
          DelegatedAccess.pipe(
            Effect.flatMap((grant) =>
              grant === undefined
                ? provideRuntime(auth.api.getSession(input))
                : callNative((native) =>
                    native.api.resolveDelegatedAccess({ body: grant })
                  ).pipe(
                    Effect.map((current) => ({
                      session: current.session,
                      user: current.user,
                    }))
                  )
            )
          ),
        getSetupInvitation: (input) =>
          callNative((native) => native.api.getSetupInvitation(input)),
        leaveOrganization: (input) =>
          callNative((native) => native.api.leaveOrganization(input)),
        rejectInvitation: (input) =>
          callNative((native) => native.api.rejectInvitation(input)),
        removeMember: (input) =>
          callNative((native) => native.api.removeMember(input)),
      },
      createHouseholdInvitation: (input) =>
        callNative((native) => native.createHouseholdInvitation(input)),
      delegatedAccessEnabled: security.delegatedAccessEnabled,
      fetchHttpEffect: (request) =>
        provideRuntime(
          Effect.gen(function* fetchGuardedAuthHttp() {
            const native = yield* auth.auth;
            // The guard must execute the native handler's Promise inside its
            // ALS frame; deferring an Effect beyond the frame loses fence errors.
            const response = yield* Effect.promise(() =>
              fetchGuardedMealPlannerAuth(native, security, request)
            );
            return HttpServerResponse.fromWeb(response);
          })
        ),
    };
    return service;
  });
