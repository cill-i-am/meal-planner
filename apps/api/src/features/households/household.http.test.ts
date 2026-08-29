import {
  BootstrapHouseholdCreatorPayload,
  CreateMealPlanPayload,
  DecideMealPlanPayload,
  HouseholdCreatorBootstrapConflict,
  HouseholdMealPlanPrincipal,
  HouseholdOrganizationId,
  HouseholdPeopleRoster,
  HouseholdPerson,
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
  HouseholdPeopleGateway,
} from "./household.gateway.js";
import {
  makeHouseholdMealPlanHttpApiLayer,
  makeHouseholdPeopleHttpApiLayer,
} from "./household.http.js";

const organizationId = Schema.decodeUnknownSync(HouseholdOrganizationId)(
  "organization-a"
);
const householdStatus = Schema.decodeUnknownSync(HouseholdStatus)({
  createdAtEpochMs: 1_777_777_777_777,
  organizationId,
  status: "ready",
});
const actorId = Schema.decodeUnknownSync(MealPlanActorId)("authenticated-user");
const admittedActorId = Schema.decodeUnknownSync(MealPlanActorId)(
  "b6613fdfccc63dff6de05dfe53238e12f9469481e51f4da22b72beb7d17bfb4e"
);
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
const approvedMealPlan = Schema.decodeUnknownSync(MealPlan)({
  ...createdMealPlan,
  _tag: "Approved",
  decision: {
    actorId,
    decidedAt: "2026-08-24T18:00:00.000Z",
    mutationId: "decision-1",
    outcome: "approved",
    reason: "The household reviewed this plan.",
  },
  revision: 1,
});
const rejectedMealPlan = Schema.decodeUnknownSync(MealPlan)({
  ...createdMealPlan,
  _tag: "Rejected",
  decision: {
    actorId,
    decidedAt: "2026-08-24T18:00:00.000Z",
    mutationId: "decision-1",
    outcome: "rejected",
    reason: "The household reviewed this plan.",
  },
  revision: 1,
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

const gatewayWithList = (
  list: HouseholdPeopleGateway["list"]
): HouseholdPeopleGateway =>
  HouseholdPeopleGateway.of({
    archive: () => Effect.die("Unexpected archive"),
    bootstrapCreator: () => Effect.die("Unexpected bootstrap"),
    create: () => Effect.die("Unexpected create"),
    get: () => Effect.die("Unexpected get"),
    list,
    restore: () => Effect.die("Unexpected restore"),
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
        ensure: (principal) =>
          Effect.sync(() => {
            routedOrganizationIds.push(principal.organizationId);
            return householdStatus;
          }),
      }),
      resolver: AuthenticatedOrganizationResolver.of({
        resolve: () =>
          Effect.succeed({
            membershipRole: "owner",
            organizationId,
            userId: "authenticated-user",
          }),
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

describe("household people identity and owner boundary", () => {
  const apps: { readonly dispose: () => Promise<void> }[] = [];
  const creator = Schema.decodeUnknownSync(HouseholdPerson)({
    createdAtEpochMs: 1,
    displayName: "Owner",
    id: "person_00000000-0000-4000-8000-000000000001",
    isCurrentAdult: true,
    kind: "adult",
    lifecycle: "active",
    updatedAtEpochMs: 1,
    version: 1,
  });
  const roster = Schema.decodeUnknownSync(HouseholdPeopleRoster)({
    currentPersonId: creator.id,
    people: [creator],
  });
  const bootstrapPayload = Schema.decodeUnknownSync(
    BootstrapHouseholdCreatorPayload
  )({ displayName: "Owner", mutationId: "bootstrap-owner" });

  afterAll(async () => {
    await Promise.all(apps.map(({ dispose }) => dispose()));
  });

  const makePeopleApp = (options: {
    readonly gateway: HouseholdPeopleGateway;
    readonly membershipRole: string;
    readonly admittedOrganizationId?: typeof organizationId;
    readonly userId?: string;
  }) => {
    const requestServices = Layer.mergeAll(
      Layer.succeed(
        AuthenticatedOrganizationResolver,
        AuthenticatedOrganizationResolver.of({
          resolve: () =>
            Effect.succeed({
              membershipRole: options.membershipRole,
              organizationId: options.admittedOrganizationId ?? organizationId,
              userId: options.userId ?? "better-auth-user-a",
            }),
        })
      ),
      Layer.succeed(HouseholdPeopleGateway, options.gateway)
    );
    const app = HttpRouter.toWebHandler(
      makeHouseholdPeopleHttpApiLayer().pipe(
        Layer.provide(RecipeImportHttpPlatformServices),
        Layer.provide(requestServices),
        HttpRouter.provideRequest(requestServices)
      ),
      { disableLogger: true }
    );
    apps.push(app);
    return app;
  };

  it("keeps linkage identity stable across sessions and membership changes while scoping it by household and user", async () => {
    const admitted: unknown[] = [];
    const captureGateway = gatewayWithList((input) =>
      Effect.sync(() => {
        admitted.push(input.principal);
        return roster;
      })
    );
    const otherOrganizationId = Schema.decodeUnknownSync(
      HouseholdOrganizationId
    )("organization-b");
    const cases = [
      {
        admittedOrganizationId: organizationId,
        membershipRole: "owner",
        userId: "better-auth-user-a",
      },
      {
        admittedOrganizationId: organizationId,
        membershipRole: "member",
        userId: "better-auth-user-a",
      },
      {
        admittedOrganizationId: otherOrganizationId,
        membershipRole: "owner",
        userId: "better-auth-user-a",
      },
      {
        admittedOrganizationId: organizationId,
        membershipRole: "owner",
        userId: "better-auth-user-b",
      },
    ];

    const responses = await Promise.all(
      cases.map(({ admittedOrganizationId, membershipRole, userId }, index) =>
        makePeopleApp({
          admittedOrganizationId,
          gateway: captureGateway,
          membershipRole,
          userId,
        }).handler(
          new Request("https://meal-planner.test/v1/household/people", {
            headers: {
              cookie: `better-auth.session_token=session-${String(index)}`,
            },
          })
        )
      )
    );
    expect(responses.map(({ status }) => status)).toEqual([200, 200, 200, 200]);

    const principals = admitted as readonly {
      readonly actorId: string;
      readonly linkageSubject: string;
    }[];
    expect(principals).toHaveLength(4);
    expect(principals[1]?.linkageSubject).toBe(principals[0]?.linkageSubject);
    expect(principals[1]?.actorId).toBe(principals[0]?.actorId);
    expect(principals[2]?.linkageSubject).not.toBe(
      principals[0]?.linkageSubject
    );
    expect(principals[3]?.linkageSubject).not.toBe(
      principals[0]?.linkageSubject
    );
    expect(principals[0]?.linkageSubject).not.toBe(principals[0]?.actorId);
    expect(JSON.stringify(principals)).not.toContain("better-auth-user");
    expect(JSON.stringify(principals)).not.toContain("session-");
  });

  it("rejects a non-owner bootstrap before invoking the household gateway", async () => {
    let invoked = false;
    const gateway = HouseholdPeopleGateway.of({
      ...gatewayWithList(() => Effect.succeed(roster)),
      bootstrapCreator: () => {
        invoked = true;
        return Effect.succeed(creator);
      },
    });
    const app = makePeopleApp({ gateway, membershipRole: "member" });
    const response = await app.handler(
      new Request(
        "https://meal-planner.test/v1/household/people/bootstrap-creator",
        {
          body: JSON.stringify(
            Schema.encodeSync(BootstrapHouseholdCreatorPayload)(
              bootstrapPayload
            )
          ),
          headers: {
            "content-type": "application/json",
            cookie: "better-auth.session_token=member-session",
          },
          method: "POST",
        }
      )
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      code: "creator_required",
      message:
        "Only the Better Auth household owner can set up the creator person.",
      status: 403,
    });
    expect(invoked).toBe(false);
  });

  it("describes an occupied creator slot without claiming the losing owner is linked", async () => {
    const gateway = HouseholdPeopleGateway.of({
      ...gatewayWithList(() => Effect.succeed(roster)),
      bootstrapCreator: () =>
        Effect.fail(HouseholdCreatorBootstrapConflict.make({})),
    });
    const app = makePeopleApp({ gateway, membershipRole: "owner" });
    const response = await app.handler(
      new Request(
        "https://meal-planner.test/v1/household/people/bootstrap-creator",
        {
          body: JSON.stringify(
            Schema.encodeSync(BootstrapHouseholdCreatorPayload)(
              bootstrapPayload
            )
          ),
          headers: {
            "content-type": "application/json",
            cookie: "better-auth.session_token=owner-session",
          },
          method: "POST",
        }
      )
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      code: "bootstrap_conflict",
      message:
        "This household already has a creator person. This account remains unlinked.",
      status: 409,
    });
  });
});

describe("household meal-plan HttpApi boundary", () => {
  const apps: { readonly dispose: () => Promise<void> }[] = [];
  const admittedResolver = AuthenticatedOrganizationResolver.of({
    resolve: () =>
      Effect.succeed({
        membershipRole: "member",
        organizationId,
        userId: "authenticated-user",
      }),
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
          actorId: admittedActorId,
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
            return approvedMealPlan;
          }),
        create: () => Effect.die("Unexpected create"),
        read: (input) =>
          Effect.sync(() => {
            calls.push({ input, operation: "read" });
            return approvedMealPlan;
          }),
        reject: (input) =>
          Effect.sync(() => {
            calls.push({ input, operation: "reject" });
            return rejectedMealPlan;
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
    const responseBodies = await Promise.all(
      responses.map((response) => response.json())
    );
    expect(responseBodies[0]).not.toHaveProperty("decision.actorId");
    expect(responseBodies[2]).not.toHaveProperty("decision.actorId");
    expect(responseBodies[3]).not.toHaveProperty("decision.actorId");
    expect(JSON.stringify(responseBodies)).not.toContain(actorId);
    expect(calls).toHaveLength(4);
    expect(calls).toEqual(
      expect.arrayContaining([
        {
          input: {
            draftId,
            principal: { actorId: admittedActorId, organizationId },
          },
          operation: "read",
        },
        {
          input: {
            draftId,
            payload: swapMealPlanPayload,
            principal: { actorId: admittedActorId, organizationId },
          },
          operation: "swap",
        },
        {
          input: {
            draftId,
            payload: decideMealPlanPayload,
            principal: { actorId: admittedActorId, organizationId },
          },
          operation: "approve",
        },
        {
          input: {
            draftId,
            payload: decideMealPlanPayload,
            principal: { actorId: admittedActorId, organizationId },
          },
          operation: "reject",
        },
      ])
    );
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
