import {
  ChangeMealPlanPayload,
  DecideMealPlanPayload,
  MealPlanId,
  MealPlanInstant,
  MealPlanMutationId,
} from "@meal-planner/household-api";
import { Effect, Schema } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";

import {
  admitMealPlanChange,
  admitMealPlanDecision,
} from "./household-meal-plan-admission.js";
import { HouseholdPeopleMemberAdmission } from "./rpc/command-envelope.js";

const actorId = "a".repeat(64);
const admission = Schema.decodeUnknownSync(HouseholdPeopleMemberAdmission)({
  actor: { _tag: "PeopleMember", actorId, linkageSubject: "b".repeat(64) },
  organizationId: "organization-a",
});
const planId = Schema.decodeUnknownSync(MealPlanId)("plan-a");
const mutationId = Schema.decodeUnknownSync(MealPlanMutationId)("mutation-a");

describe("household meal-plan admission", () => {
  it("binds plan audit identity and time to the admitted adult", async () => {
    const payload = Schema.decodeUnknownSync(DecideMealPlanPayload)({
      expectedRevision: 1,
      mutationId,
      reason: "Approve the reviewed plan.",
    });
    const result = await Effect.runPromise(
      Effect.gen(function* admitAtDeterministicTime() {
        yield* TestClock.setTime(Date.parse("2026-08-22T09:30:00.000Z"));
        return yield* admitMealPlanDecision(admission, planId, payload);
      }).pipe(Effect.provide(TestClock.layer()))
    );
    expect(result).toMatchObject({
      actorId,
      planId,
    });
    expect(Schema.encodeSync(MealPlanInstant)(result.at)).toBe(
      "2026-08-22T09:30:00.000Z"
    );
  });

  it("binds a proposed change to the admitted adult", async () => {
    const payload = Schema.decodeUnknownSync(ChangeMealPlanPayload)({
      change: { _tag: "RefreshInputs" },
      expectedRevision: 1,
      mutationId,
      reason: "Refresh saved family inputs.",
    });
    const result = await Effect.runPromise(
      Effect.gen(function* admitAtDeterministicTime() {
        yield* TestClock.setTime(Date.parse("2026-08-22T09:31:00.000Z"));
        return yield* admitMealPlanChange(admission, planId, payload);
      }).pipe(Effect.provide(TestClock.layer()))
    );
    expect(result).toMatchObject({
      actorId,
      change: { _tag: "RefreshInputs" },
      planId,
    });
  });
});
