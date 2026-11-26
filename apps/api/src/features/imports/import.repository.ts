import type {
  ImportNotFound,
  ImportPersistenceCorrupt,
  ImportPersistenceUnavailable,
  ImportTransitionRejected,
} from "@meal-planner/recipe-imports/contracts/errors";
import { Schema } from "effect";

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
