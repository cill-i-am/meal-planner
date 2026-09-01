import {
  HouseholdPeopleRoster,
  HouseholdPeopleUnavailable,
  HouseholdPerson,
  MealPlan,
  MealPlanNotFound,
  MealPlanPersistenceFailure,
  MealPlanPolicy,
  MealPlanRequest,
} from "@meal-planner/household-api";
import type {
  HouseholdPeopleFailure,
  MealPlanMutationConflict,
  MealPlanRequestConflict,
  MealPlanSwapRejected,
  MealPlanTransitionRejected,
  MealPlanVersionConflict,
} from "@meal-planner/household-api";
import { Effect, Layer, Schema } from "effect";
import * as HttpRouter from "effect/unstable/http/HttpRouter";

import type { AuthenticatedOrganizationResolver } from "../auth/auth.principal.js";
import { AuthenticatedOrganizationResolver as AuthenticatedOrganizationResolverService } from "../auth/auth.principal.js";
import { RecipeImportHttpPlatformServices } from "../imports/import-intent-api.http.js";
import type {
  HouseholdCreateMealPlanFromRecipeBankInput,
  HouseholdDecideMealPlanInput,
  HouseholdMealPlanWire,
  HouseholdReadMealPlanInput,
  HouseholdSwapMealPlanFromRecipeBankInput,
} from "./household-meal-plan.contract.js";
import {
  HouseholdManualMealSwapCommand,
  HouseholdMealPlanDecisionCommand,
} from "./household-meal-plan.contract.js";
import type {
  HouseholdDomainFailure,
  HouseholdEnsureInput,
  HouseholdMetadata,
} from "./household.contract.js";
import { HouseholdInvalidInput } from "./household.contract.js";
import type {
  HouseholdDomainGateway,
  HouseholdMealPlanGateway,
  HouseholdPeopleGateway,
  MealPlanCreateFailure,
  MealPlanDecisionFailure,
  MealPlanReadFailure,
  MealPlanSwapFailure,
} from "./household.gateway.js";
import {
  HouseholdDomainGateway as HouseholdDomainGatewayService,
  HouseholdMealPlanGateway as HouseholdMealPlanGatewayService,
  HouseholdPeopleGateway as HouseholdPeopleGatewayService,
} from "./household.gateway.js";
import {
  makeHouseholdHttpApiLayer,
  makeHouseholdMealPlanHttpApiLayer,
  makeHouseholdPeopleHttpApiLayer,
} from "./household.http.js";
import type {
  HouseholdBootstrapCreatorPersonInput,
  HouseholdCreatePersonInput,
  HouseholdGetPersonInput,
  HouseholdListPeopleInput,
  HouseholdTransitionPersonInput,
} from "./people/household-people.contract.js";
import type { HouseholdRecipeImportFailure } from "./recipe-import/household-recipe-import.contract.js";
import {
  makeHouseholdMemberAdmission,
  makeHouseholdPeopleAdmission,
  makeHouseholdPeopleCreatorAdmission,
} from "./rpc/command-envelope.js";

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
  | HouseholdRecipeImportFailure;

interface HouseholdMealPlanDomainPort {
  readonly approveMealPlan: (
    input: HouseholdDecideMealPlanInput
  ) => Effect.Effect<HouseholdMealPlanWire, MealPlanDomainFailure>;
  readonly createMealPlanFromRecipeBank: (
    input: HouseholdCreateMealPlanFromRecipeBankInput
  ) => Effect.Effect<HouseholdMealPlanWire, MealPlanDomainFailure>;
  readonly readMealPlan: (
    input: HouseholdReadMealPlanInput
  ) => Effect.Effect<HouseholdMealPlanWire | null, MealPlanDomainFailure>;
  readonly rejectMealPlan: (
    input: HouseholdDecideMealPlanInput
  ) => Effect.Effect<HouseholdMealPlanWire, MealPlanDomainFailure>;
  readonly swapMealPlanFromRecipeBank: (
    input: HouseholdSwapMealPlanFromRecipeBankInput
  ) => Effect.Effect<HouseholdMealPlanWire, MealPlanDomainFailure>;
}

