import { MealPlanActorId, MealPlanInstant } from "@meal-planner/household-api";
import type {
  ChangeMealPlanPayload,
  DecideMealPlanPayload,
  MealPlanId,
} from "@meal-planner/household-api";
import { Clock, Effect, Schema } from "effect";

import type { HouseholdPeopleMemberAdmission } from "./rpc/command-envelope.js";

const admittedFields = (admission: HouseholdPeopleMemberAdmission) =>
  Effect.gen(function* admittedMealPlanFields() {
    const actorId = yield* Schema.decodeUnknownEffect(MealPlanActorId)(
      admission.actor.actorId
    );
    const at = yield* Schema.decodeUnknownEffect(MealPlanInstant)(
      new Date(yield* Clock.currentTimeMillis).toISOString()
    );
    return { actorId, at };
  });

export const admitMealPlanChange = (
  admission: HouseholdPeopleMemberAdmission,
  planId: MealPlanId,
  payload: ChangeMealPlanPayload
) =>
  admittedFields(admission).pipe(
    Effect.map((fields) => ({ ...payload, ...fields, planId }))
  );

export const admitMealPlanDecision = (
  admission: HouseholdPeopleMemberAdmission,
  planId: MealPlanId,
  payload: DecideMealPlanPayload
) =>
  admittedFields(admission).pipe(
    Effect.map((fields) => ({ ...payload, ...fields, planId }))
  );
