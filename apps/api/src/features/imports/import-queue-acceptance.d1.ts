import type { AnyD1Database } from "drizzle-orm/d1";
import { Effect, Schema } from "effect";

import type {
  ImportBatchId,
  ImportBatchItemId,
  ImportBatchQueueMessage,
  ImportBatchView,
} from "./import-batch.contracts.js";
import { ImportBatchView as ImportBatchViewSchema } from "./import-batch.contracts.js";
import type {
  DeadLetterNotFound,
  DeadLetterReplayClaim,
  DeadLetterReplayInProgress,
  DeadLetterStoreShape,
  OperationalCorrelation,
  OperationalEvent,
  OperationalEventSinkShape,
} from "./import-operations.js";
import {
  DeadLetterInspection,
  OperationalCorrelation as OperationalCorrelationSchema,
} from "./import-operations.js";
import type { IdempotencyKey, SourceDescriptor } from "./import.contracts.js";
import {
  CreateImportRequest as CreateImportRequestSchema,
  IdempotencyKey as IdempotencyKeySchema,
  ImportView as ImportViewSchema,
} from "./import.contracts.js";
import type { ImportServiceShape } from "./import.service.js";

const QueueItemRow = Schema.Struct({
  attemptCount: Schema.Number,
  batchId: Schema.String,
  correlationJson: Schema.NullOr(Schema.String),
  deliveryMode: Schema.Literals(["ordinary", "poison"]),
  failureCode: Schema.NullOr(Schema.String),
  id: Schema.String,
  idempotencyKey: Schema.String,
  sourceCanonicalId: Schema.String,
  status: Schema.Literals(["queued", "running", "succeeded", "failed"]),
});

const DeadLetterRow = Schema.Struct({
  correlationJson: Schema.String,
  failureCode: Schema.String,
  idempotencyKey: Schema.String,
  replayImportJson: Schema.NullOr(Schema.String),
  replayState: Schema.Literals(["ready", "claimed", "replayed"]),
  sourceCanonicalId: Schema.String,
});

export interface ImportQueueAcceptanceMessageNotFound {
  readonly _tag: "ImportQueueAcceptanceMessageNotFound";
  readonly itemId: ImportBatchItemId;
}

export interface ImportQueueAcceptancePoisoned {
  readonly _tag: "ImportQueueAcceptancePoisoned";
  readonly itemId: ImportBatchItemId;
}

export type ImportQueueAcceptanceError =
  | ImportQueueAcceptanceMessageNotFound
  | ImportQueueAcceptancePoisoned;

type SyntheticBatchItem =
  | {
      readonly deliveryMode: "ordinary";
      readonly id: ImportBatchItemId;
      readonly idempotencyKey: IdempotencyKey;
      readonly source: SourceDescriptor;
    }
  | {
      readonly correlation: OperationalCorrelation;
      readonly deliveryMode: "poison";
      readonly id: ImportBatchItemId;
      readonly idempotencyKey: IdempotencyKey;
      readonly source: SourceDescriptor;
    };

interface SeedSyntheticBatch {
  readonly batchId: ImportBatchId;
  readonly idempotencyKey: string;
  readonly items: readonly SyntheticBatchItem[];
}

const databaseEffect = <A>(operation: () => PromiseLike<A>) =>
  Effect.tryPromise({
    catch: (cause) =>
      new Error("Durable import queue persistence failed", { cause }),
    try: operation,
  }).pipe(Effect.orDie);

const digestSha256 = (value: string) =>
  Effect.promise(async () => {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(value)
    );
    return Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("");
  });

const decodeQueueItem = (value: unknown) =>
  Schema.decodeUnknownSync(QueueItemRow)(value);

const updateBatchProjection = (
  database: AnyD1Database,
  batchId: ImportBatchId,
  updatedAt: string
) =>
  database
    .prepare(
      `UPDATE import_batches
          SET status = (
                SELECT CASE
                  WHEN COUNT(*) = SUM(status = 'succeeded') THEN 'completed'
                  WHEN COUNT(*) = SUM(status = 'failed') THEN 'failed'
                  WHEN SUM(status = 'succeeded') > 0
                   AND SUM(status = 'failed') > 0 THEN 'partial_failure'
                  WHEN SUM(status = 'running') > 0 THEN 'running'
                  ELSE 'queued'
                END
                  FROM import_batch_items
                 WHERE batch_id = ?
              ),
              updated_at = ?
        WHERE id = ?`
    )
    .bind(batchId, updatedAt, batchId);

