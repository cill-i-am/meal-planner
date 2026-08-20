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
  it("keeps internal actor attribution out of the public schema and generated client", () => {
    type Client = HttpApiClient.ForApi<typeof HouseholdMealPlanApi>;
    type MealPlanClient = Client["mealPlans"];
    type CreateResponse = Effect.Success<ReturnType<MealPlanClient["create"]>>;
    type ReadResponse = Effect.Success<ReturnType<MealPlanClient["read"]>>;
    type SwapResponse = Effect.Success<ReturnType<MealPlanClient["swap"]>>;
    type ApproveResponse = Effect.Success<
      ReturnType<MealPlanClient["approve"]>
    >;
    type RejectResponse = Effect.Success<ReturnType<MealPlanClient["reject"]>>;
    type ApprovedResponse = Extract<
      ReadResponse,
      { readonly _tag: "Approved" }
    >;

    expectTypeOf<ReadResponse["audit"][number]>().not.toHaveProperty("actorId");
    expectTypeOf<ApprovedResponse["decision"]>().not.toHaveProperty("actorId");
    expectTypeOf<CreateResponse>().toEqualTypeOf<HouseholdMealPlanResponse>();
    expectTypeOf<ReadResponse>().toEqualTypeOf<HouseholdMealPlanResponse>();
    expectTypeOf<SwapResponse>().toEqualTypeOf<HouseholdMealPlanResponse>();
    expectTypeOf<ApproveResponse>().toEqualTypeOf<HouseholdMealPlanResponse>();
    expectTypeOf<RejectResponse>().toEqualTypeOf<HouseholdMealPlanResponse>();

    const document = OpenApi.fromApi(HouseholdMealPlanApi);
    expect(JSON.stringify(document)).not.toContain("actorId");
  });

  it("projects internal swap and decision actors out of serialized responses", () => {
    const recipe = {
      approvedAt: "2026-08-19T12:00:00.000Z",
      extractionFingerprint: "extraction-fingerprint",
      importId: "a9f513cb-d1cc-4ae8-99fb-20113da1b83a",
      recipe: {
        ingredientLines: ["1 ingredient"],
        instructions: ["Cook it."],
        name: "Private Actor Test Recipe",
      },
      source: {
        evidenceFingerprint: "evidence-fingerprint",
        sourceUrl: null,
      },
      tags: {
        cuisines: ["Mediterranean"],
        dietaryFit: "household_match",
        difficulty: "easy",
        leftovers: "none",
        mealTypes: ["dinner"],
        totalTimeBand: "under_30_minutes",
      },
      version: 1,
    } as const;
    const internal = Schema.decodeUnknownSync(MealPlan)({
      _tag: "Approved",
      audit: [
        {
          actorId: "better-auth-user-secret",
          fromRecipe: recipe,
          mutationId: "swap-1",
          reason: "Use the household alternative.",
          slotId: "monday-dinner",
          swappedAt: "2026-08-19T12:30:00.000Z",
          toRecipe: recipe,
        },
      ],
      decision: {
        actorId: "better-auth-user-secret",
        decidedAt: "2026-08-19T12:45:00.000Z",
        mutationId: "approve-1",
        outcome: "approved",
        reason: "The household approved this plan.",
      },
      draftId: "draft-week-1",
      gaps: [],
      meals: [],
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
      revision: 2,
    });

    const encoded = Schema.encodeSync(HouseholdMealPlanResponse)(
      toHouseholdMealPlanResponse(internal)
    );

    expect(encoded).not.toHaveProperty("audit.0.actorId");
    expect(encoded).not.toHaveProperty("decision.actorId");
    expect(JSON.stringify(encoded)).not.toContain("better-auth-user-secret");
  });
});
