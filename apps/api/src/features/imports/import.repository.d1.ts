import { Instant, RecipeImportIntent } from "@meal-planner/recipe-import-api";
import type {
  RecipeImportIntent as RecipeImportIntentType,
  RecipeImportIntentId,
} from "@meal-planner/recipe-import-api";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { AnyD1Database } from "drizzle-orm/d1";
import { DateTime, Effect, Option, Schema } from "effect";

import {
  InitialRecipeImportIntentVersion,
  LegacyPrivateImportActorId,
  LegacyPrivateHouseholdScopeId,
  RecipeImportIntentIdempotencyConflict,
  RecipeImportIntentNotFound,
  RecipeImportIntentRedirected,
  RecipeImportIntentTransitionRejected,
} from "./import-intent.js";
import type { ImportPrincipal } from "./import-intent.js";
import type {
  AcquisitionGeneration,
  ClassifiedAcquisitionFailure,
  VerifiedAcquisitionEvidence,
} from "./import-media.model.js";
import {
  AcquisitionGeneration as AcquisitionGenerationSchema,
  EvidenceRetentionSeconds,
  manifestObjectKey,
  mediaObjectKey,
} from "./import-media.model.js";
import { ImportCorrelationId } from "./import-observability.js";
import { RecipeDraft } from "./import-recipe-draft.repository.d1.js";
import { deriveLegacyImportCorrelationId } from "./import-workflow-input.js";
import {
  EvidenceReference,
  ImportView,
  SourceCanonicalId,
} from "./import.contracts.js";
import type {
  ImportDisposition,
  ImportId,
  ImportStatus,
  ImportTimestamp,
} from "./import.contracts.js";
import {
  importCarouselEvidence,
  importRecipeTerminalProjections,
  importRequests,
  importRecipeExtractions,
  importVisualEvidence,
  recipeImports,
} from "./import.database-schema.js";
import {
  idempotencyConflict,
  importPersistenceCorrupt,
  importPersistenceUnavailable,
  incompatibleDuplicate,
  importNotFound,
  importTransitionRejected,
} from "./import.errors.js";
import type {
  AcceptImportCommand,
  ClaimAcquisitionResult,
  ImportIntentRepositoryShape,
  ImportRepositoryShape,
  ImportTransitionError,
  StoredImport,
  StoredImportRequest,
} from "./import.repository.js";
import {
  CompatibilityFingerprint,
  RequestFingerprint,
  SourceLocatorHash,
} from "./import.repository.js";

const NullableString = Schema.NullOr(Schema.String);
const encodeInstant = Schema.encodeSync(Instant);
interface D1MutationResult {
  readonly meta: { readonly changes: number };
}

const DatabaseImportRow = Schema.Struct({
  acquisitionGeneration: AcquisitionGenerationSchema,
  canonicalSourceId: Schema.String,
  carouselManifestKey: NullableString,
  carouselUpdatedAt: NullableString,
  compatibilityFingerprint: CompatibilityFingerprint,
  correlationId: NullableString,
  createdAt: Schema.String,
  evidenceReferencesJson: Schema.String,
  id: Schema.String,
  recipeDraftFingerprint: NullableString,
  recipeDraftJson: NullableString,
  recipeDraftState: NullableString,
  recipeDraftUpdatedAt: NullableString,
  recoveryAction: NullableString,
  sourceKind: Schema.Literal("tiktok"),
  status: Schema.Literals([
    "acquired",
    "acquiring",
    "failed",
    "queued",
    "transcribed",
    "transcribing",
    "unsupported",
  ]),
  statusCode: NullableString,
  updatedAt: Schema.String,
  visualFailureCode: NullableString,
  visualManifestKey: NullableString,
  visualOutcome: NullableString,
  visualState: NullableString,
  visualUpdatedAt: NullableString,
});

const DatabaseRequestFingerprints = Schema.Struct({
  requestFingerprint: RequestFingerprint,
  sourceLocatorHash: SourceLocatorHash,
});

const importSelection = {
  acquisitionGeneration: recipeImports.acquisitionGeneration,
  canonicalSourceId: recipeImports.canonicalSourceId,
  carouselManifestKey: sql<string | null>`(
    SELECT ${importCarouselEvidence.manifestKey}
      FROM ${importCarouselEvidence}
     WHERE ${importCarouselEvidence.importId} = ${recipeImports.id}
       AND ${importCarouselEvidence.acquisitionGeneration} = ${recipeImports.acquisitionGeneration}
       AND ${importCarouselEvidence.state} = 'completed'
  )`.as("carousel_manifest_key"),
  carouselUpdatedAt: sql<string | null>`(
    SELECT ${importCarouselEvidence.updatedAt}
      FROM ${importCarouselEvidence}
     WHERE ${importCarouselEvidence.importId} = ${recipeImports.id}
       AND ${importCarouselEvidence.acquisitionGeneration} = ${recipeImports.acquisitionGeneration}
       AND ${importCarouselEvidence.state} = 'completed'
  )`.as("carousel_updated_at"),
  compatibilityFingerprint: recipeImports.compatibilityFingerprint,
  correlationId: recipeImports.correlationId,
  createdAt: recipeImports.createdAt,
  evidenceReferencesJson: sql<string>`COALESCE(
    (
      SELECT ${importRecipeTerminalProjections.evidenceReferencesJson}
        FROM ${importRecipeTerminalProjections}
       WHERE ${importRecipeTerminalProjections.importId} = ${recipeImports.id}
         AND ${importRecipeTerminalProjections.acquisitionGeneration} = ${recipeImports.acquisitionGeneration}
    ),
    ${recipeImports.evidenceReferencesJson}
  )`.as("evidence_references_json"),
  id: recipeImports.id,
  recipeDraftFingerprint: sql<
    string | null
  >`${importRecipeExtractions.extractionFingerprint}`.as(
    "recipe_draft_fingerprint"
  ),
  recipeDraftJson: sql<string | null>`${importRecipeExtractions.draftJson}`.as(
    "recipe_draft_json"
  ),
  recipeDraftState: sql<string | null>`${importRecipeExtractions.state}`.as(
    "recipe_draft_state"
  ),
  recipeDraftUpdatedAt: sql<
    string | null
  >`${importRecipeExtractions.updatedAt}`.as("recipe_draft_updated_at"),
  recoveryAction: sql<string | null>`COALESCE(
    (
      SELECT ${importRecipeTerminalProjections.recoveryAction}
        FROM ${importRecipeTerminalProjections}
       WHERE ${importRecipeTerminalProjections.importId} = ${recipeImports.id}
         AND ${importRecipeTerminalProjections.acquisitionGeneration} = ${recipeImports.acquisitionGeneration}
    ),
    ${recipeImports.recoveryAction}
  )`.as("recovery_action"),
  sourceKind: recipeImports.sourceKind,
  status: sql<string>`COALESCE(
    (
      SELECT ${importRecipeTerminalProjections.status}
        FROM ${importRecipeTerminalProjections}
       WHERE ${importRecipeTerminalProjections.importId} = ${recipeImports.id}
         AND ${importRecipeTerminalProjections.acquisitionGeneration} = ${recipeImports.acquisitionGeneration}
    ),
    ${recipeImports.status}
  )`.as("status"),
  statusCode: sql<string | null>`COALESCE(
    (
      SELECT ${importRecipeTerminalProjections.statusCode}
        FROM ${importRecipeTerminalProjections}
       WHERE ${importRecipeTerminalProjections.importId} = ${recipeImports.id}
         AND ${importRecipeTerminalProjections.acquisitionGeneration} = ${recipeImports.acquisitionGeneration}
    ),
    ${recipeImports.statusCode}
  )`.as("status_code"),
  updatedAt: sql<string>`COALESCE(
    (
      SELECT ${importRecipeTerminalProjections.projectedAt}
        FROM ${importRecipeTerminalProjections}
       WHERE ${importRecipeTerminalProjections.importId} = ${recipeImports.id}
         AND ${importRecipeTerminalProjections.acquisitionGeneration} = ${recipeImports.acquisitionGeneration}
    ),
    ${recipeImports.updatedAt}
  )`.as("updated_at"),
  visualFailureCode: importVisualEvidence.failureCode,
  visualManifestKey: importVisualEvidence.manifestKey,
  visualOutcome: importVisualEvidence.outcome,
  visualState: importVisualEvidence.state,
  visualUpdatedAt: sql<string | null>`${importVisualEvidence.updatedAt}`.as(
    "visual_updated_at"
  ),
} as const;

