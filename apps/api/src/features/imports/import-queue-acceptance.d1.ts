import {
  CanonicalTikTokUrl,
  CreateRecipeImportIntentRequest,
  IdempotencyKey as RecipeImportIntentIdempotencyKey,
  RecipeImportIntentId as RecipeImportIntentIdSchema,
} from "@meal-planner/recipe-import-api";
import type { RecipeImportIntentId } from "@meal-planner/recipe-import-api";
import type { AnyD1Database } from "drizzle-orm/d1";
import { DateTime, Effect, Option, Schema } from "effect";

import type {
  ImportBatchDeliveryAttempt,
  ImportBatchId,
  ImportBatchItemFailureCode,
  ImportBatchItemId,
  ImportBatchQueueMessage,
  ImportBatchView,
} from "./import-batch.contracts.js";
import {
  ImportBatchId as ImportBatchIdSchema,
  ImportBatchItemId as ImportBatchItemIdSchema,
  ImportBatchQueueMessage as ImportBatchQueueMessageSchema,
  ImportBatchView as ImportBatchViewSchema,
} from "./import-batch.contracts.js";
import type {
  ImportBatchAdmissionCommand,
  ImportBatchAdmissionProjection,
  ImportBatchNotFound,
  ImportBatchQueueMessageNotFound,
  ImportBatchSourceIdentityKind,
  ImportBatchStore,
} from "./import-batch.service.js";
import {
  ImportBatchRequestFingerprint,
  ImportBatchSourceIdentityKind as ImportBatchSourceIdentityKindSchema,
  importBatchConflict,
} from "./import-batch.service.js";
import type {
  AdmitResolvedRecipeImportIntentError,
  AdmitResolvedRecipeImportIntentResult,
} from "./import-intent-admission.js";
import { makeRecipeImportIntentAdmission } from "./import-intent-admission.js";
import type {
  ImportPrincipal,
  makeImportIntentApplication,
} from "./import-intent.js";
import type {
  DeadLetterNotFound,
  DeadLetterReplayClaim,
  DeadLetterReplayClaimId,
  DeadLetterReplayInProgress,
  DeadLetterStore,
  OperationalEvent,
  OperationalEventSink,
} from "./import-operations.js";
import {
  DeadLetterInspection,
  OperationalCorrelation as OperationalCorrelationSchema,
} from "./import-operations.js";
import { SourceCanonicalId } from "./import.contracts.js";
import {
  importPersistenceCorrupt,
  importPersistenceUnavailable,
} from "./import.errors.js";
import type {
  ImportPersistenceCorrupt,
  ImportPersistenceUnavailable,
} from "./import.errors.js";

const NonNegativeInteger = Schema.Number.pipe(
  Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
);

const BatchRow = Schema.Struct({
  createdAt: Schema.String,
  id: ImportBatchIdSchema,
  requestFingerprint: ImportBatchRequestFingerprint,
  updatedAt: Schema.String,
});

const QueueItemRow = Schema.Struct({
  attemptCount: NonNegativeInteger,
  batchId: ImportBatchIdSchema,
  failureCode: Schema.NullOr(Schema.String),
  id: ImportBatchItemIdSchema,
  idempotencyKey: Schema.String,
  sourceCanonicalId: Schema.String,
  sourceIdentityKind: ImportBatchSourceIdentityKindSchema,
  status: Schema.Literals(["queued", "running", "succeeded", "failed"]),
});

const ProjectionItemRow = Schema.Struct({
  deadLetterItemId: Schema.NullOr(Schema.String),
  disposition: Schema.NullOr(Schema.String),
  failureCode: Schema.NullOr(Schema.String),
  id: Schema.String,
  idempotencyKey: Schema.String,
  intentId: Schema.NullOr(Schema.String),
  status: Schema.Literals(["queued", "running", "succeeded", "failed"]),
});

