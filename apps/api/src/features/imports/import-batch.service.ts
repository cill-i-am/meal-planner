import { Context, Effect, Schema } from "effect";

import { CreateImportBatchRequest } from "./import-batch.contracts.js";
import type {
  CreateImportBatchResponse,
  GetImportBatchResponse,
  ImportBatchId,
  ImportBatchItemId,
  ImportBatchItemFailureCode,
  ImportBatchItemRequest,
  ImportBatchItemView,
  ImportBatchQueueMessage,
  ImportBatchView,
} from "./import-batch.contracts.js";
import type { IdempotencyKey, ImportTimestamp } from "./import.contracts.js";
import type { CreateImportError } from "./import.errors.js";
import type { ImportServiceShape } from "./import.service.js";

/** The batch idempotency key was reused for a different request. */
export interface ImportBatchIdempotencyConflict {
  readonly _tag: "ImportBatchIdempotencyConflict";
}

/** The requested import batch does not exist. */
export interface ImportBatchNotFound {
  readonly _tag: "ImportBatchNotFound";
  readonly batchId: ImportBatchId;
}

/** The provider-free queue seam could not accept the batch messages. */
export interface ImportBatchQueueUnavailable {
  readonly _tag: "ImportBatchQueueUnavailable";
}

/** A queue delivery did not reference a currently stored batch item. */
export interface ImportBatchQueueMessageNotFound {
  readonly _tag: "ImportBatchQueueMessageNotFound";
  readonly batchId: ImportBatchId;
  readonly itemId: ImportBatchItemId;
}

/** Expected failures when creating an import batch. */
export type CreateImportBatchError =
  | ImportBatchIdempotencyConflict
  | ImportBatchQueueUnavailable;

/** Expected failures when polling an import batch. */
export type GetImportBatchError = ImportBatchNotFound;

/** Expected failures while consuming provider queue deliveries. */
export type ConsumeImportBatchError = ImportBatchQueueMessageNotFound;

/** Provider-neutral enqueue capability used by the batch coordinator. */
export interface ImportBatchQueueShape {
  readonly enqueue: (
    messages: readonly ImportBatchQueueMessage[]
  ) => Effect.Effect<void, ImportBatchQueueUnavailable>;
}

/** Construction options for the provider-free batch coordinator. */
export interface MakeImportBatchServiceOptions {
  readonly concurrency: number;
  readonly imports: ImportServiceShape;
  readonly newBatchId: () => ImportBatchId;
  readonly newItemId: () => ImportBatchItemId;
  readonly now: () => ImportTimestamp;
  readonly queue: ImportBatchQueueShape;
}

/** Application service contract shared by HTTP and a future queue consumer. */
export interface ImportBatchServiceShape {
  readonly consume: (
    messages: readonly ImportBatchQueueMessage[]
  ) => Effect.Effect<void, ConsumeImportBatchError>;
  readonly create: (
    request: CreateImportBatchRequest,
    idempotencyKey: IdempotencyKey
  ) => Effect.Effect<CreateImportBatchResponse, CreateImportBatchError>;
  readonly get: (
    id: ImportBatchId
  ) => Effect.Effect<GetImportBatchResponse, GetImportBatchError>;
}

interface StoredBatchItem {
  readonly request: ImportBatchItemRequest;
  view: ImportBatchItemView;
}

interface StoredBatch {
  readonly createdAt: ImportTimestamp;
  readonly fingerprint: string;
  readonly id: ImportBatchId;
  readonly items: Map<ImportBatchItemId, StoredBatchItem>;
  updatedAt: ImportTimestamp;
}

const failureCode = (error: CreateImportError): ImportBatchItemFailureCode => {
  switch (error._tag) {
    case "IdempotencyConflict": {
      return "idempotency_conflict";
    }
    case "ImportPersistenceCorrupt": {
      return "persistence_corrupt";
    }
    case "ImportPersistenceUnavailable": {
      return "persistence_unavailable";
    }
    case "IncompatibleDuplicate": {
      return "incompatible_duplicate";
    }
    case "InvalidSource": {
      return "invalid_source";
    }
    case "SourceIdentityUnavailable": {
      return "source_identity_unavailable";
    }
    case "SourceValidationUnavailable": {
      return "source_validation_unavailable";
    }
    case "WorkflowStartUnavailable": {
      return "workflow_start_unavailable";
    }
    default: {
      return error satisfies never;
    }
  }
};

const projectBatch = (stored: StoredBatch): ImportBatchView => {
  const items = Array.from(stored.items.values(), ({ view }) => view);
  const counts = {
    failed: items.filter(({ status }) => status === "failed").length,
    queued: items.filter(({ status }) => status === "queued").length,
    running: items.filter(({ status }) => status === "running").length,
    succeeded: items.filter(({ status }) => status === "succeeded").length,
    total: items.length,
  };
  let status: ImportBatchView["status"];
  if (counts.running > 0) {
    status = "running";
  } else if (counts.queued > 0) {
    status = "queued";
  } else if (counts.failed === 0) {
    status = "completed";
  } else if (counts.succeeded === 0) {
    status = "failed";
  } else {
    status = "partial_failure";
  }
  return {
    counts,
    createdAt: stored.createdAt,
    id: stored.id,
    items,
    status,
    updatedAt: stored.updatedAt,
  };
};

