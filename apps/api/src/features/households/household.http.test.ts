import {
  BootstrapHouseholdCreatorPayload,
  ChangeMealPlanPayload,
  CreateMealPlanPayload,
  DecideMealPlanPayload,
  HouseholdCreatorBootstrapConflict,
  HouseholdMealPlanResponse,
  HouseholdOrganizationId,
  HouseholdPeopleRoster,
  HouseholdPerson,
  HouseholdStatus,
  MealPlan,
  MealPlanDraft,
  MealPlanId,
  MealPlanMutationId,
  MealPlanNotFound,
  MealPlanPersistenceFailure,
  MealPlanRequestConflict,
  MealPlanRuleViolation,
  MealPlanTransitionRejected,
  MealPlanVersionConflict,
  toHouseholdMealPlanResponse,
  toMealPlanSummary,
  UserId,
} from "@meal-planner/household-api";
import { Effect, Layer, Schema } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { afterAll, describe, expect, it } from "vitest";

import { JsonHttpPlatformServices } from "../../infrastructure/json-http-platform.js";
import {
  AuthenticatedOrganizationResolver,
  AuthPrincipalResolutionError,
} from "../auth/auth.principal.js";
import { makeHouseholdRequestLayer } from "./household-request-composition.js";
import type { HouseholdDomainGateway } from "./household.gateway.js";
import {
  HouseholdDomainGateway as HouseholdDomainGatewayService,
  HouseholdMealPlanGateway,
  HouseholdPeopleGateway,
} from "./household.gateway.js";
import {
  HouseholdMealPlanHttpApiLayer,
  HouseholdPeopleHttpApiLayer,
} from "./household.http.js";

const organizationId = Schema.decodeUnknownSync(HouseholdOrganizationId)(
  "organization-a"
);
const authenticatedUserId =
  Schema.decodeUnknownSync(UserId)("authenticated-user");