const DeadLetterRow = Schema.Struct({
  correlationJson: Schema.String,
  failureCode: Schema.String,
  idempotencyKey: Schema.String,
  replayIntentId: Schema.NullOr(Schema.String),
  replayState: Schema.Literals(["ready", "claimed", "replayed"]),
  sourceCanonicalId: Schema.String,
  sourceIdentityKind: ImportBatchSourceIdentityKindSchema,
});

export type ImportQueueAcceptanceError =
  | ImportBatchQueueMessageNotFound
  | ImportPersistenceCorrupt
  | ImportPersistenceUnavailable;

const databaseEffect = <A>(operation: () => PromiseLike<A>) =>
  Effect.tryPromise({
    catch: importPersistenceUnavailable,
    try: operation,
  });

const operationalDatabaseEffect = <A>(operation: () => PromiseLike<A>) =>
  databaseEffect(operation).pipe(Effect.orDie);

const decodePersisted = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  value: unknown
): Effect.Effect<S["Type"], ImportPersistenceCorrupt> =>
  Effect.try({
    catch: importPersistenceCorrupt,
    try: () => Schema.decodeUnknownSync(schema)(value),
  });

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
                  WHEN SUM(status = 'running') > 0 THEN 'running'
                  WHEN SUM(status = 'queued') > 0 THEN 'queued'
                  WHEN COUNT(*) = SUM(status = 'succeeded') THEN 'completed'
                  WHEN COUNT(*) = SUM(status = 'failed') THEN 'failed'
                  ELSE 'partial_failure'
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
            failure_code AS failureCode,
            id,
            idempotency_key AS idempotencyKey,
            source_canonical_id AS sourceCanonicalId,
            source_identity_kind AS sourceIdentityKind,
            status
       FROM import_batch_items
      WHERE batch_id = ? AND id = ?`
  );

const failureForMissingMessage = (
  message: ImportBatchQueueMessage
): ImportBatchQueueMessageNotFound => ({
  _tag: "ImportBatchQueueMessageNotFound",
  batchId: message.batchId,
  itemId: message.itemId,
});

const failureCodeFor = (
  error: AdmitResolvedRecipeImportIntentError
): ImportBatchItemFailureCode => {
  switch (error._tag) {
    case "RecipeImportIntentIdempotencyConflict": {
      return "idempotency_conflict";
    }
    case "RecipeImportIntentNotFound": {
      return "intent_not_found";
    }
    case "RecipeImportIntentRedirected": {
      return "intent_redirected";
    }
    case "ImportIntentTransitionMutationConflict": {
      return "intent_transition_conflict";
    }
    case "RecipeImportIntentTransitionRejected": {
      return "intent_transition_rejected";
    }
    case "ImportPersistenceCorrupt": {
      return "persistence_corrupt";
    }
    case "ImportPersistenceUnavailable": {
      return "persistence_unavailable";
    }
    case "WorkflowStartUnavailable": {
      return "workflow_start_unavailable";
    }
    default: {
      return error satisfies never;
    }
  }
};

const resolvedIntentCommand = (
  canonicalId: string,
  sourceIdentityKind: ImportBatchSourceIdentityKind
) => {
  const canonicalUrl = Schema.decodeUnknownSync(CanonicalTikTokUrl)(
    `https://www.tiktok.com/@source/${sourceIdentityKind === "video" ? "video" : "photo"}/${encodeURIComponent(canonicalId)}`
  );
  return {
    request: Schema.decodeUnknownSync(CreateRecipeImportIntentRequest)({
      source: { kind: "tiktok", url: canonicalUrl },
    }),
    source: {
      canonicalSourceId:
        Schema.decodeUnknownSync(SourceCanonicalId)(canonicalId),
      canonicalUrl,
      sourceKind: sourceIdentityKind,
    },
  };
};