const decodeUnclassifiedStatus = (
  row: typeof DatabaseImportRow.Type
): ImportStatus | null => {
  if (row.statusCode !== null || row.recoveryAction !== null) {
    return null;
  }
  switch (row.status) {
    case "acquired":
    case "acquiring":
    case "queued":
    case "transcribed":
    case "transcribing": {
      return { kind: row.status };
    }
    default: {
      return null;
    }
  }
};

const decodeStatus = (row: typeof DatabaseImportRow.Type): ImportStatus => {
  const unclassified = decodeUnclassifiedStatus(row);
  if (unclassified !== null) {
    return unclassified;
  }
  if (
    row.status === "failed" &&
    row.statusCode === "recipe_extraction_failed" &&
    row.recoveryAction === "operator_reconcile"
  ) {
    return {
      code: "recipe_extraction_failed",
      kind: "failed",
      recovery: "operator_reconcile",
    };
  }
  if (
    row.status === "failed" &&
    row.statusCode === "transcription_failed" &&
    row.recoveryAction === "retry_later"
  ) {
    return {
      code: "transcription_failed",
      kind: "failed",
      recovery: "retry_later",
    };
  }
  if (
    row.status === "failed" &&
    row.statusCode === "private_or_unavailable" &&
    row.recoveryAction === "check_source_visibility"
  ) {
    return {
      code: "private_or_unavailable",
      kind: "failed",
      recovery: "check_source_visibility",
    };
  }
  if (
    row.status === "failed" &&
    row.statusCode === "acquisition_temporarily_unavailable" &&
    row.recoveryAction === "retry_later"
  ) {
    return {
      code: "acquisition_temporarily_unavailable",
      kind: "failed",
      recovery: "retry_later",
    };
  }
  if (
    row.status === "failed" &&
    row.statusCode === "invalid_or_unsupported_media" &&
    row.recoveryAction === "submit_supported_public_video"
  ) {
    return {
      code: "invalid_or_unsupported_media",
      kind: "failed",
      recovery: "submit_supported_public_video",
    };
  }
  if (
    row.status === "unsupported" &&
    row.statusCode === "unsupported_post_type" &&
    row.recoveryAction === "submit_supported_public_video"
  ) {
    return {
      code: "unsupported_post_type",
      kind: "unsupported",
      recovery: "submit_supported_public_video",
    };
  }
  throw new Error("Invalid persisted import state");
};

type DatabaseImportRow = typeof DatabaseImportRow.Type;

const hasNoVisualPayload = (row: DatabaseImportRow) =>
  row.visualOutcome === null &&
  row.visualManifestKey === null &&
  row.visualFailureCode === null;

const completedVisualStatus = (outcome: string | null) => {
  switch (outcome) {
    case "empty": {
      return { kind: "visual_evidence_empty" } as const;
    }
    case "found": {
      return { kind: "visual_evidence_found" } as const;
    }
    case "low_confidence": {
      return { kind: "visual_evidence_low_confidence" } as const;
    }
    default: {
      return null;
    }
  }
};

// eslint-disable-next-line complexity -- Projection decoding rejects every invalid persisted state combination.
const decodeVisualProjection = (
  row: DatabaseImportRow,
  evidence: readonly EvidenceReference[]
) => {
  if (
    row.visualState === null &&
    row.visualUpdatedAt === null &&
    hasNoVisualPayload(row)
  ) {
    return { evidence, status: decodeStatus(row), updatedAt: row.updatedAt };
  }
  if (
    (row.status !== "transcribed" &&
      !(
        row.status === "failed" &&
        row.statusCode === "recipe_extraction_failed" &&
        row.recoveryAction === "operator_reconcile"
      )) ||
    row.visualUpdatedAt === null ||
    evidence.length !== 3
  ) {
    throw new Error("Invalid visual evidence parent state");
  }
  if (row.visualState === "dispatching" && hasNoVisualPayload(row)) {
    return {
      evidence,
      status: { kind: "extracting_visual" } as const,
      updatedAt: row.visualUpdatedAt,
    };
  }
  if (
    row.visualState === "failed" &&
    row.visualOutcome === null &&
    row.visualManifestKey === null &&
    row.visualFailureCode !== null
  ) {
    return {
      evidence,
      status: {
        code: "visual_evidence_failed",
        kind: "failed",
        recovery: "operator_reconcile",
      } as const,
      updatedAt: row.visualUpdatedAt,
    };
  }
  if (
    row.visualState === "completed" &&
    row.visualFailureCode === null &&
    row.visualManifestKey !== null
  ) {
    const status = completedVisualStatus(row.visualOutcome);
    if (status === null) {
      throw new Error("Invalid completed visual outcome");
    }
    return {
      evidence: [
        ...evidence,
        {
          kind: "visual_evidence_manifest" as const,
          referenceId: row.visualManifestKey,
        },
      ],
      status: row.status === "failed" ? decodeStatus(row) : status,
      updatedAt: row.status === "failed" ? row.updatedAt : row.visualUpdatedAt,
    };
  }
  throw new Error("Invalid persisted visual evidence state");
};

const decodeRecipeProjection = (
  row: DatabaseImportRow,
  visualProjection: ReturnType<typeof decodeVisualProjection>
) => {
  if (
    row.recipeDraftState === null &&
    row.recipeDraftFingerprint === null &&
    row.recipeDraftJson === null &&
    row.recipeDraftUpdatedAt === null
  ) {
    return visualProjection;
  }
  if (
    row.recipeDraftState !== "needs_review" ||
    row.recipeDraftFingerprint === null ||
    row.recipeDraftJson === null ||
    row.recipeDraftUpdatedAt === null
  ) {
    throw new Error("Invalid persisted recipe draft state");
  }
  const draft = Schema.decodeUnknownSync(RecipeDraft, {
    onExcessProperty: "error",
  })(JSON.parse(row.recipeDraftJson));
  if (
    draft.extractionFingerprint !== row.recipeDraftFingerprint ||
    draft.importId !== row.id ||
    draft.generation !== row.acquisitionGeneration
  ) {
    throw new Error("Persisted recipe draft identity mismatch");
  }
  if (draft.schemaVersion === 2) {
    if (
      row.carouselManifestKey === null ||
      row.carouselUpdatedAt === null ||
      visualProjection.evidence.length !== 0 ||
      visualProjection.status.kind !== "queued"
    ) {
      throw new Error("Invalid persisted carousel recipe draft state");
    }
    return {
      evidence: [
        {
          kind: "carousel_evidence_manifest" as const,
          referenceId: row.carouselManifestKey,
        },
        {
          kind: "recipe_draft" as const,
          referenceId: `recipe-drafts/${row.recipeDraftFingerprint}`,
        },
      ],
      status: { kind: "needs_review" as const },
      updatedAt: row.recipeDraftUpdatedAt,
    };
  }
  if (
    visualProjection.evidence.length === 4 &&
    [
      "visual_evidence_empty",
      "visual_evidence_found",
      "visual_evidence_low_confidence",
    ].includes(visualProjection.status.kind)
  ) {
    return {
      evidence: [
        ...visualProjection.evidence,
        {
          kind: "recipe_draft" as const,
          referenceId: `recipe-drafts/${row.recipeDraftFingerprint}`,
        },
      ],
      status: { kind: "needs_review" as const },
      updatedAt: row.recipeDraftUpdatedAt,
    };
  }
  throw new Error("Invalid persisted recipe draft state");
};

