import { Context, Duration, Effect, Option, Schema } from "effect";

import { CreateImportBatchRequest } from "./import-batch.contracts.js";
import type {
  CreateImportBatchResponse,
  GetImportBatchResponse,
  ImportBatchId,
  ImportBatchItemId,
  ImportBatchQueueMessage,
  ImportBatchView,
} from "./import-batch.contracts.js";
import type {
  IdempotencyKey,
  ImportTimestamp,
  SourceCanonicalId,
} from "./import.contracts.js";
import { sourceIdentityUnavailable } from "./import.errors.js";
import type {
  ImportPersistenceCorrupt,
  ImportPersistenceUnavailable,
  InvalidSource,
  SourceIdentityUnavailable,
} from "./import.errors.js";
import type { CanonicalSourceIdentityResolverShape } from "./source-identity.js";

const ProviderDeadlineMilliseconds = 5000;
const MaximumConcurrentIdentityResolutions = 5;

const Sha256Hex = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-f\d]{64}$/u))
);

/** Privacy-safe digest of the batch idempotency key stored by D1. */
export const ImportBatchIdempotencyKeyHash = Sha256Hex.pipe(
  Schema.brand("ImportBatchIdempotencyKeyHash")
);
export type ImportBatchIdempotencyKeyHash =
  typeof ImportBatchIdempotencyKeyHash.Type;

/** Stable digest of the exact parsed batch request. */
export const ImportBatchRequestFingerprint = Sha256Hex.pipe(
  Schema.brand("ImportBatchRequestFingerprint")
);
export type ImportBatchRequestFingerprint =
  typeof ImportBatchRequestFingerprint.Type;

/** Durable discriminator for the admitted source identity resolution. */
export const ImportBatchSourceIdentityKind = Schema.Literals([
  "carousel",
  "video",
]);
export type ImportBatchSourceIdentityKind =
  typeof ImportBatchSourceIdentityKind.Type;

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
  | ImportBatchQueueUnavailable
  | ImportPersistenceCorrupt
  | ImportPersistenceUnavailable
  | InvalidSource
  | SourceIdentityUnavailable;

/** Expected failures when polling an import batch. */
export type GetImportBatchError =
  | ImportBatchNotFound
  | ImportPersistenceCorrupt
  | ImportPersistenceUnavailable;

/** Provider-neutral enqueue capability used by the batch coordinator. */
export interface ImportBatchQueueShape {
  readonly enqueue: (
    messages: readonly ImportBatchQueueMessage[]
  ) => Effect.Effect<void, ImportBatchQueueUnavailable>;
}

export interface ImportBatchAdmissionProjection {
  readonly batch: ImportBatchView;
  readonly messages: readonly ImportBatchQueueMessage[];
}

export interface ImportBatchAdmissionCommand {
  readonly batchId: ImportBatchId;
  readonly idempotencyKeyHash: ImportBatchIdempotencyKeyHash;
  readonly items: readonly {
    readonly id: ImportBatchItemId;
    readonly idempotencyKey: IdempotencyKey;
    readonly sourceCanonicalId: SourceCanonicalId;
    readonly sourceIdentityKind: ImportBatchSourceIdentityKind;
  }[];
  readonly requestFingerprint: ImportBatchRequestFingerprint;
  readonly timestamp: ImportTimestamp;
}

/** Durable batch persistence contract consumed by the application service. */
export interface ImportBatchStoreShape {
  readonly admit: (command: ImportBatchAdmissionCommand) => Effect.Effect<
    ImportBatchAdmissionProjection & {
      readonly disposition: "created" | "idempotency_replay";
    },
    | ImportBatchIdempotencyConflict
    | ImportPersistenceCorrupt
    | ImportPersistenceUnavailable
  >;
  readonly findReplay: (
    idempotencyKeyHash: ImportBatchIdempotencyKeyHash,
    requestFingerprint: ImportBatchRequestFingerprint
  ) => Effect.Effect<
    Option.Option<ImportBatchAdmissionProjection>,
    | ImportBatchIdempotencyConflict
    | ImportPersistenceCorrupt
    | ImportPersistenceUnavailable
  >;
  readonly get: (
    id: ImportBatchId
  ) => Effect.Effect<GetImportBatchResponse, GetImportBatchError>;
}

