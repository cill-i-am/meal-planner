import type { ImportId } from "./import.contracts.js";

export interface InvalidImportRequest {
  readonly _tag: "InvalidImportRequest";
}

export interface InvalidSource {
  readonly _tag: "InvalidSource";
}

export interface SourceIdentityUnavailable {
  readonly _tag: "SourceIdentityUnavailable";
}

export interface UnauthorizedImportCaller {
  readonly _tag: "UnauthorizedImportCaller";
}

export interface IdempotencyConflict {
  readonly _tag: "IdempotencyConflict";
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

/** Exact native proof that the Workflow binding rejected before committing a start. */
export interface WorkflowStartRefused {
  readonly _tag: "WorkflowStartRefused";
}

export interface ImportTransitionRejected {
  readonly _tag: "ImportTransitionRejected";
}

export interface InvalidCarouselBundle {
  readonly _tag: "InvalidCarouselBundle";
}

export interface CarouselProcessingUnavailable {
  readonly _tag: "CarouselProcessingUnavailable";
}

export type SourceIdentityError = InvalidSource | SourceIdentityUnavailable;

export const invalidImportRequest = () => {
  const checkedResult: InvalidImportRequest = {
    _tag: "InvalidImportRequest",
  };
  return checkedResult;
};

export const invalidSource = () => {
  const checkedResult: InvalidSource = { _tag: "InvalidSource" };
  return checkedResult;
};

export const sourceIdentityUnavailable = () => {
  const checkedResult: SourceIdentityUnavailable = {
    _tag: "SourceIdentityUnavailable",
  };
  return checkedResult;
};

export const unauthorizedImportCaller = () => {
  const checkedResult: UnauthorizedImportCaller = {
    _tag: "UnauthorizedImportCaller",
  };
  return checkedResult;
};

export const importPersistenceUnavailable = () => {
  const checkedResult: ImportPersistenceUnavailable = {
    _tag: "ImportPersistenceUnavailable",
  };
  return checkedResult;
};

export const importPersistenceCorrupt = () => {
  const checkedResult: ImportPersistenceCorrupt = {
    _tag: "ImportPersistenceCorrupt",
  };
  return checkedResult;
};

export const workflowStartUnavailable = () => {
  const checkedResult: WorkflowStartUnavailable = {
    _tag: "WorkflowStartUnavailable",
  };
  return checkedResult;
};

export const workflowStartRefused = () => {
  const checkedResult: WorkflowStartRefused = {
    _tag: "WorkflowStartRefused",
  };
  return checkedResult;
};

export const importTransitionRejected = () => {
  const checkedResult: ImportTransitionRejected = {
    _tag: "ImportTransitionRejected",
  };
  return checkedResult;
};