const decodeStoredImport = (input: unknown) =>
  Effect.try({
    catch: importPersistenceCorrupt,
    try: (): StoredImport => {
      const row = Schema.decodeUnknownSync(DatabaseImportRow)(input);
      const canonicalSourceId = Schema.decodeUnknownSync(SourceCanonicalId)(
        row.canonicalSourceId
      );
      const baseEvidence = Schema.decodeUnknownSync(
        Schema.Array(EvidenceReference)
      )(JSON.parse(row.evidenceReferencesJson));
      const visualProjection = decodeVisualProjection(row, baseEvidence);
      const projection = decodeRecipeProjection(row, visualProjection);
      const view = Schema.decodeUnknownSync(ImportView)({
        createdAt: row.createdAt,
        evidence: projection.evidence,
        id: row.id,
        source: { canonicalId: canonicalSourceId, kind: row.sourceKind },
        status: projection.status,
        updatedAt: projection.updatedAt,
      });
      const correlationId =
        row.correlationId === null
          ? deriveLegacyImportCorrelationId(view.id)
          : Schema.decodeUnknownSync(ImportCorrelationId)(row.correlationId);
      return {
        acquisitionGeneration: row.acquisitionGeneration,
        canonicalSourceId,
        compatibilityFingerprint: row.compatibilityFingerprint,
        sourceKind: row.sourceKind,
        trace: { correlationId },
        view,
      };
    },
  });

const decodeStoredImportRequest = (input: unknown) =>
  Effect.gen(function* decodeStoredRequest() {
    const fingerprints = yield* Effect.try({
      catch: importPersistenceCorrupt,
      try: () => Schema.decodeUnknownSync(DatabaseRequestFingerprints)(input),
    });
    return {
      import: yield* decodeStoredImport(input),
      requestFingerprint: fingerprints.requestFingerprint,
      sourceLocatorHash: fingerprints.sourceLocatorHash,
    } satisfies StoredImportRequest;
  });

const persistenceEffect = <A>(promise: () => PromiseLike<A>) =>
  Effect.tryPromise({
    catch: importPersistenceUnavailable,
    try: promise,
  });

const DatabaseIntentRow = Schema.Struct({
  activeActionId: NullableString,
  cancelledAt: NullableString,
  createdAt: Schema.String,
  failedAt: NullableString,
  id: Schema.String,
  intentVersion: Schema.Number,
  legacyStatus: Schema.String,
  publicActivity: Schema.NullOr(Schema.Literals(["working", "retrying"])),
  publicFailureCode: NullableString,
  publicFailureMessage: NullableString,
  publicNextAttemptAt: NullableString,
  publicRecipeId: NullableString,
  publicRecovery: NullableString,
  publicSourceKind: Schema.NullOr(Schema.Literals(["video", "carousel"])),
  publicSourceUrl: NullableString,
  publicStage: NullableString,
  publicStageStartedAt: NullableString,
  publicStatus: Schema.Literals([
    "processing",
    "requires_action",
    "succeeded",
    "failed",
    "cancelled",
    "redirected",
  ]),
  redirectedAt: NullableString,
  redirectedToImportId: NullableString,
  resolvedCanonicalSourceId: NullableString,
  succeededAt: NullableString,
  updatedAt: Schema.String,
});
type DatabaseIntentRow = typeof DatabaseIntentRow.Type;

const intentRowSelection = `
  active_action_id AS activeActionId,
  cancelled_at AS cancelledAt,
  created_at AS createdAt,
  failed_at AS failedAt,
  id,
  intent_version AS intentVersion,
  status AS legacyStatus,
  public_activity AS publicActivity,
  public_failure_code AS publicFailureCode,
  public_failure_message AS publicFailureMessage,
  public_next_attempt_at AS publicNextAttemptAt,
  public_recipe_id AS publicRecipeId,
  public_recovery AS publicRecovery,
  public_source_kind AS publicSourceKind,
  public_source_url AS publicSourceUrl,
  public_stage AS publicStage,
  public_stage_started_at AS publicStageStartedAt,
  public_status AS publicStatus,
  redirected_at AS redirectedAt,
  redirected_to_import_id AS redirectedToImportId,
  resolved_canonical_source_id AS resolvedCanonicalSourceId,
  succeeded_at AS succeededAt,
  updated_at AS updatedAt
`;

const intentLinks = (id: string) => ({
  self: `/v1/recipe-import-intents/${id}`,
  timeline: `/v1/recipe-import-intents/${id}/timeline`,
});

const publicSourceFor = (row: DatabaseIntentRow) =>
  row.publicSourceUrl === null
    ? { kind: "tiktok" as const, resolution: "pending" as const }
    : {
        canonicalUrl: row.publicSourceUrl,
        kind: "tiktok" as const,
        resolution: "resolved" as const,
      };

const processingActivityFor = (row: DatabaseIntentRow) => {
  if (row.publicActivity === null) {
    throw new Error("Processing activity is missing");
  }
  return row.publicActivity === "retrying"
    ? {
        ...(row.publicNextAttemptAt === null
          ? {}
          : { nextAttemptAt: row.publicNextAttemptAt }),
        type: "retrying" as const,
      }
    : { type: "working" as const };
};

const speechProgressFor = (legacyStatus: string) => {
  switch (legacyStatus) {
    case "transcribed": {
      return "completed" as const;
    }
    case "transcribing": {
      return "processing" as const;
    }
    default: {
      return "not_started" as const;
    }
  }
};

const processingStageFor = (row: DatabaseIntentRow): unknown => {
  if (row.publicStage === null || row.publicStageStartedAt === null) {
    throw new Error("Processing stage is missing");
  }
  switch (row.publicStage) {
    case "resolving_source": {
      return {
        startedAt: row.publicStageStartedAt,
        type: "resolving_source",
      };
    }
    case "acquiring_media": {
      if (row.publicSourceKind === null) {
        throw new Error("Resolved source kind is missing");
      }
      return {
        sourceKind: row.publicSourceKind,
        startedAt: row.publicStageStartedAt,
        type: "acquiring_media",
      };
    }
    case "analyzing_evidence": {
      return {
        speech: speechProgressFor(row.legacyStatus),
        startedAt: row.publicStageStartedAt,
        type: "analyzing_evidence",
        visuals: "not_started",
      };
    }
    case "extracting_recipe":
    case "finalizing_recipe":
    case "grounding_recipe":
    case "preparing_review": {
      return {
        startedAt: row.publicStageStartedAt,
        type: row.publicStage,
      };
    }
    default: {
      throw new Error("Unsupported processing projection");
    }
  }
};

