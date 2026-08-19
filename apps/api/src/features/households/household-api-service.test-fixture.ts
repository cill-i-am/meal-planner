import { drizzle } from "drizzle-orm/d1";
import type { AnyD1Database } from "drizzle-orm/d1";
import { Effect } from "effect";
import * as HttpRouter from "effect/unstable/http/HttpRouter";

import * as authSchema from "../auth/auth.database-schema.js";
import { makeMealPlannerAuth } from "../auth/auth.js";
import { makeAuthenticatedOrganizationResolver } from "../auth/auth.principal.js";
import {
  makeHouseholdDomainGateway,
  makeHouseholdRequestLayer,
} from "./household-request-composition.js";
import type {
  HouseholdEnsureInput,
  HouseholdMetadata,
} from "./household.contract.js";
import { HouseholdPersistenceFailure } from "./household.contract.js";

const baseURL = "https://meal-planner.test";

interface HouseholdApiFixtureEnv {
  readonly BETTER_AUTH_SECRET: string;
  readonly HouseholdDomainWorker: {
    readonly ensureHousehold: (
      input: HouseholdEnsureInput
    ) => Promise<HouseholdMetadata>;
  };
  readonly MealPlannerAuthDatabase: AnyD1Database;
}

/**
 * Provider-free host shell. All security-sensitive household authorization,
 * route composition, and private-domain adaptation come from production code.
 */
export default {
  fetch: async (request: Request, env: HouseholdApiFixtureEnv) => {
    const auth = makeMealPlannerAuth({
      baseURL,
      database: drizzle(env.MealPlannerAuthDatabase),
      schema: authSchema,
      secret: env.BETTER_AUTH_SECRET,
    });
    if (new URL(request.url).pathname.startsWith("/api/auth/")) {
      return auth.fetch(request);
    }
    const mounted = HttpRouter.toWebHandler(
      makeHouseholdRequestLayer({
        gateway: makeHouseholdDomainGateway({
          ensureHousehold: (input) =>
            Effect.tryPromise({
              catch: () =>
                HouseholdPersistenceFailure.make({ operation: "ensure" }),
              try: () => env.HouseholdDomainWorker.ensureHousehold(input),
            }),
        }),
        resolver: makeAuthenticatedOrganizationResolver({ auth }),
      }),
      { disableLogger: true }
    );
    try {
      return await mounted.handler(request);
    } finally {
      await mounted.dispose();
    }
  },
};