interface HouseholdPeopleDomainPort {
  readonly archiveHouseholdPerson: (
    input: HouseholdTransitionPersonInput
  ) => Effect.Effect<unknown, HouseholdDomainFailure | HouseholdPeopleFailure>;
  readonly bootstrapCreatorPerson: (
    input: HouseholdBootstrapCreatorPersonInput
  ) => Effect.Effect<unknown, HouseholdDomainFailure | HouseholdPeopleFailure>;
  readonly createHouseholdPerson: (
    input: HouseholdCreatePersonInput
  ) => Effect.Effect<unknown, HouseholdDomainFailure | HouseholdPeopleFailure>;
  readonly getHouseholdPerson: (
    input: HouseholdGetPersonInput
  ) => Effect.Effect<unknown, HouseholdDomainFailure | HouseholdPeopleFailure>;
  readonly listHouseholdPeople: (
    input: HouseholdListPeopleInput
  ) => Effect.Effect<unknown, HouseholdDomainFailure | HouseholdPeopleFailure>;
  readonly restoreHouseholdPerson: (
    input: HouseholdTransitionPersonInput
  ) => Effect.Effect<unknown, HouseholdDomainFailure | HouseholdPeopleFailure>;
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

const mapPeopleFailure = (
  error: HouseholdDomainFailure | HouseholdPeopleFailure
): HouseholdPeopleFailure => {
  if (Schema.is(HouseholdPeopleUnavailable)(error)) {
    return error;
  }
  switch (error._tag) {
    case "HouseholdCreatorBootstrapConflict":
    case "HouseholdPersonLifecycleConflict":
    case "HouseholdPersonMutationCollision":
    case "HouseholdPersonNotFound":
    case "HouseholdPersonStaleVersion": {
      return error;
    }
    default: {
      return HouseholdPeopleUnavailable.make({});
    }
  }
};

/** Adapt admitted people operations to the private household Worker. */
export const makeHouseholdPeopleGateway = (options: {
  readonly domain: HouseholdPeopleDomainPort;
}): HouseholdPeopleGateway => {
  const call = <A, R>(
    admission: Effect.Effect<R, unknown>,
    invoke: (
      admission: R
    ) => Effect.Effect<
      unknown,
      HouseholdDomainFailure | HouseholdPeopleFailure
    >,
    schema: Schema.Codec<A, unknown, never>
  ) =>
    admission.pipe(
      Effect.mapError(() => HouseholdPeopleUnavailable.make({})),
      Effect.flatMap(invoke),
      Effect.mapError(mapPeopleFailure),
      Effect.flatMap((wire) =>
        Schema.decodeUnknownEffect(schema)(wire).pipe(
          Effect.mapError(() => HouseholdPeopleUnavailable.make({}))
        )
      )
    );
  return {
    archive: ({ payload, personId, principal }) =>
      call(
        makeHouseholdPeopleAdmission(principal),
        (admission) =>
          options.domain.archiveHouseholdPerson({
            admission,
            payload,
            personId,
          }),
        HouseholdPerson
      ),
    bootstrapCreator: ({ payload, principal }) =>
      principal.creatorAuthority === null
        ? Effect.fail(HouseholdPeopleUnavailable.make({}))
        : call(
            makeHouseholdPeopleCreatorAdmission({
              ...principal,
              creatorAuthority: principal.creatorAuthority,
            }),
            (admission) =>
              options.domain.bootstrapCreatorPerson({ admission, payload }),
            HouseholdPerson
          ),
    create: ({ payload, principal }) =>
      call(
        makeHouseholdPeopleAdmission(principal),
        (admission) =>
          options.domain.createHouseholdPerson({ admission, payload }),
        HouseholdPerson
      ),
    get: ({ personId, principal }) =>
      call(
        makeHouseholdPeopleAdmission(principal),
        (admission) =>
          options.domain.getHouseholdPerson({ admission, personId }),
        HouseholdPerson
      ),
    list: ({ includeArchived, principal }) =>
      call(
        makeHouseholdPeopleAdmission(principal),
        (admission) =>
          options.domain.listHouseholdPeople({
            admission,
            query: { includeArchived: includeArchived ? "true" : "false" },
          }),
        HouseholdPeopleRoster
      ),
    restore: ({ payload, personId, principal }) =>
      call(
        makeHouseholdPeopleAdmission(principal),
        (admission) =>
          options.domain.restoreHouseholdPerson({
            admission,
            payload,
            personId,
          }),
        HouseholdPerson
      ),
  };
};

/**
 * Adapt admitted household operations to the private household worker.
 * Recipe selection and hydration stay inside the household authority.
 */
export const makeHouseholdMealPlanGateway = (options: {
  readonly domain: HouseholdMealPlanDomainPort;
}): HouseholdMealPlanGateway => ({
  approve: ({ draftId, payload, principal }) =>
    Effect.gen(function* approveHouseholdMealPlan() {
      const admission = yield* makeHouseholdMemberAdmission(principal).pipe(
        Effect.mapError(() => persistenceFailure("save"))
      );
      const request = yield* Schema.encodeEffect(
        HouseholdMealPlanDecisionCommand
      )({
        ...payload,
        draftId,
      }).pipe(Effect.mapError(() => persistenceFailure("save")));
      const wire = yield* options.domain
        .approveMealPlan({
          admission,
          request,
        })
        .pipe(Effect.mapError(mapDecisionFailure));
      return yield* decodeMealPlan(wire);
    }),
  create: ({ payload, principal }) =>
    Effect.gen(function* createHouseholdMealPlan() {
      const admission = yield* makeHouseholdMemberAdmission(principal).pipe(
        Effect.mapError(() => persistenceFailure("create"))
      );
      const [policy, request] = yield* Effect.all([
        Schema.encodeEffect(MealPlanPolicy)(payload.policy).pipe(
          Effect.mapError(() => persistenceFailure("create"))
        ),
        Schema.encodeEffect(MealPlanRequest)(payload.request).pipe(
          Effect.mapError(() => persistenceFailure("create"))
        ),
      ]);
      const wire = yield* options.domain
        .createMealPlanFromRecipeBank({
          admission,
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
      const admission = yield* makeHouseholdMemberAdmission(principal).pipe(
        Effect.mapError(() => persistenceFailure("read"))
      );
      const wire = yield* options.domain
        .readMealPlan({
          admission,
          draftId,
        })
        .pipe(Effect.mapError(mapReadFailure));
      if (wire === null) {
        return yield* Effect.fail(MealPlanNotFound.make({ draftId }));
      }
      return yield* decodeMealPlan(wire);
    }),
  reject: ({ draftId, payload, principal }) =>
    Effect.gen(function* rejectHouseholdMealPlan() {
      const admission = yield* makeHouseholdMemberAdmission(principal).pipe(
        Effect.mapError(() => persistenceFailure("save"))
      );
      const request = yield* Schema.encodeEffect(
        HouseholdMealPlanDecisionCommand
      )({
        ...payload,
        draftId,
      }).pipe(Effect.mapError(() => persistenceFailure("save")));
      const wire = yield* options.domain
        .rejectMealPlan({
          admission,
          request,
        })
        .pipe(Effect.mapError(mapDecisionFailure));
      return yield* decodeMealPlan(wire);
    }),
  swap: ({ draftId, payload, principal }) =>
    Effect.gen(function* swapHouseholdMealPlan() {
      const admission = yield* makeHouseholdMemberAdmission(principal).pipe(
        Effect.mapError(() => persistenceFailure("save"))
      );
      const request = yield* Schema.encodeEffect(
        HouseholdManualMealSwapCommand
      )({
        ...payload,
        draftId,
      }).pipe(Effect.mapError(() => persistenceFailure("save")));
      const wire = yield* options.domain
        .swapMealPlanFromRecipeBank({
          admission,
          request,
        })
        .pipe(Effect.mapError(mapSwapFailure));
      return yield* decodeMealPlan(wire);
    }),
});

/** Adapt the private service binding to the application gateway. */
export const makeHouseholdDomainGateway = (
  domain: HouseholdDomainPort
): HouseholdDomainGateway => ({
  ensure: (principal) =>
    makeHouseholdMemberAdmission(principal).pipe(
      Effect.mapError(() => HouseholdInvalidInput.make({})),
      Effect.flatMap((admission) => domain.ensureHousehold({ admission })),
      Effect.map((metadata) => ({ ...metadata, status: "ready" as const }))
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

/** Mount the authenticated household people surface over its admitted gateway. */
export const makeHouseholdPeopleRequestLayer = (options: {
  readonly gateway: HouseholdPeopleGateway;
  readonly resolver: AuthenticatedOrganizationResolver;
}) => {
  const requestServices = Layer.mergeAll(
    Layer.succeed(AuthenticatedOrganizationResolverService, options.resolver),
    Layer.succeed(HouseholdPeopleGatewayService, options.gateway)
  );
  return makeHouseholdPeopleHttpApiLayer().pipe(
    Layer.provide(RecipeImportHttpPlatformServices),
    Layer.provide(requestServices),
    HttpRouter.provideRequest(requestServices)
  );
};