const selectQueueItem = (database: AnyD1Database) =>
  database.prepare(
    `SELECT attempt_count AS attemptCount,
            batch_id AS batchId,
            correlation_json AS correlationJson,
            delivery_mode AS deliveryMode,
            failure_code AS failureCode,
            id,
            idempotency_key AS idempotencyKey,
            source_canonical_id AS sourceCanonicalId,
            status
       FROM import_batch_items
      WHERE batch_id = ? AND id = ?`
  );

const failureForMissingMessage = (
  itemId: ImportBatchItemId
): ImportQueueAcceptanceMessageNotFound => ({
  _tag: "ImportQueueAcceptanceMessageNotFound",
  itemId,
});

const poisonFailure = (
  itemId: ImportBatchItemId
): ImportQueueAcceptancePoisoned => ({
  _tag: "ImportQueueAcceptancePoisoned",
  itemId,
});

const sourceRequest = (canonicalId: string) =>
  Schema.decodeUnknownSync(CreateImportRequestSchema)({
    source: {
      kind: "tiktok",
      url: `https://synthetic.invalid/imports/${canonicalId}`,
    },
  });

const syntheticCanonicalId = (source: SourceDescriptor) => {
  const canonicalId =
    /^https:\/\/synthetic\.invalid\/imports\/(?<canonicalId>\d{19})$/u.exec(
      source.url
    )?.groups?.["canonicalId"];
  if (canonicalId === undefined) {
    throw new Error("Synthetic acceptance requires an inert local source");
  }
  return canonicalId;
};

const itemView = (row: {
  readonly canonicalSourceId: string | null;
  readonly disposition: string | null;
  readonly failureCode: string | null;
  readonly id: string;
  readonly idempotencyKey: string;
  readonly importId: string | null;
  readonly importStatusJson: string | null;
  readonly status: string;
}) => {
  const base = {
    id: row.id,
    idempotencyKey: row.idempotencyKey,
    sourceKind: "tiktok" as const,
  };
  switch (row.status) {
    case "queued":
    case "running": {
      return { ...base, status: row.status };
    }
    case "failed": {
      return { ...base, code: row.failureCode, status: "failed" as const };
    }
    case "succeeded": {
      return {
        ...base,
        canonicalId: row.canonicalSourceId,
        disposition: row.disposition,
        importId: row.importId,
        importStatus:
          row.importStatusJson === null
            ? null
            : JSON.parse(row.importStatusJson),
        status: "succeeded" as const,
      };
    }
    default: {
      throw new Error("Unsupported persisted batch item status");
    }
  }
};

