import {
  BetterAuth,
  BetterAuthApiError,
  Database,
  isAPIErrorLike,
} from "@alchemy.run/better-auth";
import type { BetterAuthInstance } from "@alchemy.run/better-auth";
import type { RuntimeContext } from "alchemy";
import { Effect, Redacted, Scope } from "effect";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

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

type AuthProps = Omit<MealPlannerAuthConfiguration, "database" | "secret"> & {
  readonly migrate: false;
  readonly secret: Redacted.Redacted<string>;
};
type AlchemyAuth = BetterAuthInstance<AuthProps>;
type AuthOperation =
  | "getSession"
  | "getActiveMember"
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
export interface MealPlannerAuthService {
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

export type AlchemyMealPlannerAuthOptions = Omit<
  MealPlannerAuthOptions,
  "secret"
> & { readonly secret: Redacted.Redacted<string> };

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

    const service: MealPlannerAuthService = {
      api: {
        getActiveMember: (input) =>
          provideRuntime(auth.api.getActiveMember(input)),
        getSession: (input) => provideRuntime(auth.api.getSession(input)),
        leaveOrganization: (input) =>
          provideRuntime(auth.api.leaveOrganization(input)),
        removeMember: (input) => provideRuntime(auth.api.removeMember(input)),
      },
      createHouseholdInvitation: ({ invitationId, ...request }) =>
        provideRuntime(
          Effect.gen(function* createHouseholdInvitation() {
            const native = yield* auth.auth;
            return yield* Effect.matchEffect(
              Effect.tryPromise({
                catch: (error) => error,
                try: () =>
                  security.invitationIdentity.run(invitationId, () =>
                    native.api.createInvitation(request)
                  ),
              }),
              {
                onFailure: (error) =>
                  isAPIErrorLike(error)
                    ? Effect.fail(BetterAuthApiError.fromAPIError(error))
                    : Effect.die(error),
                onSuccess: Effect.succeed,
              }
            );
          })
        ),
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
