import {
  MealPlan,
  MealPlanMutationConflict,
  MealPlanNotFound,
  MealPlanPersistenceFailure,
  MealPlanRequestConflict,
  MealPlanTransitionRejected,
  MealPlanVersionConflict,
} from "@meal-planner/household-api";
import type { MealPlanDraftId } from "@meal-planner/household-api";
import { and, eq } from "drizzle-orm";
import type { EffectSQLiteDoDatabase } from "drizzle-orm/effect-sqlite-do";
import { Effect, Option, Schema } from "effect";

import type { MealPlanDraftRepository } from "../meal-planning/meal-plan.js";
import {
  householdMealPlanMutationReceipts,
  householdMealPlans,
} from "./household.database-schema.js";

const EncodedMealPlan = Schema.fromJsonString(MealPlan);

const encodePlan = Schema.encodeSync(EncodedMealPlan);

const persistenceFailure = (
  operation: (typeof MealPlanPersistenceFailure.Type)["operation"]
) => MealPlanPersistenceFailure.make({ operation });

const decodePlan = (planJson: string, operation: "read" | "save") =>
  Schema.decodeUnknownEffect(EncodedMealPlan)(planJson).pipe(
    Effect.mapError(() => persistenceFailure(operation))
  );

const queryFailure =
  (operation: "create" | "read" | "save") =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(Effect.mapError(() => persistenceFailure(operation)));

export const makeHouseholdMealPlanRepository = (
  database: EffectSQLiteDoDatabase
): MealPlanDraftRepository => ({
  create: ({ draft, requestFingerprint }) =>
    database
      .transaction((transaction) =>
        Effect.gen(function* createHouseholdMealPlan() {
          const [existing] = yield* transaction
            .select()
            .from(householdMealPlans)
            .where(eq(householdMealPlans.draftId, draft.draftId))
            .limit(1)
            .pipe(queryFailure("create"));
          if (existing !== undefined) {
            return existing.requestFingerprint === requestFingerprint
              ? yield* decodePlan(existing.planJson, "read")
              : yield* Effect.fail(
                  MealPlanRequestConflict.make({ draftId: draft.draftId })
                );
          }
          yield* transaction
            .insert(householdMealPlans)
            .values({
              draftId: draft.draftId,
              planJson: encodePlan(draft),
              requestFingerprint,
              revision: draft.revision,
            })
            .pipe(queryFailure("create"));
          return draft;
        })
      )
      .pipe(
        Effect.catchTag("SqlError", () =>
          Effect.fail(persistenceFailure("create"))
        )
      ),
  find: (draftId: MealPlanDraftId) =>
    database
      .select()
      .from(householdMealPlans)
      .where(eq(householdMealPlans.draftId, draftId))
      .limit(1)
      .pipe(
        queryFailure("read"),
        Effect.flatMap(([row]) =>
          row === undefined
            ? Effect.succeed(Option.none<MealPlan>())
            : decodePlan(row.planJson, "read").pipe(Effect.map(Option.some))
        )
      ),
  findMutation: ({ draftId, mutationFingerprint, mutationId }) =>
    database
      .select()
      .from(householdMealPlanMutationReceipts)
      .where(
        and(
          eq(householdMealPlanMutationReceipts.draftId, draftId),
          eq(householdMealPlanMutationReceipts.mutationId, mutationId)
        )
      )
      .limit(1)
      .pipe(
        queryFailure("read"),
        Effect.flatMap(([row]) =>
          Effect.gen(function* findMealPlanMutation() {
            if (row === undefined) {
              return Option.none<MealPlan>();
            }
            if (row.mutationFingerprint !== mutationFingerprint) {
              return yield* Effect.fail(
                MealPlanMutationConflict.make({ mutationId })
              );
            }
            return Option.some(yield* decodePlan(row.resultJson, "read"));
          })
        )
      ),
  save: (input) =>
    database
      .transaction((transaction) =>
        Effect.gen(function* saveHouseholdMealPlan() {
          const [receipt] = yield* transaction
            .select()
            .from(householdMealPlanMutationReceipts)
            .where(
              and(
                eq(
                  householdMealPlanMutationReceipts.draftId,
                  input.next.draftId
                ),
                eq(
                  householdMealPlanMutationReceipts.mutationId,
                  input.mutationId
                )
              )
            )
            .limit(1)
            .pipe(queryFailure("save"));
          if (receipt !== undefined) {
            return receipt.mutationFingerprint === input.mutationFingerprint
              ? yield* decodePlan(receipt.resultJson, "save")
              : yield* Effect.fail(
                  MealPlanMutationConflict.make({
                    mutationId: input.mutationId,
                  })
                );
          }

          const [currentRow] = yield* transaction
            .select()
            .from(householdMealPlans)
            .where(eq(householdMealPlans.draftId, input.next.draftId))
            .limit(1)
            .pipe(queryFailure("save"));
          if (currentRow === undefined) {
            return yield* Effect.fail(
              MealPlanNotFound.make({ draftId: input.next.draftId })
            );
          }
          const current = yield* decodePlan(currentRow.planJson, "save");
          if (current._tag !== "Draft") {
            return yield* Effect.fail(
              MealPlanTransitionRejected.make({ lifecycle: current._tag })
            );
          }
          if (current.revision !== input.expectedRevision) {
            return yield* Effect.fail(
              MealPlanVersionConflict.make({
                actualRevision: current.revision,
                expectedRevision: input.expectedRevision,
              })
            );
          }
          if (input.next.revision !== current.revision + 1) {
            return yield* Effect.fail(persistenceFailure("save"));
          }

          const resultJson = encodePlan(input.next);
          yield* transaction
            .update(householdMealPlans)
            .set({
              planJson: resultJson,
              revision: input.next.revision,
            })
            .where(
              and(
                eq(householdMealPlans.draftId, input.next.draftId),
                eq(householdMealPlans.revision, input.expectedRevision)
              )
            )
            .pipe(queryFailure("save"));
          yield* transaction
            .insert(householdMealPlanMutationReceipts)
            .values({
              draftId: input.next.draftId,
              mutationFingerprint: input.mutationFingerprint,
              mutationId: input.mutationId,
              resultJson,
            })
            .pipe(queryFailure("save"));
          return input.next;
        })
      )
      .pipe(
        Effect.catchTag("SqlError", () =>
          Effect.fail(persistenceFailure("save"))
        )
      ),
});