const makeD1OperationalAdapters = (
  database: AnyD1Database,
  now: () => string
): {
  readonly deadLetters: DeadLetterStoreShape;
  readonly events: OperationalEventSinkShape;
} => {
  const readDeadLetter = (itemId: ImportBatchItemId) =>
    databaseEffect(() =>
      database
        .prepare(
          `SELECT d.correlation_json AS correlationJson,
                  d.failure_code AS failureCode,
                  i.idempotency_key AS idempotencyKey,
                  d.replay_import_json AS replayImportJson,
                  d.replay_state AS replayState,
                  i.source_canonical_id AS sourceCanonicalId
             FROM import_dead_letters d
             JOIN import_batch_items i ON i.id = d.item_id
            WHERE d.item_id = ?`
        )
        .bind(itemId)
        .first()
    ).pipe(
      Effect.flatMap((row) =>
        row === null
          ? Effect.fail<DeadLetterNotFound>({
              _tag: "DeadLetterNotFound",
              itemId,
            })
          : Effect.sync(() => Schema.decodeUnknownSync(DeadLetterRow)(row))
      )
    );

  const deadLetters: DeadLetterStoreShape = {
    claimReplay: (itemId) =>
      databaseEffect<
        readonly {
          readonly results: readonly unknown[];
        }[]
      >(() =>
        database.batch([
          database
            .prepare(
              `UPDATE import_dead_letters
                  SET replay_state = 'claimed', updated_at = ?
                WHERE item_id = ? AND replay_state = 'ready'
              RETURNING item_id`
            )
            .bind(now(), itemId),
          database
            .prepare(
              `SELECT d.correlation_json AS correlationJson,
                      d.failure_code AS failureCode,
                      i.idempotency_key AS idempotencyKey,
                      d.replay_import_json AS replayImportJson,
                      d.replay_state AS replayState,
                      i.source_canonical_id AS sourceCanonicalId
                 FROM import_dead_letters d
                 JOIN import_batch_items i ON i.id = d.item_id
                WHERE d.item_id = ?`
            )
            .bind(itemId),
        ])
      ).pipe(
        Effect.flatMap(
          (
            results
          ): Effect.Effect<
            DeadLetterReplayClaim,
            DeadLetterNotFound | DeadLetterReplayInProgress
          > => {
            const [claimed, selected] = results;
            if (claimed === undefined || selected === undefined) {
              throw new Error("Incomplete D1 replay claim transaction");
            }
            const [raw] = selected.results;
            if (raw === undefined) {
              return Effect.fail({
                _tag: "DeadLetterNotFound",
                itemId,
              });
            }
            const row = Schema.decodeUnknownSync(DeadLetterRow)(raw);
            const correlation = Schema.decodeUnknownSync(
              OperationalCorrelationSchema
            )(JSON.parse(row.correlationJson));
            if (row.replayState === "replayed") {
              return Effect.succeed({
                _tag: "AlreadyReplayed",
                correlation,
                import: Schema.decodeUnknownSync(ImportViewSchema)(
                  JSON.parse(row.replayImportJson ?? "null")
                ),
              });
            }
            if (claimed.results.length === 0) {
              return Effect.fail({
                _tag: "DeadLetterReplayInProgress",
                itemId,
              });
            }
            return Effect.succeed({
              _tag: "Ready",
              correlation,
              idempotencyKey: Schema.decodeUnknownSync(IdempotencyKeySchema)(
                row.idempotencyKey
              ),
              request: sourceRequest(row.sourceCanonicalId),
            });
          }
        )
      ),
    completeReplay: (itemId, imported) => {
      const importedJson = JSON.stringify(imported);
      const updatedAt = now();
      return databaseEffect(() =>
        database.batch([
          database
            .prepare(
              `UPDATE import_dead_letters
                  SET replay_state = 'replayed',
                      replay_import_json = ?,
                      updated_at = ?
                WHERE item_id = ? AND replay_state = 'claimed'`
            )
            .bind(importedJson, updatedAt, itemId),
          database
            .prepare(
              `UPDATE import_batch_items
                  SET status = 'succeeded',
                      failure_code = NULL,
                      import_id = ?,
                      canonical_source_id = ?,
                      import_status_json = ?,
                      disposition = 'idempotency_replay',
                      updated_at = ?
                WHERE id = ?
                  AND EXISTS (
                    SELECT 1
                      FROM import_dead_letters
                     WHERE item_id = ?
                       AND replay_state = 'replayed'
                       AND replay_import_json = ?
                  )`
            )
            .bind(
              imported.id,
              imported.source.canonicalId,
              JSON.stringify(imported.status),
              updatedAt,
              itemId,
              itemId,
              importedJson
            ),
          database
            .prepare(
              `UPDATE import_batches
                  SET status = (
                        SELECT CASE
                          WHEN COUNT(*) = SUM(status = 'succeeded') THEN 'completed'
                          WHEN COUNT(*) = SUM(status = 'failed') THEN 'failed'
                          WHEN SUM(status = 'succeeded') > 0
                           AND SUM(status = 'failed') > 0 THEN 'partial_failure'
                          WHEN SUM(status = 'running') > 0 THEN 'running'
                          ELSE 'queued'
                        END
                          FROM import_batch_items
                         WHERE batch_id = (
                           SELECT batch_id FROM import_batch_items WHERE id = ?
                         )
                      ),
                      updated_at = ?
                WHERE id = (
                  SELECT batch_id FROM import_batch_items WHERE id = ?
                )`
            )
            .bind(itemId, updatedAt, itemId),
        ])
      ).pipe(Effect.asVoid);
    },
    inspect: (itemId) =>
      readDeadLetter(itemId).pipe(
        Effect.map((row) =>
          Schema.decodeUnknownSync(DeadLetterInspection)({
            code: row.failureCode,
            correlation: JSON.parse(row.correlationJson),
            itemId,
          })
        )
      ),
    releaseReplay: (itemId) =>
      databaseEffect(() =>
        database
          .prepare(
            `UPDATE import_dead_letters
                SET replay_state = 'ready', updated_at = ?
              WHERE item_id = ? AND replay_state = 'claimed'`
          )
          .bind(now(), itemId)
          .run()
      ).pipe(Effect.asVoid),
  };

  const events: OperationalEventSinkShape = {
    emit: (event: OperationalEvent) =>
      databaseEffect(() =>
        database
          .prepare(
            `INSERT INTO import_operational_events (
               event_tag, item_id, actor_id, event_json, occurred_at
             ) VALUES (?, ?, ?, ?, ?)`
          )
          .bind(
            event._tag,
            "itemId" in event ? event.itemId : null,
            "actorId" in event ? event.actorId : null,
            JSON.stringify(event),
            String(event.occurredAt)
          )
          .run()
      ).pipe(Effect.asVoid),
  };

  return { deadLetters, events };
};

