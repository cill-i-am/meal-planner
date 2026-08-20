import { MealPlanPersistenceFailure } from "@meal-planner/household-api";
import { drizzle } from "drizzle-orm/d1";
import type { AnyD1Database } from "drizzle-orm/d1";
import { Effect, Layer } from "effect";
import * as HttpRouter from "effect/unstable/http/HttpRouter";

import * as authSchema from "../auth/auth.database-schema.js";
import { makeMealPlannerAuth } from "../auth/auth.js";
import { makeAuthenticatedOrganizationResolver } from "../auth/auth.principal.js";
import type {
  HouseholdCreateMealPlanInput,
  HouseholdDecideMealPlanInput,
  HouseholdMealPlanWire,
  HouseholdReadMealPlanInput,
  HouseholdSwapMealPlanInput,
} from "./household-meal-plan.contract.js";
import {
  makeHouseholdDomainGateway,
  makeHouseholdMealPlanGateway,
  makeHouseholdMealPlanRequestLayer,
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
    readonly approveMealPlan: (
      input: HouseholdDecideMealPlanInput
    ) => Promise<HouseholdMealPlanWire>;
    readonly createMealPlan: (
      input: HouseholdCreateMealPlanInput
    ) => Promise<HouseholdMealPlanWire>;
    readonly ensureHousehold: (
      input: HouseholdEnsureInput
    ) => Promise<HouseholdMetadata>;
    readonly readMealPlan: (
      input: HouseholdReadMealPlanInput
    ) => Promise<HouseholdMealPlanWire | null>;
    readonly rejectMealPlan: (
      input: HouseholdDecideMealPlanInput
    ) => Promise<HouseholdMealPlanWire>;
    readonly swapMealPlan: (
      input: HouseholdSwapMealPlanInput
    ) => Promise<HouseholdMealPlanWire>;
  };
  readonly MealPlannerAuthDatabase: AnyD1Database;
  readonly MealPlannerDatabase: AnyD1Database;
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
    const resolver = makeAuthenticatedOrganizationResolver({ auth });
    const householdLayer = makeHouseholdRequestLayer({
      gateway: makeHouseholdDomainGateway({
        ensureHousehold: (input) =>
          Effect.tryPromise({
            catch: () =>
              HouseholdPersistenceFailure.make({ operation: "ensure" }),
            try: () => env.HouseholdDomainWorker.ensureHousehold(input),
          }),
      }),
      resolver,
    });
    const mealPlanDomain: Parameters<
      typeof makeHouseholdMealPlanGateway
    >[0]["domain"] = {
      approveMealPlan: (input) =>
        Effect.tryPromise({
          catch: () => MealPlanPersistenceFailure.make({ operation: "save" }),
          try: () => env.HouseholdDomainWorker.approveMealPlan(input),
        }),
      createMealPlan: (input) =>
        Effect.tryPromise({
          catch: () => MealPlanPersistenceFailure.make({ operation: "create" }),
          try: () => env.HouseholdDomainWorker.createMealPlan(input),
        }),
      readMealPlan: (input) =>
        Effect.tryPromise({
          catch: () => MealPlanPersistenceFailure.make({ operation: "read" }),
          try: () => env.HouseholdDomainWorker.readMealPlan(input),
        }),
      rejectMealPlan: (input) =>
        Effect.tryPromise({
          catch: () => MealPlanPersistenceFailure.make({ operation: "save" }),
          try: () => env.HouseholdDomainWorker.rejectMealPlan(input),
        }),
      swapMealPlan: (input) =>
        Effect.tryPromise({
          catch: () => MealPlanPersistenceFailure.make({ operation: "save" }),
          try: () => env.HouseholdDomainWorker.swapMealPlan(input),
        }),
    };
    const mealPlanLayer = makeHouseholdMealPlanRequestLayer({
      gateway: makeHouseholdMealPlanGateway({ domain: mealPlanDomain }),
      resolver,
    });
    const mounted = HttpRouter.toWebHandler(
      Layer.mergeAll(householdLayer, mealPlanLayer),
      { disableLogger: true }
    );
    try {
      return await mounted.handler(request);
    } finally {
      await mounted.dispose();
    }
  },
};
