import { MealPlanPersistenceFailure } from "@meal-planner/household-api";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { AnyD1Database } from "drizzle-orm/d1";
import { Effect, Layer } from "effect";
import * as HttpRouter from "effect/unstable/http/HttpRouter";

import * as authSchema from "../auth/auth.database-schema.js";
import { makeMealPlannerAuth } from "../auth/auth.js";
import { makeAuthenticatedOrganizationResolver } from "../auth/auth.principal.js";
import { ApprovedRecipeAuthorityMismatch } from "../imports/import-approved-recipe-projection.d1.js";
import type { ApprovedRecipeCandidateCatalogue } from "../imports/import-approved-recipe-projection.d1.js";
import { recipeReviews } from "../imports/import.database-schema.js";
import type {
  HouseholdCreateMealPlanInput,
  HouseholdDecideMealPlanInput,
  HouseholdMealPlanWire,
  HouseholdReadMealPlanInput,
  HouseholdSwapMealPlanInput,
} from "./household-meal-plan.contract.js";
import {
  findApprovedMealPlanRecipeSnapshot,
  hydrateApprovedMealPlanRecipeSnapshots,
  readApprovedMealPlanRecipeCandidateCatalogue,
} from "./household-meal-plan.recipe-source.js";
import {
  makeHouseholdDomainGateway,
  makeHouseholdMealPlanGateway,
  makeHouseholdMealPlanRequestLayer,
  makeHouseholdRequestLayer,
} from "./household-request-composition.js";
import type { HouseholdMealPlanRecipeAuthority } from "./household-request-composition.js";
import type {
  HouseholdEnsureInput,
  HouseholdMetadata,
} from "./household.contract.js";
import { HouseholdPersistenceFailure } from "./household.contract.js";

const baseURL = "https://meal-planner.test";
const recipeAuthorityDriftHeader = "x-test-recipe-authority-drift";
const recipeAuthorityQueryBudgetHeader = "x-test-recipe-authority-query-budget";
const recipeAuthorityQueryStatementsHeader =
  "x-test-recipe-authority-query-statements";

/** Count statements at the real D1 execution seam without replacing D1. */
const observeD1BatchStatements = (binding: AnyD1Database) => {
  let statementCount = 0;
  type PreparedStatement = ReturnType<AnyD1Database["prepare"]>;
  const nativeStatements = new WeakMap<PreparedStatement, PreparedStatement>();
  const observeStatement = (
    statement: PreparedStatement
  ): PreparedStatement => {
    const observed = new Proxy(statement, {
      get: (target, property) => {
        if (property === "all") {
          return () => {
            statementCount += 1;
            return target.all();
          };
        }
        if (property === "bind") {
          return (...values: unknown[]) =>
            observeStatement(target.bind(...values));
        }
        if (property === "first") {
          return (columnName?: string) => {
            statementCount += 1;
            return columnName === undefined
              ? target.first()
              : target.first(columnName);
          };
        }
        if (property === "raw") {
          return (options?: { readonly columnNames?: boolean }) => {
            statementCount += 1;
            return options?.columnNames === true
              ? target.raw({ columnNames: true })
              : target.raw();
          };
        }
        if (property === "run") {
          return () => {
            statementCount += 1;
            return target.run();
          };
        }
        return Reflect.get(target, property, target);
      },
    });
    nativeStatements.set(observed, statement);
    return observed;
  };
  const observedBatch: AnyD1Database["batch"] = (
    statements: ReturnType<AnyD1Database["prepare"]>[]
  ) => {
    statementCount += statements.length;
    return binding.batch(
      statements.map(
        (statement) => nativeStatements.get(statement) ?? statement
      )
    );
  };
  const observedPrepare: AnyD1Database["prepare"] = (query: string) =>
    observeStatement(binding.prepare(query));
  const database = new Proxy(binding, {
    get: (target, property) => {
      if (property === "batch") {
        return observedBatch;
      }
      if (property === "prepare") {
        return observedPrepare;
      }
      return Reflect.get(target, property, target);
    },
  });
  return {
    database,
    statementCount: () => statementCount,
  };
};

const firstCatalogueCandidate = (
  pages: ApprovedRecipeCandidateCatalogue["pages"]
) => pages.find((page) => page.length > 0)?.[0];

const lastCatalogueCandidate = (
  pages: ApprovedRecipeCandidateCatalogue["pages"]
) => pages.findLast((page) => page.length > 0)?.at(-1);

