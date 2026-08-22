import { RecipeImportIntentId } from "@meal-planner/recipe-import-api";
import type { AnyD1Database } from "drizzle-orm/d1";
import { Effect, Schema } from "effect";

import type { HouseholdDomainWorkerMethods } from "../households/household-domain-worker.js";
import { HouseholdRecipeImportExecutionView } from "../households/recipe-import/household-recipe-import.contract.js";
import type { HouseholdImportMutationId } from "../households/recipe-import/household-recipe-import.contract.js";
import { makeD1ImportEvidenceRouteRepository } from "./import-evidence-route.repository.d1.js";
import type { HouseholdEvidenceDomain } from "./import-evidence.repository.household.js";
import {
  makeHouseholdImportEvidenceViewRepository,
  makeHouseholdRecipeDraftRepository,
} from "./import-evidence.repository.household.js";
import type { RecipeRecoveryWorkflowInput } from "./import-recipe-recovery.js";
import { SourceCanonicalId } from "./import.contracts.js";
import {
  importPersistenceUnavailable,
  importTransitionRejected,
} from "./import.errors.js";

export type RecipeRecoveryHouseholdAuthority = HouseholdEvidenceDomain &
  Pick<HouseholdDomainWorkerMethods, "readRecipeImportExecution">;

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
