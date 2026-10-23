import { AsyncLocalStorage } from "node:async_hooks";

import { getOAuthProviderApi } from "@better-auth/oauth-provider";
import type { OAuthOptions } from "@better-auth/oauth-provider";
import { HouseholdOrganizationId, UserId } from "@meal-planner/household-api";
import type { BetterAuthPlugin } from "better-auth";
import {
  APIError,
  createAuthEndpoint,
  createAuthMiddleware,
} from "better-auth/api";
import { Context, Data, Effect, Option, Schema } from "effect";

import {
  OAuthLifecycleRequest,
  resolveOAuthLifecycleAccount,
} from "./oauth-lifecycle.js";

export const delegatedScopes = [
  "meal-planner:read",
  "meal-planner:write",
  "meal-planner:account",
  "meal-planner:assistant",
  "meal-planner:private",
] as const;

/** Native provider owns all code, PKCE, refresh, token and consent persistence. */
export const mealPlannerOAuthOptions = (
  baseURL: string,
  enabled = true
): OAuthOptions<string[]> => ({
  accessTokenExpiresIn: 15 * 60,
  allowClientKeyRotation: false,
  allowDynamicClientRegistration: enabled,
  allowPublicClientPrelogin: enabled,
  allowUnauthenticatedClientRegistration: enabled,
  // Registration and owner inspection are public product capabilities. Client
  // mutations can revoke many accounts through cascades, so keep that provider
  // control plane disabled until it has an all-account output fence.
  clientPrivileges: ({ action }) =>
    action === "create" || action === "read" || action === "list",
  clientRegistrationDefaultApplicationType: "infer",
  clientRegistrationDefaultResources: enabled
    ? [`${baseURL}/v1`, `${baseURL}/mcp`]
    : [],
  clientRegistrationDefaultScopes: [...delegatedScopes, "offline_access"],
  clientRegistrationRequirePKCE: true,
  consentPage: "/oauth/consent",
  disableJwtPlugin: true,
  grantTypes: ["authorization_code", "refresh_token"],
  loginPage: "/login",
  resourcePrivileges: () => false,
  resources: enabled ? [`${baseURL}/v1`, `${baseURL}/mcp`] : [],
  scopes: [...delegatedScopes, "offline_access"],
});

const StoredSession = Schema.Struct({
  activeOrganizationId: Schema.optional(Schema.NullOr(HouseholdOrganizationId)),
  createdAt: Schema.Date,
  expiresAt: Schema.Date,
  id: Schema.String,
  ipAddress: Schema.optional(Schema.NullOr(Schema.String)),
  token: Schema.String,
  updatedAt: Schema.Date,
  userAgent: Schema.optional(Schema.NullOr(Schema.String)),
  userId: UserId,
});
const StoredUser = Schema.Struct({
  createdAt: Schema.Date,
  email: Schema.String,
  emailVerified: Schema.Boolean,
  id: UserId,
  image: Schema.optional(Schema.NullOr(Schema.String)),
  name: Schema.String,
  updatedAt: Schema.Date,
});
const StoredConsent = Schema.Struct({
  resources: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
  scopes: Schema.Array(Schema.String),
});
const DelegatedGrant = Schema.Struct({
  clientId: Schema.String,
  expiresAt: Schema.Date,
  organizationId: Schema.optional(HouseholdOrganizationId),
  requiredScopes: Schema.Array(Schema.String),
  resource: Schema.String,
  scopes: Schema.Array(Schema.String),
  session: StoredSession,
  token: Schema.String,
  user: StoredUser,
});
export type DelegatedGrant = typeof DelegatedGrant.Type;

/** This capability exists only in a server Effect context, never in request headers. */
export const DelegatedAccess = Context.Reference<DelegatedGrant | undefined>(
  "meal-planner/DelegatedAccess",
  {
    // eslint-disable-next-line unicorn/no-useless-undefined -- Absence is the native browser authority, not a delegated grant.
    defaultValue: () => undefined,
  }
);

// Better Auth owns a Promise callback boundary. The service restores only the
// verified grant while invoking a native API; simultaneous callers stay isolated.
const nativeDelegation = new AsyncLocalStorage<DelegatedGrant>();
export const currentNativeDelegation = () => nativeDelegation.getStore();
export const runWithNativeDelegation = <A>(
  grant: DelegatedGrant | undefined,
  operation: () => Promise<A>
) =>
  grant === undefined ? operation() : nativeDelegation.run(grant, operation);

const delegatedNativePaths = new Set([
  "/organization/accept-invitation",
  "/organization/reject-invitation",
  "/organization/cancel-invitation",
  "/organization/create",
  "/organization/get-active-member",
  "/organization/get-active-member-role",
  "/organization/leave",
  "/organization/remove-member",
  "/organization/invite-member",
]);
const invalidToken = () =>
  new APIError("UNAUTHORIZED", {
    error: "invalid_token",
    message: "Reconnect Meal Planner to continue.",
  });
