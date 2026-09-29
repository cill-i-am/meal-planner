import {
  HouseholdPersonId,
  MutatePlanningContentPayload,
  PlanningContentRejected,
  PlanningContentSnapshot,
  PlanningContentVersion,
  PlanningDate,
  ProfileVersion,
  SavedRecipePage,
  SavedRecipeSummary,
} from "@meal-planner/household-api";
import type {
  HouseholdPeoplePrincipal,
  SavedRecipePageQuery,
} from "@meal-planner/household-api";
import { and, asc, desc, eq, gt } from "drizzle-orm";
import type { EffectSQLiteDoDatabase } from "drizzle-orm/effect-sqlite-do";
import { Clock, Effect, Schema } from "effect";

import {
  applyPlanningContentCommand,
  emptyPlanningContentSnapshot,
} from "../../meal-content/index.js";
import {
  householdPeople,
  householdPersonAccountLinks,
  householdProfileVersions,
  householdRecipes,
} from "../household.database-schema.js";
import type { HouseholdDigestService } from "../shared-kernel/authority-services.js";
import { householdPlanningContentVersions } from "./household-meal-content.database-schema.js";

type Actor = Pick<HouseholdPeoplePrincipal, "actorId" | "linkageSubject">;
type Transaction = Parameters<
  Parameters<EffectSQLiteDoDatabase["transaction"]>[0]
>[0];
export type HouseholdPlanningContentTransaction = Transaction;
const EncodedSnapshot = Schema.fromJsonString(PlanningContentSnapshot);
const SavedRecipeNameSource = Schema.fromJsonString(
  Schema.Struct({
    recipe: Schema.Struct({ name: Schema.NullOr(Schema.String) }),
  })
);
const decodeSnapshot = Schema.decodeUnknownEffect(EncodedSnapshot);
const encodeSnapshot = Schema.encodeSync(EncodedSnapshot);
const reject = (reason: PlanningContentRejected["reason"]) =>
  PlanningContentRejected.make({ reason });
const unavailable = () => reject("unavailable");

const activeAdult = (database: Transaction, actor: Actor) =>
  Effect.gen(function* checkActiveAdult() {
    const [person] = yield* database
      .select({ id: householdPeople.personId })
      .from(householdPersonAccountLinks)
      .innerJoin(
        householdPeople,
        eq(householdPeople.personId, householdPersonAccountLinks.personId)
      )
      .where(
        and(
          eq(householdPersonAccountLinks.linkageSubject, actor.linkageSubject),
          eq(householdPersonAccountLinks.state, "linked"),
          eq(householdPeople.kind, "adult"),
          eq(householdPeople.lifecycle, "active")
        )
      )
      .limit(1)
      .pipe(Effect.mapError(unavailable));
    if (!person) {
      return yield* Effect.fail(reject("missing_person"));
    }
  });

const latest = (database: Transaction) =>
  Effect.gen(function* latestPlanningContent() {
    const [row] = yield* database
      .select()
      .from(householdPlanningContentVersions)
      .orderBy(desc(householdPlanningContentVersions.version))
      .limit(1)
      .pipe(Effect.mapError(unavailable));
    return row
      ? yield* decodeSnapshot(row.snapshotJson).pipe(
          Effect.mapError(unavailable)
        )
      : emptyPlanningContentSnapshot();
  });

const currentAuthority = (database: Transaction, actor: Actor) =>
  Effect.gen(function* loadContentAuthority() {
    yield* activeAdult(database, actor);
    const people = yield* database
      .select({ personId: householdPeople.personId })
      .from(householdPeople)
      .where(eq(householdPeople.lifecycle, "active"))
      .pipe(Effect.mapError(unavailable));
    const profileRows = yield* database
      .select({
        personId: householdProfileVersions.personId,
        version: householdProfileVersions.version,
      })
      .from(householdProfileVersions)
      .orderBy(desc(householdProfileVersions.version))
      .pipe(Effect.mapError(unavailable));
    const activePersonIds = new Set<HouseholdPersonId>();
    const profileVersions = new Map<HouseholdPersonId, ProfileVersion>();
    for (const person of people) {
      const personId = yield* Schema.decodeUnknownEffect(HouseholdPersonId)(
        person.personId
      ).pipe(Effect.mapError(unavailable));
      activePersonIds.add(personId);
      profileVersions.set(personId, ProfileVersion.make(0));
    }
    for (const row of profileRows) {
      const personId = yield* Schema.decodeUnknownEffect(HouseholdPersonId)(
        row.personId
      ).pipe(Effect.mapError(unavailable));
      if (!profileVersions.has(personId)) {
        continue;
      }
      if (profileVersions.get(personId) === 0) {
        const version = yield* Schema.decodeUnknownEffect(ProfileVersion)(
          row.version
        ).pipe(Effect.mapError(unavailable));
        profileVersions.set(personId, version);
      }
    }
    const nowEpochMs = yield* Clock.currentTimeMillis;
    const today = PlanningDate.make(
      new Date(nowEpochMs).toISOString().slice(0, 10)
    );
    return { activePersonIds, actorId: actor.actorId, profileVersions, today };
  });