/** Build the in-memory provider-free tracer behind the stable service seam. */
export const makeImportBatchService = (
  options: MakeImportBatchServiceOptions
): ImportBatchServiceShape => {
  if (!Number.isSafeInteger(options.concurrency) || options.concurrency < 1) {
    throw new Error("Import batch concurrency must be a positive integer");
  }

  const batches = new Map<ImportBatchId, StoredBatch>();
  const batchesByKey = new Map<IdempotencyKey, ImportBatchId>();

  const consumeOne = (message: ImportBatchQueueMessage) =>
    Effect.suspend(() => {
      const batch = batches.get(message.batchId);
      const item = batch?.items.get(message.itemId);
      if (batch === undefined || item === undefined) {
        return Effect.fail<ImportBatchQueueMessageNotFound>({
          _tag: "ImportBatchQueueMessageNotFound",
          batchId: message.batchId,
          itemId: message.itemId,
        });
      }
      if (item.view.status === "succeeded" || item.view.status === "running") {
        return Effect.void;
      }
      item.view = {
        id: item.view.id,
        idempotencyKey: item.view.idempotencyKey,
        sourceKind: item.view.sourceKind,
        status: "running",
      };
      batch.updatedAt = options.now();
      return options.imports
        .create({ source: item.request.source }, item.request.idempotencyKey)
        .pipe(
          Effect.match({
            onFailure: (error): ImportBatchItemView => ({
              code: failureCode(error),
              id: item.view.id,
              idempotencyKey: item.view.idempotencyKey,
              sourceKind: item.view.sourceKind,
              status: "failed",
            }),
            onSuccess: (response): ImportBatchItemView => {
              const { canonicalId } = response.import.source;
              if (canonicalId === undefined) {
                throw new Error(
                  "Ordinary import succeeded without a canonical identity"
                );
              }
              return {
                canonicalId,
                disposition: response.disposition,
                id: item.view.id,
                idempotencyKey: item.view.idempotencyKey,
                importId: response.import.id,
                importStatus: response.import.status,
                sourceKind: item.view.sourceKind,
                status: "succeeded",
              };
            },
          }),
          Effect.tap((view) =>
            Effect.sync(() => {
              item.view = view;
              batch.updatedAt = options.now();
            })
          ),
          Effect.asVoid
        );
    });

  const create: ImportBatchServiceShape["create"] = (request, idempotencyKey) =>
    Effect.suspend(
      (): Effect.Effect<CreateImportBatchResponse, CreateImportBatchError> => {
        const fingerprint = JSON.stringify(
          Schema.encodeSync(CreateImportBatchRequest)(request)
        );
        const existingId = batchesByKey.get(idempotencyKey);
        if (existingId !== undefined) {
          const existing = batches.get(existingId);
          if (existing === undefined || existing.fingerprint !== fingerprint) {
            return Effect.fail<ImportBatchIdempotencyConflict>({
              _tag: "ImportBatchIdempotencyConflict",
            });
          }
          return Effect.succeed({
            batch: projectBatch(existing),
            disposition: "idempotency_replay" as const,
          });
        }
        const timestamp = options.now();
        const batchId = options.newBatchId();
        if (batches.has(batchId)) {
          throw new Error(
            "Import batch id generator produced a duplicate identity"
          );
        }
        const stored: StoredBatch = {
          createdAt: timestamp,
          fingerprint,
          id: batchId,
          items: new Map(),
          updatedAt: timestamp,
        };
        for (const item of request.items) {
          const itemId = options.newItemId();
          if (stored.items.has(itemId)) {
            throw new Error(
              "Import batch item id generator produced a duplicate identity"
            );
          }
          stored.items.set(itemId, {
            request: item,
            view: {
              id: itemId,
              idempotencyKey: item.idempotencyKey,
              sourceKind: item.source.kind,
              status: "queued",
            },
          });
        }
        batches.set(stored.id, stored);
        batchesByKey.set(idempotencyKey, stored.id);
        const messages = Array.from(stored.items.keys(), (itemId) => ({
          batchId: stored.id,
          itemId,
        }));
        return options.queue.enqueue(messages).pipe(
          Effect.tapError(() =>
            Effect.sync(() => {
              batches.delete(stored.id);
              batchesByKey.delete(idempotencyKey);
            })
          ),
          Effect.as({
            batch: projectBatch(stored),
            disposition: "created" as const,
          })
        );
      }
    );

  return {
    consume: (messages) =>
      Effect.forEach(messages, consumeOne, {
        concurrency: options.concurrency,
        discard: true,
      }),
    create,
    get: (id) =>
      Effect.suspend(() => {
        const stored = batches.get(id);
        return stored === undefined
          ? Effect.fail<ImportBatchNotFound>({
              _tag: "ImportBatchNotFound",
              batchId: id,
            })
          : Effect.succeed({ batch: projectBatch(stored) });
      }),
  };
};

/** Effect service tag for the import-batch application seam. */
export class ImportBatchService extends Context.Service<
  ImportBatchService,
  ImportBatchServiceShape
>()("meal-planner/ImportBatchService") {}
