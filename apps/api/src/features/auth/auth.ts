import { AsyncLocalStorage } from "node:async_hooks";

import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { oauthProvider } from "@better-auth/oauth-provider";
import {
  EmailAddress,
  HouseholdOrganizationId,
  InvitationId,
  UserId,
} from "@meal-planner/household-api";
import type { HouseholdPersonId } from "@meal-planner/household-api";
import { betterAuth } from "better-auth";
import type { Auth, BetterAuthOptions } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import type { OrganizationOptions } from "better-auth/plugins/organization";
import { DrizzleD1Database } from "drizzle-orm/d1";
import { Option, Schema } from "effect";

import {
  privateOutputKey,
  PrivateOutputUnavailable,
} from "../private-output/private-output.contract.js";
import { applicationAccessPlugin } from "./application-access.js";
import {
  atomicOrganization,
  atomicPasswordResetPlugin,
} from "./auth-atomic-endpoints.js";
import {
  makeAuthAtomicStore,
  revokeUnusedOAuthCodes,
} from "./auth-atomic-store.js";
import type { PasswordResetMail } from "./auth-mail.js";
import { fenceAuthAdapter } from "./auth-output-fence.js";
import type { AuthOutputFence } from "./auth-output-fence.js";
import {
  delegatedAccessPlugin,
  mealPlannerOAuthOptions,
} from "./delegated-access.js";
import { invitationViewPlugin } from "./invitation-view.js";
import { oauthLifecyclePaths } from "./oauth-lifecycle.js";

const parseEmailAddress = Schema.decodeUnknownSync(EmailAddress);
const parseOptionalEmailAddress = Schema.decodeUnknownOption(EmailAddress);
const parseInvitationId = Schema.decodeUnknownSync(InvitationId);
const parseOrganizationId = Schema.decodeUnknownSync(HouseholdOrganizationId);
const parseUserId = Schema.decodeUnknownSync(UserId);
const nativeEmailPaths = new Set([
  "/sign-up/email",
  "/sign-in/email",
  "/request-password-reset",
  "/send-verification-email",
  "/organization/invite-member",
]);

const invitationSchema = {
  invitation: {
    additionalFields: {
      householdPersonId: { input: true, required: false, type: "string" },
    },
  },
} as const;

export type MealPlannerAuthConfiguration = Omit<
  BetterAuthOptions,
  "plugins" | "user"
> & {
  plugins: [
    ReturnType<typeof invitationViewPlugin>,
    ReturnType<typeof applicationAccessPlugin>,
    ReturnType<typeof atomicPasswordResetPlugin>,
    ReturnType<typeof atomicOrganization<{ schema: typeof invitationSchema }>>,
    ReturnType<typeof oauthProvider>,
    ReturnType<typeof delegatedAccessPlugin>,
  ];
};
type AuthCore = Auth<MealPlannerAuthConfiguration>;
export interface HouseholdInvitationRequest {
  readonly invitationId: InvitationId;
  readonly headers: Headers;
  readonly body: {
    readonly email: EmailAddress;
    readonly householdPersonId: HouseholdPersonId;
    readonly organizationId: HouseholdOrganizationId;
    readonly role: "member";
  };
}

export type MealPlannerAuth = AuthCore & {
  readonly delegatedAccessEnabled: boolean;
  readonly createHouseholdInvitation: (
    request: HouseholdInvitationRequest
  ) => ReturnType<AuthCore["api"]["createInvitation"]>;
};

export interface MealPlannerAuthOptions {
  readonly delegatedAccessEnabled?: boolean;
  readonly sendPasswordResetEmail?: (mail: PasswordResetMail) => Promise<void>;
  readonly outputFence: AuthOutputFence;
  readonly baseURL: string;
  readonly database: Parameters<typeof drizzleAdapter>[0];
  readonly schema?: Record<string, unknown>;
  readonly secret: string;
  readonly verifyInvitationRecipient?: (input: {
    readonly invitationId: InvitationId;
    readonly organizationId: HouseholdOrganizationId;
    readonly userId: UserId;
  }) => Promise<void>;
}

