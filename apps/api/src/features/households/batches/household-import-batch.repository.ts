import {
  CreateRecipeImportBatchItemRequest,
  RecipeImportBatch,
  RecipeImportBatchId,
  RecipeImportBatchItemId,
} from "@meal-planner/recipe-import-api";
import { and, asc, eq, inArray, lte } from "drizzle-orm";
import type { EffectSQLiteDoDatabase } from "drizzle-orm/effect-sqlite-do";
import { Clock, Effect, Schema } from "effect";

import { ensureHouseholdProvenance } from "../foundation/household-provenance.js";
import {
  householdImportBatchItems,
  householdImportBatchOutbox,
  householdImportBatches,
} from "../household.database-schema.js";
import {
  HouseholdCanonicalEncoding,
  HouseholdDigest,
  HouseholdIdentityGenerator,
} from "../shared-kernel/authority-services.js";
import {
  HouseholdBatchFailure,
  HouseholdBatchQueueMessage,
  HouseholdClaimImportBatchItemResult,
} from "./household-import-batch.contract.js";
import type {
  HouseholdAdmitImportBatchInput,
  HouseholdClaimImportBatchItemInput,
  HouseholdCompleteImportBatchItemInput,
  HouseholdFailImportBatchItemInput,
  HouseholdReadImportBatchInput,
  HouseholdRecordImportBatchDispatchInput,
} from "./household-import-batch.contract.js";

const failure = (reason: HouseholdBatchFailure["reason"]) =>
  HouseholdBatchFailure.make({ reason });
const persistenceFailure = () => failure("persistence_unavailable");
const mapPersistence = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.mapError(persistenceFailure));
// eslint-disable-next-line anti-slop/no-unknown-parameters -- Transaction failures are narrowed through the typed household failure schema before defects are closed.
const mapTransactionError = (error: unknown) =>
  Schema.is(HouseholdBatchFailure)(error) ? error : persistenceFailure();
const mapTransaction = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.mapError(mapTransactionError));

const EncodedSource = Schema.fromJsonString(
  CreateRecipeImportBatchItemRequest.fields.source
);

type BatchRow = typeof householdImportBatches.$inferSelect;
type ItemRow = typeof householdImportBatchItems.$inferSelect;

const aggregateStatus = (items: readonly ItemRow[]) => {
  const terminal = items.every(
    ({ status }) => status === "succeeded" || status === "failed"
  );
  if (!terminal) {
    return items.some(({ status }) => status === "running")
      ? "running"
      : "queued";
  }
  const failed = items.filter(({ status }) => status === "failed").length;
  if (failed === 0) {
    return "completed";
  }
  return failed === items.length ? "failed" : "partial_failure";
};

const projectBatchItem = ({
  failureCode,
  intentId,
  itemId,
  status,
}: ItemRow) => {
  const projected: {
    failureCode?: string;
    id: string;
    intentId?: string;
    status: string;
  } = { id: itemId, status };
  if (failureCode !== null) {
    projected.failureCode = failureCode;
  }
  if (intentId !== null) {
    projected.intentId = intentId;
  }
  return projected;
};

const isTerminalItemStatus = (status: ItemRow["status"] | undefined) =>
  status === "succeeded" || status === "failed";
const dispatchState = (
  outcome: HouseholdRecordImportBatchDispatchInput["outcome"],
  item: Pick<ItemRow, "failureCode" | "status"> | undefined,
  previousState: string
) => {
  if (isTerminalItemStatus(item?.status)) {
    return item?.failureCode === "dispatch_exhausted"
      ? "exhausted"
      : "delivered";
  }
  if (outcome === "delivered" || previousState === "delivered") {
    return "delivered";
  }
  return outcome === "exhausted" ? "exhausted" : "pending";
};
const settledDispatchState = (
  input:
    | HouseholdCompleteImportBatchItemInput
    | HouseholdFailImportBatchItemInput
) =>
  "failureCode" in input && input.failureCode === "dispatch_exhausted"
    ? "exhausted"
    : "delivered";

