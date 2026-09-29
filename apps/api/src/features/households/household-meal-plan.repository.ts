import {
  MealPlan,
  MealPlanMutationConflict,
  MealPlanNotFound,
  MealPlanPersistenceFailure,
  MealPlanRequestConflict,
  MealPlanRuleViolation,
  MealPlanVersionConflict,
  PlanningContentVersion,
} from "@meal-planner/household-api";
import type { MealPlanId } from "@meal-planner/household-api";
import { and, desc, eq, sql } from "drizzle-orm";
import type { EffectSQLiteDoDatabase } from "drizzle-orm/effect-sqlite-do";
import { Effect, Option, Schema } from "effect";

import {
  consumptionWeekStart,
  requirementIdentity,
} from "../meal-planning/index.js";
import type { MealPlanRepository } from "../meal-planning/index.js";
import {
  householdPeople,
  householdMealPlanMutationReceipts,
  householdMealPlans,
  householdProfileVersions,
} from "./household.database-schema.js";
import {
  preparedReservationIntent,
  syncPreparedReservationsForPlan,
} from "./meal-content/household-meal-content.repository.js";
import type { HouseholdDigestService } from "./shared-kernel/authority-services.js";

const EncodedMealPlan = Schema.fromJsonString(MealPlan);

const encodePlan = Schema.encodeSync(EncodedMealPlan);
const MaximumPersistedMealPlanBytes = 1_900_000;
// A terminal decision can add up to 26,112 bytes when its 4,096-character
// reason and two 128-character identifiers all require six-byte JSON escapes.
// The remaining 6,656 bytes cover keys, quotes, lifecycle-tag growth, the
// decision timestamp, and UTF-8 overhead.
const TerminalDecisionHeadroomBytes = 32_768;
const MaximumPersistedMutablePlanBytes =
  MaximumPersistedMealPlanBytes - TerminalDecisionHeadroomBytes;
const utf8Encoder = new TextEncoder();

const persistenceFailure = (
  operation: (typeof MealPlanPersistenceFailure.Type)["operation"]
) => MealPlanPersistenceFailure.make({ operation });

const encodePersistablePlan = (
  plan: typeof MealPlan.Type,
  operation: "create" | "save"
): Effect.Effect<string, MealPlanPersistenceFailure> => {
  const encoded = encodePlan(plan);
  const maximumBytes = MaximumPersistedMutablePlanBytes;
  return utf8Encoder.encode(encoded).byteLength <= maximumBytes
    ? Effect.succeed(encoded)
    : Effect.fail(persistenceFailure(operation));
};

const decodePlan = (planJson: string, operation: "read" | "save") =>
  Schema.decodeUnknownEffect(EncodedMealPlan)(planJson).pipe(
    Effect.mapError(() => persistenceFailure(operation))
  );

const queryFailure =
  (operation: "create" | "read" | "save") =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(Effect.mapError(() => persistenceFailure(operation)));

const ruleViolation = (reason: (typeof MealPlanRuleViolation.Type)["reason"]) =>
  MealPlanRuleViolation.make({ reason });

const verifyPersonPins = (
  transaction: Parameters<
    Parameters<EffectSQLiteDoDatabase["transaction"]>[0]
  >[0],
  plan: typeof MealPlan.Type
) =>
  Effect.gen(function* verifyPlanningPeople() {
    const version = plan._tag === "Approved" ? plan.active : plan.proposed;
    const active = yield* transaction
      .select({ personId: householdPeople.personId })
      .from(householdPeople)
      .where(eq(householdPeople.lifecycle, "active"))
      .pipe(queryFailure("save"));
    const activeIds = new Set(active.map(({ personId }) => personId));
    const pinnedIds = new Set<string>(
      version.pins.people.map(({ personId }) => personId)
    );
    if (
      activeIds.size !== pinnedIds.size ||
      [...activeIds].some((id) => !pinnedIds.has(id))
    ) {
      return yield* Effect.fail(ruleViolation("profile_version_changed"));
    }
    const rows = yield* transaction
      .select({
        personId: householdProfileVersions.personId,
        version: householdProfileVersions.version,
      })
      .from(householdProfileVersions)
      .orderBy(desc(householdProfileVersions.version))
      .pipe(queryFailure("save"));
    const latest = new Map<string, number>();
    for (const row of rows) {
      if (!latest.has(row.personId)) {
        latest.set(row.personId, row.version);
      }
    }
    for (const pin of version.pins.people) {
      if ((latest.get(pin.personId) ?? 0) !== pin.profileVersion) {
        return yield* Effect.fail(ruleViolation("profile_version_changed"));
      }
    }
  });