/** Share one plugin and policy configuration between the CLI and Alchemy runtime. */
export const makeMealPlannerAuthConfiguration = ({
  baseURL,
  delegatedAccessEnabled = true,
  database,
  outputFence,
  schema,
  secret,
  verifyInvitationRecipient,
  sendPasswordResetEmail,
}: MealPlannerAuthOptions) => {
  const adapterOptions =
    schema === undefined
      ? { provider: "sqlite" as const }
      : { provider: "sqlite" as const, schema };
  const failures = new AsyncLocalStorage<{ failure: unknown }>();
  const oauthLifecycleAccount = new AsyncLocalStorage<UserId>();
  const oauthOptions = mealPlannerOAuthOptions(baseURL, delegatedAccessEnabled);
  oauthOptions.postLogin = {
    // Native login and session-cookie hooks can resume OAuth internally. Defer
    // those responses to explicit consent, whose request owns the account claim.
    // eslint-disable-next-line unicorn/no-useless-undefined -- Native undefined retains user/client consent ownership without adding a reference dimension.
    consentReferenceId: () => undefined,
    page: "/oauth/consent",
    shouldRedirect: ({ user }) => oauthLifecycleAccount.getStore() !== user.id,
  };
  const invitationIdentity = new AsyncLocalStorage<InvitationId>();
  const organizationHooks: NonNullable<
    OrganizationOptions["organizationHooks"]
  > = {
    beforeCreateInvitation: () => {
      const id = invitationIdentity.getStore();
      return Promise.resolve(id === undefined ? undefined : { data: { id } });
    },
  };
  if (verifyInvitationRecipient !== undefined) {
    organizationHooks.beforeAcceptInvitation = ({
      invitation,
      organization,
      user,
    }) =>
      verifyInvitationRecipient({
        invitationId: parseInvitationId(invitation.id),
        organizationId: parseOrganizationId(organization.id),
        userId: parseUserId(user.id),
      });
  }
  const guardedFence: AuthOutputFence = async (input, canonical) => {
    try {
      return await outputFence(input, canonical);
    } catch (error) {
      const current = failures.getStore();
      if (current !== undefined) {
        current.failure = error;
      }
      throw error;
    }
  };
  const authDatabase = () => {
    // The CLI inspects this same configuration using SQLite without running endpoints.
    // Production mutations require D1's atomic batch capability.
    if (!(database instanceof DrizzleD1Database)) {
      throw new Error("Authentication mutations require a D1 database.");
    }
    return database;
  };
  const atomicStore = makeAuthAtomicStore(authDatabase, guardedFence);
  const emailAndPassword: NonNullable<BetterAuthOptions["emailAndPassword"]> = {
    enabled: true,
    resetPasswordTokenExpiresIn: 3600,
    revokeSessionsOnPasswordReset: true,
  };
  if (sendPasswordResetEmail !== undefined) {
    emailAndPassword.sendResetPassword = ({ user, url }) =>
      sendPasswordResetEmail({
        email: parseEmailAddress(user.email),
        url,
      });
  }
  const configuration: MealPlannerAuthConfiguration = {
    advanced: {
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
    },
    appName: "Meal Planner",
    baseURL,
    database: (options: BetterAuthOptions) =>
      fenceAuthAdapter(
        drizzleAdapter(database, { ...adapterOptions, transaction: false })(
          options
        ),
        guardedFence,
        (input) => revokeUnusedOAuthCodes(authDatabase(), input)
      ),
    disabledPaths: [
      "/organization/create",
      "/organization/update",
      "/organization/leave",
      "/organization/remove-member",
      "/organization/cancel-invitation",
    ],
    emailAndPassword,
    hooks: {
      before: createAuthMiddleware((ctx): Promise<unknown> => {
        let field: "email" | "newEmail" | undefined;
        if (ctx.path === "/change-email") {
          field = "newEmail";
        } else if (nativeEmailPaths.has(ctx.path)) {
          field = "email";
        }
        if (field === undefined) {
          return Promise.resolve();
        }
        const email = parseOptionalEmailAddress(ctx.body?.[field]);
        if (Option.isNone(email)) {
          throw new APIError("BAD_REQUEST", {
            code: "INVALID_EMAIL",
            message: "Enter a valid email address.",
          });
        }
        return Promise.resolve({
          context: { body: { ...ctx.body, [field]: email.value } },
        });
      }),
    },
    plugins: [
      invitationViewPlugin(),
      applicationAccessPlugin(),
      atomicPasswordResetPlugin(atomicStore),
      atomicOrganization(
        {
          disableOrganizationDeletion: true,
          invitationExpiresIn: 48 * 3600,
          organizationHooks,
          schema: invitationSchema,
        } satisfies OrganizationOptions,
        atomicStore
      ),
      oauthProvider(oauthOptions),
      delegatedAccessPlugin(oauthOptions),
    ],
    rateLimit: { enabled: true, storage: "database" },
    secret,
    trustedOrigins: [baseURL],
  };
  return {
    configuration,
    delegatedAccessEnabled,
    guard: <A>(operation: () => Promise<A>): Promise<A> =>
      failures.run({ failure: undefined }, async () => {
        const result = await operation();
        const failure = failures.getStore()?.failure;
        if (failure !== undefined) {
          throw failure;
        }
        return result;
      }),
    invitationIdentity,
    oauthLifecycle: ((input, canonical) =>
      guardedFence(input, () =>
        oauthLifecycleAccount.run(input.accountId, canonical)
      )) satisfies AuthOutputFence,
  };
};

