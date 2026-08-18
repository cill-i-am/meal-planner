import type {
  CanonicalTikTokUrl,
  CreateRecipeImportIntentRequest,
  IdempotencyKey,
  RecipeImportIntent,
  RecipeImportIntentId,
} from "@meal-planner/recipe-import-api";
import { Effect } from "effect";

import { ImportIntentIdGenerator } from "./import-intent.js";
import type {
  ImportPrincipal,
  makeImportIntentApplication,
} from "./import-intent.js";
import type { SourceCanonicalId } from "./import.contracts.js";
import type { WorkflowStartUnavailable } from "./import.errors.js";
import type { ImportIntentRepositoryError } from "./import.repository.js";

/** Canonical source identity resolved before a durable batch item is consumed. */
export interface ResolvedRecipeImportIntentSource {
  readonly canonicalSourceId: SourceCanonicalId;
  readonly canonicalUrl: CanonicalTikTokUrl;
  readonly sourceKind: "carousel" | "video";
}

/** Complete command needed to admit and resolve one canonical recipe-import intent. */
export interface AdmitResolvedRecipeImportIntentCommand {
  readonly idempotencyKey: IdempotencyKey;
  readonly request: CreateRecipeImportIntentRequest;
  readonly source: ResolvedRecipeImportIntentSource;
}

export interface AdmitResolvedRecipeImportIntentResult {
  readonly disposition: "created" | "idempotency_replay";
  readonly intent: RecipeImportIntent;
}

export type AdmitResolvedRecipeImportIntentError =
  | ImportIntentRepositoryError
  | WorkflowStartUnavailable;

/** Canonical application seam shared by queue consumption and dead-letter replay. */
export interface RecipeImportIntentAdmission {
  readonly admitResolved: (
    command: AdmitResolvedRecipeImportIntentCommand
  ) => Effect.Effect<
    AdmitResolvedRecipeImportIntentResult,
    AdmitResolvedRecipeImportIntentError
  >;
}

/** Bind household ownership and ID generation once at the queue boundary. */
export const makeRecipeImportIntentAdmission = (input: {
  readonly application: Pick<
    ReturnType<typeof makeImportIntentApplication>,
    "admit" | "resolveSource"
  >;
  readonly newIntentId: () => RecipeImportIntentId;
  readonly principal: ImportPrincipal;
}): RecipeImportIntentAdmission => ({
  admitResolved: Effect.fn("RecipeImportIntentAdmission.admitResolved")(
    function* admitResolved(command) {
      const admitted = yield* input.application
        .admit(input.principal, command.request, command.idempotencyKey)
        .pipe(
          Effect.provideService(
            ImportIntentIdGenerator,
            ImportIntentIdGenerator.of({
              next: Effect.sync(input.newIntentId),
            })
          )
        );
      const intent = yield* input.application.resolveSource(input.principal, {
        canonicalSourceId: command.source.canonicalSourceId,
        canonicalUrl: command.source.canonicalUrl,
        intentId: admitted.intent.id,
        sourceKind: command.source.sourceKind,
      });
      return { disposition: admitted.disposition, intent };
    }
  ),
});
