import {
  CreateMealPlanPayload,
  DecideMealPlanPayload,
  HouseholdMealPlanPrincipal,
  HouseholdOrganizationId,
  HouseholdStatus,
  MealPlan,
  MealPlanActorId,
  MealPlanDraftId,
  MealPlanMutationId,
  MealPlanNotFound,
  MealPlanPersistenceFailure,
  MealPlanRecipeSnapshotId,
  MealPlanRequestConflict,
  MealPlanSwapRejected,
  MealPlanVersionConflict,
  SwapMealPlanPayload,
} from "@meal-planner/household-api";
import { Effect, Layer, Schema } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { afterAll, describe, expect, it } from "vitest";

import {
  AuthenticatedOrganizationResolver,
  AuthPrincipalResolutionError,
} from "../auth/auth.principal.js";
import { RecipeImportHttpPlatformServices } from "../imports/import-intent-api.http.js";
import { makeHouseholdRequestLayer } from "./household-request-composition.js";
import type { HouseholdDomainGateway } from "./household.gateway.js";
import {
  HouseholdDomainGateway as HouseholdDomainGatewayService,
  HouseholdMealPlanGateway,
} from "./household.gateway.js";
import { makeHouseholdMealPlanHttpApiLayer } from "./household.http.js";

const organizationId = Schema.decodeUnknownSync(HouseholdOrganizationId)(
  "organization-a"
);
const householdStatus = Schema.decodeUnknownSync(HouseholdStatus)({
  createdAtEpochMs: 1_777_777_777_777,
  organizationId,
  status: "ready",
});
const actorId = Schema.decodeUnknownSync(MealPlanActorId)("authenticated-user");
const draftId = Schema.decodeUnknownSync(MealPlanDraftId)("draft-week-1");
const createMealPlanPayload = Schema.decodeUnknownSync(CreateMealPlanPayload)({
  policy: {
    allowedDietaryFit: ["household_match"],
    allowedDifficulties: ["easy"],
    allowedTotalTimeBands: ["under_30_minutes"],
    maxRecipeUses: 1,
    preferredCuisines: ["Mediterranean"],
    version: "policy-v1",
  },
  request: {
    requestKey: "week-1",
    slots: [
      {
        date: "2026-08-24",
        mealType: "dinner",
        servings: 2,
        slotId: "monday-dinner",
      },
    ],
  },
});
const createdMealPlan = Schema.decodeUnknownSync(MealPlan)({
  _tag: "Draft",
  audit: [],
  draftId: "draft-week-1",
  gaps: [
    {
      reason: "no_eligible_approved_recipe",
      slotId: "monday-dinner",
    },
  ],
  meals: [],
  policy: createMealPlanPayload.policy,
  request: createMealPlanPayload.request,
  revision: 0,
});
const swapMealPlanPayload = Schema.decodeUnknownSync(SwapMealPlanPayload)({
  expectedRevision: 0,
  mutationId: Schema.decodeUnknownSync(MealPlanMutationId)("swap-1"),
  reason: "Use the quicker approved recipe tonight.",
  replacementImportId: Schema.decodeUnknownSync(MealPlanRecipeSnapshotId)(
    "a9f513cb-d1cc-4ae8-99fb-20113da1b83a"
  ),
  slotId: "monday-dinner",
});
const decideMealPlanPayload = Schema.decodeUnknownSync(DecideMealPlanPayload)({
  expectedRevision: 0,
  mutationId: Schema.decodeUnknownSync(MealPlanMutationId)("decision-1"),
  reason: "The household reviewed this plan.",
});

const makeApp = (options: {
  readonly gateway: HouseholdDomainGateway;
  readonly resolver: AuthenticatedOrganizationResolver;
}) =>
  HttpRouter.toWebHandler(makeHouseholdRequestLayer(options), {
    disableLogger: true,
  });