const aggregateStatus = (counts: {
  readonly failed: number;
  readonly queued: number;
  readonly running: number;
  readonly succeeded: number;
}) => {
  if (counts.running > 0) {
    return "running" as const;
  }
  if (counts.queued > 0) {
    return "queued" as const;
  }
  if (counts.failed === 0) {
    return "completed" as const;
  }
  if (counts.succeeded === 0) {
    return "failed" as const;
  }
  return "partial_failure" as const;
};

const itemView = (row: typeof ProjectionItemRow.Type) => {
  const base = {
    id: row.id,
    idempotencyKey: row.idempotencyKey,
    sourceKind: "tiktok" as const,
  };
  switch (row.status) {
    case "queued": {
      return { ...base, status: row.status };
    }
    case "running": {
      return { ...base, status: row.status };
    }
    case "failed": {
      return {
        ...base,
        code: row.failureCode,
        deadLettered: row.deadLetterItemId !== null,
        status: "failed" as const,
      };
    }
    case "succeeded": {
      return {
        ...base,
        disposition: row.disposition,
        intentId: row.intentId,
        status: "succeeded" as const,
      };
    }
    default: {
      return row.status satisfies never;
    }
  }
};

type ProjectionReadError =
  | ImportBatchNotFound
  | ImportPersistenceCorrupt
  | ImportPersistenceUnavailable;

const readBatchProjection = (
  database: AnyD1Database,
  batchId: ImportBatchId
): Effect.Effect<ImportBatchView, ProjectionReadError> =>
  Effect.gen(function* readProjection() {
    const [batchResult, itemResult] = yield* databaseEffect<
      readonly { readonly results: readonly unknown[] }[]
    >(() =>
      database.batch([
        database
          .prepare(
            `SELECT created_at AS createdAt,
                    id,
                    request_fingerprint AS requestFingerprint,
                    updated_at AS updatedAt
               FROM import_batches
              WHERE id = ?`
          )
          .bind(batchId),
        database
          .prepare(
            `SELECT d.item_id AS deadLetterItemId,
                    i.disposition,
                    i.failure_code AS failureCode,
                    i.id,
                    i.idempotency_key AS idempotencyKey,
                    i.intent_id AS intentId,
                    i.status
               FROM import_batch_items i
               LEFT JOIN import_dead_letters d ON d.item_id = i.id
              WHERE i.batch_id = ?
              ORDER BY i.created_at, i.id`
          )
          .bind(batchId),
      ])
    );
    if (batchResult === undefined || itemResult === undefined) {
      return yield* Effect.fail(importPersistenceCorrupt());
    }
    const [rawBatch] = batchResult.results;
    if (rawBatch === undefined) {
      return yield* Effect.fail<ImportBatchNotFound>({
        _tag: "ImportBatchNotFound",
        batchId,
      });
    }
    const batch = yield* decodePersisted(BatchRow, rawBatch);
    const items = yield* Effect.forEach((row) =>
      decodePersisted(ProjectionItemRow, row)
    )(itemResult.results);
    const counts = {
      failed: 0,
      queued: 0,
      running: 0,
      succeeded: 0,
      total: items.length,
    };
    for (const item of items) {
      counts[item.status] += 1;
    }
    const projection = yield* Effect.try({
      catch: importPersistenceCorrupt,
      try: () => ({
        counts,
        createdAt: batch.createdAt,
        id: batch.id,
        items: items.map(itemView),
        status: aggregateStatus(counts),
        updatedAt: batch.updatedAt,
      }),
    });
    return yield* decodePersisted(ImportBatchViewSchema, projection);
  });

const pendingMessages = (
  database: AnyD1Database,
  batchId: ImportBatchId
): Effect.Effect<
  readonly ImportBatchQueueMessage[],
  ImportPersistenceCorrupt | ImportPersistenceUnavailable