/** Build the D1-backed, provider-free queue coordinator used by staging acceptance. */
export const makeD1ImportQueueAcceptance = (input: {
  readonly database: AnyD1Database;
  readonly imports: ImportServiceShape;
  readonly maximumDeliveryAttempts: number;
  readonly now: () => string;
}) => {
  if (
    !Number.isInteger(input.maximumDeliveryAttempts) ||
    input.maximumDeliveryAttempts < 1
  ) {
    throw new Error("maximumDeliveryAttempts must be a positive integer");
  }
  const operational = makeD1OperationalAdapters(input.database, input.now);

  const consume = (
    message: ImportBatchQueueMessage
  ): Effect.Effect<void, ImportQueueAcceptanceError> =>
    Effect.gen(function* consumeMessage() {
      const stored = yield* databaseEffect(() =>
        selectQueueItem(input.database)
          .bind(message.batchId, message.itemId)
          .first<typeof QueueItemRow.Type>()
      );
      if (stored === null) {
        return yield* Effect.fail(failureForMissingMessage(message.itemId));
      }
      const existing = decodeQueueItem(stored);
      if (existing.status === "succeeded") {
        return;
      }
      if (existing.status === "failed") {
        return yield* Effect.fail(poisonFailure(message.itemId));
      }
      const updatedAt = input.now();
      yield* databaseEffect(() =>
        input.database.batch([
          input.database
            .prepare(
              `UPDATE import_batch_items
                  SET status = 'running',
                      attempt_count = attempt_count + 1,
                      updated_at = ?
                WHERE batch_id = ?
                  AND id = ?
                  AND status IN ('queued', 'running')`
            )
            .bind(updatedAt, message.batchId, message.itemId),
          input.database
            .prepare(
              `UPDATE import_batches
                  SET status = 'running', updated_at = ?
                WHERE id = ? AND status = 'queued'`
            )
            .bind(updatedAt, message.batchId),
        ])
      );
      const running = yield* databaseEffect(() =>
        selectQueueItem(input.database)
          .bind(message.batchId, message.itemId)
          .first<typeof QueueItemRow.Type>()
      );
      if (running === null) {
        return yield* Effect.fail(failureForMissingMessage(message.itemId));
      }
      const item = decodeQueueItem(running);
      if (item.deliveryMode === "poison") {
        if (
          item.attemptCount >= input.maximumDeliveryAttempts &&
          item.correlationJson !== null
        ) {
          yield* databaseEffect(() =>
            input.database.batch([
              input.database
                .prepare(
                  `UPDATE import_batch_items
                      SET status = 'failed',
                          failure_code = 'workflow_start_unavailable',
                          updated_at = ?
                    WHERE id = ? AND status = 'running'`
                )
                .bind(updatedAt, message.itemId),
              input.database
                .prepare(
                  `INSERT INTO import_dead_letters (
                     item_id, failure_code, correlation_json, replay_state,
                     replay_import_json, created_at, updated_at
                   ) VALUES (?, 'workflow_start_unavailable', ?, 'ready', NULL, ?, ?)
                   ON CONFLICT(item_id) DO NOTHING`
                )
                .bind(
                  message.itemId,
                  item.correlationJson,
                  updatedAt,
                  updatedAt
                ),
              updateBatchProjection(input.database, message.batchId, updatedAt),
            ])
          );
        }
        return yield* Effect.fail(poisonFailure(message.itemId));
      }
      const result = yield* input.imports
        .create(
          sourceRequest(item.sourceCanonicalId),
          Schema.decodeUnknownSync(IdempotencyKeySchema)(item.idempotencyKey)
        )
        .pipe(Effect.mapError(() => poisonFailure(message.itemId)));
      yield* databaseEffect(() =>
        input.database.batch([
          input.database
            .prepare(
              `UPDATE import_batch_items
                  SET status = 'succeeded',
                      import_id = ?,
                      canonical_source_id = ?,
                      import_status_json = ?,
                      disposition = ?,
                      updated_at = ?
                WHERE id = ? AND status = 'running'`
            )
            .bind(
              result.import.id,
              result.import.source.canonicalId,
              JSON.stringify(result.import.status),
              result.disposition,
              updatedAt,
              message.itemId
            ),
          updateBatchProjection(input.database, message.batchId, updatedAt),
        ])
      );
    });

  return {
    consume,
    deadLetters: operational.deadLetters,
    events: operational.events,
    getBatch: (batchId: ImportBatchId): Effect.Effect<ImportBatchView> =>
      databaseEffect(async () => {
        const batch = await input.database
          .prepare(
            `SELECT created_at AS createdAt, id, status, updated_at AS updatedAt
               FROM import_batches WHERE id = ?`
          )
          .bind(batchId)
          .first<{
            readonly createdAt: string;
            readonly id: string;
            readonly status: string;
            readonly updatedAt: string;
          }>();
        if (batch === null) {
          throw new Error("Import batch not found");
        }
        const items = await input.database
          .prepare(
            `SELECT canonical_source_id AS canonicalSourceId,
                    disposition,
                    failure_code AS failureCode,
                    id,
                    idempotency_key AS idempotencyKey,
                    import_id AS importId,
                    import_status_json AS importStatusJson,
                    status
               FROM import_batch_items
              WHERE batch_id = ?
              ORDER BY id`
          )
          .bind(batchId)
          .all<{
            readonly canonicalSourceId: string | null;
            readonly disposition: string | null;
            readonly failureCode: string | null;
            readonly id: string;
            readonly idempotencyKey: string;
            readonly importId: string | null;
            readonly importStatusJson: string | null;
            readonly status: string;
          }>();
        const counts = {
          failed: 0,
          queued: 0,
          running: 0,
          succeeded: 0,
          total: items.results.length,
        };
        for (const item of items.results) {
          if (item.status in counts && item.status !== "total") {
            counts[item.status as keyof Omit<typeof counts, "total">] += 1;
          }
        }
        return Schema.decodeUnknownSync(ImportBatchViewSchema)({
          ...batch,
          counts,
          items: items.results.map(itemView),
        });
      }),
    seedBatch: (batch: SeedSyntheticBatch) =>
      Effect.gen(function* seedBatch() {
        const timestamp = input.now();
        const idempotencyKeyHash = yield* digestSha256(
          `batch-idempotency:v1:${batch.idempotencyKey}`
        );
        const requestFingerprint = yield* digestSha256(
          JSON.stringify(
            batch.items.map((item) => ({
              deliveryMode: item.deliveryMode,
              id: item.id,
              idempotencyKey: item.idempotencyKey,
              source: item.source,
            }))
          )
        );
        yield* databaseEffect(() =>
          input.database.batch([
            input.database
              .prepare(
                `INSERT INTO import_batches (
                   id, idempotency_key_hash, request_fingerprint,
                   status, created_at, updated_at
                 ) VALUES (?, ?, ?, 'queued', ?, ?)`
              )
              .bind(
                batch.batchId,
                idempotencyKeyHash,
                requestFingerprint,
                timestamp,
                timestamp
              ),
            ...batch.items.map((item) =>
              input.database
                .prepare(
                  `INSERT INTO import_batch_items (
                     id, batch_id, idempotency_key, source_kind, source_canonical_id,
                     delivery_mode, correlation_json, status, failure_code,
                     attempt_count, import_id, canonical_source_id,
                     import_status_json, disposition, created_at, updated_at
                   ) VALUES (?, ?, ?, 'tiktok', ?, ?, ?, 'queued', NULL, 0,
                             NULL, NULL, NULL, NULL, ?, ?)`
                )
                .bind(
                  item.id,
                  batch.batchId,
                  item.idempotencyKey,
                  syntheticCanonicalId(item.source),
                  item.deliveryMode,
                  item.deliveryMode === "poison"
                    ? JSON.stringify(item.correlation)
                    : null,
                  timestamp,
                  timestamp
                )
            ),
          ])
        );
      }),
  };
};
