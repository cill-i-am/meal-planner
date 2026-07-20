import type { Effect, Option } from "effect";
import { Context, Schema } from "effect";

import type {
  ImportDisposition,
  ImportId,
  ImportView,
  SourceCanonicalId,
} from "./import.contracts.js";
import type {
  IdempotencyConflict,
  ImportPersistenceCorrupt,
  ImportPersistenceUnavailable,
  IncompatibleDuplicate,
} from "./import.errors.js";

const Sha256Hex = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-f\d]{64}$/u))
);

export const CompatibilityFingerprint = Sha256Hex.pipe(
  Schema.brand("CompatibilityFingerprint")
);
export type CompatibilityFingerprint = typeof CompatibilityFingerprint.Type;

export const IdempotencyKeyHash = Sha256Hex.pipe(
  Schema.brand("IdempotencyKeyHash")
);
export type IdempotencyKeyHash = typeof IdempotencyKeyHash.Type;

export const RequestFingerprint = Sha256Hex.pipe(
  Schema.brand("RequestFingerprint")
);
export type RequestFingerprint = typeof RequestFingerprint.Type;

export const SourceLocatorHash = Sha256Hex.pipe(
  Schema.brand("SourceLocatorHash")
);
export type SourceLocatorHash = typeof SourceLocatorHash.Type;

export interface StoredImport {
  readonly canonicalSourceId: SourceCanonicalId;
  readonly compatibilityFingerprint: CompatibilityFingerprint;
  readonly sourceKind: "tiktok";
  readonly view: ImportView;
}

export interface StoredImportRequest {
  readonly import: StoredImport;
  readonly requestFingerprint: RequestFingerprint;
  readonly sourceLocatorHash: SourceLocatorHash;
}

export interface AcceptImportCommand {
  readonly candidate: StoredImport;
  readonly idempotencyKeyHash: IdempotencyKeyHash;
  readonly requestFingerprint: RequestFingerprint;
  readonly sourceLocatorHash: SourceLocatorHash;
}

export interface AcceptImportResult {
  readonly disposition: ImportDisposition;
  readonly import: StoredImport;
}

export type ImportRepositoryError =
  | IdempotencyConflict
  | ImportPersistenceCorrupt
  | ImportPersistenceUnavailable
  | IncompatibleDuplicate;

export interface ImportRepositoryShape {
  readonly acceptRequest: (
    command: AcceptImportCommand
  ) => Effect.Effect<AcceptImportResult, ImportRepositoryError>;
  readonly findByCanonicalIdentity: (identity: {
    readonly canonicalId: SourceCanonicalId;
    readonly kind: "tiktok";
  }) => Effect.Effect<
    Option.Option<StoredImport>,
    ImportPersistenceCorrupt | ImportPersistenceUnavailable
  >;
  readonly findById: (
    id: ImportId
  ) => Effect.Effect<
    Option.Option<StoredImport>,
    ImportPersistenceCorrupt | ImportPersistenceUnavailable
  >;
  readonly findRequest: (
    idempotencyKeyHash: IdempotencyKeyHash
  ) => Effect.Effect<
    Option.Option<StoredImportRequest>,
    ImportPersistenceCorrupt | ImportPersistenceUnavailable
  >;
}

export class ImportRepository extends Context.Service<
  ImportRepository,
  ImportRepositoryShape
>()("meal-planner/ImportRepository") {}