export interface PreparedPlanAllocation {
  readonly date: PlanningDate;
  readonly outputId: string;
  readonly coverageKey: string;
  readonly amount: number;
  readonly unit: string;
  readonly weekStart: PlanningDate;
}

export interface PreparedReservationIntent {
  readonly actorId: string;
  readonly planId: string;
  readonly mutationId: string;
  readonly expectedConfigVersion: PlanningContentVersion;
  readonly allocations: readonly PreparedPlanAllocation[];
}

/** Stable intent text to digest before opening the HouseholdObject SQL transaction. */
export const preparedReservationIntent = (
  input: PreparedReservationIntent
): string =>
  JSON.stringify({
    actorId: input.actorId,
    allocations: [...input.allocations].toSorted(
      (left, right) =>
        left.outputId.localeCompare(right.outputId) ||
        left.coverageKey.localeCompare(right.coverageKey)
    ),
    expectedConfigVersion: input.expectedConfigVersion,
    mutationId: input.mutationId,
    planId: input.planId,
  });

/**
 * Atomically replace this plan's stock reservations inside the plan save transaction.
 * Planned outputs from cook events are ignored here; only recorded stock is reserved.
 */
export const syncPreparedReservationsForPlan = (
  transaction: HouseholdPlanningContentTransaction,
  input: PreparedReservationIntent & { readonly intentDigest: string }
) =>
  Effect.gen(function* syncPreparedReservations() {
    const current = yield* latest(transaction);
    if (current.configVersion !== input.expectedConfigVersion) {
      return yield* Effect.fail(reject("stale_version"));
    }
    const receiptId = `stock_${input.mutationId}`;
    const [receipt] = yield* transaction
      .select()
      .from(householdPlanningContentVersions)
      .where(eq(householdPlanningContentVersions.mutationId, receiptId))
      .limit(1)
      .pipe(Effect.mapError(unavailable));
    if (receipt) {
      return receipt.intentDigest === input.intentDigest
        ? yield* decodeSnapshot(receipt.snapshotJson).pipe(
            Effect.mapError(unavailable)
          )
        : yield* Effect.fail(reject("mutation_collision"));
    }

    const stockIds = new Set<string>(
      current.preparedPortions.map((portion) => portion.id)
    );
    const relevant = input.allocations.filter((allocation) =>
      stockIds.has(allocation.outputId)
    );
    const nextPortions = current.preparedPortions.map((portion) => {
      const desired = relevant.filter(
        (allocation) => allocation.outputId === portion.id
      );
      const previous = portion.reservations.filter(
        (reservation) => reservation.planId !== input.planId
      );
      return { desired, portion, previous };
    });
    for (const { portion, desired, previous } of nextPortions) {
      if (desired.length === 0) {
        continue;
      }
      if (
        (portion.state !== "available" && portion.state !== "reserved") ||
        desired.some(
          (allocation) =>
            allocation.weekStart !== portion.confirmedForWeekStart ||
            allocation.unit !== portion.quantity.unit ||
            !Number.isFinite(allocation.amount) ||
            allocation.amount <= 0 ||
            allocation.coverageKey.length === 0
        )
      ) {
        return yield* Effect.fail(reject("invalid_transition"));
      }
      const keys = desired.map((allocation) => allocation.coverageKey);
      if (new Set(keys).size !== keys.length) {
        return yield* Effect.fail(reject("invalid_transition"));
      }
      const occupied = previous.reduce(
        (sum, reservation) => sum + reservation.amount,
        0
      );
      const requested = desired.reduce(
        (sum, allocation) => sum + allocation.amount,
        0
      );
      if (occupied + requested > portion.remainingAmount + 1e-9) {
        return yield* Effect.fail(reject("quantity_exceeded"));
      }
    }
    const changed = nextPortions.some(
      ({ portion, desired }) =>
        desired.length > 0 ||
        portion.reservations.some(
          (reservation) => reservation.planId === input.planId
        )
    );
    if (!changed) {
      return current;
    }
    const preparedPortions = nextPortions.map(
      ({ portion, desired, previous }) => {
        if (
          desired.length === 0 &&
          previous.length === portion.reservations.length
        ) {
          return portion;
        }
        const reservations = [
          ...previous,
          ...desired.map((allocation) => ({
            amount: allocation.amount,
            coverageKey: allocation.coverageKey,
            date: allocation.date,
            planId: input.planId,
            weekStart: allocation.weekStart,
          })),
        ];
        return {
          ...portion,
          reservations,
          state:
            reservations.length > 0
              ? ("reserved" as const)
              : ("available" as const),
          version: portion.version + 1,
        };
      }
    );
    const next = PlanningContentSnapshot.make({
      ...current,
      configVersion: PlanningContentVersion.make(current.configVersion + 1),
      preparedPortions,
    });
    yield* transaction
      .insert(householdPlanningContentVersions)
      .values({
        actorId: input.actorId,
        intentDigest: input.intentDigest,
        mutationId: receiptId,
        snapshotJson: encodeSnapshot(next),
        version: next.configVersion,
      })
      .pipe(Effect.mapError(unavailable));
    return next;
  });

