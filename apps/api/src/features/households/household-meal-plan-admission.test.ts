import {
  ManualMealSwapRequest,
  MealPlanDecisionRequest,
  MealPlanDraftId,
  MealPlanMutationId,
  MealPlanRecipeSnapshot,
  MealPlanSlotId,
} from "@meal-planner/household-api";
import { Effect, Schema } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";

import {
  admitManualMealSwap,
  admitMealPlanDecision,
} from "./household-meal-plan-admission.js";
import {
  HouseholdManualMealSwapCommand,
  HouseholdMealPlanDecisionCommand,
} from "./household-meal-plan.contract.js";
import { HouseholdMemberAdmission } from "./rpc/command-envelope.js";

const actorId = "a".repeat(64);
const admission = Schema.decodeUnknownSync(HouseholdMemberAdmission)({
  actor: { _tag: "Member", actorId },
  organizationId: "organization-a",
});
const draftId = Schema.decodeUnknownSync(MealPlanDraftId)("draft-a");
const mutationId = Schema.decodeUnknownSync(MealPlanMutationId)("mutation-a");

describe("household meal-plan admission", () => {
  it("binds decision audit identity and time to object-provided authority", async () => {
    const command = Schema.decodeUnknownSync(HouseholdMealPlanDecisionCommand)({
      draftId,
      expectedRevision: 1,
      mutationId,
      reason: "Approved by the admitted household member.",
    });
    const result = await Effect.runPromise(
      Effect.gen(function* admitAtDeterministicTime() {
        yield* TestClock.setTime(Date.parse("2026-08-22T09:30:00.000Z"));
        return yield* admitMealPlanDecision(admission, command);
      }).pipe(Effect.provide(TestClock.layer()))
    );

    expect(Schema.encodeSync(MealPlanDecisionRequest)(result)).toMatchObject({
      actorId,
      decidedAt: "2026-08-22T09:30:00.000Z",
    });
  });

  it("binds swap audit identity and time to object-provided authority", async () => {
    const command = Schema.decodeUnknownSync(HouseholdManualMealSwapCommand)({
      draftId,
      expectedRevision: 1,
      mutationId,
      reason: "Use the approved household alternative.",
      replacementImportId: Schema.decodeUnknownSync(
        MealPlanRecipeSnapshot.fields.importId
      )("52d88ef9-2a18-4cfc-9020-7f872020ed39"),
      slotId: Schema.decodeUnknownSync(MealPlanSlotId)("dinner-a"),
    });
    const result = await Effect.runPromise(
      Effect.gen(function* admitAtDeterministicTime() {
        yield* TestClock.setTime(Date.parse("2026-08-22T09:31:00.000Z"));
        return yield* admitManualMealSwap(admission, command);
      }).pipe(Effect.provide(TestClock.layer()))
    );

    expect(Schema.encodeSync(ManualMealSwapRequest)(result)).toMatchObject({
      actorId,
      swappedAt: "2026-08-22T09:31:00.000Z",
    });
  });
});