const betterAuthUserA = Schema.decodeUnknownSync(UserId)("better-auth-user-a");
const householdStatus = Schema.decodeUnknownSync(HouseholdStatus)({
  createdAtEpochMs: 1_777_777_777_777,
  organizationId,
  status: "ready",
});
const planId = Schema.decodeUnknownSync(MealPlanId)("plan-week-1");
const createMealPlanPayload = Schema.decodeUnknownSync(CreateMealPlanPayload)({
  requestKey: "week-1",
  startDate: "2026-08-24",
  weeks: 1,
});
const createdMealPlan = Schema.decodeUnknownSync(MealPlanDraft)({
  _tag: "Draft",
  audit: [],
  planId,
  proposed: {
    cookEvents: [],
    coverage: [],
    number: 1,
    pins: {
      configVersion: 0,
      content: [],
      contentSnapshots: [],
      people: [],
      preparedSources: [],
      routines: [],
    },
  },
  request: createMealPlanPayload,
  revision: 0,
});
const approvedMealPlan = Schema.decodeUnknownSync(MealPlan)({
  ...createdMealPlan,
  _tag: "Approved",
  active: createdMealPlan.proposed,
  audit: [
    {
      action: "approve",
      actorId: "a".repeat(64),
      at: "2026-08-24T18:00:00.000Z",
      changedRequirements: [],
      mutationId: "decision-1",
      reason: "The household reviewed this plan.",
    },
  ],
  revision: 1,
});
const revisedMealPlan = Schema.decodeUnknownSync(MealPlan)({
  ...Schema.encodeSync(MealPlan)(approvedMealPlan),
  _tag: "ProposedRevision",
  proposed: { ...createdMealPlan.proposed, number: 2 },
  revision: 2,
});
const changeMealPlanPayload = Schema.decodeUnknownSync(ChangeMealPlanPayload)({
  change: { _tag: "RefreshInputs" },
  expectedRevision: 0,
  mutationId: Schema.decodeUnknownSync(MealPlanMutationId)("change-1"),
  reason: "Refresh confirmed planning inputs.",
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
    associateInvitation: () => Effect.die("Unexpected invitation association"),
    bootstrapCreator: () => Effect.die("Unexpected bootstrap"),
    cancelDeparture: () => Effect.die("Unexpected departure cancellation"),
    completeAdultLink: () => Effect.die("Unexpected link completion"),
    create: () => Effect.die("Unexpected create"),
    departAdult: () => Effect.die("Unexpected departure"),
    get: () => Effect.die("Unexpected get"),
    getDeparture: () => Effect.die("Unexpected departure read"),
    getDepartureByMutation: () =>
      Effect.die("Unexpected departure recovery read"),
    getProfile: () => Effect.die("Unexpected profile read"),
    inviteAdult: () => Effect.die("Unexpected invitation"),
    list,
    listProfileVersions: () => Effect.die("Unexpected profile history"),
    mutateProfile: () => Effect.die("Unexpected profile mutation"),
    remove: () => Effect.die("Unexpected remove"),
    rename: () => Effect.die("Unexpected rename"),
    repairAdultLink: () => Effect.die("Unexpected link repair"),
    restore: () => Effect.die("Unexpected restore"),
    retryDeparture: () => Effect.die("Unexpected departure retry"),
    returnAdult: () => Effect.die("Unexpected adult return"),
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
            userId: authenticatedUserId,
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
    associationState: "linked",
    associationVersion: 1,
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
    creatorSlot: "occupied",
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
    readonly userId?: typeof UserId.Type;
  }) => {
    const requestServices = Layer.mergeAll(
      Layer.succeed(
        AuthenticatedOrganizationResolver,
        AuthenticatedOrganizationResolver.of({
          resolve: () =>
            Effect.succeed({
              membershipRole: options.membershipRole,
              organizationId: options.admittedOrganizationId ?? organizationId,
              userId: options.userId ?? betterAuthUserA,
            }),
        })
      ),
      Layer.succeed(HouseholdPeopleGateway, options.gateway)
    );
    const app = HttpRouter.toWebHandler(
      HouseholdPeopleHttpApiLayer.pipe(
        Layer.provide(JsonHttpPlatformServices),
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
    const otherOrganizationId = Schema.decodeUnknownSync(
      HouseholdOrganizationId
    )("organization-b");
    const cases = [
      {
        admittedOrganizationId: organizationId,
        membershipRole: "owner",
        userId: betterAuthUserA,
      },
      {
        admittedOrganizationId: organizationId,
        membershipRole: "member",
        userId: betterAuthUserA,
      },
      {
        admittedOrganizationId: otherOrganizationId,
        membershipRole: "owner",
        userId: betterAuthUserA,
      },
      {
        admittedOrganizationId: organizationId,
        membershipRole: "owner",
        userId: Schema.decodeUnknownSync(UserId)("better-auth-user-b"),
      },
    ];

    const responses = await Promise.all(
      cases.map(({ admittedOrganizationId, membershipRole, userId }, index) =>
        makePeopleApp({
          admittedOrganizationId,
          gateway: gatewayWithList((input) =>
            Effect.sync(() => {
              admitted[index] = input.principal;
              return roster;
            })
          ),
          membershipRole,
          userId,
        }).handler(
          new Request(
            "https://meal-planner.test/v1/families/organization-a/people",
            {
              headers: {
                cookie: `better-auth.session_token=session-${String(index)}`,
              },
            }
          )
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
        "https://meal-planner.test/v1/families/organization-a/people/bootstrap-creator",
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
        "https://meal-planner.test/v1/families/organization-a/people/bootstrap-creator",
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

const gatewayWith = (
  overrides: Partial<HouseholdMealPlanGateway>
): HouseholdMealPlanGateway =>
  HouseholdMealPlanGateway.of({
    acceptRevision: () => Effect.die("Unexpected revision acceptance"),
    approve: () => Effect.die("Unexpected approval"),
    change: () => Effect.die("Unexpected change"),
    create: () => Effect.die("Unexpected creation"),
    list: () => Effect.die("Unexpected list"),
    proposeRevision: () => Effect.die("Unexpected revision proposal"),
    read: () => Effect.die("Unexpected read"),
    rejectRevision: () => Effect.die("Unexpected revision rejection"),
    ...overrides,
  });

describe("household meal-plan HttpApi boundary", () => {
  const apps: { readonly dispose: () => Promise<void> }[] = [];
  const admittedResolver = AuthenticatedOrganizationResolver.of({
    resolve: () =>
      Effect.succeed({
        membershipRole: "member",
        organizationId,
        userId: authenticatedUserId,
      }),
  });
  const sessionHeaders = {
    "content-type": "application/json",
    cookie: "better-auth.session_token=session",
  };
  const request = (path: string, payload?: Schema.Json) =>
    new Request(
      `https://meal-planner.test${path}`,
      payload === undefined
        ? { headers: sessionHeaders }
        : {
            body: JSON.stringify(payload),
            headers: sessionHeaders,
            method: "POST",
          }
    );

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
      HouseholdMealPlanHttpApiLayer.pipe(
        Layer.provide(JsonHttpPlatformServices),
        Layer.provide(requestServices),
        HttpRouter.provideRequest(requestServices)
      ),
      { disableLogger: true }
    );
    apps.push(app);
    return app;
  };

  it("uses the admitted household people principal for creation and returns a public plan", async () => {
    const admittedInputs: unknown[] = [];
    const app = makeMealPlanApp({
      gateway: gatewayWith({
        create: (input) =>
          Effect.sync(() => {
            admittedInputs.push(input);
            return createdMealPlan;
          }),
      }),
    });

    const response = await app.handler(
      request("/v1/meal-plans", createMealPlanPayload)
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual(
      toHouseholdMealPlanResponse(createdMealPlan)
    );
    expect(admittedInputs).toHaveLength(1);
    expect(admittedInputs[0]).toMatchObject({
      payload: createMealPlanPayload,
      principal: { creatorAuthority: null, organizationId },
    });
    const { principal } = admittedInputs[0] as {
      readonly principal: {
        readonly actorId: string;
        readonly linkageSubject: string;
      };
    };
    expect(principal.actorId).toMatch(/^[a-f\d]{64}$/u);
    expect(principal.linkageSubject).toMatch(/^[a-f\d]{64}$/u);
    expect(principal.actorId).not.toBe(principal.linkageSubject);
    expect(JSON.stringify(admittedInputs)).not.toContain("session_token");
  });

  it("routes list, read and every plan transition with decoded inputs", async () => {
    const calls: { readonly operation: string; readonly input: unknown }[] = [];
    const record = (
      operation: string,
      input:
        | Parameters<HouseholdMealPlanGateway["read"]>[0]
        | Parameters<HouseholdMealPlanGateway["change"]>[0]
        | Parameters<HouseholdMealPlanGateway["approve"]>[0],
      result: MealPlan
    ) =>
      Effect.sync(() => {
        calls.push({ input, operation });
        return result;
      });
    const app = makeMealPlanApp({
      gateway: gatewayWith({
        acceptRevision: (input) =>
          record("acceptRevision", input, approvedMealPlan),
        approve: (input) => record("approve", input, approvedMealPlan),
        change: (input) => record("change", input, createdMealPlan),
        list: (input) =>
          Effect.sync(() => {
            calls.push({ input, operation: "list" });
            return [toMealPlanSummary(createdMealPlan)];
          }),
        proposeRevision: (input) =>
          record("proposeRevision", input, revisedMealPlan),
        read: (input) => record("read", input, createdMealPlan),
        rejectRevision: (input) =>
          record("rejectRevision", input, approvedMealPlan),
      }),
    });
    const operations = [
      ["change", "changes", changeMealPlanPayload],
      ["approve", "approve", decideMealPlanPayload],
      ["proposeRevision", "propose-revision", decideMealPlanPayload],
      ["acceptRevision", "accept-revision", decideMealPlanPayload],
      ["rejectRevision", "reject-revision", decideMealPlanPayload],
    ] as const;
    const requests = [
      request("/v1/meal-plans"),
      request(`/v1/meal-plans/${planId}`),
      ...operations.map(([, path, payload]) =>
        request(`/v1/meal-plans/${planId}/${path}`, payload)
      ),
    ];
    const responses = await Promise.all(
      requests.map((value) => app.handler(value))
    );

    expect(responses.map(({ status }) => status)).toEqual([
      200, 200, 200, 200, 200, 200, 200,
    ]);
    const bodies = await Promise.all(
      responses.map((response) => response.json())
    );
    expect(bodies[0]).toEqual([toMealPlanSummary(createdMealPlan)]);
    expect(bodies[1]).toEqual(toHouseholdMealPlanResponse(createdMealPlan));
    expect(bodies[3]).toEqual(
      Schema.encodeSync(HouseholdMealPlanResponse)(
        toHouseholdMealPlanResponse(approvedMealPlan)
      )
    );
    expect(bodies[4]).toEqual(
      Schema.encodeSync(HouseholdMealPlanResponse)(
        toHouseholdMealPlanResponse(revisedMealPlan)
      )
    );
    expect(JSON.stringify(bodies)).not.toContain('"actorId"');
    const byOperation = new Map(
      calls.map((call) => [call.operation, call.input])
    );
    expect([...byOperation.keys()].toSorted()).toEqual(
      ["list", "read", ...operations.map(([operation]) => operation)].toSorted()
    );
    for (const call of calls) {
      expect(call.input).toMatchObject({
        principal: { creatorAuthority: null, organizationId },
      });
    }
    expect(byOperation.get("read")).toMatchObject({ planId });
    for (const [operation] of operations) {
      expect(byOperation.get(operation)).toMatchObject({ planId });
    }
    expect(byOperation.get("change")).toMatchObject({
      payload: changeMealPlanPayload,
    });
    for (const [operation] of operations.slice(1)) {
      expect(byOperation.get(operation)).toMatchObject({
        payload: decideMealPlanPayload,
      });
    }
  });

  it("rejects identity fields, impossible dates and invalid ranges before reaching the gateway", async () => {
    let routed = false;
    const app = makeMealPlanApp({
      gateway: gatewayWith({
        approve: () => {
          routed = true;
          return Effect.succeed(approvedMealPlan);
        },
        change: () => {
          routed = true;
          return Effect.succeed(createdMealPlan);
        },
        create: () => {
          routed = true;
          return Effect.succeed(createdMealPlan);
        },
      }),
    });
    const requests = [
      request("/v1/meal-plans", {
        ...createMealPlanPayload,
        organizationId: "browser-supplied",
      }),
      request("/v1/meal-plans", {
        ...createMealPlanPayload,
        startDate: "2026-99-99",
      }),
      request("/v1/meal-plans", { ...createMealPlanPayload, weeks: 13 }),
      request(`/v1/meal-plans/${planId}/changes`, {
        ...changeMealPlanPayload,
        actorId: "browser-supplied",
      }),
      request(`/v1/meal-plans/${planId}/approve`, {
        ...decideMealPlanPayload,
        decidedAt: "2026-08-24T18:00:00.000Z",
      }),
    ];
    const responses = await Promise.all(
      requests.map((value) => app.handler(value))
    );

    expect(responses.map(({ status }) => status)).toEqual([
      400, 400, 400, 400, 400,
    ]);
    expect(routed).toBe(false);
  });

  it("maps missing plans, rule and lifecycle conflicts, and storage failures to stable problems", async () => {
    const notFound = Schema.decodeUnknownSync(MealPlanNotFound)({
      _tag: "MealPlanNotFound",
      planId,
    });
    const requestConflict = Schema.decodeUnknownSync(MealPlanRequestConflict)({
      _tag: "MealPlanRequestConflict",
      planId,
    });
    const versionConflict = Schema.decodeUnknownSync(MealPlanVersionConflict)({
      _tag: "MealPlanVersionConflict",
      actualRevision: 3,
      expectedRevision: 0,
    });
    const ruleViolation = Schema.decodeUnknownSync(MealPlanRuleViolation)({
      _tag: "MealPlanRuleViolation",
      reason: "unresolved_gap",
    });
    const transitionRejected = Schema.decodeUnknownSync(
      MealPlanTransitionRejected
    )({
      _tag: "MealPlanTransitionRejected",
      lifecycle: "Draft",
    });
    const persistenceFailure = Schema.decodeUnknownSync(
      MealPlanPersistenceFailure
    )({
      _tag: "MealPlanPersistenceFailure",
      operation: "save",
    });
    const app = makeMealPlanApp({
      gateway: gatewayWith({
        acceptRevision: () => Effect.fail(versionConflict),
        approve: () => Effect.fail(persistenceFailure),
        change: () => Effect.fail(ruleViolation),
        create: () => Effect.fail(requestConflict),
        proposeRevision: () => Effect.fail(transitionRejected),
        read: () => Effect.fail(notFound),
      }),
    });
    const responses = await Promise.all([
      app.handler(request("/v1/meal-plans", createMealPlanPayload)),
      app.handler(request(`/v1/meal-plans/${planId}`)),
      app.handler(
        request(`/v1/meal-plans/${planId}/changes`, changeMealPlanPayload)
      ),
      app.handler(
        request(`/v1/meal-plans/${planId}/approve`, decideMealPlanPayload)
      ),
      app.handler(
        request(
          `/v1/meal-plans/${planId}/propose-revision`,
          decideMealPlanPayload
        )
      ),
      app.handler(
        request(
          `/v1/meal-plans/${planId}/accept-revision`,
          decideMealPlanPayload
        )
      ),
    ]);

    expect(responses.map(({ status }) => status)).toEqual([
      409, 404, 409, 500, 409, 409,
    ]);
    const problems = await Promise.all(
      responses.map((response) => response.json())
    );
    expect(problems.map((problem) => problem.code)).toEqual([
      "meal_plan_conflict",
      "meal_plan_not_found",
      "meal_plan_conflict",
      "internal_error",
      "meal_plan_conflict",
      "meal_plan_conflict",
    ]);
    expect(problems.map((problem) => problem.reason ?? null)).toEqual([
      "request_conflict",
      null,
      "unresolved_gap",
      null,
      "invalid_transition",
      "version_conflict",
    ]);
    expect(JSON.stringify(problems)).not.toContain("actualRevision");
  });

  it("explains missing managed occasions on first draft creation", async () => {
    const app = makeMealPlanApp({
      gateway: gatewayWith({
        create: () =>
          Effect.fail(
            Schema.decodeUnknownSync(MealPlanRuleViolation)({
              _tag: "MealPlanRuleViolation",
              reason: "config_missing",
            })
          ),
      }),
    });
    const response = await app.handler(
      request("/v1/meal-plans", createMealPlanPayload)
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "meal_plan_conflict",
      reason: "config_missing",
    });
  });

  it("rejects unauthenticated requests before routing", async () => {
    let routed = false;
    const app = makeMealPlanApp({
      gateway: gatewayWith({
        create: () => {
          routed = true;
          return Effect.succeed(createdMealPlan);
        },
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
        body: JSON.stringify(createMealPlanPayload),
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
