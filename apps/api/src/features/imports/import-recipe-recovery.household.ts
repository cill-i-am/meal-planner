import { RecipeImportIntentId } from "@meal-planner/recipe-import-api";
import type { AnyD1Database } from "drizzle-orm/d1";
import { Effect, Schema } from "effect";

import {
  HouseholdMutateEvidenceStageInput,
  HouseholdMutateEvidenceStageResult,
  HouseholdPrepareRecipeRecoveryInput,
  HouseholdPrepareRecipeRecoveryResult,
  HouseholdReadEvidenceStageResult,
  HouseholdReadImportTerminalCheckpointResult,
  HouseholdReadRecipeRecoveryAttemptResult,
  HouseholdRecipeRecoveryAttempt,
} from "../households/evidence/household-evidence.contract.js";
import type {
  HouseholdDomainWorkerMethods,
  HouseholdRecipeImportDomainFailure,
} from "../households/household-domain-worker.js";
import {
  HouseholdImportMutationId,
  HouseholdRecipeImportExecutionView,
} from "../households/recipe-import/household-recipe-import.contract.js";
import { makeD1ImportEvidenceRouteRepository } from "./import-evidence-route.repository.d1.js";
import type { HouseholdEvidenceDomain } from "./import-evidence.repository.household.js";
import {
  makeHouseholdImportEvidenceViewRepository,
  makeHouseholdRecipeDraftRepository,
} from "./import-evidence.repository.household.js";
import type {
  RecipeRecoveryAttempt,
  RecipeRecoveryWorkflowInput,
} from "./import-recipe-recovery.js";
import { RecipeRecoveryAttempt as RecipeRecoveryAttemptSchema } from "./import-recipe-recovery.js";
import { SourceCanonicalId } from "./import.contracts.js";
import {
  importPersistenceUnavailable,
  importTransitionRejected,
} from "./import.errors.js";

const PersistenceUnavailableFailure = Schema.Struct({
  reason: Schema.Literal("persistence_unavailable"),
});

export type RecipeRecoveryHouseholdAuthority = HouseholdEvidenceDomain &
  Pick<
    HouseholdDomainWorkerMethods,
    | "prepareRecipeRecovery"
    | "readImportTerminalCheckpoint"
    | "readRecipeImportExecution"
    | "readRecipeRecoveryAttempt"
  >;

export type RecipeRecoveryPreparationHouseholdAuthority = Pick<
  RecipeRecoveryHouseholdAuthority,
  | "prepareRecipeRecovery"
  | "mutateEvidenceStage"
  | "readEvidenceStage"
  | "readImportTerminalCheckpoint"
  | "readRecipeImportExecution"
  | "readRecipeRecoveryAttempt"
>;

export interface HouseholdProviderRecovery {
  readonly acquisitionGeneration: RecipeRecoveryWorkflowInput["acquisitionGeneration"];
  readonly importId: RecipeRecoveryWorkflowInput["importId"];
  readonly originalDispatchId: string;
  readonly recoveryDispatchId: string;
  readonly requiresWorkflowActivation: boolean;
}

export const recipeRecoveryHouseholdMutationId = (semanticKey: string) =>
  Effect.promise(() =>
    crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(
        `household-recipe-import-recovery:v1:${semanticKey}`
      )
    )
  ).pipe(
    Effect.map((digest) =>
      Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0")
      ).join("")
    ),
    Effect.map(Schema.decodeUnknownSync(HouseholdImportMutationId))
  );

const mapHouseholdFailure = (error: HouseholdRecipeImportDomainFailure) =>
  Schema.is(PersistenceUnavailableFailure)(error)
    ? importPersistenceUnavailable()
    : importTransitionRejected();

