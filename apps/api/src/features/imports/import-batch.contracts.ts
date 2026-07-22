import { Schema } from "effect";

import {
  IdempotencyKey,
  ImportDisposition,
  ImportId,
  ImportStatus,
  ImportTimestamp,
  SourceCanonicalId,
  SourceDescriptor,
} from "./import.contracts.js";

/** Maximum number of ordinary imports admitted by one batch request. */
export const MaximumImportBatchSize = 50;

/** Stable public identity for one import batch. */
export const ImportBatchId = Schema.String.pipe(
  Schema.check(Schema.isUUID()),
  Schema.brand("ImportBatchId")
);
/** Stable public identity for one import batch. */
export type ImportBatchId = typeof ImportBatchId.Type;

/** Stable identity for one item within an import batch. */
export const ImportBatchItemId = Schema.String.pipe(
  Schema.check(Schema.isUUID()),
  Schema.brand("ImportBatchItemId")
);
/** Stable identity for one item within an import batch. */
export type ImportBatchItemId = typeof ImportBatchItemId.Type;

/** One ordinary import request and its retry-stable idempotency identity. */
export const ImportBatchItemRequest = Schema.Struct({
  idempotencyKey: IdempotencyKey,
  source: SourceDescriptor,
});
/** One ordinary import request and its retry-stable idempotency identity. */
export type ImportBatchItemRequest = typeof ImportBatchItemRequest.Type;

const hasUniqueItemIdempotencyKeys = Schema.makeFilter<
  readonly ImportBatchItemRequest[]
>(
  (items) =>
    new Set(items.map(({ idempotencyKey }) => idempotencyKey)).size ===
    items.length,
  { expected: "unique per-item idempotency keys" },
  true
);

/** Parsed POST body for creating an import batch. */
export const CreateImportBatchRequest = Schema.Struct({
  items: Schema.Array(ImportBatchItemRequest).pipe(
    Schema.check(Schema.isMaxLength(MaximumImportBatchSize)),
    Schema.check(hasUniqueItemIdempotencyKeys)
  ),
});
/** Parsed POST body for creating an import batch. */
export type CreateImportBatchRequest = typeof CreateImportBatchRequest.Type;

const QueuedImportBatchItem = Schema.Struct({
  id: ImportBatchItemId,
  idempotencyKey: IdempotencyKey,
  sourceKind: Schema.Literal("tiktok"),
  status: Schema.Literal("queued"),
});

const RunningImportBatchItem = Schema.Struct({
  id: ImportBatchItemId,
  idempotencyKey: IdempotencyKey,
  sourceKind: Schema.Literal("tiktok"),
  status: Schema.Literal("running"),
});

const SucceededImportBatchItem = Schema.Struct({
  canonicalId: SourceCanonicalId,
  disposition: ImportDisposition,
  id: ImportBatchItemId,
  idempotencyKey: IdempotencyKey,
  importId: ImportId,
  importStatus: ImportStatus,
  sourceKind: Schema.Literal("tiktok"),
  status: Schema.Literal("succeeded"),
});

/** Safe per-item error codes retained by a partial batch. */
export const ImportBatchItemFailureCode = Schema.Literals([
  "idempotency_conflict",
  "persistence_corrupt",
  "persistence_unavailable",
  "incompatible_duplicate",
  "invalid_source",
  "source_identity_unavailable",
  "source_validation_unavailable",
  "workflow_start_unavailable",
]);
/** Safe per-item error codes retained by a partial batch. */
export type ImportBatchItemFailureCode = typeof ImportBatchItemFailureCode.Type;

const FailedImportBatchItem = Schema.Struct({
  code: ImportBatchItemFailureCode,
  id: ImportBatchItemId,
  idempotencyKey: IdempotencyKey,
  sourceKind: Schema.Literal("tiktok"),
  status: Schema.Literal("failed"),
});

/** Pollable state for one ordinary import within a batch. */
export const ImportBatchItemView = Schema.Union([
  QueuedImportBatchItem,
  RunningImportBatchItem,
  SucceededImportBatchItem,
  FailedImportBatchItem,
]);
/** Pollable state for one ordinary import within a batch. */
export type ImportBatchItemView = typeof ImportBatchItemView.Type;

/** Aggregate batch lifecycle derived from its per-item states. */
export const ImportBatchStatus = Schema.Literals([
  "queued",
  "running",
  "completed",
  "partial_failure",
  "failed",
]);
/** Aggregate batch lifecycle derived from its per-item states. */
export type ImportBatchStatus = typeof ImportBatchStatus.Type;

/** Unambiguous counts for every batch item lifecycle state. */
const ImportBatchCount = Schema.Number.pipe(
  Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
);

export const ImportBatchCounts = Schema.Struct({
  failed: ImportBatchCount,
  queued: ImportBatchCount,
  running: ImportBatchCount,
  succeeded: ImportBatchCount,
  total: ImportBatchCount,
});
/** Unambiguous counts for every batch item lifecycle state. */
export type ImportBatchCounts = typeof ImportBatchCounts.Type;

/** Public pollable import-batch projection. */
export const ImportBatchView = Schema.Struct({
  counts: ImportBatchCounts,
  createdAt: ImportTimestamp,
  id: ImportBatchId,
  items: Schema.Array(ImportBatchItemView),
  status: ImportBatchStatus,
  updatedAt: ImportTimestamp,
});
/** Public pollable import-batch projection. */
export type ImportBatchView = typeof ImportBatchView.Type;

/** Creation outcome distinguishes a new batch from a POST replay. */
export const ImportBatchDisposition = Schema.Literals([
  "created",
  "idempotency_replay",
]);
/** Creation outcome distinguishes a new batch from a POST replay. */
export type ImportBatchDisposition = typeof ImportBatchDisposition.Type;

/** Typed response for POST /import-batches. */
export const CreateImportBatchResponse = Schema.Struct({
  batch: ImportBatchView,
  disposition: ImportBatchDisposition,
});
/** Typed response for POST /import-batches. */
export type CreateImportBatchResponse = typeof CreateImportBatchResponse.Type;

/** Typed response for GET /import-batches/:id. */
export const GetImportBatchResponse = Schema.Struct({
  batch: ImportBatchView,
});
/** Typed response for GET /import-batches/:id. */
export type GetImportBatchResponse = typeof GetImportBatchResponse.Type;

/** ID-only queue message; source locators remain in coordinator-owned state. */
export const ImportBatchQueueMessage = Schema.Struct({
  batchId: ImportBatchId,
  itemId: ImportBatchItemId,
});
/** ID-only queue message; source locators remain in coordinator-owned state. */
export type ImportBatchQueueMessage = typeof ImportBatchQueueMessage.Type;
