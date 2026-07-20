import type { ImportId } from "./import.contracts.js";

export interface InvalidImportRequest {
  readonly _tag: "InvalidImportRequest";
}

export interface InvalidImportId {
  readonly _tag: "InvalidImportId";
}

export interface InvalidSource {
  readonly _tag: "InvalidSource";
}

export interface SourceIdentityUnavailable {
  readonly _tag: "SourceIdentityUnavailable";
}

export interface SourceValidationUnavailable {
  readonly _tag: "SourceValidationUnavailable";
}

export interface UnauthorizedImportCaller {
  readonly _tag: "UnauthorizedImportCaller";
}

export interface IdempotencyConflict {
  readonly _tag: "IdempotencyConflict";
}

export interface IncompatibleDuplicate {
  readonly _tag: "IncompatibleDuplicate";
}

export interface ImportNotFound {
  readonly _tag: "ImportNotFound";
  readonly importId: ImportId;
}

export interface ImportPersistenceUnavailable {
  readonly _tag: "ImportPersistenceUnavailable";
}

export interface ImportPersistenceCorrupt {
  readonly _tag: "ImportPersistenceCorrupt";
}

export interface WorkflowStartUnavailable {
  readonly _tag: "WorkflowStartUnavailable";
}

export interface ImportTransitionRejected {
  readonly _tag: "ImportTransitionRejected";
}

export type SourceIdentityError = InvalidSource | SourceIdentityUnavailable;

export type SourceAvailabilityError = SourceValidationUnavailable;

export type CreateImportError =
  | IdempotencyConflict
  | ImportPersistenceCorrupt
  | ImportPersistenceUnavailable
  | IncompatibleDuplicate
  | InvalidSource
  | SourceIdentityUnavailable
  | SourceValidationUnavailable
  | WorkflowStartUnavailable;

export type GetImportError =
  | ImportNotFound
  | ImportPersistenceCorrupt
  | ImportPersistenceUnavailable;

export const invalidImportRequest = (): InvalidImportRequest => ({
  _tag: "InvalidImportRequest",
});

export const invalidImportId = (): InvalidImportId => ({
  _tag: "InvalidImportId",
});

export const invalidSource = (): InvalidSource => ({ _tag: "InvalidSource" });

export const sourceIdentityUnavailable = (): SourceIdentityUnavailable => ({
  _tag: "SourceIdentityUnavailable",
});

export const sourceValidationUnavailable = (): SourceValidationUnavailable => ({
  _tag: "SourceValidationUnavailable",
});

export const unauthorizedImportCaller = (): UnauthorizedImportCaller => ({
  _tag: "UnauthorizedImportCaller",
});

export const idempotencyConflict = (): IdempotencyConflict => ({
  _tag: "IdempotencyConflict",
});

export const incompatibleDuplicate = (): IncompatibleDuplicate => ({
  _tag: "IncompatibleDuplicate",
});

export const importNotFound = (importId: ImportId): ImportNotFound => ({
  _tag: "ImportNotFound",
  importId,
});

export const importPersistenceUnavailable =
  (): ImportPersistenceUnavailable => ({
    _tag: "ImportPersistenceUnavailable",
  });

export const importPersistenceCorrupt = (): ImportPersistenceCorrupt => ({
  _tag: "ImportPersistenceCorrupt",
});

export const workflowStartUnavailable = (): WorkflowStartUnavailable => ({
  _tag: "WorkflowStartUnavailable",
});

export const importTransitionRejected = (): ImportTransitionRejected => ({
  _tag: "ImportTransitionRejected",
});
