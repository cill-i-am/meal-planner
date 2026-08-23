import type { AnyD1Database } from "drizzle-orm/d1";
import { Effect, Schema } from "effect";

import {
  ImportEvidenceEventFailure,
  reconcileImportEvidenceQueueMessage,
} from "../imports/import-evidence-event.js";
import { makeD1ImportEvidenceRouteRepository } from "../imports/import-evidence-route.repository.d1.js";
import { ImportTraceContext } from "../imports/import-observability.js";
import {
  ProviderTerminalSettlementRequest,
  ProviderTerminalSettlementResponse,
  makeD1ProviderTerminalSettlementService,
} from "../imports/import-provider-terminal-settlement.js";
import { ImportTimestamp } from "../imports/import.contracts.js";
import { HouseholdObserveEvidenceReferenceInput } from "./evidence/household-evidence.contract.js";
import type {
  HouseholdMutateEvidenceStageInput,
  HouseholdMutateEvidenceStageResult,
  HouseholdObserveEvidenceReferenceResult,
  HouseholdPrepareRecipeRecoveryInput,
  HouseholdPrepareRecipeRecoveryResult,
  HouseholdReadEvidenceReferencesInput,
  HouseholdReadEvidenceReferencesResult,
  HouseholdReadEvidenceStageInput,
  HouseholdReadEvidenceStageResult,
  HouseholdReadImportTerminalCheckpointInput,
  HouseholdReadImportTerminalCheckpointResult,
  HouseholdReadRecipeRecoveryAttemptInput,
  HouseholdReadRecipeRecoveryAttemptResult,
} from "./evidence/household-evidence.contract.js";
import { HouseholdRecipeImportFailure } from "./recipe-import/household-recipe-import.contract.js";
import type {
  HouseholdReadRecipeImportExecutionInput,
  HouseholdRecipeImportExecutionView,
} from "./recipe-import/household-recipe-import.contract.js";

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
    readonly mutateEvidenceStage: (
      input: typeof HouseholdMutateEvidenceStageInput.Encoded
    ) => Promise<typeof HouseholdMutateEvidenceStageResult.Encoded>;
    readonly observeEvidenceReference: (
      input: typeof HouseholdObserveEvidenceReferenceInput.Encoded
    ) => Promise<typeof HouseholdObserveEvidenceReferenceResult.Encoded>;
    readonly readEvidenceReferences: (
      input: HouseholdReadEvidenceReferencesInput
    ) => Promise<typeof HouseholdReadEvidenceReferencesResult.Encoded>;
    readonly prepareRecipeRecovery: (
      input: typeof HouseholdPrepareRecipeRecoveryInput.Encoded
    ) => Promise<typeof HouseholdPrepareRecipeRecoveryResult.Encoded>;
    readonly readEvidenceStage: (
      input: HouseholdReadEvidenceStageInput
    ) => Promise<typeof HouseholdReadEvidenceStageResult.Encoded>;
    readonly readImportTerminalCheckpoint: (
      input: HouseholdReadImportTerminalCheckpointInput
    ) => Promise<typeof HouseholdReadImportTerminalCheckpointResult.Encoded>;
    readonly readRecipeImportExecution: (
      input: HouseholdReadRecipeImportExecutionInput
    ) => Promise<typeof HouseholdRecipeImportExecutionView.Encoded>;
    readonly readRecipeRecoveryAttempt: (
      input: HouseholdReadRecipeRecoveryAttemptInput
    ) => Promise<typeof HouseholdReadRecipeRecoveryAttemptResult.Encoded>;
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

const terminalRpc = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({
    catch: () =>
      HouseholdRecipeImportFailure.make({
        reason: "persistence_unavailable",
      }),
    try: run,
  }).pipe(
    Effect.flatMap((value) => {
      const rejected = Schema.decodeUnknownOption(RpcErrorEnvelope)(value);
      if (rejected._tag === "Some") {
        return Effect.fail(
          HouseholdRecipeImportFailure.make({
            reason:
              rejected.value.error.reason === "persistence_unavailable"
                ? "persistence_unavailable"
                : "illegal_transition",
          })
        );
      }
      return Effect.try({
        catch: () =>
          HouseholdRecipeImportFailure.make({
            reason: "persistence_unavailable",
          }),
        try: () => structuredClone(value),
      });
    })
  );

const terminalHousehold = (environment: Environment) => ({
  mutateEvidenceStage: (
    input: typeof HouseholdMutateEvidenceStageInput.Encoded
  ) =>
    terminalRpc(() =>
      environment.HouseholdDomainWorker.mutateEvidenceStage(input)
    ),
  prepareRecipeRecovery: (
    input: typeof HouseholdPrepareRecipeRecoveryInput.Encoded
  ) =>
    terminalRpc(() =>
      environment.HouseholdDomainWorker.prepareRecipeRecovery(input)
    ),
  readEvidenceStage: (input: HouseholdReadEvidenceStageInput) =>
    terminalRpc(() =>
      environment.HouseholdDomainWorker.readEvidenceStage(input)
    ),
  readImportTerminalCheckpoint: (
    input: HouseholdReadImportTerminalCheckpointInput
  ) =>
    terminalRpc(() =>
      environment.HouseholdDomainWorker.readImportTerminalCheckpoint(input)
    ),
  readRecipeImportExecution: (input: HouseholdReadRecipeImportExecutionInput) =>
    terminalRpc(() =>
      environment.HouseholdDomainWorker.readRecipeImportExecution(input)
    ),
  readRecipeRecoveryAttempt: (input: HouseholdReadRecipeRecoveryAttemptInput) =>
    terminalRpc(() =>
      environment.HouseholdDomainWorker.readRecipeRecoveryAttempt(input)
    ),
});

export default {
  async fetch(request: Request, environment: Environment) {
    if (request.headers.get("x-test-terminal-settlement") !== "1") {
      return new Response(null, { status: 404 });
    }
    try {
      const command = await Schema.decodeUnknownPromise(
        ProviderTerminalSettlementRequest,
        { onExcessProperty: "error" }
      )(await request.json());
      const result = await Effect.runPromise(
        makeD1ProviderTerminalSettlementService({
          database: environment.MealPlannerDatabase,
          householdDomain: terminalHousehold(environment),
          now: () =>
            Schema.decodeUnknownSync(ImportTimestamp)(new Date().toISOString()),
          recipeRecoveryStarter: { start: () => Effect.void },
          runtimeStage: "pilot-gaia-118",
          trace: Schema.decodeUnknownSync(ImportTraceContext)({
            correlationId: "00000000-0000-4000-8000-000000000188",
          }),
          workflowStarter: { restartFromSpeech: () => Effect.void },
        }).settle(command)
      );
      return Response.json(
        Schema.encodeSync(ProviderTerminalSettlementResponse)(result)
      );
    } catch (error) {
      return Response.json(
        { error: JSON.stringify(error), rejected: true },
        { status: 409 }
      );
    }
  },
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
