import {
  ManualMealSwapRequest,
  MealPlan,
  MealPlanDecisionRequest,
  MealPlanNotFound,
  MealPlanPersistenceFailure,
  MealPlanPolicy,
  MealPlanRecipeSnapshot,
  MealPlanRequest,
} from "@meal-planner/household-api";
import type {
  MealPlanMutationConflict,
  MealPlanRequestConflict,
  MealPlanSwapRejected,
  MealPlanTransitionRejected,
  MealPlanVersionConflict,
} from "@meal-planner/household-api";
import type { AnyD1Database } from "drizzle-orm/d1";
import { Effect, Layer, Schema } from "effect";
import * as HttpRouter from "effect/unstable/http/HttpRouter";

import type { AuthenticatedOrganizationResolver } from "../auth/auth.principal.js";
import { AuthenticatedOrganizationResolver as AuthenticatedOrganizationResolverService } from "../auth/auth.principal.js";
import { RecipeImportHttpPlatformServices } from "../imports/import-intent-api.http.js";
import type {
  HouseholdCreateMealPlanInput,
  HouseholdDecideMealPlanInput,
  HouseholdMealPlanWire,
  HouseholdReadMealPlanInput,
  HouseholdSwapMealPlanInput,
} from "./household-meal-plan.contract.js";
import { listApprovedMealPlanRecipeSnapshots } from "./household-meal-plan.recipe-source.js";
import type {
  HouseholdDomainFailure,
  HouseholdEnsureInput,
  HouseholdMetadata,
} from "./household.contract.js";
import type {
  HouseholdDomainGateway,
  HouseholdMealPlanGateway,
  MealPlanCreateFailure,
  MealPlanDecisionFailure,
  MealPlanReadFailure,
  MealPlanSwapFailure,
} from "./household.gateway.js";
import {
  HouseholdDomainGateway as HouseholdDomainGatewayService,
  HouseholdMealPlanGateway as HouseholdMealPlanGatewayService,
} from "./household.gateway.js";
import {
  makeHouseholdHttpApiLayer,
  makeHouseholdMealPlanHttpApiLayer,
} from "./household.http.js";

interface HouseholdDomainPort {
  readonly ensureHousehold: (
    input: HouseholdEnsureInput
  ) => Effect.Effect<HouseholdMetadata, HouseholdDomainFailure>;
}

type MealPlanDomainFailure =
  | HouseholdDomainFailure
  | MealPlanMutationConflict
  | MealPlanNotFound
  | MealPlanPersistenceFailure
  | MealPlanRequestConflict
  | MealPlanSwapRejected
  | MealPlanTransitionRejected
  | MealPlanVersionConflict
  | { readonly _tag: "ImportPersistenceCorrupt" }
  | { readonly _tag: "ImportPersistenceUnavailable" };

interface HouseholdMealPlanDomainPort {
  readonly approveMealPlan: (
    input: HouseholdDecideMealPlanInput
  ) => Effect.Effect<HouseholdMealPlanWire, MealPlanDomainFailure>;
  readonly createMealPlan: (
    input: HouseholdCreateMealPlanInput
  ) => Effect.Effect<HouseholdMealPlanWire, MealPlanDomainFailure>;
  readonly readMealPlan: (
    input: HouseholdReadMealPlanInput
  ) => Effect.Effect<HouseholdMealPlanWire | null, MealPlanDomainFailure>;
  readonly rejectMealPlan: (
    input: HouseholdDecideMealPlanInput
  ) => Effect.Effect<HouseholdMealPlanWire, MealPlanDomainFailure>;
  readonly swapMealPlan: (
    input: HouseholdSwapMealPlanInput
  ) => Effect.Effect<HouseholdMealPlanWire, MealPlanDomainFailure>;
}

const persistenceFailure = (operation: "create" | "read" | "save") =>
  MealPlanPersistenceFailure.make({ operation });

const mapCreateFailure = (
  error: MealPlanDomainFailure
): MealPlanCreateFailure =>
  error._tag === "MealPlanRequestConflict" ||
  error._tag === "MealPlanPersistenceFailure"
    ? error
    : persistenceFailure("create");

const mapReadFailure = (error: MealPlanDomainFailure): MealPlanReadFailure =>
  error._tag === "MealPlanNotFound" ||
  error._tag === "MealPlanPersistenceFailure"
    ? error
    : persistenceFailure("read");

const mapDecisionFailure = (
  error: MealPlanDomainFailure
): MealPlanDecisionFailure => {
  switch (error._tag) {
    case "MealPlanMutationConflict":
    case "MealPlanNotFound":
    case "MealPlanPersistenceFailure":
    case "MealPlanTransitionRejected":
    case "MealPlanVersionConflict": {
      return error;
    }
    default: {
      return persistenceFailure("save");
    }
  }
};

const mapSwapFailure = (error: MealPlanDomainFailure): MealPlanSwapFailure =>
  error._tag === "MealPlanSwapRejected" ? error : mapDecisionFailure(error);

const decodeMealPlan = (wire: HouseholdMealPlanWire) =>
  Schema.decodeUnknownEffect(MealPlan)(wire).pipe(
    Effect.mapError(() => persistenceFailure("read"))
  );

/**
 * Adapt admitted household operations to the private household worker.
 * Approved recipe state is read from its current D1 authority and passed as a
 * closed snapshot; meal-plan state is owned only by the household object.
 */
