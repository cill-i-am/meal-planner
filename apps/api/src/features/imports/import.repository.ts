import { Schema } from "effect";

import type {
  ImportNotFound,
  ImportPersistenceCorrupt,
  ImportPersistenceUnavailable,
  ImportTransitionRejected,
} from "./import.errors.js";

export type ImportTransitionError =
  | ImportNotFound
  | ImportPersistenceCorrupt
  | ImportPersistenceUnavailable
  | ImportTransitionRejected;

export const AcquisitionFinalizationResult = Schema.Literals([
  "Recorded",
  "Superseded",
]);
export type AcquisitionFinalizationResult =
  typeof AcquisitionFinalizationResult.Type;