const parseSession = Schema.decodeUnknownSync(StoredSession);
const parseUser = Schema.decodeUnknownSync(StoredUser);

const DelegatedRequest = Schema.Struct({
  organizationId: Schema.optional(HouseholdOrganizationId),
  requiredScopes: Schema.Array(Schema.String),
  resource: Schema.String,
  token: Schema.String,
});
const AccessTokenClaims = Schema.Struct({
  aud: Schema.Union([Schema.String, Schema.Array(Schema.String)]),
  client_id: Schema.String,
  cnf: Schema.optional(Schema.Undefined),
  exp: Schema.Number,
  iss: Schema.String,
  scope: Schema.String,
  sid: Schema.String,
  sub: UserId,
});
const resolveOAuthGrant = async (
  ctx: Parameters<typeof getOAuthProviderApi>[0],
  options: OAuthOptions<string[]>,
  body: typeof DelegatedRequest.Type
): Promise<DelegatedGrant> => {
  const parsed = Schema.decodeUnknownOption(AccessTokenClaims)(
    await getOAuthProviderApi(ctx, options).requireActiveAccessToken(body.token)
  );
  if (Option.isNone(parsed)) {
    throw invalidToken();
  }
  const payload = parsed.value;
  const audience = Schema.is(Schema.String)(payload.aud)
    ? [payload.aud]
    : payload.aud;
  if (
    !audience.includes(body.resource) ||
    payload.iss !== ctx.context.baseURL ||
    payload.exp * 1000 <= Date.now()
  ) {
    throw invalidToken();
  }
  const scopes = payload.scope.split(" ");
  if (!body.requiredScopes.every((scope) => scopes.includes(scope))) {
    throw new APIError("FORBIDDEN", {
      error: "insufficient_scope",
      message: "This connection has not been granted the required access.",
    });
  }
  // Native consent deletion stops future authorization prompts but does not
  // itself delete issued access tokens. Require the current grant as well.
  const consents = Schema.decodeUnknownSync(Schema.Array(StoredConsent))(
    await ctx.context.adapter.findMany({
      model: "oauthConsent",
      where: [
        { field: "clientId", value: payload["client_id"] },
        { field: "userId", value: payload.sub },
      ],
    })
  );
  if (
    !consents.some(
      (consent) =>
        consent.resources?.includes(body.resource) &&
        body.requiredScopes.every((scope) => consent.scopes.includes(scope))
    )
  ) {
    throw invalidToken();
  }
  const [rawSession, rawUser] = await Promise.all([
    ctx.context.adapter.findOne({
      model: "session",
      where: [{ field: "id", value: payload["sid"] }],
    }),
    ctx.context.internalAdapter.findUserById(payload.sub),
  ]);
  if (rawSession === null || rawUser === null) {
    throw invalidToken();
  }
  const session = parseSession(rawSession);
  const user = parseUser(rawUser);
  if (
    session.userId !== user.id ||
    user.id !== payload.sub ||
    session.expiresAt.getTime() <= Date.now()
  ) {
    throw invalidToken();
  }
  const grant: DelegatedGrant = {
    clientId: payload["client_id"],
    expiresAt: new Date(
      Math.min(payload.exp * 1000, session.expiresAt.getTime())
    ),
    organizationId: body.organizationId,
    requiredScopes: body.requiredScopes,
    resource: body.resource,
    scopes,
    session: {
      ...session,
      activeOrganizationId: body.organizationId ?? null,
      expiresAt: new Date(
        Math.min(payload.exp * 1000, session.expiresAt.getTime())
      ),
    },
    token: body.token,
    user,
  };
  return grant;
};

/** A server-only bridge validates the provider token before the application receives authority. */
export const delegatedAccessPlugin = (options: OAuthOptions<string[]>) =>
  ({
    endpoints: {
      resolveDelegatedAccess: createAuthEndpoint.serverOnly(
        {
          body: Schema.toStandardSchemaV1(DelegatedRequest),
          method: "POST",
        },
        (ctx) => resolveOAuthGrant(ctx, options, ctx.body)
      ),
      resolveOAuthLifecycleAccount: createAuthEndpoint.serverOnly(
        {
          body: Schema.toStandardSchemaV1(OAuthLifecycleRequest),
          method: "POST",
        },
        (ctx) => resolveOAuthLifecycleAccount(ctx, options, ctx.body)
      ),
    },
    hooks: {
      before: [
        {
          handler: createAuthMiddleware(async (ctx) => {
            const grant = nativeDelegation.getStore();
            if (
              grant === undefined ||
              ctx.request !== undefined ||
              grant.expiresAt.getTime() <= Date.now()
            ) {
              throw invalidToken();
            }
            const current = await resolveOAuthGrant(ctx, options, grant);
            return {
              context: {
                context: {
                  session: { session: current.session, user: current.user },
                },
              },
            };
          }),
          matcher: (ctx) =>
            nativeDelegation.getStore() !== undefined &&
            ctx.path !== undefined &&
            (delegatedNativePaths.has(ctx.path) ||
              ctx.path.startsWith("/setup/invitation/")),
        },
      ],
    },
    id: "meal-planner-delegated-access",
  }) satisfies BetterAuthPlugin;