const decodePublicIntent = (input: unknown) =>
  Effect.try({
    catch: importPersistenceCorrupt,
    try: (): RecipeImportIntentType => {
      const row = Schema.decodeUnknownSync(DatabaseIntentRow)(input);
      const common = {
        createdAt: row.createdAt,
        id: row.id,
        intentVersion: row.intentVersion,
        links: intentLinks(row.id),
        object: "recipe_import_intent" as const,
        source: publicSourceFor(row),
        updatedAt: row.updatedAt,
      };
      let candidate: unknown;
      switch (row.publicStatus) {
        case "processing": {
          candidate = {
            ...common,
            activity: processingActivityFor(row),
            processing: processingStageFor(row),
            status: "processing",
          };
          break;
        }
        case "requires_action": {
          if (row.activeActionId === null) {
            throw new Error("Active action identity is missing");
          }
          candidate = {
            ...common,
            action: {
              id: row.activeActionId,
              link: `/v1/recipe-import-intents/${row.id}/actions/${row.activeActionId}`,
              type: "review_recipe",
            },
            status: "requires_action",
          };
          break;
        }
        case "succeeded": {
          if (row.publicRecipeId === null || row.succeededAt === null) {
            throw new Error("Succeeded result is missing");
          }
          candidate = {
            ...common,
            completedAt: row.succeededAt,
            result: { recipeId: row.publicRecipeId },
            status: "succeeded",
          };
          break;
        }
        case "failed": {
          if (
            row.publicFailureCode === null ||
            row.publicFailureMessage === null ||
            row.publicRecovery === null ||
            row.failedAt === null
          ) {
            throw new Error("Failed result is missing");
          }
          candidate = {
            ...common,
            error: {
              code: row.publicFailureCode,
              message: row.publicFailureMessage,
              recovery: row.publicRecovery,
            },
            failedAt: row.failedAt,
            status: "failed",
          };
          break;
        }
        case "cancelled": {
          if (row.cancelledAt === null) {
            throw new Error("Cancellation time is missing");
          }
          candidate = {
            ...common,
            cancelledAt: row.cancelledAt,
            status: "cancelled",
          };
          break;
        }
        case "redirected": {
          if (row.redirectedAt === null || row.redirectedToImportId === null) {
            throw new Error("Redirect target is missing");
          }
          candidate = {
            ...common,
            redirect: {
              intentId: row.redirectedToImportId,
              link: `/v1/recipe-import-intents/${row.redirectedToImportId}`,
            },
            redirectedAt: row.redirectedAt,
            status: "redirected",
          };
          break;
        }
        default: {
          throw new Error("Unsupported public intent status");
        }
      }
      return Schema.decodeUnknownSync(RecipeImportIntent, {
        onExcessProperty: "error",
      })(candidate);
    },
  });

const initialPublicIntent = (id: string, createdAt: string) =>
  Effect.try({
    catch: importPersistenceCorrupt,
    try: () =>
      Schema.decodeUnknownSync(RecipeImportIntent, {
        onExcessProperty: "error",
      })({
        activity: { type: "working" },
        createdAt,
        id,
        intentVersion: InitialRecipeImportIntentVersion,
        links: intentLinks(id),
        object: "recipe_import_intent",
        processing: { startedAt: createdAt, type: "resolving_source" },
        source: { kind: "tiktok", resolution: "pending" },
        status: "processing",
        updatedAt: createdAt,
      }),
  });

const statusColumns = (status: ImportStatus) => {
  switch (status.kind) {
    case "acquired":
    case "acquiring":
    case "extracting_visual":
    case "needs_review":
    case "queued":
    case "transcribed":
    case "transcribing": {
      return { recoveryAction: null, statusCode: null };
    }
    case "visual_evidence_empty":
    case "visual_evidence_found":
    case "visual_evidence_low_confidence": {
      return { recoveryAction: null, statusCode: null };
    }
    case "failed": {
      return {
        recoveryAction: status.recovery,
        statusCode: status.code,
      };
    }
    case "unsupported": {
      return {
        recoveryAction: status.recovery,
        statusCode: status.code,
      };
    }
    default: {
      throw new Error("Unsupported import status");
    }
  }
};

const failureStatus = (
  failure: ClassifiedAcquisitionFailure
): Exclude<
  ImportStatus,
  { readonly kind: "acquired" | "acquiring" | "queued" }
> => {
  switch (failure._tag) {
    case "RetryExhausted": {
      return {
        code: "acquisition_temporarily_unavailable",
        kind: "failed",
        recovery: "retry_later",
      };
    }
    case "Unavailable": {
      return {
        code: "private_or_unavailable",
        kind: "failed",
        recovery: "check_source_visibility",
      };
    }
    case "TerminalMedia": {
      return {
        code: "invalid_or_unsupported_media",
        kind: "failed",
        recovery: "submit_supported_public_video",
      };
    }
    case "UnsupportedCarousel": {
      return {
        code: "unsupported_post_type",
        kind: "unsupported",
        recovery: "submit_supported_public_video",
      };
    }
    default: {
      throw new Error("Unsupported acquisition failure");
    }
  }
};

const isVerifiedEvidenceFor = (
  id: ImportId,
  evidence: VerifiedAcquisitionEvidence,
  acquiredAt: ImportTimestamp
) =>
  evidence.mediaKey === mediaObjectKey(id, evidence.generation) &&
  evidence.manifestKey === manifestObjectKey(id, evidence.generation) &&
  evidence.acquiredAt === acquiredAt &&
  evidence.sha256.length === 64 &&
  evidence.bytes > 0 &&
  evidence.durationSeconds > 0 &&
  evidence.audioStreams.length > 0 &&
  evidence.videoStreams.length > 0 &&
  DateTime.toEpochMillis(evidence.deleteAt) -
    DateTime.toEpochMillis(evidence.acquiredAt) ===
    EvidenceRetentionSeconds * 1000;

interface D1ImportRepositoryShape
  extends ImportRepositoryShape, ImportIntentRepositoryShape {
  readonly beginAcquisitionAttempt: (id: ImportId) => Effect.Effect<
    {
      readonly canonicalSourceId: SourceCanonicalId;
      readonly generation: AcquisitionGeneration;
    },
    ImportTransitionError
  >;
  readonly claimAcquisition: (
    id: ImportId
  ) => Effect.Effect<ClaimAcquisitionResult, ImportTransitionError>;
  readonly recordAcquired: (
    id: ImportId,
    generation: AcquisitionGeneration,
    evidence: VerifiedAcquisitionEvidence,
    acquiredAt: ImportTimestamp
  ) => Effect.Effect<"Recorded" | "Superseded", ImportTransitionError>;
  readonly recordAcquisitionFailure: (
    id: ImportId,
    generation: AcquisitionGeneration,
    failure: ClassifiedAcquisitionFailure,
    failedAt: ImportTimestamp
  ) => Effect.Effect<"Recorded" | "Superseded", ImportTransitionError>;
}

