import {
  Instant,
  RecipeImportIntent,
  RecipeImportIntentId,
  SourceUrl,
} from "@meal-planner/recipe-import-api";
import type {
  RecipeImportIntent as RecipeImportIntentType,
  RecipeImportTimeline as RecipeImportTimelineType,
} from "@meal-planner/recipe-import-api";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { AnyD1Database } from "drizzle-orm/d1";
import { Cause, DateTime, Effect, Exit, Option, Schema } from "effect";

import {
  ImportIntentHistoryRow,
  projectImportIntentHistoryRow,
} from "./import-intent-timeline.js";
import {
  ImportIntentExecutionGeneration,
  ImportIntentTransitionCommand,
  ImportIntentTransitionCommandDigest,
  ImportIntentTransitionMutationConflict,
  ImportIntentTransitionSnapshot,
  applyImportIntentTransition,
} from "./import-intent-transition.js";
import type {
  ImportIntentTransitionMutationId,
  ImportIntentTransitionOutcome,
} from "./import-intent-transition.js";
import {
  CancelImportIntentCommand,
  InitialRecipeImportIntentVersion,
  ImportPrincipal,
  RecipeImportIntentIdempotencyConflict,
  RecipeImportIntentNotFound,
  RecipeImportIntentRedirected,
  RecipeImportIntentTransitionRejected,
  RecipeImportIntentVersionConflict,
} from "./import-intent.js";
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
import {
  EvidenceReference,
  ImportView,
  SourceCanonicalId,
} from "./import.contracts.js";
import type {
  ImportId,
  ImportStatus,
  ImportTimestamp,
} from "./import.contracts.js";
import {
  importCarouselEvidence,
  importRecipeExtractions,
  importVisualEvidence,
  recipeImports,
} from "./import.database-schema.js";
import {
  importPersistenceCorrupt,
  importPersistenceUnavailable,
  importNotFound,
  importTransitionRejected,
} from "./import.errors.js";
import type {
  ClaimAcquisitionResult,
  ImportIntentRepository,
  InternalImportIntentTransitionError,
  ImportRepository,
  ImportTransitionError,
  PendingImportIntentSourceResolution as PendingImportIntentSourceResolutionType,
  StalledImportIntentStartLimit,
  StoredImport,
} from "./import.repository.js";
import {
  RequestFingerprint,
  StalledImportIntentStartCandidate,
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
  correlationId: ImportCorrelationId,
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

const importSelection = {
  acquisitionGeneration: recipeImports.acquisitionGeneration,
  canonicalSourceId: sql<string>`${recipeImports.resolvedCanonicalSourceId}`.as(
    "resolved_canonical_source_id"
  ),
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
  correlationId: recipeImports.correlationId,
  createdAt: recipeImports.createdAt,
  evidenceReferencesJson: recipeImports.evidenceReferencesJson,
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
  recoveryAction: recipeImports.recoveryAction,
  sourceKind: recipeImports.sourceKind,
  status: recipeImports.status,
  statusCode: recipeImports.statusCode,
  updatedAt: recipeImports.updatedAt,
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

const storedImportFromRow = (row: DatabaseImportRow) =>
  Effect.try({
    catch: importPersistenceCorrupt,
    try: (): StoredImport => {
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
      return {
        acquisitionGeneration: row.acquisitionGeneration,
        canonicalSourceId,
        sourceKind: row.sourceKind,
        trace: { correlationId: row.correlationId },
        view,
      };
    },
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
  executionGeneration: ImportIntentExecutionGeneration,
  failedAt: NullableString,
  id: Schema.String,
  intentVersion: Schema.Number,
  publicActivity: Schema.NullOr(Schema.Literals(["working", "retrying"])),
  publicFailureCode: NullableString,
  publicFailureMessage: NullableString,
  publicNextAttemptAt: NullableString,
  publicRecipeId: NullableString,
  publicRecovery: NullableString,
  publicSourceKind: Schema.NullOr(Schema.Literals(["video", "carousel"])),
  publicSourceUrl: NullableString,
  publicSpeech: Schema.NullOr(
    Schema.Literals(["not_started", "processing", "completed", "skipped"])
  ),
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
  publicVisuals: Schema.NullOr(
    Schema.Literals(["not_started", "processing", "completed", "skipped"])
  ),
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
  execution_generation AS executionGeneration,
  failed_at AS failedAt,
  id,
  intent_version AS intentVersion,
  public_activity AS publicActivity,
  public_failure_code AS publicFailureCode,
  public_failure_message AS publicFailureMessage,
  public_next_attempt_at AS publicNextAttemptAt,
  public_recipe_id AS publicRecipeId,
  public_recovery AS publicRecovery,
  public_speech AS publicSpeech,
  public_source_kind AS publicSourceKind,
  public_source_url AS publicSourceUrl,
  public_stage AS publicStage,
  public_stage_started_at AS publicStageStartedAt,
  public_status AS publicStatus,
  public_visuals AS publicVisuals,
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
  if (row.publicActivity !== "retrying") {
    return { type: "working" as const };
  }
  const retrying = { type: "retrying" as const };
  return row.publicNextAttemptAt === null
    ? retrying
    : { ...retrying, nextAttemptAt: row.publicNextAttemptAt };
};

const processingStageFor = (row: DatabaseIntentRow) => {
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
      if (row.publicSpeech === null || row.publicVisuals === null) {
        throw new Error("Analysis component progress is missing");
      }
      return {
        speech: row.publicSpeech,
        startedAt: row.publicStageStartedAt,
        type: "analyzing_evidence",
        visuals: row.publicVisuals,
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

const publicIntentFromRow = (row: DatabaseIntentRow) =>
  Effect.try({
    catch: importPersistenceCorrupt,
    try: (): RecipeImportIntentType => {
      const common = {
        createdAt: row.createdAt,
        id: row.id,
        intentVersion: row.intentVersion,
        links: intentLinks(row.id),
        object: "recipe_import_intent" as const,
        source: publicSourceFor(row),
        updatedAt: row.updatedAt,
      };
      const decode = Schema.decodeUnknownSync(RecipeImportIntent, {
        onExcessProperty: "error",
      });
      switch (row.publicStatus) {
        case "processing": {
          return decode({
            ...common,
            activity: processingActivityFor(row),
            processing: processingStageFor(row),
            status: "processing",
          });
        }
        case "requires_action": {
          if (row.activeActionId === null) {
            throw new Error("Active action identity is missing");
          }
          return decode({
            ...common,
            action: {
              id: row.activeActionId,
              link: `/v1/recipe-import-intents/${row.id}/actions/${row.activeActionId}`,
              type: "review_recipe",
            },
            status: "requires_action",
          });
        }
        case "succeeded": {
          if (row.publicRecipeId === null || row.succeededAt === null) {
            throw new Error("Succeeded result is missing");
          }
          return decode({
            ...common,
            completedAt: row.succeededAt,
            result: { recipeId: row.publicRecipeId },
            status: "succeeded",
          });
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
          return decode({
            ...common,
            error: {
              code: row.publicFailureCode,
              message: row.publicFailureMessage,
              recovery: row.publicRecovery,
            },
            failedAt: row.failedAt,
            status: "failed",
          });
        }
        case "cancelled": {
          if (row.cancelledAt === null) {
            throw new Error("Cancellation time is missing");
          }
          return decode({
            ...common,
            cancelledAt: row.cancelledAt,
            status: "cancelled",
          });
        }
        case "redirected": {
          if (row.redirectedAt === null || row.redirectedToImportId === null) {
            throw new Error("Redirect target is missing");
          }
          return decode({
            ...common,
            redirect: {
              intentId: row.redirectedToImportId,
              link: `/v1/recipe-import-intents/${row.redirectedToImportId}`,
            },
            redirectedAt: row.redirectedAt,
            status: "redirected",
          });
        }
        default: {
          throw new Error("Unsupported public intent status");
        }
      }
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

interface D1ImportRepository extends ImportRepository, ImportIntentRepository {
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

const transitionSnapshotFor = (row: DatabaseIntentRow) =>
  Effect.try({
    catch: importPersistenceCorrupt,
    try: () =>
      Schema.decodeUnknownSync(ImportIntentTransitionSnapshot)({
        activeActionId: row.activeActionId,
        activity: row.publicActivity,
        executionGeneration: row.executionGeneration,
        failedAt: row.failedAt,
        failureCode: row.publicFailureCode,
        failureMessage: row.publicFailureMessage,
        failureRecovery: row.publicRecovery,
        intentVersion: row.intentVersion,
        nextAttemptAt: row.publicNextAttemptAt,
        redirectedAt: row.redirectedAt,
        redirectedToIntentId: row.redirectedToImportId,
        resolvedCanonicalSourceId: row.resolvedCanonicalSourceId,
        sourceKind: row.publicSourceKind,
        sourceUrl: row.publicSourceUrl,
        speech: row.publicSpeech,
        stage: row.publicStage,
        stageStartedAt: row.publicStageStartedAt,
        status: row.publicStatus,
        updatedAt: row.updatedAt,
        visuals: row.publicVisuals,
      }),
  });

const resolvedSourceResult = (
  row: DatabaseIntentRow,
  intent: RecipeImportIntentType,
  applied: boolean
) => {
  if (row.publicStatus === "redirected") {
    return {
      _tag: "Redirected" as const,
      disposition: applied ? ("redirected" as const) : ("replayed" as const),
      intent,
    };
  }
  if (
    row.publicStatus === "processing" &&
    row.publicStage === "acquiring_media" &&
    row.executionGeneration > 0
  ) {
    return {
      _tag: "Owner" as const,
      disposition: applied ? ("claimed" as const) : ("replayed" as const),
      executionGeneration: row.executionGeneration,
      intent,
    };
  }
  return {
    _tag: "NoStart" as const,
    disposition: "replayed" as const,
    intent,
  };
};

const requireMatchingResolvedSource = (
  row: DatabaseIntentRow,
  command: Parameters<ImportIntentRepository["resolveIntentSource"]>[1]
) =>
  row.resolvedCanonicalSourceId === command.canonicalSourceId &&
  row.publicSourceUrl === command.canonicalUrl &&
  row.publicSourceKind === command.sourceKind;

const PendingSourceResolutionRow = Schema.Struct({
  actorId: Schema.String,
  correlationId: ImportCorrelationId,
  executionGeneration: ImportIntentExecutionGeneration,
  householdScopeId: Schema.String,
  intentId: RecipeImportIntentId,
  submittedSourceUrl: Schema.String,
  updatedAt: Schema.String,
});
type PendingSourceResolutionRow = typeof PendingSourceResolutionRow.Type;

const IntentTimelineResults = Schema.Struct({
  results: Schema.Array(ImportIntentHistoryRow),
});

const StalledIntentStartRow = Schema.Struct({
  correlationId: ImportCorrelationId,
  executionGeneration: ImportIntentExecutionGeneration,
  intentId: RecipeImportIntentId,
  updatedAt: Schema.String,
});

const StalledIntentStartResults = Schema.Struct({
  results: Schema.Array(StalledIntentStartRow),
});

const PendingSourceResolutionResults = Schema.Struct({
  results: Schema.Array(PendingSourceResolutionRow),
});

const pendingSourceResolutionFromRow = (row: PendingSourceResolutionRow) =>
  Effect.try({
    catch: importPersistenceCorrupt,
    try: () =>
      ({
        executionGeneration: row.executionGeneration,
        intentId: row.intentId,
        principal: Schema.decodeUnknownSync(ImportPrincipal)({
          actorId: row.actorId,
          householdScopeId: row.householdScopeId,
        }),
        submittedSourceUrl: Schema.decodeUnknownSync(SourceUrl)(
          row.submittedSourceUrl
        ),
        trace: { correlationId: row.correlationId },
        updatedAt: Schema.decodeUnknownSync(Instant)(row.updatedAt),
      }) satisfies PendingImportIntentSourceResolutionType,
  });

export const makeD1ImportRepository = (
  binding: AnyD1Database,
  currentTimeMillis: () => number = Date.now
): D1ImportRepository => {
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
        : Option.some(
            yield* Effect.try({
              catch: importPersistenceCorrupt,
              try: () => Schema.decodeUnknownSync(DatabaseImportRow)(rows[0]),
            }).pipe(Effect.flatMap(storedImportFromRow))
          );
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
      const row = yield* persistenceEffect(() =>
        binding
          .prepare(
            `SELECT ${intentRowSelection}
                 FROM recipe_imports
                WHERE household_scope_id = ? AND id = ?
                LIMIT 1`
          )
          .bind(principal.householdScopeId, intentId)
          .first()
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
        onSome: (row) => Effect.map(publicIntentFromRow(row), Option.some),
      })
    );

  const findPendingSourceResolution = (
    principal: ImportPrincipal,
    intentId: RecipeImportIntentId
  ) =>
    Effect.gen(function* findPendingSourceResolutionEffect() {
      const row = yield* persistenceEffect(() =>
        binding
          .prepare(
            `SELECT actor_id AS actorId, correlation_id AS correlationId,
                      execution_generation AS executionGeneration,
                      household_scope_id AS householdScopeId, id AS intentId,
                      submitted_source_url AS submittedSourceUrl,
                      updated_at AS updatedAt
                 FROM recipe_imports
                WHERE actor_id = ? AND household_scope_id = ? AND id = ?
                  AND public_status = 'processing'
                  AND public_stage = 'resolving_source'
                LIMIT 1`
          )
          .bind(principal.actorId, principal.householdScopeId, intentId)
          .first()
      );
      return row === null
        ? Option.none<PendingImportIntentSourceResolutionType>()
        : Option.some(
            yield* Schema.decodeUnknownEffect(PendingSourceResolutionRow, {
              onExcessProperty: "ignore",
            })(row).pipe(
              Effect.mapError(importPersistenceCorrupt),
              Effect.flatMap(pendingSourceResolutionFromRow)
            )
          );
    });

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

  const requireInternalIntentRow = (intentId: RecipeImportIntentId) =>
    Effect.gen(function* requireInternalIntentRowEffect() {
      const row = yield* persistenceEffect(() =>
        binding
          .prepare(
            `SELECT ${intentRowSelection}
                 FROM recipe_imports
                WHERE id = ?
                LIMIT 1`
          )
          .bind(intentId)
          .first()
      );
      if (row === null) {
        return yield* Effect.fail(new RecipeImportIntentNotFound());
      }
      return yield* Effect.try({
        catch: importPersistenceCorrupt,
        try: () => Schema.decodeUnknownSync(DatabaseIntentRow)(row),
      });
    });

  const recordedTransition = (
    intentId: RecipeImportIntentId,
    mutationId: typeof ImportIntentTransitionMutationId.Type
  ) =>
    Effect.gen(function* recordedTransitionEffect() {
      const row = yield* persistenceEffect(() =>
        binding
          .prepare(
            `SELECT command_digest AS commandDigest
                 FROM recipe_import_intent_history
                WHERE intent_id = ? AND mutation_id = ?
                LIMIT 1`
          )
          .bind(intentId, mutationId)
          .first()
      );
      if (row === null) {
        return Option.none<typeof ImportIntentTransitionCommandDigest.Type>();
      }
      return Option.some(
        yield* Effect.try({
          catch: importPersistenceCorrupt,
          try: () =>
            Schema.decodeUnknownSync(
              Schema.Struct({
                commandDigest: ImportIntentTransitionCommandDigest,
              })
            )(row).commandDigest,
        })
      );
    });

  const replayOutcome = (
    command: ImportIntentTransitionCommand,
    digest: typeof ImportIntentTransitionCommandDigest.Type,
    principal?: ImportPrincipal
  ) =>
    Effect.gen(function* replayOutcomeEffect() {
      if (digest !== command.commandDigest) {
        return yield* Effect.fail(new ImportIntentTransitionMutationConflict());
      }
      const snapshot = yield* transitionSnapshotFor(
        yield* principal === undefined
          ? requireInternalIntentRow(command.intentId)
          : requireIntentRow(principal, command.intentId)
      );
      return {
        _tag: "NoOp",
        reason: "replayed_mutation",
        snapshot,
      } satisfies ImportIntentTransitionOutcome;
    });

  const transitionIntentAttempt = (
    command: ImportIntentTransitionCommand,
    retriesRemaining: number,
    principal?: ImportPrincipal
  ): Effect.Effect<
    ImportIntentTransitionOutcome,
    InternalImportIntentTransitionError
  > =>
    Effect.gen(function* transitionIntentAttemptEffect() {
      const row = yield* principal === undefined
        ? requireInternalIntentRow(command.intentId)
        : requireIntentRow(principal, command.intentId);
      const recorded = yield* recordedTransition(
        command.intentId,
        command.mutationId
      );
      if (Option.isSome(recorded)) {
        return yield* replayOutcome(command, recorded.value, principal);
      }

      const current = yield* transitionSnapshotFor(row);
      const outcome = applyImportIntentTransition(current, command);
      if (outcome._tag !== "Applied") {
        return outcome;
      }
      const next = outcome.snapshot;
      const sourceGuard = (() => {
        switch (command._tag) {
          case "ResolveSource": {
            return {
              bindings: [
                principal?.householdScopeId,
                principal?.householdScopeId,
                command.canonicalSourceId,
                command.intentId,
              ],
              sql: `
                AND household_scope_id = ?
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
                )`,
            };
          }
          case "Redirect": {
            return {
              bindings: [
                principal?.householdScopeId,
                command.redirectedToIntentId,
                principal?.householdScopeId,
                command.canonicalSourceId,
                command.intentId,
              ],
              sql: `
                AND household_scope_id = ?
                AND public_stage = 'resolving_source'
                AND resolved_canonical_source_id IS NULL
                AND ? = (
                  SELECT winner.id
                    FROM recipe_imports AS winner
                   WHERE winner.household_scope_id = ?
                     AND winner.resolved_canonical_source_id = ?
                     AND winner.public_status IN (
                       'processing', 'requires_action', 'succeeded'
                     )
                     AND winner.id <> ?
                   ORDER BY winner.created_at, winner.id
                   LIMIT 1
                )`,
            };
          }
          default: {
            return { bindings: [], sql: "" };
          }
        }
      })();
      if (
        (command._tag === "ResolveSource" || command._tag === "Redirect") &&
        principal === undefined
      ) {
        return yield* Effect.fail(importPersistenceUnavailable());
      }
      const update = yield* Effect.exit(
        persistenceEffect<D1MutationResult>(
          () =>
            binding
              .prepare(
                `UPDATE recipe_imports
                SET resolved_canonical_source_id = ?, public_source_url = ?,
                    public_source_kind = ?, public_status = ?,
                    active_action_id = ?,
                    active_action_version = CASE
                      WHEN ? = 'requires_action' THEN 1 ELSE NULL END,
                    public_stage = ?,
                    public_stage_started_at = ?, public_activity = ?,
                    public_next_attempt_at = ?, public_speech = ?,
                    public_visuals = ?, public_recipe_id = NULL,
                    public_failure_code = ?, public_failure_message = ?,
                    public_recovery = ?, failed_at = ?, cancelled_at = ?,
                    redirected_at = ?, redirected_to_import_id = ?,
                    execution_generation = ?,
                    executor_owner_id = CASE
                      WHEN ? = 'redirected' THEN NULL ELSE executor_owner_id END,
                    transition_mutation_id = ?,
                    transition_command_digest = ?,
                    transition_actor_category = ?,
                    transition_actor_identity_hash = ?,
                    transition_provenance_version = ?, intent_version = ?,
                    updated_at = ?
              WHERE id = ? AND intent_version = ?
                AND execution_generation = ?${sourceGuard.sql}`
              )
              .bind(
                next.resolvedCanonicalSourceId,
                next.sourceUrl,
                next.sourceKind,
                next.status,
                next.activeActionId,
                next.status,
                next.stage,
                next.stageStartedAt === null
                  ? null
                  : encodeInstant(next.stageStartedAt),
                next.activity,
                next.nextAttemptAt === null
                  ? null
                  : encodeInstant(next.nextAttemptAt),
                next.speech,
                next.visuals,
                next.failureCode,
                next.failureMessage,
                next.failureRecovery,
                next.failedAt === null ? null : encodeInstant(next.failedAt),
                command._tag === "Cancel"
                  ? encodeInstant(command.occurredAt)
                  : row.cancelledAt,
                next.redirectedAt === null
                  ? null
                  : encodeInstant(next.redirectedAt),
                next.redirectedToIntentId,
                next.executionGeneration,
                next.status,
                command.mutationId,
                command.commandDigest,
                principal === undefined ||
                  command._tag === "ResolveSource" ||
                  command._tag === "Redirect"
                  ? "system"
                  : "household_member",
                command._tag === "ResolveSource" || command._tag === "Redirect"
                  ? null
                  : (principal?.actorId ?? null),
                next.intentVersion,
                next.intentVersion,
                encodeInstant(next.updatedAt),
                command.intentId,
                current.intentVersion,
                command.executionGeneration,
                ...sourceGuard.bindings
              )
              .run() as PromiseLike<D1MutationResult>
        )
      );
      if (Exit.isSuccess(update) && update.value.meta.changes > 0) {
        return outcome;
      }
      const raced = yield* recordedTransition(
        command.intentId,
        command.mutationId
      );
      if (Option.isSome(raced)) {
        return yield* replayOutcome(command, raced.value, principal);
      }
      if (Exit.isFailure(update)) {
        return yield* Effect.fail(
          Option.getOrThrow(Cause.findErrorOption(update.cause))
        );
      }
      if (retriesRemaining > 0) {
        return yield* transitionIntentAttempt(
          command,
          retriesRemaining - 1,
          principal
        );
      }
      return yield* Effect.fail(importPersistenceUnavailable());
    });

  const transitionIntent = (command: ImportIntentTransitionCommand) =>
    transitionIntentAttempt(command, 1);

  const readIntentTimeline = (
    principal: ImportPrincipal,
    intentId: RecipeImportIntentId
  ) =>
    Effect.gen(function* readIntentTimelineEffect() {
      yield* requireIntentRow(principal, intentId);
      const rawRows = yield* persistenceEffect(() =>
        binding
          .prepare(
            `SELECT action_id AS actionId, occurred_at AS at,
                      event_type AS eventType, failure_code AS failureCode,
                      intent_id AS intentId, intent_version AS intentVersion,
                      public_next_attempt_at AS publicNextAttemptAt,
                      public_source_kind AS publicSourceKind,
                      public_source_url AS publicSourceUrl,
                      public_speech AS publicSpeech,
                      public_stage AS publicStage,
                      public_stage_started_at AS publicStageStartedAt,
                      public_visuals AS publicVisuals, recipe_id AS recipeId,
                      redirected_to_import_id AS redirectedToIntentId
                 FROM recipe_import_intent_history
                WHERE intent_id = ?
                ORDER BY intent_version ASC`
          )
          .bind(intentId)
          .all()
      );
      const rows = yield* Schema.decodeUnknownEffect(IntentTimelineResults, {
        onExcessProperty: "ignore",
      })(rawRows).pipe(Effect.mapError(importPersistenceCorrupt));
      return yield* Effect.try({
        catch: importPersistenceCorrupt,
        try: (): RecipeImportTimelineType => ({
          data: rows.results.flatMap((row) =>
            Option.match(projectImportIntentHistoryRow(row), {
              onNone: () => [],
              onSome: (event) => [event],
            })
          ),
          object: "list",
        }),
      });
    });

  const listStalledIntentStarts = (
    cutoff: Instant,
    limit: StalledImportIntentStartLimit
  ) =>
    Effect.gen(function* listStalledIntentStartsEffect() {
      const rawRows = yield* persistenceEffect(() =>
        binding
          .prepare(
            `SELECT id AS intentId,
                      correlation_id AS correlationId,
                      execution_generation AS executionGeneration,
                      updated_at AS updatedAt
                 FROM recipe_imports
                WHERE public_status = 'processing'
                  AND public_stage = 'acquiring_media'
                  AND execution_generation > 0
                  AND updated_at <= ?
                ORDER BY updated_at ASC, id ASC
                LIMIT ?`
          )
          .bind(encodeInstant(cutoff), limit)
          .all()
      );
      const rows = yield* Schema.decodeUnknownEffect(
        StalledIntentStartResults,
        {
          onExcessProperty: "ignore",
        }
      )(rawRows).pipe(Effect.mapError(importPersistenceCorrupt));
      return yield* Effect.try({
        catch: importPersistenceCorrupt,
        try: () =>
          rows.results.map((candidate) =>
            Schema.decodeUnknownSync(StalledImportIntentStartCandidate, {
              onExcessProperty: "error",
            })({
              executionGeneration: candidate.executionGeneration,
              intentId: candidate.intentId,
              trace: { correlationId: candidate.correlationId },
              updatedAt: candidate.updatedAt,
            })
          ),
      });
    });

  const listStalledSourceResolutions = (
    cutoff: Instant,
    limit: StalledImportIntentStartLimit
  ) =>
    Effect.gen(function* listStalledSourceResolutionsEffect() {
      const rawRows = yield* persistenceEffect(() =>
        binding
          .prepare(
            `SELECT actor_id AS actorId, correlation_id AS correlationId,
                      execution_generation AS executionGeneration,
                      household_scope_id AS householdScopeId, id AS intentId,
                      submitted_source_url AS submittedSourceUrl,
                      updated_at AS updatedAt
                 FROM recipe_imports
                WHERE public_status = 'processing'
                  AND public_stage = 'resolving_source'
                  AND updated_at <= ?
                ORDER BY updated_at ASC, id ASC
                LIMIT ?`
          )
          .bind(encodeInstant(cutoff), limit)
          .all()
      );
      const rows = yield* Schema.decodeUnknownEffect(
        PendingSourceResolutionResults,
        { onExcessProperty: "ignore" }
      )(rawRows).pipe(Effect.mapError(importPersistenceCorrupt));
      return yield* Effect.all(
        rows.results.map(pendingSourceResolutionFromRow)
      );
    });

  const isIntentExecutionCurrent = (
    intentId: RecipeImportIntentId,
    executionGeneration: typeof ImportIntentExecutionGeneration.Type
  ) =>
    Effect.gen(function* isIntentExecutionCurrentEffect() {
      const row = yield* persistenceEffect(() =>
        binding
          .prepare(
            `SELECT 1 AS isCurrent
                 FROM recipe_imports
                WHERE id = ?
                  AND execution_generation = ?
                  AND public_status = 'processing'
                LIMIT 1`
          )
          .bind(intentId, executionGeneration)
          .first()
      );
      if (row === null) {
        return false;
      }
      yield* Effect.try({
        catch: importPersistenceCorrupt,
        try: () =>
          Schema.decodeUnknownSync(
            Schema.Struct({ isCurrent: Schema.Literal(1) }),
            { onExcessProperty: "error" }
          )(row),
      });
      return true;
    });

  const cancelIntent = (rawCommand: CancelImportIntentCommand) =>
    Effect.gen(function* cancelIntentEffect() {
      const command = yield* Effect.try({
        catch: importPersistenceCorrupt,
        try: () =>
          Schema.decodeUnknownSync(CancelImportIntentCommand, {
            onExcessProperty: "error",
          })(Schema.encodeSync(CancelImportIntentCommand)(rawCommand)),
      });
      const currentRow = yield* requireIntentRow(
        command.principal,
        command.intentId
      );
      const currentIntent = yield* publicIntentFromRow(currentRow);
      if (currentIntent.status === "redirected") {
        return yield* Effect.fail(
          new RecipeImportIntentRedirected({
            intent: currentIntent,
            redirect: currentIntent.redirect,
          })
        );
      }
      const transition = yield* Effect.try({
        catch: importPersistenceCorrupt,
        try: () =>
          Schema.decodeUnknownSync(ImportIntentTransitionCommand, {
            onExcessProperty: "error",
          })({
            _tag: "Cancel",
            commandDigest: command.commandDigest,
            executionGeneration: currentRow.executionGeneration,
            expectedIntentVersion: command.expectedIntentVersion,
            intentId: command.intentId,
            mutationId: command.mutationId,
            occurredAt: encodeInstant(command.cancelledAt),
          }),
      });
      const outcome = yield* transitionIntentAttempt(
        transition,
        1,
        command.principal
      );
      if (outcome._tag === "Rejected") {
        return yield* Effect.fail(
          outcome.reason === "intent_version_conflict"
            ? new RecipeImportIntentVersionConflict()
            : new RecipeImportIntentTransitionRejected()
        );
      }
      if (outcome._tag === "NoOp" && outcome.reason !== "replayed_mutation") {
        return yield* Effect.fail(new RecipeImportIntentTransitionRejected());
      }
      return {
        disposition:
          outcome._tag === "NoOp"
            ? ("replayed" as const)
            : ("applied" as const),
        intent: yield* publicIntentFromRow(
          yield* requireIntentRow(command.principal, command.intentId)
        ),
      };
    });

  const findResolvedSourceWinner = (
    principal: ImportPrincipal,
    command: Parameters<ImportIntentRepository["resolveIntentSource"]>[1]
  ) =>
    Effect.gen(function* findResolvedSourceWinnerEffect() {
      const winner = yield* persistenceEffect(() =>
        binding
          .prepare(
            `SELECT id
                 FROM recipe_imports
                WHERE household_scope_id = ?
                  AND resolved_canonical_source_id = ?
                  AND public_status IN (
                    'processing', 'requires_action', 'succeeded'
                  )
                  AND id <> ?
                ORDER BY created_at, id
                LIMIT 1`
          )
          .bind(
            principal.householdScopeId,
            command.canonicalSourceId,
            command.intentId
          )
          .first()
      );
      if (winner === null) {
        return Option.none<RecipeImportIntentId>();
      }
      return Option.some(
        yield* Effect.try({
          catch: importPersistenceCorrupt,
          try: () =>
            Schema.decodeUnknownSync(
              Schema.Struct({ id: RecipeImportIntentId })
            )(winner).id,
        })
      );
    });

  const sourceTransitionCommand = (
    command: Parameters<ImportIntentRepository["resolveIntentSource"]>[1],
    winner: Option.Option<RecipeImportIntentId>,
    executionGeneration: typeof ImportIntentExecutionGeneration.Type
  ) =>
    Effect.try({
      catch: importPersistenceCorrupt,
      try: () =>
        Schema.decodeUnknownSync(ImportIntentTransitionCommand, {
          onExcessProperty: "error",
        })(
          Option.match(winner, {
            onNone: () => ({
              _tag: "ResolveSource" as const,
              canonicalSourceId: command.canonicalSourceId,
              canonicalUrl: command.canonicalUrl,
              commandDigest: command.commandDigest,
              executionGeneration,
              intentId: command.intentId,
              mutationId: command.mutationId,
              occurredAt: encodeInstant(command.resolvedAt),
              sourceKind: command.sourceKind,
            }),
            onSome: (redirectedToIntentId) => ({
              _tag: "Redirect" as const,
              canonicalSourceId: command.canonicalSourceId,
              canonicalUrl: command.canonicalUrl,
              commandDigest: command.commandDigest,
              executionGeneration,
              intentId: command.intentId,
              mutationId: command.mutationId,
              occurredAt: encodeInstant(command.resolvedAt),
              redirectedToIntentId,
              sourceKind: command.sourceKind,
            }),
          })
        ),
    });

  // eslint-disable-next-line sort-keys -- Repository methods stay grouped by request, read, and acquisition lifecycle.
  return {
    admitIntent: (command) =>
      Effect.gen(function* admitIntent() {
        const createdAt = encodeInstant(command.createdAt);
        const [insertResult] = yield* persistenceEffect<
          readonly D1MutationResult[]
        >(
          () =>
            binding.batch([
              binding
                .prepare(
                  `INSERT INTO recipe_imports (
                   acquisition_generation, actor_id, correlation_id, created_at,
                   evidence_references_json, execution_generation,
                   household_scope_id, id, intent_version, public_activity,
                   public_stage, public_stage_started_at, public_status,
                   source_kind, status, submitted_source_url,
                   transition_mutation_id, transition_command_digest,
                   transition_actor_category, transition_actor_identity_hash,
                   transition_provenance_version, updated_at
                 )
                 SELECT 0, ?, ?, ?, '[]', 1, ?, ?, 1, 'working',
                        'resolving_source', ?, 'processing', 'tiktok', 'queued',
                        ?, ?, ?, 'household_member', ?, 1, ?
                  WHERE NOT EXISTS (
                    SELECT 1 FROM import_requests
                     WHERE household_scope_id = ? AND idempotency_key_hash = ?
                  )`
                )
                .bind(
                  command.principal.actorId,
                  command.trace.correlationId,
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
        const winningRequest = yield* persistenceEffect(() =>
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
            .first()
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
    cancelIntent,
    findIntent,
    findPendingSourceResolution,
    isIntentExecutionCurrent,
    listStalledIntentStarts,
    listStalledSourceResolutions,
    readIntentTimeline,
    requireMutableIntent: (principal, intentId) =>
      Effect.gen(function* requireMutableIntent() {
        const row = yield* requireIntentRow(principal, intentId);
        const intent = yield* publicIntentFromRow(row);
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
    transitionIntent,
    resolveIntentSource: (principal, command) =>
      Effect.gen(function* resolveIntentSource() {
        const current = yield* requireIntentRow(principal, command.intentId);
        const recorded = yield* recordedTransition(
          command.intentId,
          command.mutationId
        );
        if (Option.isSome(recorded)) {
          if (recorded.value !== command.commandDigest) {
            return yield* Effect.fail(
              new ImportIntentTransitionMutationConflict()
            );
          }
          if (!requireMatchingResolvedSource(current, command)) {
            return yield* Effect.fail(importPersistenceCorrupt());
          }
          return resolvedSourceResult(
            current,
            yield* publicIntentFromRow(current),
            false
          );
        }
        if (current.resolvedCanonicalSourceId !== null) {
          if (requireMatchingResolvedSource(current, command)) {
            return resolvedSourceResult(
              current,
              yield* publicIntentFromRow(current),
              false
            );
          }
          return yield* Effect.fail(new RecipeImportIntentTransitionRejected());
        }
        if (
          current.publicStatus !== "processing" ||
          current.publicStage !== "resolving_source"
        ) {
          return yield* Effect.fail(new RecipeImportIntentTransitionRejected());
        }

        const applySelectedTransition = (
          winner: Option.Option<RecipeImportIntentId>
        ) =>
          Effect.gen(function* applySelectedSourceTransition() {
            const transition = yield* sourceTransitionCommand(
              command,
              winner,
              current.executionGeneration
            );
            const outcome = yield* transitionIntentAttempt(
              transition,
              0,
              principal
            );
            if (outcome._tag === "Rejected") {
              return yield* Effect.fail(
                new RecipeImportIntentTransitionRejected()
              );
            }
            if (
              outcome._tag === "NoOp" &&
              outcome.reason !== "replayed_mutation"
            ) {
              return yield* Effect.fail(
                new RecipeImportIntentTransitionRejected()
              );
            }
            const settled = yield* requireIntentRow(
              principal,
              command.intentId
            );
            if (!requireMatchingResolvedSource(settled, command)) {
              return yield* Effect.fail(importPersistenceCorrupt());
            }
            return resolvedSourceResult(
              settled,
              yield* publicIntentFromRow(settled),
              outcome._tag === "Applied"
            );
          });

        const selectedWinner = yield* findResolvedSourceWinner(
          principal,
          command
        );
        const firstAttempt = yield* Effect.exit(
          applySelectedTransition(selectedWinner)
        );
        if (Exit.isSuccess(firstAttempt)) {
          return firstAttempt.value;
        }

        const raced = yield* requireIntentRow(principal, command.intentId);
        if (raced.resolvedCanonicalSourceId !== null) {
          if (!requireMatchingResolvedSource(raced, command)) {
            return yield* Effect.fail(
              new RecipeImportIntentTransitionRejected()
            );
          }
          return resolvedSourceResult(
            raced,
            yield* publicIntentFromRow(raced),
            false
          );
        }
        if (
          raced.publicStatus !== "processing" ||
          raced.publicStage !== "resolving_source"
        ) {
          return yield* Effect.fail(new RecipeImportIntentTransitionRejected());
        }

        const racedWinner = yield* findResolvedSourceWinner(principal, command);
        return yield* applySelectedTransition(racedWinner);
      }),
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
               RETURNING acquisition_generation, resolved_canonical_source_id`
              )
              .bind(id)
              .first() as PromiseLike<{
              readonly acquisition_generation: number;
              readonly resolved_canonical_source_id: string;
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
              allocated.resolved_canonical_source_id
            ),
            generation: Schema.decodeUnknownSync(AcquisitionGenerationSchema)(
              allocated.acquisition_generation
            ),
          }),
        });
      }),
    findById,
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
                     FROM import_recipe_executor_terminal_checkpoints AS projection
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
