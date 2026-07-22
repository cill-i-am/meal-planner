import { Effect } from "effect";

import type {
  CreateImportRequest,
  CreateImportResponse,
  IdempotencyKey,
  ImportView,
} from "./import.contracts.js";
import { importNotFound } from "./import.errors.js";
import type { CreateImportError } from "./import.errors.js";
import type { ImportServiceShape } from "./import.service.js";

/** One deterministic ordinary-import result consumed in configured order. */
export interface DeterministicImportAttempt {
  readonly idempotencyKey: string;
  readonly outcome:
    | { readonly _tag: "Failure"; readonly error: CreateImportError }
    | { readonly _tag: "Success"; readonly import: ImportView };
}

/** Recorded call made through the existing ordinary ImportService seam. */
export interface DeterministicImportCall {
  readonly idempotencyKey: IdempotencyKey;
  readonly request: CreateImportRequest;
}

/** Recording fake for the existing ordinary ImportService seam. */
export const makeDeterministicOrdinaryImportService = (options: {
  readonly attempts: readonly DeterministicImportAttempt[];
}): {
  readonly calls: readonly DeterministicImportCall[];
  readonly evidenceWrites: number;
  readonly ordinaryImportsCreated: number;
  readonly service: ImportServiceShape;
} => {
  const calls: DeterministicImportCall[] = [];
  const consumed = new Set<number>();
  const importsByCanonicalId = new Map<string, ImportView>();
  const importsById = new Map<string, ImportView>();
  const importsByKey = new Map<string, ImportView>();
  let evidenceWrites = 0;
  let ordinaryImportsCreated = 0;

  const create: ImportServiceShape["create"] = (request, idempotencyKey) =>
    Effect.suspend(
      (): Effect.Effect<CreateImportResponse, CreateImportError> => {
        calls.push({ idempotencyKey, request });
        const replay = importsByKey.get(idempotencyKey);
        if (replay !== undefined) {
          return Effect.succeed({
            disposition: "idempotency_replay" as const,
            import: replay,
          });
        }
        const attemptIndex = options.attempts.findIndex(
          (attempt, index) =>
            !consumed.has(index) && attempt.idempotencyKey === idempotencyKey
        );
        const attempt = options.attempts[attemptIndex];
        if (attemptIndex < 0 || attempt === undefined) {
          return Effect.die(
            "No deterministic ordinary import attempt configured"
          );
        }
        consumed.add(attemptIndex);
        if (attempt.outcome._tag === "Failure") {
          return Effect.fail(attempt.outcome.error);
        }
        const canonicalId = attempt.outcome.import.source.canonicalId;
        if (canonicalId === undefined) {
          return Effect.die(
            "Deterministic ordinary import is missing a canonical identity"
          );
        }
        const canonical = importsByCanonicalId.get(canonicalId);
        if (canonical !== undefined) {
          importsByKey.set(idempotencyKey, canonical);
          return Effect.succeed({
            disposition: "canonical_duplicate" as const,
            import: canonical,
          });
        }
        const created = attempt.outcome.import;
        importsByCanonicalId.set(canonicalId, created);
        importsById.set(created.id, created);
        importsByKey.set(idempotencyKey, created);
        evidenceWrites += created.evidence.length;
        ordinaryImportsCreated += 1;
        return Effect.succeed({
          disposition: "created" as const,
          import: created,
        });
      }
    );

  return {
    calls,
    get evidenceWrites() {
      return evidenceWrites;
    },
    get ordinaryImportsCreated() {
      return ordinaryImportsCreated;
    },
    service: {
      create,
      get: (id) => {
        const found = importsById.get(id);
        return found === undefined
          ? Effect.fail(importNotFound(id))
          : Effect.succeed({ import: found });
      },
    },
  };
};
