import { drizzle } from "drizzle-orm/d1";
import type { AnyD1Database } from "drizzle-orm/d1";
import { Effect, Schema } from "effect";

import * as authSchema from "../auth/auth.database-schema.js";
import { makeMealPlannerAuth } from "../auth/auth.js";
import { resolveAuthenticatedOrganization } from "../auth/auth.principal.js";
import {
  HouseholdEnsureInput,
  HouseholdMetadata,
} from "./household.contract.js";
import type { HouseholdEnsureInput as HouseholdEnsureInputValue } from "./household.contract.js";

const baseURL = "https://meal-planner.test";

interface HouseholdApiTestEnv {
  readonly AUTH_SECRET: string;
  readonly HouseholdDomainWorker: {
    readonly ensureHousehold: (
      input: HouseholdEnsureInputValue
    ) => Promise<unknown>;
  };
  readonly MealPlannerAuthDatabase: AnyD1Database;
}

export default {
  fetch: (request: Request, env: HouseholdApiTestEnv) => {
    const auth = makeMealPlannerAuth({
      baseURL,
      database: drizzle(env.MealPlannerAuthDatabase),
      schema: authSchema,
      secret: env.AUTH_SECRET,
    });
    if (new URL(request.url).pathname.startsWith("/api/auth/")) {
      return auth.fetch(request);
    }
    if (
      request.method !== "GET" ||
      new URL(request.url).pathname !== "/v1/household"
    ) {
      return Response.json({ code: "not_found" }, { status: 404 });
    }
    return Effect.runPromise(
      resolveAuthenticatedOrganization({
        auth,
        headers: request.headers,
      }).pipe(
        Effect.flatMap((principal) =>
          Effect.tryPromise(() =>
            env.HouseholdDomainWorker.ensureHousehold(
              HouseholdEnsureInput.make({
                organizationId: principal.organizationId,
              })
            )
          )
        ),
        Effect.flatMap(Schema.decodeUnknownEffect(HouseholdMetadata)),
        Effect.match({
          onFailure: (error) =>
            error._tag === "AuthPrincipalResolutionError"
              ? Response.json({ code: "unauthorized" }, { status: 401 })
              : Response.json({ code: "internal_error" }, { status: 500 }),
          onSuccess: (metadata) =>
            Response.json({ ...metadata, status: "ready" as const }),
        })
      )
    );
  },
};
