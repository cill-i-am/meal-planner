import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins";

export interface MealPlannerAuthOptions {
  readonly baseURL: string;
  readonly database: Parameters<typeof drizzleAdapter>[0];
  readonly schema?: Record<string, unknown>;
  readonly secret: string;
}

/** Construct the Better Auth control plane with the same plugins in every runtime. */
export const makeMealPlannerAuth = ({
  baseURL,
  database,
  schema,
  secret,
}: MealPlannerAuthOptions) =>
  betterAuth({
    appName: "Meal Planner",
    baseURL,
    database: drizzleAdapter(database, {
      provider: "sqlite",
      ...(schema === undefined ? {} : { schema }),
    }),
    emailAndPassword: { enabled: true },
    plugins: [organization()],
    secret,
    trustedOrigins: [baseURL],
  });

export type MealPlannerAuth = ReturnType<typeof makeMealPlannerAuth>;