const updateCandidateCuisines = (
  binding: AnyD1Database,
  candidate: NonNullable<ReturnType<typeof firstCatalogueCandidate>>,
  cuisines: readonly string[]
) =>
  Effect.tryPromise({
    catch: () => new ApprovedRecipeAuthorityMismatch(undefined),
    try: () =>
      drizzle(binding)
        .update(recipeReviews)
        .set({
          tagsJson: JSON.stringify({ ...candidate.tags, cuisines }),
        })
        .where(
          eq(
            recipeReviews.extractionFingerprint,
            candidate.authorityToken.extractionFingerprint
          )
        )
        .run(),
  });

/**
 * Fixture-only authority interleaving at the production composition seam.
 * Mutations happen after one real transactional catalogue snapshot and before
 * real selected-row hydration; ordinary requests use the unwrapped authority.
 */
const makeRecipeAuthority = (
  request: Request,
  mutationBinding: AnyD1Database
): HouseholdMealPlanRecipeAuthority | undefined => {
  const driftMode = request.headers.get(recipeAuthorityDriftHeader);
  if (
    driftMode !== "catalogue" &&
    driftMode !== "once" &&
    driftMode !== "always"
  ) {
    return undefined;
  }

  let hydrationAttempts = 0;
  return {
    findApprovedRecipe: findApprovedMealPlanRecipeSnapshot,
    hydrateApprovedRecipes: (...input) => {
      hydrationAttempts += 1;
      return hydrateApprovedMealPlanRecipeSnapshots(...input);
    },
    readApprovedRecipeCandidateCatalogue: (...input) =>
      readApprovedMealPlanRecipeCandidateCatalogue(...input).pipe(
        Effect.tap((catalogue) => {
          if (driftMode === "catalogue") {
            if (hydrationAttempts !== 0) {
              return Effect.void;
            }
            const candidate = firstCatalogueCandidate(catalogue.pages);
            return candidate === undefined
              ? Effect.void
              : updateCandidateCuisines(mutationBinding, candidate, [
                  "preferred",
                ]);
          }
          if (hydrationAttempts === 0) {
            const candidate = lastCatalogueCandidate(catalogue.pages);
            return candidate === undefined
              ? Effect.void
              : updateCandidateCuisines(mutationBinding, candidate, ["Irish"]);
          }
          if (driftMode === "always" && hydrationAttempts === 1) {
            const candidate = firstCatalogueCandidate(catalogue.pages);
            return candidate === undefined
              ? Effect.void
              : updateCandidateCuisines(mutationBinding, candidate, [
                  "preferred",
                ]);
          }
          return Effect.void;
        })
      ),
  };
};

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
    if (request.headers.get("x-test-private-household-malformed") === "1") {
      try {
        await env.HouseholdDomainWorker.ensureHousehold({
          admission: {
            actor: { _tag: "Member", actorId: "a".repeat(64) },
            organizationId: "organization-private-malformed",
          },
          unexpectedAuthority: true,
        } as never);
        return Response.json({ rejected: false }, { status: 500 });
      } catch {
        return Response.json({ rejected: true }, { status: 400 });
      }
    }
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
    const queryObservation =
      request.headers.get(recipeAuthorityQueryBudgetHeader) === "observe"
        ? observeD1BatchStatements(env.MealPlannerDatabase)
        : undefined;
    const mealPlannerDatabase =
      queryObservation?.database ?? env.MealPlannerDatabase;
    const recipeAuthority = makeRecipeAuthority(
      request,
      env.MealPlannerDatabase
    );
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
    const mealPlanGatewayOptions = {
      database: mealPlannerDatabase,
      domain: mealPlanDomain,
    };
    const mealPlanGateway =
      recipeAuthority === undefined
        ? makeHouseholdMealPlanGateway(mealPlanGatewayOptions)
        : makeHouseholdMealPlanGateway({
            ...mealPlanGatewayOptions,
            recipeAuthority,
          });
    const mealPlanLayer = makeHouseholdMealPlanRequestLayer({
      gateway: mealPlanGateway,
      resolver,
    });
    const mounted = HttpRouter.toWebHandler(
      Layer.mergeAll(householdLayer, mealPlanLayer),
      { disableLogger: true }
    );
    try {
      const response = await mounted.handler(request);
      if (queryObservation === undefined) {
        return response;
      }
      const headers = new Headers(response.headers);
      headers.set(
        recipeAuthorityQueryStatementsHeader,
        String(queryObservation.statementCount())
      );
      return new Response(response.body, {
        headers,
        status: response.status,
        statusText: response.statusText,
      });
    } finally {
      await mounted.dispose();
    }
  },
};