const projectBatch = (row: BatchRow, items: readonly ItemRow[]) =>
  Schema.decodeUnknownEffect(RecipeImportBatch)({
    counts: {
      failed: items.filter(({ status }) => status === "failed").length,
      queued: items.filter(({ status }) => status === "queued").length,
      running: items.filter(({ status }) => status === "running").length,
      succeeded: items.filter(({ status }) => status === "succeeded").length,
      total: items.length,
    },
    createdAt: row.createdAt,
    id: row.batchId,
    items: items.map(projectBatchItem),
    links: { self: `/v1/recipe-import-batches/${row.batchId}` },
    object: "recipe_import_batch",
    status: row.status,
    updatedAt: row.updatedAt,
    version: row.version,
  }).pipe(Effect.mapError(persistenceFailure));

export const makeHouseholdImportBatchRepository = (
  database: EffectSQLiteDoDatabase
) => {
  const digestJson = (value: Schema.Json) =>
    HouseholdCanonicalEncoding.pipe(
      Effect.zip(HouseholdDigest),
      Effect.flatMap(([canonical, digest]) =>
        canonical.encode(value).pipe(Effect.flatMap(digest.sha256))
      ),
      Effect.mapError(persistenceFailure)
    );

  const authorize = (
    organizationId: HouseholdAdmitImportBatchInput["admission"]["organizationId"]
  ) =>
    ensureHouseholdProvenance(database, organizationId).pipe(
      Effect.mapError(persistenceFailure)
    );

  const readRows = (connection: EffectSQLiteDoDatabase, batchId: string) =>
    Effect.all({
      items: connection
        .select()
        .from(householdImportBatchItems)
        .where(eq(householdImportBatchItems.batchId, batchId))
        .orderBy(asc(householdImportBatchItems.ordinal))
        .pipe(mapPersistence),
      rows: connection
        .select()
        .from(householdImportBatches)
        .where(eq(householdImportBatches.batchId, batchId))
        .limit(1)
        .pipe(mapPersistence),
    }).pipe(
      Effect.flatMap(({ items, rows: [row] }) =>
        row === undefined
          ? Effect.fail(failure("batch_not_found"))
          : Effect.succeed({ items, row })
      )
    );

  const admit = (input: HouseholdAdmitImportBatchInput) =>
    Effect.gen(function* admitImportBatch() {
      yield* authorize(input.admission.organizationId);
      const [idempotencyKeyDigest, requestDigest] = yield* Effect.all([
        digestJson({
          key: input.idempotencyKey,
          purpose: "recipe-import-batch-idempotency",
          version: 1,
        }),
        digestJson({
          purpose: "recipe-import-batch-request",
          request: input.request,
          version: 1,
        }),
      ]);
      const identities = yield* HouseholdIdentityGenerator;
      const generated = yield* Effect.all(
        Array.from({ length: input.request.items.length + 1 }, () =>
          identities.generate()
        )
      ).pipe(Effect.mapError(persistenceFailure));
      const batchId = yield* Schema.decodeUnknownEffect(RecipeImportBatchId)(
        generated[0]
      ).pipe(Effect.mapError(persistenceFailure));
      const itemIds = yield* Effect.all(
        generated
          .slice(1)
          .map((identity) =>
            Schema.decodeUnknownEffect(RecipeImportBatchItemId)(identity).pipe(
              Effect.mapError(persistenceFailure)
            )
          )
      );
      const itemInputs = yield* Effect.all(
        input.request.items.map((item, ordinal) => {
          const itemId = itemIds[ordinal];
          if (itemId === undefined) {
            return Effect.fail(persistenceFailure());
          }
          return Schema.encodeEffect(EncodedSource)(item.source).pipe(
            Effect.mapError(persistenceFailure),
            Effect.map((sourceJson) => ({ item, itemId, ordinal, sourceJson }))
          );
        })
      );
      const nowEpochMs = yield* Clock.currentTimeMillis;
      const now = new Date(nowEpochMs).toISOString();
      return yield* database
        .transaction((transaction) =>
          Effect.gen(function* commitBatch() {
            const [replay] = yield* transaction
              .select()
              .from(householdImportBatches)
              .where(
                eq(
                  householdImportBatches.idempotencyKeyDigest,
                  idempotencyKeyDigest
                )
              )
              .limit(1)
              .pipe(mapPersistence);
            if (replay !== undefined) {
              if (replay.requestDigest !== requestDigest) {
                return yield* Effect.fail(failure("idempotency_conflict"));
              }
              const { items, row } = yield* readRows(
                transaction,
                replay.batchId
              );
              const pending = yield* transaction
                .select()
                .from(householdImportBatchOutbox)
                .where(
                  and(
                    eq(householdImportBatchOutbox.batchId, replay.batchId),
                    eq(householdImportBatchOutbox.state, "pending")
                  )
                )
                .pipe(mapPersistence);
              const messages = yield* Effect.all(
                pending.map((entry) =>
                  Schema.decodeUnknownEffect(HouseholdBatchQueueMessage)({
                    batchId: entry.batchId,
                    generation: entry.generation,
                    itemId: entry.itemId,
                    organizationId: input.admission.organizationId,
                  }).pipe(Effect.mapError(persistenceFailure))
                )
              );
              return { batch: yield* projectBatch(row, items), messages };
            }
            yield* transaction.insert(householdImportBatches).values({
              actorId: input.admission.actor.actorId,
              batchId,
              createdAt: now,
              idempotencyKeyDigest,
              organizationId: input.admission.organizationId,
              requestDigest,
              status: "queued",
              updatedAt: now,
              version: 1,
            });
            const itemRows = itemInputs.map(
              ({ item, itemId, ordinal, sourceJson }) => ({
                batchId,
                failureCode: null,
                generation: 1,
                idempotencyKey: item.idempotencyKey,
                intentId: null,
                itemId,
                ordinal,
                sourceJson,
                status: "queued",
              })
            );
            yield* transaction
              .insert(householdImportBatchItems)
              .values(itemRows);
            yield* transaction.insert(householdImportBatchOutbox).values(
              itemRows.map(({ generation, itemId }) => ({
                attempts: 0,
                batchId,
                generation,
                itemId,
                nextAttemptAtEpochMs: nowEpochMs,
                state: "pending",
              }))
            );
            const messages = yield* Effect.all(
              itemRows.map(({ generation, itemId }) =>
                Schema.decodeUnknownEffect(HouseholdBatchQueueMessage)({
                  batchId,
                  generation,
                  itemId,
                  organizationId: input.admission.organizationId,
                }).pipe(Effect.mapError(persistenceFailure))
              )
            );
            const [row] = yield* transaction
              .select()
              .from(householdImportBatches)
              .where(eq(householdImportBatches.batchId, batchId))
              .limit(1)
              .pipe(mapPersistence);
            if (row === undefined) {
              return yield* Effect.fail(persistenceFailure());
            }
            return {
              batch: yield* projectBatch(row, itemRows),
              messages,
            };
          })
        )
        .pipe(mapTransaction);
    });

  const read = (input: HouseholdReadImportBatchInput) =>
    authorize(input.admission.organizationId).pipe(
      Effect.andThen(readRows(database, input.batchId)),
      Effect.flatMap(({ items, row }) => projectBatch(row, items))
    );

  const mutateItem = (
    input:
      | HouseholdCompleteImportBatchItemInput
      | HouseholdFailImportBatchItemInput,
    terminal: "succeeded" | "failed"
  ) =>
    authorize(input.admission.organizationId).pipe(
      Effect.andThen(
        database.transaction((transaction) =>
          Effect.gen(function* commitItemMutation() {
            const [item] = yield* transaction
              .select()
              .from(householdImportBatchItems)
              .where(
                and(
                  eq(householdImportBatchItems.batchId, input.batchId),
                  eq(householdImportBatchItems.itemId, input.itemId)
                )
              )
              .limit(1)
              .pipe(mapPersistence);
            if (item === undefined) {
              return yield* Effect.fail(failure("batch_not_found"));
            }
            if (item.generation !== input.expectedGeneration) {
              return yield* Effect.fail(failure("generation_conflict"));
            }
            if (item.status === terminal) {
              const conflicts =
                (terminal === "succeeded" &&
                  "intentId" in input &&
                  item.intentId !== input.intentId) ||
                (terminal === "failed" &&
                  "failureCode" in input &&
                  item.failureCode !== input.failureCode);
              if (conflicts) {
                return yield* Effect.fail(failure("idempotency_conflict"));
              }
              const current = yield* readRows(transaction, input.batchId);
              return yield* projectBatch(current.row, current.items);
            }
            if (item.status !== "running" && terminal === "succeeded") {
              return yield* Effect.fail(failure("illegal_transition"));
            }
            if (item.status === "succeeded" || item.status === "failed") {
              return yield* Effect.fail(failure("illegal_transition"));
            }
            yield* transaction
              .update(householdImportBatchItems)
              .set({
                failureCode:
                  terminal === "failed" && "failureCode" in input
                    ? input.failureCode
                    : null,
                intentId:
                  terminal === "succeeded" && "intentId" in input
                    ? input.intentId
                    : null,
                status: terminal,
              })
              .where(eq(householdImportBatchItems.itemId, input.itemId))
              .pipe(mapPersistence);
            yield* transaction
              .update(householdImportBatchOutbox)
              .set({
                state: settledDispatchState(input),
              })
              .where(eq(householdImportBatchOutbox.itemId, input.itemId))
              .pipe(mapPersistence);
            const { items, row } = yield* readRows(transaction, input.batchId);
            const status = aggregateStatus(items);
            const updatedAt = new Date(
              yield* Clock.currentTimeMillis
            ).toISOString();
            yield* transaction
              .update(householdImportBatches)
              .set({ status, updatedAt, version: row.version + 1 })
              .where(eq(householdImportBatches.batchId, input.batchId))
              .pipe(mapPersistence);
            return yield* projectBatch(
              { ...row, status, updatedAt, version: row.version + 1 },
              items
            );
          })
        )
      ),
      mapTransaction
    );

  const claim = (input: HouseholdClaimImportBatchItemInput) =>
    authorize(input.admission.organizationId).pipe(
      Effect.andThen(
        database.transaction((transaction) =>
          Effect.gen(function* claimBatchItem() {
            if (
              input.message.organizationId !== input.admission.organizationId
            ) {
              return yield* Effect.fail(failure("invalid_input"));
            }
            const { items, row } = yield* readRows(
              transaction,
              input.message.batchId
            );
            const item = items.find(
              ({ itemId }) => itemId === input.message.itemId
            );
            if (item === undefined) {
              return yield* Effect.fail(failure("batch_not_found"));
            }
            if (item.generation !== input.message.generation) {
              return yield* Effect.fail(failure("generation_conflict"));
            }
            if (item.status === "succeeded" || item.status === "failed") {
              return yield* Schema.decodeUnknownEffect(
                HouseholdClaimImportBatchItemResult
              )({
                _tag: "Terminal",
                batch: yield* projectBatch(row, items),
              }).pipe(Effect.mapError(persistenceFailure));
            }
            if (item.status === "queued") {
              const updatedAt = new Date(
                yield* Clock.currentTimeMillis
              ).toISOString();
              yield* transaction
                .update(householdImportBatchItems)
                .set({ status: "running" })
                .where(eq(householdImportBatchItems.itemId, item.itemId))
                .pipe(mapPersistence);
              yield* transaction
                .update(householdImportBatches)
                .set({ status: "running", updatedAt, version: row.version + 1 })
                .where(eq(householdImportBatches.batchId, row.batchId))
                .pipe(mapPersistence);
            }
            const source = yield* Schema.decodeUnknownEffect(EncodedSource)(
              item.sourceJson
            ).pipe(Effect.mapError(persistenceFailure));
            return yield* Schema.decodeUnknownEffect(
              HouseholdClaimImportBatchItemResult
            )({
              _tag: "Claimed",
              actorId: row.actorId,
              idempotencyKey: item.idempotencyKey,
              source,
            }).pipe(Effect.mapError(persistenceFailure));
          })
        )
      ),
      mapTransaction
    );

  const recordDispatch = (input: HouseholdRecordImportBatchDispatchInput) =>
    authorize(input.admission.organizationId).pipe(
      Effect.andThen(
        database.transaction((transaction) =>
          Effect.gen(function* recordBatchDispatch() {
            const [entry] = yield* transaction
              .select()
              .from(householdImportBatchOutbox)
              .where(eq(householdImportBatchOutbox.itemId, input.itemId))
              .limit(1)
              .pipe(mapPersistence);
            if (entry === undefined || entry.batchId !== input.batchId) {
              return yield* Effect.fail(failure("batch_not_found"));
            }
            if (entry.generation !== input.expectedGeneration) {
              return yield* Effect.fail(failure("generation_conflict"));
            }
            const [item] = yield* transaction
              .select({
                failureCode: householdImportBatchItems.failureCode,
                status: householdImportBatchItems.status,
              })
              .from(householdImportBatchItems)
              .where(eq(householdImportBatchItems.itemId, input.itemId))
              .limit(1)
              .pipe(mapPersistence);
            const state = dispatchState(input.outcome, item, entry.state);
            yield* transaction
              .update(householdImportBatchOutbox)
              .set({
                attempts: state === "delivered" ? 0 : entry.attempts + 1,
                nextAttemptAtEpochMs:
                  state === "exhausted"
                    ? entry.nextAttemptAtEpochMs
                    : (yield* Clock.currentTimeMillis) + 5000,
                state,
              })
              .where(eq(householdImportBatchOutbox.itemId, input.itemId))
              .pipe(mapPersistence);
          })
        )
      ),
      mapTransaction
    );

  const dueDispatches = (nowEpochMs: number) =>
    database
      .select({
        attempts: householdImportBatchOutbox.attempts,
        batchId: householdImportBatchOutbox.batchId,
        generation: householdImportBatchOutbox.generation,
        itemId: householdImportBatchOutbox.itemId,
        organizationId: householdImportBatches.organizationId,
        transportState: householdImportBatchOutbox.state,
      })
      .from(householdImportBatchOutbox)
      .innerJoin(
        householdImportBatches,
        eq(householdImportBatches.batchId, householdImportBatchOutbox.batchId)
      )
      .innerJoin(
        householdImportBatchItems,
        eq(householdImportBatchItems.itemId, householdImportBatchOutbox.itemId)
      )
      .where(
        and(
          inArray(householdImportBatchOutbox.state, ["pending", "delivered"]),
          inArray(householdImportBatchItems.status, ["queued", "running"]),
          lte(householdImportBatchOutbox.nextAttemptAtEpochMs, nowEpochMs)
        )
      )
      .pipe(
        mapPersistence,
        Effect.flatMap((rows) =>
          Effect.all(
            rows.map(({ attempts, transportState, ...message }) =>
              Schema.decodeUnknownEffect(HouseholdBatchQueueMessage)(
                message
              ).pipe(
                Effect.mapError(persistenceFailure),
                Effect.map((decoded) => ({
                  attempts,
                  message: decoded,
                  transportState,
                }))
              )
            )
          )
        )
      );

  const nextDispatchAt = database
    .select({
      nextAttemptAtEpochMs: householdImportBatchOutbox.nextAttemptAtEpochMs,
    })
    .from(householdImportBatchOutbox)
    .innerJoin(
      householdImportBatchItems,
      eq(householdImportBatchItems.itemId, householdImportBatchOutbox.itemId)
    )
    .where(
      and(
        inArray(householdImportBatchOutbox.state, ["pending", "delivered"]),
        inArray(householdImportBatchItems.status, ["queued", "running"])
      )
    )
    .orderBy(asc(householdImportBatchOutbox.nextAttemptAtEpochMs))
    .limit(1)
    .pipe(
      mapPersistence,
      Effect.map(([row]) => row?.nextAttemptAtEpochMs ?? null)
    );

  return {
    admit,
    claim,
    complete: (input: HouseholdCompleteImportBatchItemInput) =>
      mutateItem(input, "succeeded"),
    dueDispatches,
    fail: (input: HouseholdFailImportBatchItemInput) =>
      mutateItem(input, "failed"),
    nextDispatchAt,
    read,
    recordDispatch,
  };
};
