import { sql } from "drizzle-orm";
import {
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const householdMeta = sqliteTable("household_meta", {
  createdAtEpochMs: integer("created_at_epoch_ms").notNull(),
  organizationId: text("organization_id").notNull().unique(),
  singletonKey: text("singleton_key").primaryKey(),
});

export const householdMealPlans = sqliteTable("household_meal_plans", {
  draftId: text("draft_id").primaryKey(),
  planJson: text("plan_json").notNull(),
  requestFingerprintDigest: text("request_fingerprint_digest").notNull(),
  revision: integer("revision").notNull(),
});

export const householdMealPlanMutationReceipts = sqliteTable(
  "household_meal_plan_mutation_receipts",
  {
    draftId: text("draft_id").notNull(),
    mutationFingerprint: text("mutation_fingerprint").notNull(),
    mutationId: text("mutation_id").notNull(),
    resultJson: text("result_json").notNull(),
  },
  (table) => [primaryKey({ columns: [table.draftId, table.mutationId] })]
);

/**
 * Canonical admission and dispatch ledger for household-owned recipe imports.
 * Workflow execution is downstream of this committed local authority.
 */
export const householdImportWorkflowAdmissions = sqliteTable(
  "household_import_workflow_admissions",
  {
    commandDigest: text("command_digest").notNull(),
    committedAtEpochMs: integer("committed_at_epoch_ms").notNull(),
    committedResultJson: text("committed_result_json").notNull(),
    dispatchId: text("dispatch_id").notNull().unique(),
    executionGeneration: integer("execution_generation").notNull(),
    importId: text("import_id").notNull(),
    mutationId: text("mutation_id").primaryKey(),
    originalTraceJson: text("original_trace_json"),
    workflowIdentity: text("workflow_identity").notNull().unique(),
  },
  (table) => [
    uniqueIndex("household_import_workflow_execution_unique").on(
      table.importId,
      table.executionGeneration
    ),
  ]
);

export const householdOutbox = sqliteTable("household_outbox", {
  attempts: integer("attempts").notNull(),
  dispatchId: text("dispatch_id").primaryKey(),
  exhaustedAtEpochMs: integer("exhausted_at_epoch_ms"),
  nextAttemptAtEpochMs: integer("next_attempt_at_epoch_ms").notNull(),
  payloadJson: text("payload_json").notNull(),
  purpose: text("purpose").notNull(),
  state: text("state").notNull(),
});

/** Compact current acquisition result; immutable media and manifests stay in R2. */
export const householdImportEvidenceExecutions = sqliteTable(
  "household_import_evidence_executions",
  {
    acquisitionAttemptGeneration: integer(
      "acquisition_attempt_generation"
    ).notNull(),
    acquisitionJson: text("acquisition_json").notNull(),
    commandDigest: text("command_digest").notNull(),
    committedAt: text("committed_at").notNull(),
    executionGeneration: integer("execution_generation").notNull(),
    intentId: text("intent_id").notNull(),
    resultJson: text("result_json").notNull(),
    status: text("status").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.intentId, table.executionGeneration] }),
  ]
);

/** Integrity metadata for household/generation-fenced R2 objects. */
export const householdEvidenceReferences = sqliteTable(
  "household_evidence_references",
  {
    availability: text("availability").notNull().default("available"),
    byteLength: integer("byte_length").notNull(),
    deleteAt: text("delete_at").notNull(),
    executionGeneration: integer("execution_generation").notNull(),
    intentId: text("intent_id").notNull(),
    kind: text("kind").notNull(),
    objectKey: text("object_key").notNull(),
    observationOrdinal: integer("observation_ordinal").notNull().default(0),
    observedAt: text("observed_at"),
    observedEventAction: text("observed_event_action", {
      enum: [
        "CompleteMultipartUpload",
        "CopyObject",
        "DeleteObject",
        "IntegrityProbe",
        "LifecycleDeletion",
        "PutObject",
      ],
    }),
    observedEventTime: text("observed_event_time"),
    ordinal: integer("ordinal").notNull(),
    sha256: text("sha256").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.intentId, table.executionGeneration, table.ordinal],
    }),
    uniqueIndex("household_evidence_reference_kind_unique").on(
      table.intentId,
      table.executionGeneration,
      table.kind
    ),
  ]
);

export const householdEvidenceMutationReceipts = sqliteTable(
  "household_evidence_mutation_receipts",
  {
    commandDigest: text("command_digest").notNull(),
    mutationId: text("mutation_id").primaryKey(),
    resultJson: text("result_json").notNull(),
  }
);

/** Provider-free stage ledger; provider payload bytes remain outside SQLite. */
export const householdEvidenceStageExecutions = sqliteTable(
  "household_evidence_stage_executions",
  {
    acquisitionAttemptGeneration: integer(
      "acquisition_attempt_generation"
    ).notNull(),
    claimJson: text("claim_json"),
    committedAt: text("committed_at").notNull(),
    completedAt: text("completed_at"),
    dispatchId: text("dispatch_id").notNull(),
    executionGeneration: integer("execution_generation").notNull(),
    failureCode: text("failure_code"),
    inputFingerprint: text("input_fingerprint").notNull(),
    intentId: text("intent_id").notNull(),
    resultJson: text("result_json"),
    stage: text("stage").notNull(),
    startedAt: text("started_at").notNull(),
    state: text("state").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.intentId, table.executionGeneration, table.stage],
    }),
  ]
);