export const resolveHouseholdRecoveryAuthority = (input: {
  readonly database: AnyD1Database;
  readonly generation: RecipeRecoveryWorkflowInput["acquisitionGeneration"];
  readonly householdDomain: Pick<
    RecipeRecoveryHouseholdAuthority,
    "readRecipeImportExecution"
  >;
  readonly importId: RecipeRecoveryWorkflowInput["importId"];
}) =>
  Effect.gen(function* resolveHouseholdRecipeRecoveryAuthority() {
    const route = yield* makeD1ImportEvidenceRouteRepository(input.database)
      .get(input.importId)
      .pipe(Effect.mapError(() => importPersistenceUnavailable()));
    if (route === null) {
      return yield* Effect.fail(importTransitionRejected());
    }
    const intentId = yield* Schema.decodeUnknownEffect(RecipeImportIntentId)(
      input.importId
    ).pipe(Effect.mapError(() => importTransitionRejected()));
    const admission = {
      actor: {
        _tag: "System" as const,
        purpose: "recipe_import_lifecycle_commit" as const,
      },
      organizationId: route.organizationId,
    };
    const execution = yield* input.householdDomain
      .readRecipeImportExecution({
        admission,
        expectedGeneration: input.generation,
        intentId,
      })
      .pipe(
        Effect.mapError(mapHouseholdFailure),
        Effect.flatMap((rawExecution) =>
          Schema.decodeUnknownEffect(HouseholdRecipeImportExecutionView, {
            onExcessProperty: "error",
          })(rawExecution).pipe(
            Effect.mapError(() => importTransitionRejected())
          )
        )
      );
    if (execution.sourceKind !== "video") {
      return yield* Effect.fail(importTransitionRejected());
    }
    const canonicalSourceId = yield* Schema.decodeUnknownEffect(
      SourceCanonicalId
    )(execution.canonicalSourceId).pipe(
      Effect.mapError(() => importTransitionRejected())
    );
    return { admission, canonicalSourceId, intentId, route } as const;
  });

const decodeWorkflowAttempt = (attempt: HouseholdRecipeRecoveryAttempt) =>
  Schema.encodeEffect(HouseholdRecipeRecoveryAttempt)(attempt).pipe(
    Effect.flatMap(
      Schema.decodeUnknownEffect(RecipeRecoveryAttemptSchema, {
        onExcessProperty: "error",
      })
    ),
    Effect.mapError(() => importTransitionRejected())
  );

export const prepareHouseholdRecipeRecovery = (input: {
  readonly database: AnyD1Database;
  readonly generation: RecipeRecoveryWorkflowInput["acquisitionGeneration"];
  readonly householdDomain: RecipeRecoveryPreparationHouseholdAuthority;
  readonly importId: RecipeRecoveryWorkflowInput["importId"];
  readonly predecessorDispatchId: RecipeRecoveryAttempt["predecessorDispatchId"];
  readonly settlement: {
    readonly completedAt: RecipeRecoveryAttempt["createdAt"];
    readonly dispatchId: RecipeRecoveryAttempt["predecessorDispatchId"];
    readonly outcome: "settled_unknown";
  };
}) =>
  Effect.gen(function* prepareHouseholdRecipeRecoveryAttempt() {
    const authority = yield* resolveHouseholdRecoveryAuthority({
      database: input.database,
      generation: input.generation,
      householdDomain: input.householdDomain,
      importId: input.importId,
    });
    const mutationId = yield* recipeRecoveryHouseholdMutationId(
      `prepare:${input.importId}:${input.generation}:${input.predecessorDispatchId}`
    );
    const command = yield* Schema.encodeEffect(
      HouseholdPrepareRecipeRecoveryInput
    )({
      admission: authority.admission,
      expectedGeneration: input.generation,
      intentId: authority.intentId,
      mutationId,
      predecessorDispatchId: input.predecessorDispatchId,
      settlement: input.settlement,
    }).pipe(Effect.mapError(() => importTransitionRejected()));
    const receipt = yield* input.householdDomain
      .prepareRecipeRecovery(command)
      .pipe(
        Effect.mapError(mapHouseholdFailure),
        Effect.flatMap((rawReceipt) =>
          Schema.decodeUnknownEffect(HouseholdPrepareRecipeRecoveryResult, {
            onExcessProperty: "error",
          })(rawReceipt).pipe(Effect.mapError(() => importTransitionRejected()))
        )
      );
    return yield* decodeWorkflowAttempt(receipt.attempt);
  });