> =>
  databaseEffect<{
    readonly results: readonly Record<string, unknown>[];
  }>(() =>
    database
      .prepare(
        `SELECT batch_id AS batchId, id AS itemId
           FROM import_batch_items
          WHERE batch_id = ? AND status = 'queued'
          ORDER BY created_at, id`
      )
      .bind(batchId)
      .all<Record<string, unknown>>()
  ).pipe(
    Effect.flatMap(({ results }) =>
      Effect.forEach((row) =>
        decodePersisted(ImportBatchQueueMessageSchema, row)
      )(results)
    )
  );

const admissionProjection = (
  database: AnyD1Database,
  batchId: ImportBatchId
): Effect.Effect<ImportBatchAdmissionProjection, ProjectionReadError> =>
  Effect.all({
    batch: readBatchProjection(database, batchId),
    messages: pendingMessages(database, batchId),
  });

/** D1 is the sole durable truth for HTTP batch admission and polling. */
export const makeD1ImportBatchStore = (
  database: AnyD1Database
): ImportBatchStore => {
  const findReplay: ImportBatchStore["findReplay"] = Effect.fn(
    "ImportBatchStore.findReplay"
  )(function* findReplay(idempotencyKeyHash, requestFingerprint) {
    const row = yield* databaseEffect(() =>
      database
        .prepare(
          `SELECT id, request_fingerprint AS requestFingerprint
             FROM import_batches
            WHERE idempotency_key_hash = ?`
        )
        .bind(idempotencyKeyHash)
        .first<Record<string, unknown>>()
    );
    if (row === null) {
      return Option.none();
    }
    const existing = yield* decodePersisted(
      Schema.Struct({
        id: ImportBatchIdSchema,
        requestFingerprint: ImportBatchRequestFingerprint,
      }),
      row
    );
    if (existing.requestFingerprint !== requestFingerprint) {
      return yield* Effect.fail(importBatchConflict());
    }
    const projection = yield* admissionProjection(database, existing.id).pipe(
      Effect.catchTag("ImportBatchNotFound", () =>
        Effect.fail(importPersistenceCorrupt())
      )
    );
    return Option.some(projection);
  });

  const admit: ImportBatchStore["admit"] = (
    command: ImportBatchAdmissionCommand
  ) => {
    const timestamp = DateTime.formatIso(command.timestamp);
    const status = command.items.length === 0 ? "completed" : "queued";
    const inserted = databaseEffect(() =>
      database.batch([
        database
          .prepare(
            `INSERT INTO import_batches (
               id, idempotency_key_hash, request_fingerprint,
               status, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?)`
          )
          .bind(
            command.batchId,
            command.idempotencyKeyHash,
            command.requestFingerprint,
            status,
            timestamp,
            timestamp
          ),
        ...command.items.map((item) =>
          database
            .prepare(
              `INSERT INTO import_batch_items (
                 id, batch_id, idempotency_key, source_kind,
                 source_canonical_id, source_identity_kind, delivery_mode,
                 correlation_json, status, failure_code, attempt_count,
                 intent_id, disposition, created_at, updated_at
               ) VALUES (?, ?, ?, 'tiktok', ?, ?, 'ordinary', NULL, 'queued',
                         NULL, 0, NULL, NULL, ?, ?)`
            )
            .bind(
              item.id,
              command.batchId,
              item.idempotencyKey,
              item.sourceCanonicalId,
              item.sourceIdentityKind,
              timestamp,
              timestamp
            )
        ),
      ])
    ).pipe(
      Effect.flatMap(() =>
        admissionProjection(database, command.batchId).pipe(
          Effect.catchTag("ImportBatchNotFound", () =>
            Effect.fail(importPersistenceCorrupt())
          ),
          Effect.map((projection) => ({
            ...projection,
            disposition: "created" as const,
          }))
        )
      )
    );

    return inserted.pipe(
      Effect.catchTag("ImportPersistenceUnavailable", (failure) =>
        findReplay(command.idempotencyKeyHash, command.requestFingerprint).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.fail(failure),
              onSome: (projection) =>
                Effect.succeed({
                  ...projection,
                  disposition: "idempotency_replay" as const,
                }),
            })
          )
        )
      )
    );
  };

  return {
    admit,
    findReplay,
    get: (batchId) =>
      readBatchProjection(database, batchId).pipe(
        Effect.map((batch) => ({ batch }))
      ),
  };
};