describe("household HttpApi boundary", () => {
  const apps: ReturnType<typeof makeApp>[] = [];

  afterAll(async () => {
    await Promise.all(apps.map(({ dispose }) => dispose()));
  });

  it("routes only the organization admitted from the authenticated session", async () => {
    const routedOrganizationIds: string[] = [];
    const app = makeApp({
      gateway: HouseholdDomainGatewayService.of({
        ensure: (admittedOrganizationId) =>
          Effect.sync(() => {
            routedOrganizationIds.push(admittedOrganizationId);
            return householdStatus;
          }),
      }),
      resolver: AuthenticatedOrganizationResolver.of({
        resolve: () =>
          Effect.succeed({ organizationId, userId: "authenticated-user" }),
      }),
    });
    apps.push(app);

    const response = await app.handler(
      new Request("https://meal-planner.test/v1/household", {
        headers: { cookie: "better-auth.session_token=session" },
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(householdStatus);
    expect(routedOrganizationIds).toEqual([organizationId]);
  });

  it("rejects before routing when authentication cannot admit an organization", async () => {
    let routed = false;
    const app = makeApp({
      gateway: HouseholdDomainGatewayService.of({
        ensure: () => {
          routed = true;
          return Effect.succeed(householdStatus);
        },
      }),
      resolver: AuthenticatedOrganizationResolver.of({
        resolve: () =>
          Effect.fail(
            new AuthPrincipalResolutionError({
              reason: "missing_membership",
            })
          ),
      }),
    });
    apps.push(app);

    const response = await app.handler(
      new Request("https://meal-planner.test/v1/household")
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      code: "unauthorized",
      message: "Sign in and select a household to continue.",
      status: 401,
    });
    expect(routed).toBe(false);
  });
});

describe("household meal-plan HttpApi boundary", () => {
  const apps: { readonly dispose: () => Promise<void> }[] = [];
  const admittedResolver = AuthenticatedOrganizationResolver.of({
    resolve: () =>
      Effect.succeed({ organizationId, userId: "authenticated-user" }),
  });

  afterAll(async () => {
    await Promise.all(apps.map(({ dispose }) => dispose()));
  });

  const makeMealPlanApp = (options: {
    readonly gateway: HouseholdMealPlanGateway;
    readonly resolver?: AuthenticatedOrganizationResolver;
  }) => {
    const requestServices = Layer.mergeAll(
      Layer.succeed(
        AuthenticatedOrganizationResolver,
        options.resolver ?? admittedResolver
      ),
      Layer.succeed(HouseholdMealPlanGateway, options.gateway)
    );
    const app = HttpRouter.toWebHandler(
      makeHouseholdMealPlanHttpApiLayer().pipe(
        Layer.provide(RecipeImportHttpPlatformServices),
        Layer.provide(requestServices),
        HttpRouter.provideRequest(requestServices)
      ),
      { disableLogger: true }
    );
    apps.push(app);
    return app;
  };

  it("creates a plan only for the organization and actor admitted by Better Auth", async () => {
    const admittedInputs: unknown[] = [];
    const app = makeMealPlanApp({
      gateway: HouseholdMealPlanGateway.of({
        approve: () => Effect.die("Unexpected approve"),
        create: (input) =>
          Effect.sync(() => {
            admittedInputs.push(input);
            return createdMealPlan;
          }),
        read: () => Effect.die("Unexpected read"),
        reject: () => Effect.die("Unexpected reject"),
        swap: () => Effect.die("Unexpected swap"),
      }),
    });

    const response = await app.handler(
      new Request("https://meal-planner.test/v1/meal-plans", {
        body: JSON.stringify(
          Schema.encodeSync(CreateMealPlanPayload)(createMealPlanPayload)
        ),
        headers: {
          "content-type": "application/json",
          cookie: "better-auth.session_token=session",
        },
        method: "POST",
      })
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual(
      Schema.encodeSync(MealPlan)(createdMealPlan)
    );
    expect(admittedInputs).toEqual([
      {
        payload: createMealPlanPayload,
        principal: Schema.decodeUnknownSync(HouseholdMealPlanPrincipal)({
          actorId,
          organizationId,
        }),
      },
    ]);
  });

  it("rejects identity-bearing and unknown command fields before the household gateway", async () => {
    let routed = false;
    const app = makeMealPlanApp({
      gateway: HouseholdMealPlanGateway.of({
        approve: () => {
          routed = true;
          return Effect.succeed(createdMealPlan);
        },
        create: () => {
          routed = true;
          return Effect.succeed(createdMealPlan);
        },
        read: () => Effect.die("Unexpected read"),
        reject: () => Effect.die("Unexpected reject"),
        swap: () => {
          routed = true;
          return Effect.succeed(createdMealPlan);
        },
      }),
    });
    const headers = {
      "content-type": "application/json",
      cookie: "better-auth.session_token=session",
    };
    const requests = [
      new Request("https://meal-planner.test/v1/meal-plans", {
        body: JSON.stringify({
          ...Schema.encodeSync(CreateMealPlanPayload)(createMealPlanPayload),
          organizationId: "browser-supplied-organization",
        }),
        headers,
        method: "POST",
      }),
      new Request(`https://meal-planner.test/v1/meal-plans/${draftId}/swaps`, {
        body: JSON.stringify({
          ...Schema.encodeSync(SwapMealPlanPayload)(swapMealPlanPayload),
          actorId: "browser-supplied-actor",
        }),
        headers,
        method: "POST",
      }),
      new Request(
        `https://meal-planner.test/v1/meal-plans/${draftId}/approve`,
        {
          body: JSON.stringify({
            ...Schema.encodeSync(DecideMealPlanPayload)(decideMealPlanPayload),
            decidedAt: "2026-08-24T18:00:00.000Z",
          }),
          headers,
          method: "POST",
        }
      ),
    ];

    const responses = await Promise.all(
      requests.map((request) => app.handler(request))
    );

    expect(responses.map(({ status }) => status)).toEqual([400, 400, 400]);
    expect(routed).toBe(false);
  });

  it("rejects impossible calendar dates before the household gateway", async () => {
    let routed = false;
    const app = makeMealPlanApp({
      gateway: HouseholdMealPlanGateway.of({
        approve: () => Effect.die("Unexpected approve"),
        create: () => {
          routed = true;
          return Effect.succeed(createdMealPlan);
        },
        read: () => Effect.die("Unexpected read"),
        reject: () => Effect.die("Unexpected reject"),
        swap: () => Effect.die("Unexpected swap"),
      }),
    });
    const payload = Schema.encodeSync(CreateMealPlanPayload)(
      createMealPlanPayload
    );

    const response = await app.handler(
      new Request("https://meal-planner.test/v1/meal-plans", {
        body: JSON.stringify({
          ...payload,
          request: {
            ...payload.request,
            slots: [{ ...payload.request.slots[0], date: "2026-99-99" }],
          },
        }),
        headers: {
          "content-type": "application/json",
          cookie: "better-auth.session_token=session",
        },
        method: "POST",
      })
    );

    expect(response.status).toBe(400);
    expect(routed).toBe(false);
  });

  it("routes read, swap, approve, and reject through the admitted principal", async () => {
    const calls: object[] = [];
    const app = makeMealPlanApp({
      gateway: HouseholdMealPlanGateway.of({
        approve: (input) =>
          Effect.sync(() => {
            calls.push({ input, operation: "approve" });
            return createdMealPlan;
          }),
        create: () => Effect.die("Unexpected create"),
        read: (input) =>
          Effect.sync(() => {
            calls.push({ input, operation: "read" });
            return createdMealPlan;
          }),
        reject: (input) =>
          Effect.sync(() => {
            calls.push({ input, operation: "reject" });
            return createdMealPlan;
          }),
        swap: (input) =>
          Effect.sync(() => {
            calls.push({ input, operation: "swap" });
            return createdMealPlan;
          }),
      }),
    });

    const requests = [
      new Request(`https://meal-planner.test/v1/meal-plans/${draftId}`, {
        headers: { cookie: "better-auth.session_token=session" },
      }),
      new Request(`https://meal-planner.test/v1/meal-plans/${draftId}/swaps`, {
        body: JSON.stringify(
          Schema.encodeSync(SwapMealPlanPayload)(swapMealPlanPayload)
        ),
        headers: {
          "content-type": "application/json",
          cookie: "better-auth.session_token=session",
        },
        method: "POST",
      }),
      ...(["approve", "reject"] as const).map(
        (decision) =>
          new Request(
            `https://meal-planner.test/v1/meal-plans/${draftId}/${decision}`,
            {
              body: JSON.stringify(
                Schema.encodeSync(DecideMealPlanPayload)(decideMealPlanPayload)
              ),
              headers: {
                "content-type": "application/json",
                cookie: "better-auth.session_token=session",
              },
              method: "POST",
            }
          )
      ),
    ];

    const responses = await Promise.all(
      requests.map((request) => app.handler(request))
    );

    expect(responses.map(({ status }) => status)).toEqual([200, 200, 200, 200]);
    expect(calls).toEqual([
      {
        input: { draftId, principal: { actorId, organizationId } },
        operation: "read",
      },
      {
        input: {
          draftId,
          payload: swapMealPlanPayload,
          principal: { actorId, organizationId },
          swappedAt: expect.anything(),
        },
        operation: "swap",
      },
      {
        input: {
          decidedAt: expect.anything(),
          draftId,
          payload: decideMealPlanPayload,
          principal: { actorId, organizationId },
        },
        operation: "approve",
      },
      {
        input: {
          decidedAt: expect.anything(),
          draftId,
          payload: decideMealPlanPayload,
          principal: { actorId, organizationId },
        },
        operation: "reject",
      },
    ]);
  });

  it("maps domain and storage failures to stable non-leaking problems", async () => {
    const requestConflict = Schema.decodeUnknownSync(MealPlanRequestConflict)({
      _tag: "MealPlanRequestConflict",
      draftId,
    });
    const notFound = Schema.decodeUnknownSync(MealPlanNotFound)({
      _tag: "MealPlanNotFound",
      draftId,
    });
    const swapRejected = Schema.decodeUnknownSync(MealPlanSwapRejected)({
      _tag: "MealPlanSwapRejected",
      reason: "recipe_not_approved",
    });
    const persistenceFailure = Schema.decodeUnknownSync(
      MealPlanPersistenceFailure
    )({ _tag: "MealPlanPersistenceFailure", operation: "save" });
    const versionConflict = Schema.decodeUnknownSync(MealPlanVersionConflict)({
      _tag: "MealPlanVersionConflict",
      actualRevision: 3,
      expectedRevision: 0,
    });
    const app = makeMealPlanApp({
      gateway: HouseholdMealPlanGateway.of({
        approve: () => Effect.fail(persistenceFailure),
        create: () => Effect.fail(requestConflict),
        read: () => Effect.fail(notFound),
        reject: () => Effect.fail(versionConflict),
        swap: () => Effect.fail(swapRejected),
      }),
    });
    const sessionHeaders = {
      "content-type": "application/json",
      cookie: "better-auth.session_token=session",
    };
    const requests = [
      new Request("https://meal-planner.test/v1/meal-plans", {
        body: JSON.stringify(
          Schema.encodeSync(CreateMealPlanPayload)(createMealPlanPayload)
        ),
        headers: sessionHeaders,
        method: "POST",
      }),
      new Request(`https://meal-planner.test/v1/meal-plans/${draftId}`, {
        headers: sessionHeaders,
      }),
      new Request(`https://meal-planner.test/v1/meal-plans/${draftId}/swaps`, {
        body: JSON.stringify(
          Schema.encodeSync(SwapMealPlanPayload)(swapMealPlanPayload)
        ),
        headers: sessionHeaders,
        method: "POST",
      }),
      ...(["approve", "reject"] as const).map(
        (decision) =>
          new Request(
            `https://meal-planner.test/v1/meal-plans/${draftId}/${decision}`,
            {
              body: JSON.stringify(
                Schema.encodeSync(DecideMealPlanPayload)(decideMealPlanPayload)
              ),
              headers: sessionHeaders,
              method: "POST",
            }
          )
      ),
    ];

    const responses = await Promise.all(
      requests.map((request) => app.handler(request))
    );

    expect(responses.map(({ status }) => status)).toEqual([
      409, 404, 400, 500, 409,
    ]);
    await expect(
      Promise.all(responses.map((response) => response.json()))
    ).resolves.toEqual([
      {
        code: "meal_plan_conflict",
        message: "The meal plan changed or conflicts with an earlier request.",
        status: 409,
      },
      {
        code: "meal_plan_not_found",
        message: "Meal plan not found.",
        status: 404,
      },
      {
        code: "invalid_request",
        message: "The meal-plan request is invalid.",
        status: 400,
      },
      {
        code: "internal_error",
        message: "Household storage is temporarily unavailable.",
        status: 500,
      },
      {
        code: "meal_plan_conflict",
        message: "The meal plan changed or conflicts with an earlier request.",
        status: 409,
      },
    ]);
  });

  it("rejects invalid public input before the household gateway", async () => {
    let routed = false;
    const app = makeMealPlanApp({
      gateway: HouseholdMealPlanGateway.of({
        approve: () => Effect.die("Unexpected approve"),
        create: () => {
          routed = true;
          return Effect.succeed(createdMealPlan);
        },
        read: () => Effect.die("Unexpected read"),
        reject: () => Effect.die("Unexpected reject"),
        swap: () => Effect.die("Unexpected swap"),
      }),
    });

    const response = await app.handler(
      new Request("https://meal-planner.test/v1/meal-plans", {
        body: JSON.stringify({ policy: {}, request: {} }),
        headers: {
          "content-type": "application/json",
          cookie: "better-auth.session_token=session",
        },
        method: "POST",
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "invalid_request",
      message: "The meal-plan request is invalid.",
      status: 400,
    });
    expect(routed).toBe(false);
  });

  it("rejects oversized meal-plan requests before the household gateway", async () => {
    let routed = false;
    const app = makeMealPlanApp({
      gateway: HouseholdMealPlanGateway.of({
        approve: () => Effect.die("Unexpected approve"),
        create: () => {
          routed = true;
          return Effect.succeed(createdMealPlan);
        },
        read: () => Effect.die("Unexpected read"),
        reject: () => Effect.die("Unexpected reject"),
        swap: () => Effect.die("Unexpected swap"),
      }),
    });
    const oversizedSlots = Array.from({ length: 32 }, (_, index) => ({
      date: "2026-08-24",
      mealType: "dinner",
      servings: 2,
      slotId: `slot-${String(index + 1)}`,
    }));

    const response = await app.handler(
      new Request("https://meal-planner.test/v1/meal-plans", {
        body: JSON.stringify({
          ...Schema.encodeSync(CreateMealPlanPayload)(createMealPlanPayload),
          request: {
            requestKey: "oversized-plan",
            slots: oversizedSlots,
          },
        }),
        headers: {
          "content-type": "application/json",
          cookie: "better-auth.session_token=session",
        },
        method: "POST",
      })
    );

    expect(response.status).toBe(400);
    expect(routed).toBe(false);
  });

  it("rejects unauthenticated meal-plan requests before routing", async () => {
    let routed = false;
    const app = makeMealPlanApp({
      gateway: HouseholdMealPlanGateway.of({
        approve: () => Effect.die("Unexpected approve"),
        create: () => {
          routed = true;
          return Effect.succeed(createdMealPlan);
        },
        read: () => Effect.die("Unexpected read"),
        reject: () => Effect.die("Unexpected reject"),
        swap: () => Effect.die("Unexpected swap"),
      }),
      resolver: AuthenticatedOrganizationResolver.of({
        resolve: () =>
          Effect.fail(
            new AuthPrincipalResolutionError({ reason: "invalid_session" })
          ),
      }),
    });

    const response = await app.handler(
      new Request("https://meal-planner.test/v1/meal-plans", {
        body: JSON.stringify(
          Schema.encodeSync(CreateMealPlanPayload)(createMealPlanPayload)
        ),
        headers: { "content-type": "application/json" },
        method: "POST",
      })
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      code: "unauthorized",
      message: "Sign in and select a household to continue.",
      status: 401,
    });
    expect(routed).toBe(false);
  });
});