/** Construction options for the D1-backed batch application workflow. */
export interface MakeImportBatchServiceOptions {
  readonly identityResolver: CanonicalSourceIdentityResolverShape;
  readonly newBatchId: () => ImportBatchId;
  readonly newItemId: () => ImportBatchItemId;
  readonly now: () => ImportTimestamp;
  /** Finite test-only override for the code-owned five-second provider budget. */
  readonly providerDeadlineMilliseconds?: number;
  readonly queue: ImportBatchQueueShape;
  readonly store: ImportBatchStoreShape;
}

/** Application service contract mounted by the authenticated HTTP routes. */
export interface ImportBatchServiceShape {
  readonly create: (
    request: CreateImportBatchRequest,
    idempotencyKey: IdempotencyKey
  ) => Effect.Effect<CreateImportBatchResponse, CreateImportBatchError>;
  readonly get: (
    id: ImportBatchId
  ) => Effect.Effect<GetImportBatchResponse, GetImportBatchError>;
}

export const importBatchConflict = (): ImportBatchIdempotencyConflict => ({
  _tag: "ImportBatchIdempotencyConflict",
});

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

const finiteProviderDeadline = (override: number | undefined) => {
  const duration = override ?? ProviderDeadlineMilliseconds;
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("Provider deadline must be a positive finite duration");
  }
  return duration;
};

const enqueuePending = (
  queue: ImportBatchQueueShape,
  messages: readonly ImportBatchQueueMessage[]
) => (messages.length === 0 ? Effect.void : queue.enqueue(messages));

/** Build the bounded HTTP admission workflow over durable D1 state. */
export const makeImportBatchService = (
  options: MakeImportBatchServiceOptions
): ImportBatchServiceShape => {
  const providerDeadlineMilliseconds = finiteProviderDeadline(
    options.providerDeadlineMilliseconds
  );

  const create = Effect.fn("ImportBatchService.create")(function* createBatch(
    request: CreateImportBatchRequest,
    idempotencyKey: IdempotencyKey
  ) {
    const encodedRequest = Schema.encodeSync(CreateImportBatchRequest)(request);
    const idempotencyKeyHash = Schema.decodeUnknownSync(
      ImportBatchIdempotencyKeyHash
    )(yield* digestSha256(`batch-idempotency:v1:${idempotencyKey}`));
    const requestFingerprint = Schema.decodeUnknownSync(
      ImportBatchRequestFingerprint
    )(yield* digestSha256(JSON.stringify(encodedRequest)));

    const replay = yield* options.store.findReplay(
      idempotencyKeyHash,
      requestFingerprint
    );
    if (Option.isSome(replay)) {
      yield* enqueuePending(options.queue, replay.value.messages);
      return {
        batch: replay.value.batch,
        disposition: "idempotency_replay" as const,
      };
    }

    const resolvedItems = yield* Effect.forEach(
      request.items,
      (item) =>
        options.identityResolver.resolve(item.source).pipe(
          Effect.timeoutOrElse({
            duration: Duration.millis(providerDeadlineMilliseconds),
            orElse: () => Effect.fail(sourceIdentityUnavailable()),
          }),
          Effect.map((resolution) => ({
            id: options.newItemId(),
            idempotencyKey: item.idempotencyKey,
            sourceCanonicalId: resolution.identity.canonicalId,
            sourceIdentityKind:
              resolution._tag === "UnsupportedIdentity"
                ? ("carousel" as const)
                : ("video" as const),
          }))
        ),
      { concurrency: MaximumConcurrentIdentityResolutions }
    );
    const itemIds = new Set(resolvedItems.map(({ id }) => id));
    if (itemIds.size !== resolvedItems.length) {
      return yield* Effect.die(
        "Import batch item id generator produced a duplicate identity"
      );
    }

    const admitted = yield* options.store.admit({
      batchId: options.newBatchId(),
      idempotencyKeyHash,
      items: resolvedItems,
      requestFingerprint,
      timestamp: options.now(),
    });
    yield* enqueuePending(options.queue, admitted.messages);
    return {
      batch: admitted.batch,
      disposition: admitted.disposition,
    };
  });

  return {
    create,
    get: options.store.get,
  };
};

/** Effect service tag for the import-batch application seam. */
export class ImportBatchService extends Context.Service<
  ImportBatchService,
  ImportBatchServiceShape
>()("meal-planner/ImportBatchService") {}
