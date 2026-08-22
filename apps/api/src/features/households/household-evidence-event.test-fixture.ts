import type { AnyD1Database } from "drizzle-orm/d1";
import { Effect, Schema } from "effect";

import {
  ImportEvidenceEventFailure,
  reconcileImportEvidenceQueueMessage,
} from "../imports/import-evidence-event.js";
import { makeD1ImportEvidenceRouteRepository } from "../imports/import-evidence-route.repository.d1.js";
import { HouseholdObserveEvidenceReferenceInput } from "./evidence/household-evidence.contract.js";
import type {
  HouseholdObserveEvidenceReferenceResult,
  HouseholdReadEvidenceReferencesInput,
  HouseholdReadEvidenceReferencesResult,
} from "./evidence/household-evidence.contract.js";

interface TestKvNamespace {
  readonly get: (key: string) => Promise<string | null>;
  readonly put: (key: string, value: string) => Promise<void>;
}

interface TestR2Bucket {
  readonly head: (key: string) => Promise<{
    readonly checksums?: { readonly sha256?: ArrayBuffer };
    readonly customMetadata?: Record<string, string>;
  } | null>;
}

interface TestMessageBatch {
  readonly messages: readonly {
    readonly ack: () => void;
    readonly body: unknown;
    readonly retry: () => void;
  }[];
}

interface Environment {
  readonly EVIDENCE_EVENT_RESULTS: TestKvNamespace;
  readonly ImportEvidenceBucket: TestR2Bucket;
  readonly MealPlannerDatabase: AnyD1Database;
  readonly HouseholdDomainWorker: {
    readonly observeEvidenceReference: (
      input: typeof HouseholdObserveEvidenceReferenceInput.Encoded
    ) => Promise<typeof HouseholdObserveEvidenceReferenceResult.Encoded>;
    readonly readEvidenceReferences: (
      input: HouseholdReadEvidenceReferencesInput
    ) => Promise<typeof HouseholdReadEvidenceReferencesResult.Encoded>;
  };
}

const RpcErrorEnvelope = Schema.Struct({
  _tag: Schema.Literal("~alchemy/rpc/error"),
  error: Schema.Struct({ reason: Schema.optionalKey(Schema.String) }),
});

const dependencyFailure = () =>
  new ImportEvidenceEventFailure({
    reason: "dependency_unavailable",
    retryable: true,
  });

const rpc = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({ catch: dependencyFailure, try: run }).pipe(
    Effect.flatMap((value) => {
      const rejected = Schema.decodeUnknownOption(RpcErrorEnvelope)(value);
      if (rejected._tag === "None") {
        // Raw Workerd service bindings retain hidden RPC metadata. Normalize to
        // the plain structured clone returned by the Alchemy binding adapter.
        return Effect.try({
          catch: dependencyFailure,
          try: () => structuredClone(value),
        });
      }
      return Effect.fail(
        rejected.value.error.reason === "persistence_unavailable"
          ? dependencyFailure()
          : new ImportEvidenceEventFailure({
              reason: "stale_event",
              retryable: false,
            })
      );
    })
  );

export default {
  async queue(batch: TestMessageBatch, environment: Environment) {
    const routes = makeD1ImportEvidenceRouteRepository(
      environment.MealPlannerDatabase
    );
    await Promise.all(
      batch.messages.map(async (message) => {
        const safeResult = await Effect.runPromise(
          reconcileImportEvidenceQueueMessage(message.body, {
            bucket: {
              head: (key) =>
                Effect.promise(() =>
                  environment.ImportEvidenceBucket.head(key)
                ).pipe(Effect.mapError(dependencyFailure)),
            },
            household: {
              observeEvidenceReference: (input) =>
                Schema.encodeEffect(HouseholdObserveEvidenceReferenceInput)(
                  input
                ).pipe(
                  Effect.mapError(dependencyFailure),
                  Effect.flatMap((encoded) =>
                    rpc(() =>
                      environment.HouseholdDomainWorker.observeEvidenceReference(
                        encoded
                      )
                    )
                  )
                ),
              readEvidenceReferences: (input) =>
                rpc(() =>
                  environment.HouseholdDomainWorker.readEvidenceReferences(
                    input
                  )
                ),
            },
            routes: {
              get: (importId) =>
                routes.get(importId).pipe(Effect.mapError(dependencyFailure)),
              register: (route) =>
                routes.register(route).pipe(Effect.mapError(dependencyFailure)),
            },
          }).pipe(
            Effect.match({
              onFailure: (error) => ({
                _tag: "Rejected" as const,
                reason: error.reason,
                retryable: error.retryable,
              }),
              onSuccess: (value) => ({ _tag: "Accepted" as const, value }),
            })
          )
        );
        await environment.EVIDENCE_EVENT_RESULTS.put(
          "last",
          JSON.stringify(safeResult)
        );
        if (safeResult._tag === "Rejected" && safeResult.retryable) {
          message.retry();
        } else {
          message.ack();
        }
      })
    );
  },
};