export const readHouseholdRecipeRecovery = (input: {
  readonly database: AnyD1Database;
  readonly generation: RecipeRecoveryWorkflowInput["acquisitionGeneration"];
  readonly householdDomain: RecipeRecoveryPreparationHouseholdAuthority;
  readonly importId: RecipeRecoveryWorkflowInput["importId"];
  readonly selector:
    | {
        readonly _tag: "Ordinal";
        readonly ordinal: RecipeRecoveryAttempt["ordinal"];
      }
    | {
        readonly _tag: "Latest";
        readonly rootDispatchId: RecipeRecoveryAttempt["rootDispatchId"];
      };
}) =>
  Effect.gen(function* readHouseholdRecipeRecoveryAttempt() {
    const authority = yield* resolveHouseholdRecoveryAuthority({
      database: input.database,
      generation: input.generation,
      householdDomain: input.householdDomain,
      importId: input.importId,
    });
    const result = yield* input.householdDomain
      .readRecipeRecoveryAttempt({
        admission: authority.admission,
        expectedGeneration: input.generation,
        intentId: authority.intentId,
        selector: input.selector,
      })
      .pipe(
        Effect.mapError(mapHouseholdFailure),
        Effect.flatMap((rawResult) =>
          Schema.decodeUnknownEffect(HouseholdReadRecipeRecoveryAttemptResult, {
            onExcessProperty: "error",
          })(rawResult).pipe(Effect.mapError(() => importTransitionRejected()))
        )
      );
    if (result === null) {
      return yield* Effect.fail(importTransitionRejected());
    }
    return yield* decodeWorkflowAttempt(result);
  });

export const readHouseholdTerminalAuthority = (input: {
  readonly database: AnyD1Database;
  readonly generation: RecipeRecoveryWorkflowInput["acquisitionGeneration"];
  readonly householdDomain: RecipeRecoveryPreparationHouseholdAuthority;
  readonly importId: RecipeRecoveryWorkflowInput["importId"];
  readonly providerDispatchId: string;
  readonly stage: "extraction" | "speech" | "visual";
}) =>
  Effect.gen(function* readHouseholdTerminalStageAuthority() {
    const authority = yield* resolveHouseholdRecoveryAuthority({
      database: input.database,
      generation: input.generation,
      householdDomain: input.householdDomain,
      importId: input.importId,
    });
    const stage = yield* input.householdDomain
      .readEvidenceStage({
        admission: authority.admission,
        expectedGeneration: input.generation,
        intentId: authority.intentId,
        stage: input.stage,
      })
      .pipe(
        Effect.mapError(mapHouseholdFailure),
        Effect.flatMap((rawStage) =>
          Schema.decodeUnknownEffect(HouseholdReadEvidenceStageResult, {
            onExcessProperty: "error",
          })(rawStage).pipe(Effect.mapError(() => importTransitionRejected()))
        )
      );
    if (
      stage === null ||
      stage.outcome !== "Failed" ||
      stage.failureCode === null
    ) {
      return yield* Effect.fail(importTransitionRejected());
    }
    let expectedProviderDispatchId: string | null = stage.dispatchId;
    if (input.stage === "extraction") {
      expectedProviderDispatchId =
        stage.extractionContext === null
          ? null
          : `recipe:${input.importId}:${input.generation}:${stage.extractionContext.evidenceFingerprint}`;
      const recoveryMatch = /^(?<root>.*):recovery:(?<ordinal>\d+)$/u.exec(
        input.providerDispatchId
      );
      if (recoveryMatch !== null) {
        const recovery = yield* input.householdDomain
          .readRecipeRecoveryAttempt({
            admission: authority.admission,
            expectedGeneration: input.generation,
            intentId: authority.intentId,
            selector: {
              _tag: "Latest",
              rootDispatchId: recoveryMatch.groups?.["root"] as string,
            },
          })
          .pipe(
            Effect.mapError(mapHouseholdFailure),
            Effect.flatMap((rawRecovery) =>
              Schema.decodeUnknownEffect(
                HouseholdReadRecipeRecoveryAttemptResult,
                { onExcessProperty: "error" }
              )(rawRecovery).pipe(
                Effect.mapError(() => importTransitionRejected())
              )
            )
          );
        if (
          recovery === null ||
          recovery.currentExtractionFingerprint !== stage.inputFingerprint
        ) {
          return yield* Effect.fail(importTransitionRejected());
        }
        expectedProviderDispatchId = recovery.currentDispatchId;
      }
    }
    if (expectedProviderDispatchId !== input.providerDispatchId) {
      return yield* Effect.fail(importTransitionRejected());
    }
    const checkpoint = yield* input.householdDomain
      .readImportTerminalCheckpoint({
        admission: authority.admission,
        expectedGeneration: input.generation,
        intentId: authority.intentId,
        ownershipId: stage.dispatchId,
        stage: input.stage,
      })
      .pipe(
        Effect.mapError(mapHouseholdFailure),
        Effect.flatMap((rawCheckpoint) =>
          Schema.decodeUnknownEffect(
            HouseholdReadImportTerminalCheckpointResult,
            { onExcessProperty: "error" }
          )(rawCheckpoint).pipe(
            Effect.mapError(() => importTransitionRejected())
          )
        )
      );
    if (
      checkpoint === null ||
      checkpoint.failureCode !== stage.failureCode ||
      checkpoint.inputFingerprint !== stage.inputFingerprint ||
      checkpoint.ownershipId !== stage.dispatchId
    ) {
      return yield* Effect.fail(importTransitionRejected());
    }
    return { authority, checkpoint, stage } as const;
  });