type MealPlannerAuthSecurity = ReturnType<
  typeof makeMealPlannerAuthConfiguration
>;

/** A native HTTP request must complete inside its ALS fence before returning a response. */
export const fetchGuardedMealPlannerAuth = async (
  auth: AuthCore,
  security: MealPlannerAuthSecurity,
  request: Request
): Promise<Response> => {
  try {
    const { pathname } = new URL(request.url);
    if (
      !security.delegatedAccessEnabled &&
      (pathname.includes("/.well-known/") ||
        pathname.startsWith("/api/auth/oauth2/"))
    ) {
      return Response.json(
        {
          error: "temporarily_unavailable",
          message:
            "OAuth requires a configured public origin for this deployment.",
        },
        { status: 503 }
      );
    }
    const expectedUserId = request.headers.get("x-meal-planner-user");
    if (expectedUserId !== null) {
      const session = await auth.api.getSession({ headers: request.headers });
      if (session?.user.id !== expectedUserId) {
        return Response.json(
          {
            code: "ACCOUNT_CHANGED",
            message: "Your account changed. Reload to continue.",
          },
          { status: 401 }
        );
      }
    }
    const path = pathname.slice("/api/auth".length);
    const execute = () => security.guard(() => auth.fetch(request));
    if (!oauthLifecyclePaths.has(path)) {
      return await execute();
    }
    let parameters: Record<string, string> = {};
    if (path === "/oauth2/token" || path === "/oauth2/revoke") {
      const contentType = (
        request.headers.get("content-type") ?? ""
      ).toLowerCase();
      if (contentType.startsWith("application/x-www-form-urlencoded")) {
        parameters = Object.fromEntries(
          new URLSearchParams(await request.clone().text())
        );
      } else if (contentType.startsWith("application/json")) {
        const input = Schema.decodeUnknownSync(
          Schema.Record(Schema.String, Schema.Unknown)
        )(await request.clone().json());
        parameters = Object.fromEntries(
          Object.entries(input).filter((entry): entry is [string, string] =>
            Schema.is(Schema.String)(entry[1])
          )
        );
      } else {
        return Response.json({ error: "invalid_request" }, { status: 400 });
      }
    }
    const accountId = await auth.api.resolveOAuthLifecycleAccount({
      body: { parameters, path },
      headers: request.headers,
    });
    if (accountId === null) {
      return await execute();
    }
    // One durable account intent spans native consume/CAS, token creation and
    // response. Concurrent refresh/disconnect cannot cross that native gap.
    return await security.oauthLifecycle(
      {
        accountId,
        intentKey: await privateOutputKey("oauth-lifecycle", accountId),
      },
      async () => {
        const response = await execute();
        if (response.status >= 500) {
          // Preserve the unresolved claim: a failed database response can have
          // committed, so allowing another grant mutation would be unsafe.
          throw new PrivateOutputUnavailable({ reason: "mutation_pending" });
        }
        return response;
      }
    );
  } catch (error) {
    if (error instanceof APIError && error.statusCode < 500) {
      return Response.json(error.body, {
        headers: { "cache-control": "no-store" },
        status: error.statusCode,
      });
    }
    return new Response(null, { status: 503 });
  }
};

/** Preserve the native Better Auth control plane for CLI schema generation and tests. */
export const makeMealPlannerAuth = (
  options: MealPlannerAuthOptions
): MealPlannerAuth => {
  const security = makeMealPlannerAuthConfiguration(options);
  const { configuration, guard, invitationIdentity } = security;
  const auth = betterAuth<MealPlannerAuthConfiguration>(configuration);
  const fetch = (request: Request) =>
    fetchGuardedMealPlannerAuth(auth, security, request);
  const guarded: typeof auth = {
    ...auth,
    api: {
      ...auth.api,
      // Better Auth catches sign-out deletion errors; never report successful revocation after a failed fence.
      signOut: new Proxy(auth.api.signOut, {
        apply: (
          target,
          _receiver,
          argumentsList: Parameters<typeof auth.api.signOut>
        ) => guard(() => target(...argumentsList)),
      }),
    },
    fetch,
    handler: fetch,
  };
  return {
    ...guarded,
    // Only the server's retained household command may choose an invitation ID.
    // The native organization hook supplies it without redefining the core schema field.
    createHouseholdInvitation: ({
      invitationId,
      ...request
    }: HouseholdInvitationRequest) =>
      invitationIdentity.run(invitationId, () =>
        auth.api.createInvitation(request)
      ),
    delegatedAccessEnabled: security.delegatedAccessEnabled,
  };
};