/** Household SQLite adapter; the actor is admitted again inside each transaction. */
export const makeHouseholdMealContentRepository = (
  database: EffectSQLiteDoDatabase,
  digest: HouseholdDigestService
) => ({
  listSavedRecipes: (actor: Actor, query: SavedRecipePageQuery) =>
    database
      .transaction((transaction) =>
        Effect.gen(function* listSavedRecipes() {
          yield* activeAdult(transaction, actor);
          const rows = yield* transaction
            .select({
              importId: householdRecipes.importId,
              nameJson: householdRecipes.publicRecipeJson,
              recipeId: householdRecipes.recipeId,
              version: householdRecipes.version,
            })
            .from(householdRecipes)
            .where(
              query.cursor === undefined
                ? undefined
                : gt(householdRecipes.recipeId, query.cursor)
            )
            .orderBy(asc(householdRecipes.recipeId))
            .limit(51)
            .pipe(Effect.mapError(unavailable));
          const pageRows = rows.slice(0, 50);
          const items = yield* Effect.all(
            pageRows.map((row) =>
              Schema.decodeUnknownEffect(SavedRecipeNameSource)(
                row.nameJson
              ).pipe(
                Effect.flatMap((source) =>
                  Schema.decodeUnknownEffect(SavedRecipeSummary)({
                    importId: row.importId,
                    name: source.recipe.name,
                    recipeId: row.recipeId,
                    version: row.version,
                  })
                ),
                Effect.mapError(unavailable)
              )
            )
          );
          return SavedRecipePage.make({
            items,
            nextCursor:
              rows.length > 50 ? (items.at(-1)?.recipeId ?? null) : null,
          });
        })
      )
      .pipe(Effect.catchTag("SqlError", () => Effect.fail(unavailable()))),
  mutate: (actor: Actor, payload: MutatePlanningContentPayload) =>
    Effect.gen(function* mutatePlanningContent() {
      const intent = Schema.encodeSync(MutatePlanningContentPayload)(payload);
      const intentDigest = yield* digest
        .sha256(JSON.stringify({ actorId: actor.actorId, intent }))
        .pipe(Effect.mapError(unavailable));
      return yield* database.transaction((transaction) =>
        Effect.gen(function* commitPlanningContent() {
          const [receipt] = yield* transaction
            .select()
            .from(householdPlanningContentVersions)
            .where(
              eq(
                householdPlanningContentVersions.mutationId,
                payload.mutationId
              )
            )
            .limit(1)
            .pipe(Effect.mapError(unavailable));
          if (receipt) {
            if (receipt.intentDigest !== intentDigest) {
              return yield* Effect.fail(reject("mutation_collision"));
            }
            return yield* decodeSnapshot(receipt.snapshotJson).pipe(
              Effect.mapError(unavailable)
            );
          }
          const authority = yield* currentAuthority(transaction, actor);
          const current = yield* latest(transaction);
          if (
            payload.command._tag === "PutOption" &&
            payload.command.value.kind === "recipe"
          ) {
            const [recipe] = yield* transaction
              .select({
                recipeId: householdRecipes.recipeId,
                version: householdRecipes.version,
              })
              .from(householdRecipes)
              .where(
                eq(
                  householdRecipes.importId,
                  payload.command.value.recipeImportId
                )
              )
              .limit(1)
              .pipe(Effect.mapError(unavailable));
            if (
              recipe?.version !== payload.command.value.recipeVersion ||
              recipe.recipeId !== payload.command.value.recipeId
            ) {
              return yield* Effect.fail(reject("stale_option"));
            }
          }
          const next = applyPlanningContentCommand(current, payload, authority);
          if ("_tag" in next) {
            return yield* Effect.fail(next);
          }
          const snapshotJson = encodeSnapshot(next);
          yield* transaction
            .insert(householdPlanningContentVersions)
            .values({
              actorId: actor.actorId,
              intentDigest,
              mutationId: payload.mutationId,
              snapshotJson,
              version: next.configVersion,
            })
            .pipe(Effect.mapError(unavailable));
          return next;
        })
      );
    }).pipe(Effect.catchTag("SqlError", () => Effect.fail(unavailable()))),
  read: (actor: Actor) =>
    database
      .transaction((transaction) =>
        Effect.gen(function* readPlanningContent() {
          yield* activeAdult(transaction, actor);
          return yield* latest(transaction);
        })
      )
      .pipe(Effect.catchTag("SqlError", () => Effect.fail(unavailable()))),
});