export class DelegatedAccessFailure extends Data.TaggedError(
  "DelegatedAccessFailure"
)<{
  readonly statusCode: 401 | 403 | 503;
  readonly reason: "invalid_token" | "insufficient_scope" | "unavailable";
  readonly resource: string;
  readonly requiredScopes: readonly string[];
}> {}

export const delegatedAccessFailure = (
  resource: string,
  requiredScopes: readonly string[],
  error: { readonly statusCode: number }
) => {
  if (error.statusCode === 403) {
    return new DelegatedAccessFailure({
      reason: "insufficient_scope",
      requiredScopes,
      resource,
      statusCode: 403,
    });
  }
  if (error.statusCode === 401 || error.statusCode === 400) {
    return new DelegatedAccessFailure({
      reason: "invalid_token",
      requiredScopes,
      resource,
      statusCode: 401,
    });
  }
  return new DelegatedAccessFailure({
    reason: "unavailable",
    requiredScopes,
    resource,
    statusCode: 503,
  });
};

export const delegatedRequestInput = (
  request: Request,
  resource: string,
  requiredScopes: readonly string[]
) =>
  Effect.gen(function* delegatedRequest() {
    const authorization = request.headers.get("authorization");
    const token = authorization?.match(/^Bearer (?<token>[^\s]+)$/iu)?.groups?.[
      "token"
    ];
    if (token === undefined) {
      return yield* Effect.fail(
        delegatedAccessFailure(resource, requiredScopes, { statusCode: 401 })
      );
    }
    const household = request.headers.get("x-meal-planner-household");
    const organizationId =
      household === null
        ? undefined
        : yield* Schema.decodeUnknownEffect(HouseholdOrganizationId)(
            household
          ).pipe(
            Effect.mapError(() =>
              delegatedAccessFailure(resource, requiredScopes, {
                statusCode: 403,
              })
            )
          );
    return {
      organizationId,
      requiredScopes,
      resource,
      token,
    };
  });

export interface DelegatedAccessBoundary {
  readonly withDelegatedAccess: <A, E, R>(
    request: Request,
    resource: string,
    requiredScopes: readonly string[],
    operation: Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E | DelegatedAccessFailure, R>;
}

export const makeDelegatedAccessBoundary = (
  resolve: (body: {
    readonly token: string;
    readonly resource: string;
    readonly requiredScopes: readonly string[];
    readonly organizationId?: HouseholdOrganizationId | undefined;
  }) => Effect.Effect<DelegatedGrant, { readonly statusCode: number }>
): DelegatedAccessBoundary => ({
  withDelegatedAccess: (request, resource, requiredScopes, operation) =>
    Effect.gen(function* authorizeDelegatedOperation() {
      const body = yield* delegatedRequestInput(
        request,
        resource,
        requiredScopes
      );
      const grant = yield* resolve(body).pipe(
        Effect.mapError((error) =>
          delegatedAccessFailure(resource, requiredScopes, error)
        ),
        Effect.catchDefect(() =>
          Effect.fail(
            delegatedAccessFailure(resource, requiredScopes, {
              statusCode: 503,
            })
          )
        )
      );
      const expectedUser = request.headers.get("x-meal-planner-user");
      if (expectedUser !== null && expectedUser !== grant.user.id) {
        return yield* Effect.fail(
          delegatedAccessFailure(resource, requiredScopes, { statusCode: 401 })
        );
      }
      return yield* operation.pipe(
        Effect.provideService(DelegatedAccess, grant)
      );
    }),
});

export const protectedResourceMetadata = (
  baseURL: string,
  resource: string
) => ({
  authorization_servers: [`${baseURL}/api/auth`],
  bearer_methods_supported: ["header"],
  resource,
  resource_name: "Meal Planner",
  scopes_supported: [...delegatedScopes],
});

/** Resource-specific discovery survives separate HTTP and MCP token audiences. */
export const delegatedAccessChallenge = (failure: DelegatedAccessFailure) => {
  const resource = new URL(failure.resource);
  const metadata = `${resource.origin}/.well-known/oauth-protected-resource${resource.pathname}`;
  const parts = [`resource_metadata="${metadata}"`];
  if (failure.reason !== "unavailable") {
    parts.push(`error="${failure.reason}"`);
  }
  if (failure.reason === "insufficient_scope") {
    parts.push(`scope="${failure.requiredScopes.join(" ")}"`);
  }
  return `Bearer ${parts.join(", ")}`;
};
