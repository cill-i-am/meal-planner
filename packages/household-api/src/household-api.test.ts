import type { Effect } from "effect";
import { Schema } from "effect";
import type { HttpApiClient } from "effect/unstable/httpapi";
import { OpenApi } from "effect/unstable/httpapi";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  HouseholdApi,
  HouseholdMealPlanApi,
  HouseholdMealPlanResponse,
  HouseholdOrganizationId,
  HouseholdStatus,
  MealPlan,
  toHouseholdMealPlanResponse,
} from "./index.js";

describe("Household API protocol", () => {
  it("keeps organization selection out of the browser request", () => {
    const document = OpenApi.fromApi(HouseholdApi);
    const operation = document.paths["/v1/household"]?.get;
    expect(operation).toMatchObject({
      responses: {
        "200": expect.any(Object),
        "401": expect.any(Object),
        "500": expect.any(Object),
      },
    });
    expect(operation?.parameters).toEqual([]);
    expect(operation).not.toHaveProperty("requestBody");
  });

  it("admits only bounded organization IDs and ready status values", () => {
    expect(Schema.is(HouseholdOrganizationId)("organization-a")).toBe(true);
    expect(Schema.is(HouseholdOrganizationId)(" organization-a ")).toBe(false);
    expect(
      Schema.is(HouseholdStatus)({
        createdAtEpochMs: 1,
        organizationId: "organization-a",
        status: "ready",
      })
    ).toBe(true);
  });
});

describe("Household meal-plan HTTP protocol", () => {
  it("generates typed list, creation, change, and decision methods", () => {
    type Client = HttpApiClient.ForApi<typeof HouseholdMealPlanApi>;
    type MealPlanClient = Client["mealPlans"];
    type CreateResponse = Effect.Success<ReturnType<MealPlanClient["create"]>>;
    type ReadResponse = Effect.Success<ReturnType<MealPlanClient["read"]>>;
    type ChangeResponse = Effect.Success<ReturnType<MealPlanClient["change"]>>;
    type ApproveResponse = Effect.Success<
      ReturnType<MealPlanClient["approve"]>
    >;
    type AcceptResponse = Effect.Success<
      ReturnType<MealPlanClient["acceptRevision"]>
    >;
    expectTypeOf<CreateResponse>().toEqualTypeOf<HouseholdMealPlanResponse>();
    expectTypeOf<ReadResponse>().toEqualTypeOf<HouseholdMealPlanResponse>();
    expectTypeOf<ChangeResponse>().toEqualTypeOf<HouseholdMealPlanResponse>();
    expectTypeOf<ApproveResponse>().toEqualTypeOf<HouseholdMealPlanResponse>();
    expectTypeOf<AcceptResponse>().toEqualTypeOf<HouseholdMealPlanResponse>();
    expectTypeOf<ReadResponse["audit"][number]>().not.toHaveProperty("actorId");

    const document = OpenApi.fromApi(HouseholdMealPlanApi);
    expect(document.paths["/v1/meal-plans"]?.get).toBeDefined();
    expect(
      document.paths["/v1/meal-plans/{planId}/changes"]?.post
    ).toBeDefined();
    expect(JSON.stringify(document)).not.toContain("actorId");
  });

  it("removes the internal actor digest from serialized plan responses", () => {
    const internal = Schema.decodeUnknownSync(MealPlan)({
      _tag: "Draft",
      audit: [
        {
          action: "change_coverage",
          actorId: "private_actor_digest",
          at: "2026-09-28T10:00:00.000Z",
          changedRequirements: [],
          mutationId: "change_1",
          reason: "Adult edit.",
        },
      ],
      planId: "week_family_1",
      proposed: {
        cookEvents: [],
        coverage: [],
        number: 1,
        pins: {
          configVersion: 1,
          content: [],
          contentSnapshots: [],
          people: [],
          preparedSources: [],
          routines: [],
        },
      },
      request: {
        requestKey: "week_family_1",
        startDate: "2026-09-28",
        weeks: 1,
      },
      revision: 1,
    });
    const encoded = Schema.encodeSync(HouseholdMealPlanResponse)(
      toHouseholdMealPlanResponse(internal)
    );
    expect(JSON.stringify(encoded)).not.toContain("private_actor_digest");
    expect(encoded.audit[0]).not.toHaveProperty("actorId");
  });
});