export const makeD1ImportRepository = (
  binding: AnyD1Database,
  currentTimeMillis: () => number = Date.now
): D1ImportRepositoryShape => {
  const database = drizzle(binding);

  const findById = (id: ImportId) =>
    Effect.gen(function* findByIdEffect() {
      const rows = yield* persistenceEffect(() =>
        database
          .select(importSelection)
          .from(recipeImports)
          .leftJoin(
            importVisualEvidence,
            and(
              eq(importVisualEvidence.importId, recipeImports.id),
              eq(
                importVisualEvidence.acquisitionGeneration,
                recipeImports.acquisitionGeneration
              )
            )
          )
          .leftJoin(
            importRecipeExtractions,
            and(
              eq(importRecipeExtractions.importId, recipeImports.id),
              eq(
                importRecipeExtractions.acquisitionGeneration,
                recipeImports.acquisitionGeneration
              ),
              eq(importRecipeExtractions.isCurrent, 1)
            )
          )
          .where(eq(recipeImports.id, id))
          .limit(1)
      );
      return rows[0] === undefined
        ? Option.none()
        : Option.some(yield* decodeStoredImport(rows[0]));
    });

  const requireImport = (id: ImportId) =>
    Effect.flatMap(findById(id), (stored) =>
      Option.match(stored, {
        onNone: () => Effect.fail(importNotFound(id)),
        onSome: Effect.succeed,
      })
    );

  const findIntentRow = (
    principal: ImportPrincipal,
    intentId: RecipeImportIntentId
  ) =>
    Effect.gen(function* findIntentRowEffect() {
      const row = yield* persistenceEffect(
        () =>
          binding
            .prepare(
              `SELECT ${intentRowSelection}
                 FROM recipe_imports
                WHERE household_scope_id = ? AND id = ?
                LIMIT 1`
            )
            .bind(principal.householdScopeId, intentId)
            .first() as PromiseLike<unknown | null>
      );
      if (row === null) {
        return Option.none<DatabaseIntentRow>();
      }
      return Option.some(
        yield* Effect.try({
          catch: importPersistenceCorrupt,
          try: () => Schema.decodeUnknownSync(DatabaseIntentRow)(row),
        })
      );
    });

  const findIntent = (
    principal: ImportPrincipal,
    intentId: RecipeImportIntentId
  ) =>
    Effect.flatMap(
      findIntentRow(principal, intentId),
      Option.match({
        onNone: () => Effect.succeed(Option.none<RecipeImportIntentType>()),
        onSome: (row) => Effect.map(decodePublicIntent(row), Option.some),
      })
    );

  const requireIntentRow = (
    principal: ImportPrincipal,
    intentId: RecipeImportIntentId
  ) =>
    Effect.flatMap(
      findIntentRow(principal, intentId),
      Option.match({
        onNone: () => Effect.fail(new RecipeImportIntentNotFound()),
        onSome: Effect.succeed,
      })
    );

  const redirectResolvedIntent = (
    principal: ImportPrincipal,
    command: Parameters<ImportIntentRepositoryShape["resolveIntentSource"]>[1]
  ) =>
    Effect.gen(function* redirectResolvedIntentEffect() {
      const resolvedAt = encodeInstant(command.resolvedAt);
      const winnerSql = `
        SELECT id
          FROM recipe_imports
         WHERE household_scope_id = ?
           AND resolved_canonical_source_id = ?
           AND public_status IN ('processing', 'requires_action', 'succeeded')
           AND id <> ?
         ORDER BY created_at, id
         LIMIT 1
      `;
      const result = yield* persistenceEffect<D1MutationResult>(
        () =>
          binding
            .prepare(
              `UPDATE recipe_imports
                SET canonical_source_id = ?,
                    resolved_canonical_source_id = ?,
                    public_source_url = ?,
                    public_source_kind = ?,
                    public_status = 'redirected',
                    public_stage = NULL,
                    public_stage_started_at = NULL,
                    public_activity = NULL,
                    public_next_attempt_at = NULL,
                    redirected_at = ?,
                    redirected_to_import_id = (${winnerSql}),
                    executor_owner_id = NULL,
                    transition_mutation_id = NULL,
                    transition_command_digest = NULL,
                    transition_actor_category = 'system',
                    transition_actor_identity_hash = NULL,
                    transition_provenance_version = intent_version + 1,
                    intent_version = intent_version + 1,
                    updated_at = ?
              WHERE household_scope_id = ?
                AND id = ?
                AND public_status = 'processing'
                AND public_stage = 'resolving_source'
                AND resolved_canonical_source_id IS NULL
                AND EXISTS (${winnerSql})`
            )
            .bind(
              command.canonicalSourceId,
              command.canonicalSourceId,
              command.canonicalUrl,
              command.sourceKind,
              resolvedAt,
              principal.householdScopeId,
              command.canonicalSourceId,
              command.intentId,
              resolvedAt,
              principal.householdScopeId,
              command.intentId,
              principal.householdScopeId,
              command.canonicalSourceId,
              command.intentId
            )
            .run() as PromiseLike<D1MutationResult>
      );
      return result.meta.changes === 1;
    });

  const claimResolvedIntent = (
    principal: ImportPrincipal,
    command: Parameters<ImportIntentRepositoryShape["resolveIntentSource"]>[1]
  ) =>
    persistenceEffect<D1MutationResult>(() => {
      const resolvedAt = encodeInstant(command.resolvedAt);
      return binding
        .prepare(
          `UPDATE recipe_imports
                SET canonical_source_id = ?,
                    resolved_canonical_source_id = ?,
                    public_source_url = ?,
                    public_source_kind = ?,
                    public_stage = 'acquiring_media',
                    public_stage_started_at = ?,
                    public_activity = 'working',
                    public_next_attempt_at = NULL,
                    transition_mutation_id = NULL,
                    transition_command_digest = NULL,
                    transition_actor_category = 'system',
                    transition_actor_identity_hash = NULL,
                    transition_provenance_version = intent_version + 1,
                    intent_version = intent_version + 1,
                    updated_at = ?
              WHERE household_scope_id = ?
                AND id = ?
                AND public_status = 'processing'
                AND public_stage = 'resolving_source'
                AND resolved_canonical_source_id IS NULL
                AND NOT EXISTS (
                  SELECT 1
                    FROM recipe_imports AS winner
                   WHERE winner.household_scope_id = ?
                     AND winner.resolved_canonical_source_id = ?
                     AND winner.public_status IN (
                       'processing', 'requires_action', 'succeeded'
                     )
                     AND winner.id <> ?
                )`
        )
        .bind(
          command.canonicalSourceId,
          command.canonicalSourceId,
          command.canonicalUrl,
          command.sourceKind,
          resolvedAt,
          resolvedAt,
          principal.householdScopeId,
          command.intentId,
          principal.householdScopeId,
          command.canonicalSourceId,
          command.intentId
        )
        .run() as PromiseLike<D1MutationResult>;
    });

  // eslint-disable-next-line sort-keys -- Repository methods stay grouped by request, read, and acquisition lifecycle.
  return {
    admitIntent: (command) =>
      Effect.gen(function* admitIntent() {
        const createdAt = encodeInstant(command.createdAt);
        const provisionalCanonicalId = `pending:${command.intentId}`;
        const compatibilityFingerprint = "0".repeat(64);
        const [insertResult] = yield* persistenceEffect<
          readonly D1MutationResult[]
        >(
          () =>
            binding.batch([
              binding
                .prepare(
                  `INSERT INTO recipe_imports (
                   acquisition_generation, actor_id, canonical_source_id,
                   compatibility_fingerprint, created_at,
                   evidence_references_json, execution_generation,
                   household_scope_id, id, intent_version, public_activity,
                   public_stage, public_stage_started_at, public_status,
                   source_kind, status, submitted_source_url,
                   transition_mutation_id, transition_command_digest,
                   transition_actor_category, transition_actor_identity_hash,
                   transition_provenance_version, updated_at
                 )
                 SELECT 0, ?, ?, ?, ?, '[]', 0, ?, ?, 1, 'working',
                        'resolving_source', ?, 'processing', 'tiktok', 'queued',
                        ?, ?, ?, 'household_member', ?, 1, ?
                  WHERE NOT EXISTS (
                    SELECT 1 FROM import_requests
                     WHERE household_scope_id = ? AND idempotency_key_hash = ?
                  )`
                )
                .bind(
                  command.principal.actorId,
                  provisionalCanonicalId,
                  compatibilityFingerprint,
                  createdAt,
                  command.principal.householdScopeId,
                  command.intentId,
                  createdAt,
                  command.submittedSourceUrl,
                  command.idempotencyKeyHash,
                  command.requestFingerprint,
                  command.principal.actorId,
                  createdAt,
                  command.principal.householdScopeId,
                  command.idempotencyKeyHash
                ),
              binding
                .prepare(
                  `INSERT OR IGNORE INTO import_requests (
                   household_scope_id, created_at, idempotency_key_hash,
                   import_id, request_fingerprint, source_locator_hash
                 )
                 SELECT ?, ?, ?, id, ?, ?
                   FROM recipe_imports
                  WHERE household_scope_id = ? AND id = ?
                    AND NOT EXISTS (
                      SELECT 1 FROM import_requests
                       WHERE household_scope_id = ? AND idempotency_key_hash = ?
                    )`
                )
                .bind(
                  command.principal.householdScopeId,
                  createdAt,
                  command.idempotencyKeyHash,
                  command.requestFingerprint,
                  command.sourceLocatorHash,
                  command.principal.householdScopeId,
                  command.intentId,
                  command.principal.householdScopeId,
                  command.idempotencyKeyHash
                ),
            ]) as PromiseLike<readonly D1MutationResult[]>
        );
        const winningRequest = yield* persistenceEffect(
          () =>
            binding
              .prepare(
                `SELECT import_id AS id, created_at AS createdAt,
                        request_fingerprint AS requestFingerprint
                   FROM import_requests
                  WHERE household_scope_id = ? AND idempotency_key_hash = ?
                  LIMIT 1`
              )
              .bind(
                command.principal.householdScopeId,
                command.idempotencyKeyHash
              )
              .first() as PromiseLike<unknown | null>
        );
        const request = yield* Effect.try({
          catch: importPersistenceCorrupt,
          try: () =>
            Schema.decodeUnknownSync(
              Schema.Struct({
                createdAt: Schema.String,
                id: Schema.String,
                requestFingerprint: RequestFingerprint,
              })
            )(winningRequest),
        });
        if (request.requestFingerprint !== command.requestFingerprint) {
          return yield* Effect.fail(
            new RecipeImportIntentIdempotencyConflict()
          );
        }
        return {
          disposition:
            (insertResult?.meta.changes ?? 0) > 0
              ? "created"
              : "idempotency_replay",
          intent: yield* initialPublicIntent(request.id, request.createdAt),
        };
      }),
    findIntent,
    requireMutableIntent: (principal, intentId) =>
      Effect.gen(function* requireMutableIntent() {
        const row = yield* requireIntentRow(principal, intentId);
        const intent = yield* decodePublicIntent(row);
        if (intent.status === "redirected") {
          return yield* Effect.fail(
            new RecipeImportIntentRedirected({
              intent,
              redirect: intent.redirect,
            })
          );
        }
        return intent;
      }),
    resolveIntentSource: (principal, command) =>
      Effect.gen(function* resolveIntentSource() {
        const current = yield* requireIntentRow(principal, command.intentId);
        if (current.resolvedCanonicalSourceId !== null) {
          if (
            current.resolvedCanonicalSourceId === command.canonicalSourceId &&
            current.publicSourceUrl === command.canonicalUrl &&
            current.publicSourceKind === command.sourceKind
          ) {
            return yield* decodePublicIntent(current);
          }
          return yield* Effect.fail(new RecipeImportIntentTransitionRejected());
        }
        if (
          current.publicStatus !== "processing" ||
          current.publicStage !== "resolving_source"
        ) {
          return yield* Effect.fail(new RecipeImportIntentTransitionRejected());
        }

        const redirected = yield* redirectResolvedIntent(principal, command);
        if (!redirected) {
          const claim = yield* Effect.exit(
            claimResolvedIntent(principal, command)
          );
          if (claim._tag === "Failure") {
            const racedRedirect = yield* redirectResolvedIntent(
              principal,
              command
            );
            if (!racedRedirect) {
              return yield* Effect.fail(importPersistenceUnavailable());
            }
          } else if (claim.value.meta.changes === 0) {
            const racedRedirect = yield* redirectResolvedIntent(
              principal,
              command
            );
            if (racedRedirect) {
              return yield* decodePublicIntent(
                yield* requireIntentRow(principal, command.intentId)
              );
            }
            const raced = yield* requireIntentRow(principal, command.intentId);
            if (
              raced.resolvedCanonicalSourceId !== command.canonicalSourceId ||
              raced.publicSourceUrl !== command.canonicalUrl ||
              raced.publicSourceKind !== command.sourceKind
            ) {
              return yield* Effect.fail(
                new RecipeImportIntentTransitionRejected()
              );
            }
          }
        }

        const settled = yield* requireIntentRow(principal, command.intentId);
        if (settled.resolvedCanonicalSourceId === null) {
          return yield* Effect.fail(importPersistenceUnavailable());
        }
        if (
          settled.resolvedCanonicalSourceId !== command.canonicalSourceId ||
          settled.publicSourceUrl !== command.canonicalUrl ||
          settled.publicSourceKind !== command.sourceKind
        ) {
          return yield* Effect.fail(new RecipeImportIntentTransitionRejected());
        }
        return yield* decodePublicIntent(settled);
      }),
    acceptRequest: (command: AcceptImportCommand) =>
      Effect.gen(function* acceptRequest() {
        const createdAt = DateTime.formatIso(command.candidate.view.createdAt);
        const updatedAt = DateTime.formatIso(command.candidate.view.updatedAt);
        const publicSourceUrl = `https://www.tiktok.com/video/${encodeURIComponent(command.candidate.canonicalSourceId)}`;
        const canInsertCandidate =
          ![
            "extracting_visual",
            "needs_review",
            "visual_evidence_empty",
            "visual_evidence_found",
            "visual_evidence_low_confidence",
          ].includes(command.candidate.view.status.kind) &&
          !(
            command.candidate.view.status.kind === "failed" &&
            ["recipe_extraction_failed", "visual_evidence_failed"].includes(
              command.candidate.view.status.code
            )
          );
        const { recoveryAction, statusCode } = statusColumns(
          command.candidate.view.status
        );

        const insertCandidate = database
          .insert(
            recipeImports,
            "acquisitionGeneration",
            "actorId",
            "canonicalSourceId",
            "compatibilityFingerprint",
            "correlationId",
            "createdAt",
            "evidenceReferencesJson",
            "id",
            "recoveryAction",
            "sourceKind",
            "status",
            "statusCode",
            "updatedAt",
            "householdScopeId",
            "resolvedCanonicalSourceId",
            "publicSourceUrl",
            "publicSourceKind",
            "publicStatus",
            "publicStage",
            "publicStageStartedAt",
            "publicActivity",
            "publicFailureCode",
            "publicFailureMessage",
            "publicRecovery",
            "failedAt",
            "transitionMutationId",
            "transitionCommandDigest",
            "transitionActorCategory",
            "transitionActorIdentityHash",
            "transitionProvenanceVersion"
          )
          .select(
            sql`SELECT
              ${command.candidate.acquisitionGeneration},
              ${LegacyPrivateImportActorId},
              ${command.candidate.canonicalSourceId},
              ${command.candidate.compatibilityFingerprint},
              ${command.candidate.trace.correlationId},
              ${createdAt},
              ${JSON.stringify(command.candidate.view.evidence)},
              ${command.candidate.view.id},
              ${recoveryAction},
              ${command.candidate.sourceKind},
              ${command.candidate.view.status.kind},
              ${statusCode},
              ${updatedAt},
              ${LegacyPrivateHouseholdScopeId},
              ${command.candidate.canonicalSourceId},
              ${publicSourceUrl},
              'video',
              CASE
                WHEN ${command.candidate.view.status.kind} IN ('failed', 'unsupported') THEN 'failed'
                ELSE 'processing'
              END,
              CASE
                WHEN ${command.candidate.view.status.kind} IN ('failed', 'unsupported') THEN NULL
                WHEN ${command.candidate.view.status.kind} IN ('transcribed', 'transcribing') THEN 'analyzing_evidence'
                ELSE 'acquiring_media'
              END,
              CASE
                WHEN ${command.candidate.view.status.kind} IN ('failed', 'unsupported') THEN NULL
                ELSE ${updatedAt}
              END,
              CASE
                WHEN ${command.candidate.view.status.kind} IN ('failed', 'unsupported') THEN NULL
                ELSE 'working'
              END,
              CASE
                WHEN ${command.candidate.view.status.kind} NOT IN ('failed', 'unsupported') THEN NULL
                WHEN ${statusCode} = 'private_or_unavailable' THEN 'source_unavailable'
                WHEN ${statusCode} IN ('invalid_or_unsupported_media', 'unsupported_post_type') THEN 'invalid_media'
                WHEN ${statusCode} IN ('transcription_failed', 'acquisition_temporarily_unavailable') THEN 'analysis_failed'
                ELSE 'internal_error'
              END,
              CASE
                WHEN ${command.candidate.view.status.kind} NOT IN ('failed', 'unsupported') THEN NULL
                WHEN ${statusCode} = 'private_or_unavailable' THEN 'The source is not available.'
                WHEN ${statusCode} IN ('invalid_or_unsupported_media', 'unsupported_post_type') THEN 'The source media is not supported.'
                WHEN ${statusCode} IN ('transcription_failed', 'acquisition_temporarily_unavailable') THEN 'The source could not be analyzed.'
                ELSE 'This import did not produce a recipe.'
              END,
              CASE
                WHEN ${command.candidate.view.status.kind} IN ('failed', 'unsupported') THEN 'create_new_intent'
                ELSE NULL
              END,
              CASE
                WHEN ${command.candidate.view.status.kind} IN ('failed', 'unsupported') THEN ${updatedAt}
                ELSE NULL
              END,
              ${command.idempotencyKeyHash},
              ${command.requestFingerprint},
              'household_member',
              ${LegacyPrivateImportActorId},
              1
            WHERE ${canInsertCandidate ? 1 : 0} = 1
              AND NOT EXISTS (
              SELECT 1 FROM ${importRequests}
              WHERE ${importRequests.idempotencyKeyHash} = ${command.idempotencyKeyHash}
            )`
          )
          .onConflictDoNothing()
          .returning({ id: recipeImports.id });

        const insertRequest = database
          .insert(
            importRequests,
            "householdScopeId",
            "createdAt",
            "idempotencyKeyHash",
            "importId",
            "requestFingerprint",
            "sourceLocatorHash"
          )
          .select(
            sql`SELECT
              ${LegacyPrivateHouseholdScopeId},
              ${createdAt},
              ${command.idempotencyKeyHash},
              ${recipeImports.id},
              ${command.requestFingerprint},
              ${command.sourceLocatorHash}
            FROM ${recipeImports}
            WHERE ${recipeImports.sourceKind} = ${command.candidate.sourceKind}
              AND ${recipeImports.canonicalSourceId} = ${command.candidate.canonicalSourceId}
              AND ${recipeImports.compatibilityFingerprint} = ${command.candidate.compatibilityFingerprint}
              AND NOT EXISTS (
                SELECT 1 FROM ${importRequests}
                WHERE ${importRequests.idempotencyKeyHash} = ${command.idempotencyKeyHash}
              )
            LIMIT 1`
          )
          .onConflictDoNothing()
          .returning({ importId: importRequests.importId });

        const selectWinningRequest = database
          .select({
            ...importSelection,
            requestFingerprint: importRequests.requestFingerprint,
            sourceLocatorHash: importRequests.sourceLocatorHash,
          })
          .from(importRequests)
          .innerJoin(
            recipeImports,
            eq(importRequests.importId, recipeImports.id)
          )
          .leftJoin(
            importVisualEvidence,
            and(
              eq(importVisualEvidence.importId, recipeImports.id),
              eq(
                importVisualEvidence.acquisitionGeneration,
                recipeImports.acquisitionGeneration
              )
            )
          )
          .leftJoin(
            importRecipeExtractions,
            and(
              eq(importRecipeExtractions.importId, recipeImports.id),
              eq(
                importRecipeExtractions.acquisitionGeneration,
                recipeImports.acquisitionGeneration
              ),
              eq(importRecipeExtractions.isCurrent, 1)
            )
          )
          .where(
            eq(importRequests.idempotencyKeyHash, command.idempotencyKeyHash)
          )
          .limit(1);

        const selectCanonical = database
          .select(importSelection)
          .from(recipeImports)
          .leftJoin(
            importVisualEvidence,
            and(
              eq(importVisualEvidence.importId, recipeImports.id),
              eq(
                importVisualEvidence.acquisitionGeneration,
                recipeImports.acquisitionGeneration
              )
            )
          )
          .leftJoin(
            importRecipeExtractions,
            and(
              eq(importRecipeExtractions.importId, recipeImports.id),
              eq(
                importRecipeExtractions.acquisitionGeneration,
                recipeImports.acquisitionGeneration
              ),
              eq(importRecipeExtractions.isCurrent, 1)
            )
          )
          .where(
            and(
              eq(recipeImports.sourceKind, command.candidate.sourceKind),
              eq(
                recipeImports.canonicalSourceId,
                command.candidate.canonicalSourceId
              )
            )
          )
          .limit(1);

        const [insertedImports, insertedRequests] = yield* persistenceEffect(
          () => database.batch([insertCandidate, insertRequest] as const)
        );
        const winningRows = yield* persistenceEffect(
          () => selectWinningRequest
        );

        const [winningRow] = winningRows;
        if (winningRow !== undefined) {
          const winningRequest = yield* decodeStoredImportRequest(winningRow);
          if (
            winningRequest.requestFingerprint !== command.requestFingerprint
          ) {
            return yield* Effect.fail(idempotencyConflict());
          }
          const winningImport = winningRequest.import;
          if (
            winningImport.compatibilityFingerprint !==
            command.candidate.compatibilityFingerprint
          ) {
            return yield* Effect.fail(incompatibleDuplicate());
          }

          const insertedImport = insertedImports.some(
            ({ id }) => id === winningImport.view.id
          );
          let disposition: ImportDisposition = "idempotency_replay";
          if (insertedImport) {
            disposition = "created";
          } else if (insertedRequests.length > 0) {
            disposition = "canonical_duplicate";
          }
          return {
            disposition,
            import: winningImport,
          };
        }

        const canonicalRows = yield* persistenceEffect(() => selectCanonical);
        const [canonicalRow] = canonicalRows;
        if (canonicalRow !== undefined) {
          const canonicalImport = yield* decodeStoredImport(canonicalRow);
          if (
            canonicalImport.compatibilityFingerprint !==
            command.candidate.compatibilityFingerprint
          ) {
            return yield* Effect.fail(incompatibleDuplicate());
          }
        }
        return yield* Effect.fail(importPersistenceUnavailable());
      }).pipe(
        Effect.retry({
          times: 4,
          while: (error) => error._tag === "ImportPersistenceUnavailable",
        })
      ),
    beginAcquisitionAttempt: (id) =>
      Effect.gen(function* beginAcquisitionAttempt() {
        const allocated = yield* persistenceEffect(
          () =>
            binding
              .prepare(
                `UPDATE recipe_imports
               SET acquisition_generation = acquisition_generation + 1
               WHERE id = ? AND status = 'acquiring'
                 AND acquisition_generation < 9007199254740991
               RETURNING acquisition_generation, canonical_source_id`
              )
              .bind(id)
              .first() as PromiseLike<{
              readonly acquisition_generation: number;
              readonly canonical_source_id: string;
            } | null>
        );
        if (allocated === null) {
          yield* requireImport(id);
          return yield* Effect.fail(importTransitionRejected());
        }
        return yield* Effect.try({
          catch: importPersistenceCorrupt,
          try: () => ({
            canonicalSourceId: Schema.decodeUnknownSync(SourceCanonicalId)(
              allocated.canonical_source_id
            ),
            generation: Schema.decodeUnknownSync(AcquisitionGenerationSchema)(
              allocated.acquisition_generation
            ),
          }),
        });
      }),
    findByCanonicalIdentity: (identity) =>
      Effect.gen(function* findByCanonicalIdentity() {
        const rows = yield* persistenceEffect(() =>
          database
            .select(importSelection)
            .from(recipeImports)
            .leftJoin(
              importVisualEvidence,
              and(
                eq(importVisualEvidence.importId, recipeImports.id),
                eq(
                  importVisualEvidence.acquisitionGeneration,
                  recipeImports.acquisitionGeneration
                )
              )
            )
            .leftJoin(
              importRecipeExtractions,
              and(
                eq(importRecipeExtractions.importId, recipeImports.id),
                eq(
                  importRecipeExtractions.acquisitionGeneration,
                  recipeImports.acquisitionGeneration
                ),
                eq(importRecipeExtractions.isCurrent, 1)
              )
            )
            .where(
              and(
                eq(recipeImports.sourceKind, identity.kind),
                eq(recipeImports.canonicalSourceId, identity.canonicalId)
              )
            )
            .limit(1)
        );
        return rows[0] === undefined
          ? Option.none()
          : Option.some(yield* decodeStoredImport(rows[0]));
      }),
    findById,
    findRequest: (idempotencyKeyHash) =>
      Effect.gen(function* findRequest() {
        const rows = yield* persistenceEffect(() =>
          database
            .select({
              ...importSelection,
              requestFingerprint: importRequests.requestFingerprint,
              sourceLocatorHash: importRequests.sourceLocatorHash,
            })
            .from(importRequests)
            .innerJoin(
              recipeImports,
              eq(importRequests.importId, recipeImports.id)
            )
            .leftJoin(
              importVisualEvidence,
              and(
                eq(importVisualEvidence.importId, recipeImports.id),
                eq(
                  importVisualEvidence.acquisitionGeneration,
                  recipeImports.acquisitionGeneration
                )
              )
            )
            .leftJoin(
              importRecipeExtractions,
              and(
                eq(importRecipeExtractions.importId, recipeImports.id),
                eq(
                  importRecipeExtractions.acquisitionGeneration,
                  recipeImports.acquisitionGeneration
                ),
                eq(importRecipeExtractions.isCurrent, 1)
              )
            )
            .where(eq(importRequests.idempotencyKeyHash, idempotencyKeyHash))
            .limit(1)
        );
        const [row] = rows;
        if (row === undefined) {
          return Option.none();
        }
        return Option.some(yield* decodeStoredImportRequest(row));
      }),
    isAudioExtractionRecoveryEligible: (id) =>
      Effect.map(
        persistenceEffect(
          () =>
            binding
              .prepare(
                `SELECT 1 AS eligible
                   FROM recipe_imports AS parent
                   JOIN import_transcriptions AS transcription
                     ON transcription.import_id = parent.id
                    AND transcription.acquisition_generation =
                        parent.acquisition_generation
                  WHERE parent.id = ?
                    AND parent.status = 'failed'
                    AND parent.status_code = 'transcription_failed'
                    AND parent.recovery_action = 'retry_later'
                    AND transcription.state = 'failed'
                    AND transcription.failure_code = 'audio_extraction_failed'
                  LIMIT 1`
              )
              .bind(id)
              .first<{ readonly eligible: 1 }>() as PromiseLike<{
              readonly eligible: 1;
            } | null>
        ),
        (row) => row !== null
      ),
    claimAcquisition: (id) =>
      Effect.gen(function* claimAcquisition() {
        const claimedAt = new Date(currentTimeMillis()).toISOString();
        // The exact failed child must be consumed in the claim transaction
        // before its composite foreign key can permit a fresh generation.
        yield* persistenceEffect(() =>
          binding.batch([
            binding
              .prepare(
                `UPDATE recipe_imports
               SET status = 'acquiring', status_code = NULL,
                   recovery_action = NULL, evidence_references_json = '[]',
                   updated_at = ?
               WHERE id = ?
                 AND NOT EXISTS (
                   SELECT 1
                     FROM import_recipe_terminal_projections AS projection
                    WHERE projection.import_id = recipe_imports.id
                      AND projection.acquisition_generation =
                          recipe_imports.acquisition_generation
                 )
                 AND (
                 status = 'queued' OR (
                   status = 'failed'
                   AND status_code = 'acquisition_temporarily_unavailable'
                   AND recovery_action = 'retry_later'
                 ) OR (
                   status = 'failed'
                   AND status_code = 'transcription_failed'
                   AND recovery_action = 'retry_later'
                   AND EXISTS (
                     SELECT 1
                       FROM import_transcriptions AS transcription
                      WHERE transcription.import_id = recipe_imports.id
                        AND transcription.acquisition_generation =
                            recipe_imports.acquisition_generation
                        AND transcription.state = 'failed'
                        AND transcription.failure_code =
                            'audio_extraction_failed'
                   )
                 )
               )`
              )
              .bind(claimedAt, id),
            binding
              .prepare(
                `DELETE FROM import_transcriptions
                  WHERE import_id = ?
                    AND state = 'failed'
                    AND failure_code = 'audio_extraction_failed'
                    AND acquisition_generation = (
                      SELECT acquisition_generation
                        FROM recipe_imports
                       WHERE id = ? AND status = 'acquiring'
                         AND updated_at = ?
                         AND json_array_length(evidence_references_json) = 0
                    )`
              )
              .bind(id, id, claimedAt),
          ])
        );
        const stored = yield* requireImport(id);
        return stored.view.status.kind === "acquiring"
          ? ({ _tag: "Acquiring", import: stored } as const)
          : ({ _tag: "Finished", import: stored } as const);
      }),
    recordAcquired: (id, generation, evidence, acquiredAt) =>
      Effect.gen(function* recordAcquired() {
        if (
          evidence.generation !== generation ||
          !isVerifiedEvidenceFor(id, evidence, acquiredAt) ||
          DateTime.toEpochMillis(evidence.deleteAt) <= currentTimeMillis()
        ) {
          return yield* Effect.fail(importTransitionRejected());
        }
        const references = [
          { kind: "original_media", referenceId: evidence.mediaKey },
          { kind: "acquisition_manifest", referenceId: evidence.manifestKey },
        ];
        yield* persistenceEffect(() =>
          binding
            .prepare(
              `UPDATE recipe_imports
               SET status = 'acquired', status_code = NULL,
                   recovery_action = NULL, evidence_references_json = ?,
                   updated_at = ?
               WHERE id = ? AND status = 'acquiring'
                 AND acquisition_generation = ?`
            )
            .bind(
              JSON.stringify(references),
              DateTime.formatIso(acquiredAt),
              id,
              generation
            )
            .run()
        );
        const stored = yield* requireImport(id);
        if (stored.acquisitionGeneration > generation) {
          return "Superseded" as const;
        }
        if (stored.acquisitionGeneration < generation) {
          return yield* Effect.fail(importTransitionRejected());
        }
        if (
          stored.view.status.kind === "acquired" &&
          JSON.stringify(stored.view.evidence) === JSON.stringify(references) &&
          DateTime.toEpochMillis(stored.view.updatedAt) ===
            DateTime.toEpochMillis(acquiredAt)
        ) {
          return "Recorded" as const;
        }
        return yield* Effect.fail(importTransitionRejected());
      }),
    recordAcquisitionFailure: (id, generation, failure, failedAt) =>
      Effect.gen(function* recordAcquisitionFailure() {
        if (failure.generation !== generation) {
          return yield* Effect.fail(importTransitionRejected());
        }
        const status = failureStatus(failure);
        const { recoveryAction, statusCode } = statusColumns(status);
        yield* persistenceEffect(() =>
          binding
            .prepare(
              `UPDATE recipe_imports
               SET status = ?, status_code = ?, recovery_action = ?,
                   evidence_references_json = '[]', updated_at = ?
               WHERE id = ? AND status = 'acquiring'
                 AND acquisition_generation = ?`
            )
            .bind(
              status.kind,
              statusCode,
              recoveryAction,
              DateTime.formatIso(failedAt),
              id,
              generation
            )
            .run()
        );
        const stored = yield* requireImport(id);
        if (stored.acquisitionGeneration > generation) {
          return "Superseded" as const;
        }
        if (stored.acquisitionGeneration < generation) {
          return yield* Effect.fail(importTransitionRejected());
        }
        if (
          stored.view.status.kind === status.kind &&
          JSON.stringify(stored.view.status) === JSON.stringify(status)
        ) {
          return "Recorded" as const;
        }
        return yield* Effect.fail(importTransitionRejected());
      }),
  };
};