const nextRecoveryDispatchId = (dispatchId: string) => {
  const match = /^(?<root>.*):recovery:(?<ordinal>\d+)$/u.exec(dispatchId);
  const rootDispatchId = match?.groups?.["root"] ?? dispatchId;
  const ordinal = match === null ? 1 : Number(match.groups?.["ordinal"]) + 1;
  return ordinal <= 8 ? `${rootDispatchId}:recovery:${ordinal}` : null;
};

export const prepareHouseholdProviderRecovery = (input: {
  readonly database: AnyD1Database;
  readonly generation: RecipeRecoveryWorkflowInput["acquisitionGeneration"];
  readonly householdDomain: RecipeRecoveryPreparationHouseholdAuthority;
  readonly importId: RecipeRecoveryWorkflowInput["importId"];
  readonly originalDispatchId: string;
  readonly settlement: {
    readonly completedAt: RecipeRecoveryAttempt["createdAt"];
    readonly dispatchId: string;
    readonly outcome: "settled_unknown";
  };
  readonly stage: "speech" | "visual";
}) =>
  Effect.gen(function* prepareHouseholdEvidenceStageRecovery() {
    const recoveryDispatchId = nextRecoveryDispatchId(input.originalDispatchId);
    if (
      recoveryDispatchId === null ||
      input.settlement.dispatchId !== input.originalDispatchId
    ) {
      return yield* Effect.fail(importTransitionRejected());
    }
    const authority = yield* resolveHouseholdRecoveryAuthority({
      database: input.database,
      generation: input.generation,
      householdDomain: input.householdDomain,
      importId: input.importId,
    });
    const checkpoint = yield* input.householdDomain
      .readImportTerminalCheckpoint({
        admission: authority.admission,
        expectedGeneration: input.generation,
        intentId: authority.intentId,
        ownershipId: input.originalDispatchId,
        stage: input.stage,
      })
      .pipe(
        Effect.mapError(mapHouseholdFailure),
        Effect.flatMap((rawCheckpoint) =>
          Schema.decodeUnknownEffect(
            HouseholdReadImportTerminalCheckpointResult,
            { onExcessProperty: "error" }
          )(rawCheckpoint).pipe(
            Effect.mapError(() => importTransitionRejected())
          )
        )
      );
    if (
      checkpoint === null ||
      checkpoint.failureCode !== "outcome_unknown" ||
      checkpoint.ownershipId !== input.originalDispatchId
    ) {
      return yield* Effect.fail(importTransitionRejected());
    }
    const mutationId = yield* recipeRecoveryHouseholdMutationId(
      `prepare:${input.stage}:${input.importId}:${input.generation}:${input.originalDispatchId}`
    );
    const command = yield* Schema.encodeEffect(
      HouseholdMutateEvidenceStageInput
    )({
      admission: authority.admission,
      expectedGeneration: input.generation,
      inputFingerprint: checkpoint.inputFingerprint,
      intentId: authority.intentId,
      mutationId,
      operation: {
        _tag: "PrepareRecovery",
        dispatchId: recoveryDispatchId,
        predecessorDispatchId: input.originalDispatchId,
        predecessorInputFingerprint: checkpoint.inputFingerprint,
        settlement: input.settlement,
        stage: input.stage,
        startedAt: input.settlement.completedAt,
      },
    }).pipe(Effect.mapError(() => importTransitionRejected()));
    yield* input.householdDomain.mutateEvidenceStage(command).pipe(
      Effect.mapError(mapHouseholdFailure),
      Effect.flatMap((rawReceipt) =>
        Schema.decodeUnknownEffect(HouseholdMutateEvidenceStageResult, {
          onExcessProperty: "error",
        })(rawReceipt).pipe(Effect.mapError(() => importTransitionRejected()))
      )
    );
    const currentStage = yield* input.householdDomain
      .readEvidenceStage({
        admission: authority.admission,
        expectedGeneration: input.generation,
        intentId: authority.intentId,
        stage: input.stage,
      })
      .pipe(
        Effect.mapError(mapHouseholdFailure),
        Effect.flatMap((rawStage) =>
          Schema.decodeUnknownEffect(HouseholdReadEvidenceStageResult, {
            onExcessProperty: "error",
          })(rawStage).pipe(Effect.mapError(() => importTransitionRejected()))
        )
      );
    if (
      currentStage === null ||
      currentStage.dispatchId !== recoveryDispatchId ||
      currentStage.inputFingerprint !== checkpoint.inputFingerprint
    ) {
      return yield* Effect.fail(importTransitionRejected());
    }
    return {
      acquisitionGeneration: input.generation,
      importId: input.importId,
      originalDispatchId: input.originalDispatchId,
      recoveryDispatchId,
      requiresWorkflowActivation: currentStage.outcome === "Dispatching",
    } satisfies HouseholdProviderRecovery;
  });

