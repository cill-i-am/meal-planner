import {
  ManualMealSwapRequest,
  MealPlanDecisionRequest,
} from "@meal-planner/household-api";
import { Clock, Effect, Schema } from "effect";

import type {
  HouseholdManualMealSwapCommand,
  HouseholdMealPlanDecisionCommand,
} from "./household-meal-plan.contract.js";
import type { HouseholdMemberAdmission } from "./rpc/command-envelope.js";

const mutationInstant = Clock.currentTimeMillis.pipe(
  Effect.map((millis) => new Date(millis).toISOString())
);

/**
 * Complete an admitted decision inside the HouseholdObject. Audit identity is
 * bound to the admitted member and time comes from Effect's Clock service.
 */
export const admitMealPlanDecision = (
  admission: HouseholdMemberAdmission,
  command: HouseholdMealPlanDecisionCommand
) =>
  mutationInstant.pipe(
    Effect.flatMap((decidedAt) =>
      Schema.decodeUnknownEffect(MealPlanDecisionRequest)({
        ...command,
        actorId: admission.actor.actorId,
        decidedAt,
      })
    )
  );

/** Complete an admitted manual swap under the same object-owned audit rules. */
export const admitManualMealSwap = (
  admission: HouseholdMemberAdmission,
  command: HouseholdManualMealSwapCommand
) =>
  mutationInstant.pipe(
    Effect.flatMap((swappedAt) =>
      Schema.decodeUnknownEffect(ManualMealSwapRequest)({
        ...command,
        actorId: admission.actor.actorId,
        swappedAt,
      })
    )
  );