const correlationFor = (message: ImportBatchQueueMessage) =>
  Schema.decodeUnknownSync(OperationalCorrelationSchema)({
    batchId: message.batchId,
    evidence: { kind: "recipe_draft", referenceId: message.itemId },
    importId: message.itemId,
    mealPlanId: `import-batch:${message.batchId}`,
    recipeId: message.itemId,
  });

const makeD1OperationalAdapters = (
  database: AnyD1Database,
  newReplayClaimId: () => DeadLetterReplayClaimId,
  now: () => string,
  replayClaimLeaseMilliseconds: number
): {
  readonly deadLetters: DeadLetterStore;
  readonly events: OperationalEventSink;
} => {
  const readDeadLetter = (itemId: ImportBatchItemId) =>
    operationalDatabaseEffect(() =>
      database
        .prepare(
          `SELECT d.correlation_json AS correlationJson,
                  d.failure_code AS failureCode,
                  i.idempotency_key AS idempotencyKey,
                  d.replay_intent_id AS replayIntentId,
                  d.replay_state AS replayState,
                  i.source_canonical_id AS sourceCanonicalId,
                  i.source_identity_kind AS sourceIdentityKind
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

  const deadLetters: DeadLetterStore = {
    claimReplay: (itemId) => {
      const claimedAt = now();
      const claimedAtEpochMilliseconds = Date.parse(claimedAt);
      if (!Number.isFinite(claimedAtEpochMilliseconds)) {
        throw new TypeError("Replay claim time must be a valid ISO timestamp");
      }
      const claimId = newReplayClaimId();
      const expiresAtEpochMilliseconds =
        claimedAtEpochMilliseconds + replayClaimLeaseMilliseconds;
      return operationalDatabaseEffect<
        readonly {
          readonly results: readonly unknown[];
        }[]
      >(() =>
        database.batch([
          database
            .prepare(
              `UPDATE import_dead_letters
                  SET replay_state = 'claimed',
                      replay_claim_id = ?,
                      replay_claim_expires_at_epoch_milliseconds = ?,
                      updated_at = ?
                WHERE item_id = ?
                  AND (
                    replay_state = 'ready'
                    OR (
                      replay_state = 'claimed'
                      AND replay_claim_expires_at_epoch_milliseconds <= ?
                    )
                  )
              RETURNING item_id`
            )
            .bind(
              claimId,
              expiresAtEpochMilliseconds,
              claimedAt,
              itemId,
              claimedAtEpochMilliseconds
            ),
          database
            .prepare(
              `SELECT d.correlation_json AS correlationJson,
                      d.failure_code AS failureCode,
                      i.idempotency_key AS idempotencyKey,
                      d.replay_intent_id AS replayIntentId,
                      d.replay_state AS replayState,
                      i.source_canonical_id AS sourceCanonicalId,
                      i.source_identity_kind AS sourceIdentityKind
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
                intentId: Schema.decodeUnknownSync(RecipeImportIntentIdSchema)(
                  row.replayIntentId
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
              claimId,
              command: {
                ...resolvedIntentCommand(
                  row.sourceCanonicalId,
                  row.sourceIdentityKind
                ),
                idempotencyKey: Schema.decodeUnknownSync(
                  RecipeImportIntentIdempotencyKey
                )(row.idempotencyKey),
              },
              correlation,
            });
          }
        )
      );
    },
    completeReplay: (itemId, claimId, intentId) => {
      const updatedAt = now();
      const completedAtEpochMilliseconds = Date.parse(updatedAt);
      if (!Number.isFinite(completedAtEpochMilliseconds)) {
        throw new TypeError(
          "Replay completion time must be a valid ISO timestamp"
        );
      }
      return operationalDatabaseEffect<
        readonly {
          readonly results: readonly unknown[];
        }[]
      >(() =>
        database.batch([
          database
            .prepare(
              `UPDATE import_dead_letters
                  SET replay_state = 'replayed',
                      replay_claim_expires_at_epoch_milliseconds = NULL,
                      replay_intent_id = ?,
                      updated_at = ?
                WHERE item_id = ?
                  AND replay_state = 'claimed'
                  AND replay_claim_id = ?
                  AND replay_claim_expires_at_epoch_milliseconds > ?
              RETURNING item_id`
            )
            .bind(
              intentId,
              updatedAt,
              itemId,
              claimId,
              completedAtEpochMilliseconds
            ),
          database
            .prepare(
              `UPDATE import_batch_items
                  SET status = 'succeeded',
                      failure_code = NULL,
                      intent_id = ?,
                      disposition = 'idempotency_replay',
                      updated_at = ?
                WHERE id = ?
                  AND status = 'failed'
                  AND EXISTS (
                    SELECT 1
                      FROM import_dead_letters
                     WHERE item_id = ?
                       AND replay_state = 'replayed'
                       AND replay_claim_id = ?
                       AND replay_intent_id = ?
                  )`
            )
            .bind(intentId, updatedAt, itemId, itemId, claimId, intentId),
          database
            .prepare(
              `UPDATE import_batches
                  SET status = (
                        SELECT CASE
                          WHEN SUM(status = 'running') > 0 THEN 'running'
                          WHEN SUM(status = 'queued') > 0 THEN 'queued'
                          WHEN COUNT(*) = SUM(status = 'succeeded') THEN 'completed'
                          WHEN COUNT(*) = SUM(status = 'failed') THEN 'failed'
                          ELSE 'partial_failure'
                        END
                          FROM import_batch_items
                         WHERE batch_id = (
                           SELECT batch_id FROM import_batch_items WHERE id = ?
                         )
                      ),
                      updated_at = ?
                WHERE id = (
                  SELECT batch_id FROM import_batch_items WHERE id = ?
                )
                  AND EXISTS (
                    SELECT 1
                      FROM import_dead_letters
                     WHERE item_id = ?
                       AND replay_state = 'replayed'
                       AND replay_claim_id = ?
                       AND replay_intent_id = ?
                  )`
            )
            .bind(itemId, updatedAt, itemId, itemId, claimId, intentId),
        ])
      ).pipe(
        Effect.flatMap(([completed]) =>
          completed !== undefined && completed.results.length === 1
            ? Effect.void
            : Effect.fail<DeadLetterReplayInProgress>({
                _tag: "DeadLetterReplayInProgress",
                itemId,
              })
        )
      );
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
    releaseReplay: (itemId, claimId) =>
      operationalDatabaseEffect(() =>
        database
          .prepare(
            `UPDATE import_dead_letters
                SET replay_state = 'ready',
                    replay_claim_id = NULL,
                    replay_claim_expires_at_epoch_milliseconds = NULL,
                    updated_at = ?
              WHERE item_id = ?
                AND replay_state = 'claimed'
                AND replay_claim_id = ?`
          )
          .bind(now(), itemId, claimId)
          .run()
      ).pipe(Effect.asVoid),
  };

  const events: OperationalEventSink = {
    emit: (event: OperationalEvent) =>
      operationalDatabaseEffect(() =>
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

/** Build the D1-backed queue consumer, DLQ, and operations adapters. */
export const makeD1ImportQueueAcceptance = (input: {
  readonly application: Pick<
    ReturnType<typeof makeImportIntentApplication>,
    "admit" | "resolveSource"
  >;
  readonly database: AnyD1Database;
  readonly newIntentId: () => RecipeImportIntentId;
  readonly newReplayClaimId: () => DeadLetterReplayClaimId;
  readonly now: () => string;
  readonly principal: ImportPrincipal;
  readonly replayClaimLeaseMilliseconds: number;
}) => {
  if (
    !Number.isInteger(input.replayClaimLeaseMilliseconds) ||
    input.replayClaimLeaseMilliseconds < 1
  ) {
    throw new Error("replayClaimLeaseMilliseconds must be a positive integer");
  }
  const operational = makeD1OperationalAdapters(
    input.database,
    input.newReplayClaimId,
    input.now,
    input.replayClaimLeaseMilliseconds
  );
  const intents = makeRecipeImportIntentAdmission(input);
  const store = makeD1ImportBatchStore(input.database);

  const claim = Effect.fn("ImportBatchQueue.claim")(function* claimDelivery(
    message: ImportBatchQueueMessage,
    deliveryAttempt: ImportBatchDeliveryAttempt
  ) {
    const updatedAt = input.now();
    const [claimed] = yield* databaseEffect<
      readonly { readonly results: readonly unknown[] }[]
    >(() =>
      input.database.batch([
        input.database
          .prepare(
            `UPDATE import_batch_items
                SET status = 'running',
                    attempt_count = ?,
                    updated_at = ?
              WHERE batch_id = ?
                AND id = ?
                AND delivery_mode = 'ordinary'
                AND (
                  (status = 'queued' AND attempt_count < ?)
                  OR (
                    status = 'running'
                    AND ? > 1
                    AND attempt_count < ?
                  )
                )
            RETURNING attempt_count AS attemptCount,
                      batch_id AS batchId,
                      failure_code AS failureCode,
                      id,
                      idempotency_key AS idempotencyKey,
                      source_canonical_id AS sourceCanonicalId,
                      source_identity_kind AS sourceIdentityKind,
                      status`
          )
          .bind(
            deliveryAttempt,
            updatedAt,
            message.batchId,
            message.itemId,
            deliveryAttempt,
            deliveryAttempt,
            deliveryAttempt
          ),
        updateBatchProjection(input.database, message.batchId, updatedAt),
      ])
    );
    const rawClaimed = claimed?.results[0];
    if (rawClaimed !== undefined) {
      return Option.some(yield* decodePersisted(QueueItemRow, rawClaimed));
    }

    const stored = yield* databaseEffect(() =>
      selectQueueItem(input.database)
        .bind(message.batchId, message.itemId)
        .first()
    );
    if (stored === null) {
      return yield* Effect.fail(failureForMissingMessage(message));
    }
    yield* decodePersisted(QueueItemRow, stored);
    return Option.none();
  });

  const settleFailure = Effect.fn("ImportBatchQueue.settleFailure")(
    function* settleFailedItem(
      message: ImportBatchQueueMessage,
      deliveryAttempt: ImportBatchDeliveryAttempt,
      code: ImportBatchItemFailureCode
    ) {
      const updatedAt = input.now();
      yield* databaseEffect(() =>
        input.database.batch([
          input.database
            .prepare(
              `UPDATE import_batch_items
                  SET status = 'failed',
                      failure_code = ?,
                      updated_at = ?
                WHERE batch_id = ?
                  AND id = ?
                  AND status = 'running'
                  AND attempt_count = ?`
            )
            .bind(
              code,
              updatedAt,
              message.batchId,
              message.itemId,
              deliveryAttempt
            ),
          updateBatchProjection(input.database, message.batchId, updatedAt),
        ])
      );
    }
  );

  const settleSuccess = Effect.fn("ImportBatchQueue.settleSuccess")(
    function* settleSuccessfulItem(
      message: ImportBatchQueueMessage,
      deliveryAttempt: ImportBatchDeliveryAttempt,
      result: AdmitResolvedRecipeImportIntentResult
    ) {
      const updatedAt = input.now();
      yield* databaseEffect(() =>
        input.database.batch([
          input.database
            .prepare(
              `UPDATE import_batch_items
                  SET status = 'succeeded',
                      failure_code = NULL,
                      intent_id = ?,
                      disposition = ?,
                      updated_at = ?
                WHERE batch_id = ?
                  AND id = ?
                  AND status = 'running'
                  AND attempt_count = ?`
            )
            .bind(
              result.intent.id,
              result.disposition,
              updatedAt,
              message.batchId,
              message.itemId,
              deliveryAttempt
            ),
          updateBatchProjection(input.database, message.batchId, updatedAt),
        ])
      );
    }
  );

  const consume = Effect.fn("ImportBatchQueue.consume")(function* consumeBatch(
    message: ImportBatchQueueMessage,
    deliveryAttempt: ImportBatchDeliveryAttempt
  ) {
    const claimed = yield* claim(message, deliveryAttempt);
    if (Option.isNone(claimed)) {
      return;
    }
    const item = claimed.value;
    const idempotencyKey = yield* decodePersisted(
      RecipeImportIntentIdempotencyKey,
      item.idempotencyKey
    );
    const command = yield* Effect.try({
      catch: importPersistenceCorrupt,
      try: () => ({
        ...resolvedIntentCommand(
          item.sourceCanonicalId,
          item.sourceIdentityKind
        ),
        idempotencyKey,
      }),
    });
    yield* intents.admitResolved(command).pipe(
      Effect.matchEffect({
        onFailure: (error) =>
          settleFailure(message, deliveryAttempt, failureCodeFor(error)),
        onSuccess: (result) => settleSuccess(message, deliveryAttempt, result),
      })
    );
  });

  const deadLetter = Effect.fn("ImportBatchQueue.deadLetter")(
    function* deadLetterBatch(message: ImportBatchQueueMessage) {
      const updatedAt = input.now();
      const correlationJson = JSON.stringify(correlationFor(message));
      const [failed] = yield* databaseEffect<
        readonly { readonly results: readonly unknown[] }[]
      >(() =>
        input.database.batch([
          input.database
            .prepare(
              `UPDATE import_batch_items
                SET status = 'failed',
                    failure_code = 'workflow_start_unavailable',
                    updated_at = ?
              WHERE batch_id = ?
                AND id = ?
                AND status IN ('queued', 'running')
            RETURNING id`
            )
            .bind(updatedAt, message.batchId, message.itemId),
          input.database
            .prepare(
              `INSERT INTO import_dead_letters (
               item_id, failure_code, correlation_json, replay_state,
               replay_intent_id, created_at, updated_at
             )
             SELECT id, 'workflow_start_unavailable', ?, 'ready', NULL, ?, ?
               FROM import_batch_items
              WHERE batch_id = ?
                AND id = ?
                AND status = 'failed'
                AND failure_code = 'workflow_start_unavailable'
             ON CONFLICT(item_id) DO NOTHING`
            )
            .bind(
              correlationJson,
              updatedAt,
              updatedAt,
              message.batchId,
              message.itemId
            ),
          updateBatchProjection(input.database, message.batchId, updatedAt),
        ])
      );
      if ((failed?.results.length ?? 0) > 0) {
        return;
      }
      const existing = yield* databaseEffect(() =>
        selectQueueItem(input.database)
          .bind(message.batchId, message.itemId)
          .first()
      );
      if (existing === null) {
        return yield* Effect.fail(failureForMissingMessage(message));
      }
      yield* decodePersisted(QueueItemRow, existing);
    }
  );

  return {
    consume,
    deadLetter,
    deadLetters: operational.deadLetters,
    events: operational.events,
    getBatch: (batchId: ImportBatchId) =>
      readBatchProjection(input.database, batchId),
    store,
  };
};