export const readHouseholdProviderDispatchId = (input: {
  readonly database: AnyD1Database;
  readonly generation: RecipeRecoveryWorkflowInput["acquisitionGeneration"];
  readonly householdDomain: Pick<
    RecipeRecoveryHouseholdAuthority,
    "readEvidenceStage" | "readRecipeImportExecution"
  >;
  readonly importId: RecipeRecoveryWorkflowInput["importId"];
  readonly stage: "speech" | "visual";
}) =>
  Effect.gen(function* readHouseholdEvidenceStageDispatchId() {
    const authority = yield* resolveHouseholdRecoveryAuthority({
      database: input.database,
      generation: input.generation,
      householdDomain: input.householdDomain,
      importId: input.importId,
    });
    const stage = yield* input.householdDomain
      .readEvidenceStage({
        admission: authority.admission,
        expectedGeneration: input.generation,
        intentId: authority.intentId,
        stage: input.stage,
      })
      .pipe(
        Effect.mapError(mapHouseholdFailure),
        Effect.flatMap((rawStage) =>
          Schema.decodeUnknownEffect(HouseholdReadEvidenceStageResult, {
            onExcessProperty: "error",
          })(rawStage).pipe(Effect.mapError(() => importTransitionRejected()))
        )
      );
    return (
      stage?.dispatchId ??
      `${input.stage}:${input.importId}:${input.generation}`
    );
  });

export const makeRecipeRecoveryHouseholdEvidenceRepositories = (input: {
  readonly correlationId: RecipeRecoveryWorkflowInput["trace"]["correlationId"];
  readonly database: AnyD1Database;
  readonly generation: RecipeRecoveryWorkflowInput["acquisitionGeneration"];
  readonly householdDomain: RecipeRecoveryHouseholdAuthority;
  readonly importId: RecipeRecoveryWorkflowInput["importId"];
  readonly mutationId: (
    seed: string
  ) => Effect.Effect<HouseholdImportMutationId>;
}) =>
  Effect.gen(function* resolveRecipeRecoveryHouseholdAuthority() {
    const { canonicalSourceId, intentId, route } =
      yield* resolveHouseholdRecoveryAuthority(input);
    const repositoryInput = {
      canonicalSourceId,
      correlationId: input.correlationId,
      generation: input.generation,
      householdDomain: input.householdDomain,
      intentId,
      mutationId: input.mutationId,
      organizationId: route.organizationId,
    };
    return {
      current: makeHouseholdImportEvidenceViewRepository(repositoryInput),
      recipe: makeHouseholdRecipeDraftRepository(repositoryInput),
    } as const;
  });
