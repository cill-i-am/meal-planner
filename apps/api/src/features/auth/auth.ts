import { AsyncLocalStorage } from "node:async_hooks";

import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import {
  EmailAddress,
  HouseholdOrganizationId,
  InvitationId,
  setupProgressField,
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
  atomicOrganization,
  atomicPasswordResetPlugin,
} from "./auth-atomic-endpoints.js";
import { makeAuthAtomicStore } from "./auth-atomic-store.js";
import { mockInvitationMail, mockPasswordResetMail } from "./auth-mail.js";
import type { InvitationMail, PasswordResetMail } from "./auth-mail.js";
import { fenceAuthAdapter } from "./auth-output-fence.js";
import type { AuthOutputFence } from "./auth-output-fence.js";
import { invitationViewPlugin } from "./invitation-view.js";

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
    ReturnType<typeof atomicPasswordResetPlugin>,
    ReturnType<typeof atomicOrganization<{ schema: typeof invitationSchema }>>,
  ];
  user: { additionalFields: { setupProgress: typeof setupProgressField } };
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
  readonly createHouseholdInvitation: (
    request: HouseholdInvitationRequest
  ) => ReturnType<AuthCore["api"]["createInvitation"]>;
};

export interface MealPlannerAuthOptions {
  readonly sendPasswordResetEmail?: (mail: PasswordResetMail) => Promise<void>;
  readonly sendInvitationEmail?: (mail: InvitationMail) => Promise<void>;
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
  database,
  outputFence,
  schema,
  secret,
  verifyInvitationRecipient,
  sendInvitationEmail = mockInvitationMail,
  sendPasswordResetEmail = mockPasswordResetMail,
}: MealPlannerAuthOptions) => {
  const adapterOptions =
    schema === undefined
      ? { provider: "sqlite" as const }
      : { provider: "sqlite" as const, schema };
  const failures = new AsyncLocalStorage<{ failure: unknown }>();
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
  const atomicStore = makeAuthAtomicStore(() => {
    // The CLI inspects this same configuration using SQLite without running endpoints.
    // Production mutations require D1's atomic batch capability.
    if (!(database instanceof DrizzleD1Database)) {
      throw new Error("Authentication mutations require a D1 database.");
    }
    return database;
  }, guardedFence);
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
        guardedFence
      ),
    disabledPaths: ["/organization/leave", "/organization/remove-member"],
    emailAndPassword: {
      enabled: true,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: ({ user, url }) =>
        sendPasswordResetEmail({
          email: parseEmailAddress(user.email),
          url,
        }),
    },
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
      atomicPasswordResetPlugin(atomicStore),
      atomicOrganization(
        {
          disableOrganizationDeletion: true,
          organizationHooks,
          schema: invitationSchema,
          sendInvitationEmail: ({ id, email }) =>
            sendInvitationEmail({
              email: parseEmailAddress(email),
              url: `${baseURL}/invitation/${encodeURIComponent(id)}`,
            }),
        } satisfies OrganizationOptions,
        atomicStore
      ),
    ],
    rateLimit: { enabled: true, storage: "database" },
    secret,
    trustedOrigins: [baseURL],
    user: { additionalFields: { setupProgress: setupProgressField } },
  };
  return {
    configuration,
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
  };
};

export type MealPlannerAuthSecurity = ReturnType<
  typeof makeMealPlannerAuthConfiguration
>;

/** A native HTTP request must complete inside its ALS fence before returning a response. */
export const fetchGuardedMealPlannerAuth = async (
  auth: AuthCore,
  security: MealPlannerAuthSecurity,
  request: Request
): Promise<Response> => {
  try {
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
    return await security.guard(() => auth.fetch(request));
  } catch {
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
  };
};