/** Immutable household authority for terminal provider-stage identities. */
export const importTerminalCheckpoints = sqliteTable(
  "import_terminal_checkpoints",
  {
    completedAt: text("completed_at").notNull(),
    executionGeneration: integer("execution_generation").notNull(),
    failureCode: text("failure_code").notNull(),
    inputFingerprint: text("input_fingerprint").notNull(),
    intentId: text("intent_id").notNull(),
    ownershipId: text("ownership_id").notNull(),
    stage: text("stage", {
      enum: ["extraction", "speech", "visual"],
    }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.intentId,
        table.executionGeneration,
        table.stage,
        table.ownershipId,
      ],
    }),
  ]
);

/** Canonical household recipe-recovery ancestry and restart authority. */
export const importRecipeRecoveryAttempts = sqliteTable(
  "import_recipe_recovery_attempts",
  {
    acquisitionAttemptGeneration: integer(
      "acquisition_attempt_generation"
    ).notNull(),
    createdAt: text("created_at").notNull(),
    currentDispatchId: text("current_dispatch_id").notNull(),
    currentExtractionFingerprint: text(
      "current_extraction_fingerprint"
    ).notNull(),
    evidenceFingerprint: text("evidence_fingerprint").notNull(),
    executionGeneration: integer("execution_generation").notNull(),
    intentId: text("intent_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    predecessorDispatchId: text("predecessor_dispatch_id").notNull(),
    predecessorExtractionFingerprint: text(
      "predecessor_extraction_fingerprint"
    ).notNull(),
    rootDispatchId: text("root_dispatch_id").notNull(),
    rootExtractionFingerprint: text("root_extraction_fingerprint").notNull(),
    sourceMediaSha256: text("source_media_sha256").notNull(),
    terminalCheckpointCompletedAt: text(
      "terminal_checkpoint_completed_at"
    ).notNull(),
    transcriptSha256: text("transcript_sha256").notNull(),
    visualManifestSha256: text("visual_manifest_sha256").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.intentId, table.executionGeneration, table.ordinal],
    }),
    uniqueIndex("import_recipe_recovery_current_dispatch_unique").on(
      table.intentId,
      table.executionGeneration,
      table.currentDispatchId
    ),
    uniqueIndex("import_recipe_recovery_current_extraction_unique").on(
      table.intentId,
      table.executionGeneration,
      table.currentExtractionFingerprint
    ),
  ]
);

export const householdLiveRecipeImportStatuses = [
  "processing",
  "requires_action",
  "succeeded",
] as const;

export const householdRecipeImports = sqliteTable(
  "household_recipe_imports",
  {
    actionJson: text("action_json"),
    actorId: text("actor_id").notNull(),
    canonicalSourceId: text("canonical_source_id"),
    createdAt: text("created_at").notNull(),
    evidenceFingerprint: text("evidence_fingerprint"),
    executionGeneration: integer("execution_generation").notNull(),
    extractionFingerprint: text("extraction_fingerprint"),
    intentId: text("intent_id").primaryKey(),
    intentJson: text("intent_json").notNull(),
    recipeId: text("recipe_id"),
    reviewJson: text("review_json"),
    sourceKind: text("source_kind", { enum: ["video", "carousel"] }),
    status: text("status").notNull(),
    submittedSourceUrl: text("submitted_source_url").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("household_recipe_imports_recipe_unique").on(table.recipeId),
    uniqueIndex("household_recipe_imports_live_source_unique")
      .on(table.canonicalSourceId)
      .where(
        // The object is already one household, so canonical source ownership
        // is physically tenant-local.
        sql`${table.canonicalSourceId} IS NOT NULL AND ${table.status} IN ('processing', 'requires_action', 'succeeded')`
      ),
  ]
);

export const householdRecipeImportRequests = sqliteTable(
  "household_recipe_import_requests",
  {
    idempotencyKeyDigest: text("idempotency_key_digest").primaryKey(),
    intentId: text("intent_id").notNull(),
    requestDigest: text("request_digest").notNull(),
  }
);

export const householdRecipeImportTimeline = sqliteTable(
  "household_recipe_import_timeline",
  {
    eventJson: text("event_json").notNull(),
    intentId: text("intent_id").notNull(),
    intentVersion: integer("intent_version").notNull(),
  },
  (table) => [primaryKey({ columns: [table.intentId, table.intentVersion] })]
);

export const householdRecipeImportMutationReceipts = sqliteTable(
  "household_recipe_import_mutation_receipts",
  {
    commandDigest: text("command_digest").notNull(),
    mutationId: text("mutation_id").primaryKey(),
    resultJson: text("result_json").notNull(),
  }
);

export const householdRecipeReviewCorrections = sqliteTable(
  "household_recipe_review_corrections",
  {
    actionVersion: integer("action_version").notNull(),
    correctionJson: text("correction_json").notNull(),
    intentId: text("intent_id").notNull(),
    ordinal: integer("ordinal").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.intentId, table.actionVersion, table.ordinal],
    }),
  ]
);

export const householdRecipeReviewTransitions = sqliteTable(
  "household_recipe_review_transitions",
  {
    intentId: text("intent_id").notNull(),
    transitionJson: text("transition_json").notNull(),
    version: integer("version").notNull(),
  },
  (table) => [primaryKey({ columns: [table.intentId, table.version] })]
);

export const householdRecipes = sqliteTable("household_recipes", {
  importId: text("import_id").notNull().unique(),
  planningRecipeJson: text("planning_recipe_json").notNull(),
  publicRecipeJson: text("public_recipe_json").notNull(),
  publishedAt: text("published_at").notNull(),
  recipeId: text("recipe_id").primaryKey(),
  version: integer("version").notNull(),
});
