import { AsyncLocalStorage } from "node:async_hooks";

import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { setupProgressField } from "@meal-planner/household-api";
import type { HouseholdAuthResourceId } from "@meal-planner/household-api";
import { betterAuth } from "better-auth";
import type { Auth, BetterAuthOptions } from "better-auth";
import type { OrganizationOptions } from "better-auth/plugins/organization";
import { DrizzleD1Database } from "drizzle-orm/d1";

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

const invitationSchema = {
  invitation: {
    additionalFields: {
      householdPersonId: { input: true, required: false, type: "string" },
    },
  },
} as const;

type MealPlannerAuthConfiguration = Omit<
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
interface HouseholdInvitationRequest {
  readonly invitationId: HouseholdAuthResourceId;
  readonly headers: Headers;
  readonly body: {
    readonly email: string;
    readonly householdPersonId: string;
    readonly organizationId: string;
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
    readonly invitationId: string;
    readonly organizationId: string;
    readonly userId: string;
  }) => Promise<void>;
}

/** Construct the Better Auth control plane with the same plugins in every runtime. */
export const makeMealPlannerAuth = ({
  baseURL,
  database,
  outputFence,
  schema,
  secret,
  verifyInvitationRecipient,
  sendInvitationEmail = mockInvitationMail,
  sendPasswordResetEmail = mockPasswordResetMail,
}: MealPlannerAuthOptions): MealPlannerAuth => {
  const adapterOptions =
    schema === undefined
      ? { provider: "sqlite" as const }
      : { provider: "sqlite" as const, schema };
  const failures = new AsyncLocalStorage<{ failure: unknown }>();
  const invitationIdentity = new AsyncLocalStorage<HouseholdAuthResourceId>();
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
        invitationId: invitation.id,
        organizationId: organization.id,
        userId: user.id,
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
  const auth = betterAuth<MealPlannerAuthConfiguration>({
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
        sendPasswordResetEmail({ email: user.email, url }),
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
              email,
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
  });
  const guard = <A>(operation: () => Promise<A>): Promise<A> =>
    failures.run({ failure: undefined }, async () => {
      const result = await operation();
      const failure = failures.getStore()?.failure;
      if (failure !== undefined) {
        throw failure;
      }
      return result;
    });
  const fetch = async (request: Request): Promise<Response> => {
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
      return await guard(() => auth.fetch(request));
    } catch {
      return new Response(null, { status: 503 });
    }
  };
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