export const makeHouseholdMealPlanGateway = (options: {
  readonly database: AnyD1Database;
  readonly domain: HouseholdMealPlanDomainPort;
}): HouseholdMealPlanGateway => {
  const encodeRecipes = (
    organizationId: HouseholdCreateMealPlanInput["organizationId"]
  ) =>
    listApprovedMealPlanRecipeSnapshots(options.database, organizationId).pipe(
      Effect.flatMap((recipes) =>
        Effect.all(
          recipes.map((recipe) =>
            Schema.encodeEffect(MealPlanRecipeSnapshot)(recipe)
          )
        )
      ),
      Effect.mapError(() => persistenceFailure("read"))
    );

  return {
    approve: ({ decidedAt, draftId, payload, principal }) =>
      Effect.gen(function* approveHouseholdMealPlan() {
        const request = yield* Schema.encodeEffect(MealPlanDecisionRequest)({
          ...payload,
          actorId: principal.actorId,
          decidedAt,
          draftId,
        }).pipe(Effect.mapError(() => persistenceFailure("save")));
        const wire = yield* options.domain
          .approveMealPlan({
            organizationId: principal.organizationId,
            request,
          })
          .pipe(Effect.mapError(mapDecisionFailure));
        return yield* decodeMealPlan(wire);
      }),
    create: ({ payload, principal }) =>
      Effect.gen(function* createHouseholdMealPlan() {
        const [recipes, policy, request] = yield* Effect.all([
          encodeRecipes(principal.organizationId),
          Schema.encodeEffect(MealPlanPolicy)(payload.policy).pipe(
            Effect.mapError(() => persistenceFailure("create"))
          ),
          Schema.encodeEffect(MealPlanRequest)(payload.request).pipe(
            Effect.mapError(() => persistenceFailure("create"))
          ),
        ]);
        const wire = yield* options.domain
          .createMealPlan({
            approvedRecipes: recipes,
            organizationId: principal.organizationId,
            policy,
            request,
          })
          .pipe(Effect.mapError(mapCreateFailure));
        return yield* decodeMealPlan(wire).pipe(
          Effect.mapError(() => persistenceFailure("create"))
        );
      }),
    read: ({ draftId, principal }) =>
      Effect.gen(function* readHouseholdMealPlan() {
        const wire = yield* options.domain
          .readMealPlan({
            draftId,
            organizationId: principal.organizationId,
          })
          .pipe(Effect.mapError(mapReadFailure));
        if (wire === null) {
          return yield* Effect.fail(MealPlanNotFound.make({ draftId }));
        }
        return yield* decodeMealPlan(wire);
      }),
    reject: ({ decidedAt, draftId, payload, principal }) =>
      Effect.gen(function* rejectHouseholdMealPlan() {
        const request = yield* Schema.encodeEffect(MealPlanDecisionRequest)({
          ...payload,
          actorId: principal.actorId,
          decidedAt,
          draftId,
        }).pipe(Effect.mapError(() => persistenceFailure("save")));
        const wire = yield* options.domain
          .rejectMealPlan({
            organizationId: principal.organizationId,
            request,
          })
          .pipe(Effect.mapError(mapDecisionFailure));
        return yield* decodeMealPlan(wire);
      }),
    swap: ({ draftId, payload, principal, swappedAt }) =>
      Effect.gen(function* swapHouseholdMealPlan() {
        const [recipes, request] = yield* Effect.all([
          encodeRecipes(principal.organizationId),
          Schema.encodeEffect(ManualMealSwapRequest)({
            ...payload,
            actorId: principal.actorId,
            draftId,
            swappedAt,
          }).pipe(Effect.mapError(() => persistenceFailure("save"))),
        ]);
        const wire = yield* options.domain
          .swapMealPlan({
            approvedRecipes: recipes,
            organizationId: principal.organizationId,
            request,
          })
          .pipe(Effect.mapError(mapSwapFailure));
        return yield* decodeMealPlan(wire);
      }),
  };
};

/** Adapt the private service binding to the application gateway. */
export const makeHouseholdDomainGateway = (
  domain: HouseholdDomainPort
): HouseholdDomainGateway => ({
  ensure: (organizationId) =>
    domain.ensureHousehold({ organizationId }).pipe(
      Effect.map((metadata) => ({
        ...metadata,
        status: "ready" as const,
      }))
    ),
});

/**
 * Production household request composition shared by the API Worker and its
 * provider-free host proof. Authentication and membership resolution are
 * installed before the private-domain gateway can be reached.
 */
export const makeHouseholdRequestLayer = (options: {
  readonly gateway: HouseholdDomainGateway;
  readonly resolver: AuthenticatedOrganizationResolver;
}) => {
  const requestServices = Layer.mergeAll(
    Layer.succeed(AuthenticatedOrganizationResolverService, options.resolver),
    Layer.succeed(HouseholdDomainGatewayService, options.gateway)
  );
  return makeHouseholdHttpApiLayer().pipe(
    Layer.provide(RecipeImportHttpPlatformServices),
    Layer.provide(requestServices),
    HttpRouter.provideRequest(requestServices)
  );
};

/** Mount the authenticated meal-plan surface over the admitted application gateway. */
export const makeHouseholdMealPlanRequestLayer = (options: {
  readonly gateway: HouseholdMealPlanGateway;
  readonly resolver: AuthenticatedOrganizationResolver;
}) => {
  const requestServices = Layer.mergeAll(
    Layer.succeed(AuthenticatedOrganizationResolverService, options.resolver),
    Layer.succeed(HouseholdMealPlanGatewayService, options.gateway)
  );
  return makeHouseholdMealPlanHttpApiLayer().pipe(
    Layer.provide(RecipeImportHttpPlatformServices),
    Layer.provide(requestServices),
    HttpRouter.provideRequest(requestServices)
  );
};
