import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins";

export interface MealPlannerAuthOptions {
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
  schema,
  secret,
  verifyInvitationRecipient,
}: MealPlannerAuthOptions) => {
  const adapterOptions =
    schema === undefined
      ? { provider: "sqlite" as const }
      : { provider: "sqlite" as const, schema };
  return betterAuth({
    appName: "Meal Planner",
    baseURL,
    database: drizzleAdapter(database, adapterOptions),
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
      }),
    ],
    secret,
    trustedOrigins: [baseURL],
  });
};

export type MealPlannerAuth = ReturnType<typeof makeMealPlannerAuth>;
