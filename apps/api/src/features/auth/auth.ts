import { AsyncLocalStorage } from "node:async_hooks";

import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { setupProgressField } from "@meal-planner/household-api";
import { betterAuth } from "better-auth";
import type { BetterAuthOptions } from "better-auth";
import { organization } from "better-auth/plugins";

import { mockInvitationMail } from "./auth-mail.js";
import type { InvitationMail } from "./auth-mail.js";
import { fenceAuthAdapter } from "./auth-output-fence.js";
import type { AuthOutputFence } from "./auth-output-fence.js";

export interface MealPlannerAuthOptions {
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
}: MealPlannerAuthOptions) => {
  const adapterOptions =
    schema === undefined
      ? { provider: "sqlite" as const }
      : { provider: "sqlite" as const, schema };
  const failures = new AsyncLocalStorage<{ failure: unknown }>();
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
  const auth = betterAuth({
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
    emailAndPassword: { enabled: true },
    plugins: [
      organization({
        disableOrganizationDeletion: true,
        organizationHooks:
          verifyInvitationRecipient === undefined
            ? undefined
            : {
                beforeAcceptInvitation: ({
                  invitation,
                  organization: acceptedOrganization,
                  user,
                }) =>
                  verifyInvitationRecipient({
                    invitationId: invitation.id,
                    organizationId: acceptedOrganization.id,
                    userId: user.id,
                  }),
              },
        schema: {
          invitation: {
            additionalFields: {
              householdPersonId: {
                input: true,
                required: false,
                type: "string",
              },
              id: {
                input: true,
                required: false,
                type: "string",
              },
            },
          },
        },
        sendInvitationEmail: ({ id, email }) =>
          sendInvitationEmail({
            email,
            url: `${baseURL}/invitation/${encodeURIComponent(id)}`,
          }),
      }),
    ],
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
  return guarded;
};

export type MealPlannerAuth = ReturnType<typeof makeMealPlannerAuth>;
