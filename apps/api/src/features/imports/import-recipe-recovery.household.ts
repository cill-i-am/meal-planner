import { RecipeImportIntentId } from "@meal-planner/recipe-import-api";
import type { AnyD1Database } from "drizzle-orm/d1";
import { Effect, Schema } from "effect";

import { HouseholdMutateEvidenceStageResult } from "../households/evidence/household-evidence.contract.js";
import type { HouseholdDomainWorkerMethods } from "../households/household-domain-worker.js";
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
import { SourceCanonicalId } from "./import.contracts.js";
import {
  importPersistenceUnavailable,
  importTransitionRejected,
} from "./import.errors.js";

export type RecipeRecoveryHouseholdAuthority = HouseholdEvidenceDomain &
  Pick<HouseholdDomainWorkerMethods, "readRecipeImportExecution">;

export type RecipeRecoveryPreparationHouseholdAuthority = Pick<
  RecipeRecoveryHouseholdAuthority,
  "mutateEvidenceStage" | "readRecipeImportExecution"
>;

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

const resolveHouseholdRecoveryAuthority = (input: {
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
        Effect.flatMap(
          Schema.decodeUnknownEffect(HouseholdRecipeImportExecutionView, {
            onExcessProperty: "error",
          })
        ),
        Effect.mapError(() => importTransitionRejected())
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

export const prepareRecipeRecoveryHouseholdExtraction = (input: {
  readonly attempt: RecipeRecoveryAttempt;
  readonly database: AnyD1Database;
  readonly householdDomain: RecipeRecoveryPreparationHouseholdAuthority;
}) =>
  Effect.gen(function* prepareHouseholdRecipeRecoveryExtraction() {
    const authority = yield* resolveHouseholdRecoveryAuthority({
      database: input.database,
      generation: input.attempt.acquisitionGeneration,
      householdDomain: input.householdDomain,
      importId: input.attempt.importId,
    });
    const mutationId = yield* recipeRecoveryHouseholdMutationId(
      `prepare:${input.attempt.importId}:${input.attempt.acquisitionGeneration}:${input.attempt.predecessorExtractionFingerprint}:${input.attempt.currentExtractionFingerprint}`
    );
    const receipt = yield* input.householdDomain
      .mutateEvidenceStage({
        admission: authority.admission,
        expectedGeneration: input.attempt.acquisitionGeneration,
        inputFingerprint: input.attempt.currentExtractionFingerprint,
        intentId: authority.intentId,
        mutationId,
        operation: {
          _tag: "PrepareRecovery",
          dispatchId: input.attempt.currentExtractionFingerprint,
          predecessorDispatchId: input.attempt.predecessorExtractionFingerprint,
          predecessorInputFingerprint:
            input.attempt.predecessorExtractionFingerprint,
          stage: "extraction",
          startedAt: input.attempt.createdAt,
        },
      })
      .pipe(
        Effect.flatMap(
          Schema.decodeUnknownEffect(HouseholdMutateEvidenceStageResult, {
            onExcessProperty: "error",
          })
        ),
        Effect.mapError(() => importTransitionRejected())
      );
    if (receipt.outcome !== "RecoveryPrepared") {
      return yield* Effect.fail(importTransitionRejected());
    }
    return receipt;
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