export const makeHouseholdMealPlanRepository = (
  database: EffectSQLiteDoDatabase,
  digest: HouseholdDigestService
): MealPlanRepository => ({
  create: ({ draft, requestFingerprint }) =>
    Effect.gen(function* createMealPlanWithReplayDigest() {
      const requestFingerprintDigest = yield* digest
        .sha256(requestFingerprint)
        .pipe(Effect.mapError(() => persistenceFailure("create")));
      return yield* database.transaction((transaction) =>
        Effect.gen(function* createHouseholdMealPlan() {
          const [existing] = yield* transaction
            .select()
            .from(householdMealPlans)
            .where(eq(householdMealPlans.draftId, draft.planId))
            .limit(1)
            .pipe(queryFailure("create"));
          if (existing !== undefined) {
            return existing.requestFingerprintDigest ===
              requestFingerprintDigest
              ? yield* decodePlan(existing.planJson, "read")
              : yield* Effect.fail(
                  MealPlanRequestConflict.make({ planId: draft.planId })
                );
          }
          const planJson = yield* encodePersistablePlan(draft, "create");
          yield* transaction
            .insert(householdMealPlans)
            .values({
              draftId: draft.planId,
              planJson,
              requestFingerprintDigest,
              revision: draft.revision,
            })
            .pipe(queryFailure("create"));
          return draft;
        })
      );
    }).pipe(
      Effect.catchTag("SqlError", () =>
        Effect.fail(persistenceFailure("create"))
      )
    ),
  find: (planId: MealPlanId) =>
    database
      .select()
      .from(householdMealPlans)
      .where(eq(householdMealPlans.draftId, planId))
      .limit(1)
      .pipe(
        queryFailure("read"),
        Effect.flatMap(([row]) =>
          row === undefined
            ? Effect.succeed(Option.none<MealPlan>())
            : decodePlan(row.planJson, "read").pipe(Effect.map(Option.some))
        )
      ),
  findMutation: ({ planId, mutationFingerprint, mutationId }) =>
    database
      .select()
      .from(householdMealPlanMutationReceipts)
      .where(
        and(
          eq(householdMealPlanMutationReceipts.draftId, planId),
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
  listRecent: () =>
    database
      .select({ planJson: householdMealPlans.planJson })
      .from(householdMealPlans)
      .orderBy(desc(sql<number>`rowid`))
      .limit(12)
      .pipe(
        queryFailure("read"),
        Effect.flatMap((rows) =>
          Effect.all(rows.map(({ planJson }) => decodePlan(planJson, "read")))
        )
      ),
  save: (input) =>
    Effect.gen(function* saveWithPreparedIntent() {
      const decision = input.next.audit.at(-1);
      const reservationInput =
        input.next._tag === "Approved" && decision !== undefined
          ? {
              actorId: decision.actorId,
              allocations: input.next.active.coverage.flatMap(
                ({ requirement, resolution }) =>
                  resolution._tag === "Prepared"
                    ? [
                        {
                          amount: resolution.quantity.amount,
                          coverageKey: requirementIdentity(requirement),
                          date: requirement.date,
                          outputId: resolution.outputId,
                          unit: resolution.quantity.unit,
                          weekStart: consumptionWeekStart(
                            input.next.request,
                            requirement.date
                          ),
                        },
                      ]
                    : []
              ),
              expectedConfigVersion: PlanningContentVersion.make(
                input.next.active.pins.configVersion
              ),
              mutationId: input.mutationId,
              planId: input.next.planId,
            }
          : null;
      const intentDigest =
        reservationInput === null
          ? null
          : yield* digest
              .sha256(preparedReservationIntent(reservationInput))
              .pipe(Effect.mapError(() => persistenceFailure("save")));
      return yield* database.transaction((transaction) =>
        Effect.gen(function* saveHouseholdMealPlan() {
          const [receipt] = yield* transaction
            .select()
            .from(householdMealPlanMutationReceipts)
            .where(
              and(
                eq(
                  householdMealPlanMutationReceipts.draftId,
                  input.next.planId
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
            .where(eq(householdMealPlans.draftId, input.next.planId))
            .limit(1)
            .pipe(queryFailure("save"));
          if (currentRow === undefined) {
            return yield* Effect.fail(
              MealPlanNotFound.make({ planId: input.next.planId })
            );
          }
          const current = yield* decodePlan(currentRow.planJson, "save");
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

          const activatesVersion =
            input.next._tag === "Approved" &&
            (current._tag === "Draft" ||
              (current._tag === "ProposedRevision" &&
                input.next.active.number !== current.active.number));
          if (activatesVersion && input.next._tag === "Approved") {
            yield* verifyPersonPins(transaction, input.next);
            if (reservationInput === null || intentDigest === null) {
              return yield* Effect.fail(persistenceFailure("save"));
            }
            yield* syncPreparedReservationsForPlan(transaction, {
              ...reservationInput,
              intentDigest,
            }).pipe(
              Effect.mapError((error) => {
                switch (error.reason) {
                  case "stale_version": {
                    return ruleViolation("config_version_changed");
                  }
                  case "quantity_exceeded": {
                    return ruleViolation("prepared_overallocated");
                  }
                  case "invalid_transition": {
                    return ruleViolation("prepared_output_missing");
                  }
                  default: {
                    return persistenceFailure("save");
                  }
                }
              })
            );
          }

          const resultJson = yield* encodePersistablePlan(input.next, "save");
          yield* transaction
            .update(householdMealPlans)
            .set({
              planJson: resultJson,
              revision: input.next.revision,
            })
            .where(
              and(
                eq(householdMealPlans.draftId, input.next.planId),
                eq(householdMealPlans.revision, input.expectedRevision)
              )
            )
            .pipe(queryFailure("save"));
          yield* transaction
            .insert(householdMealPlanMutationReceipts)
            .values({
              draftId: input.next.planId,
              mutationFingerprint: input.mutationFingerprint,
              mutationId: input.mutationId,
              resultJson,
            })
            .pipe(queryFailure("save"));
          return input.next;
        })
      );
    }).pipe(
      Effect.catchTag("SqlError", () => Effect.fail(persistenceFailure("save")))
    ),
});
