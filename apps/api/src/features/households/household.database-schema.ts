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

/** Canonical household-local people registry. */
export const householdPeople = sqliteTable("household_people", {
  createdAtEpochMs: integer("created_at_epoch_ms").notNull(),
  displayName: text("display_name").notNull(),
  kind: text("kind", { enum: ["adult", "dependant"] }).notNull(),
  lifecycle: text("lifecycle", { enum: ["active", "archived"] }).notNull(),
  personId: text("person_id").primaryKey(),
  updatedAtEpochMs: integer("updated_at_epoch_ms").notNull(),
  version: integer("version").notNull(),
});

export const householdCreatorAssociationSingletonKey = "creator" as const;

/** Household-singleton creator association with purpose-bound identity linkage. */
export const householdPersonCreatorAssociations = sqliteTable(
  "household_person_creator_associations",
  {
    createdAtEpochMs: integer("created_at_epoch_ms").notNull(),
    linkageSubject: text("linkage_subject").notNull().unique(),
    personId: text("person_id").notNull().unique(),
    singletonKey: text("singleton_key").primaryKey(),
  }
);

/** Purpose-bound invitation association; raw invitations and email never enter Household storage. */
export const householdPersonInvitationAssociations = sqliteTable(
  "household_person_invitation_associations",
  {
    associatedAtEpochMs: integer("associated_at_epoch_ms").notNull(),
    consumedAtEpochMs: integer("consumed_at_epoch_ms"),
    invitationDigest: text("invitation_digest").primaryKey(),
    personId: text("person_id").notNull(),
    recipientLinkageSubject: text("recipient_linkage_subject"),
    state: text("state", { enum: ["pending", "consumed"] }).notNull(),
    version: integer("version").notNull(),
  }
);

/** Household-scoped account link keyed only by a purpose-bound immutable user subject. */
export const householdPersonAccountLinks = sqliteTable(
  "household_person_account_links",
  {
    createdAtEpochMs: integer("created_at_epoch_ms").notNull(),
    linkId: text("link_id").primaryKey(),
    linkageSubject: text("linkage_subject").notNull(),
    personId: text("person_id").notNull(),
    state: text("state", {
      enum: ["linked", "departure_pending", "detached"],
    }).notNull(),
    updatedAtEpochMs: integer("updated_at_epoch_ms").notNull(),
    version: integer("version").notNull(),
  }
);

/** Durable coordinator state for one access-first member departure. */
export const householdMemberDepartureOperations = sqliteTable(
  "household_member_departure_operations",
  {
    actorId: text("actor_id").notNull(),
    createdAtEpochMs: integer("created_at_epoch_ms").notNull(),
    executionGeneration: integer("execution_generation").notNull(),
    lastAttemptAtEpochMs: integer("last_attempt_at_epoch_ms"),
    linkId: text("link_id").notNull(),
    operationId: text("operation_id").primaryKey(),
    personId: text("person_id").notNull(),
    preparationMutationId: text("preparation_mutation_id").notNull(),
    reason: text("reason").notNull(),
    state: text("state", {
      enum: [
        "prepared",
        "revoking_access",
        "revocation_repair_required",
        "access_revoked",
        "finalization_repair_required",
        "completed",
        "cancelled",
      ],
    }).notNull(),
    updatedAtEpochMs: integer("updated_at_epoch_ms").notNull(),
    version: integer("version").notNull(),
  },
  (table) => [
    uniqueIndex("household_departure_preparation_mutation_unique").on(
      table.preparationMutationId
    ),
  ]
);

/** Immutable ordered people lifecycle audit. */
export const householdPersonAudits = sqliteTable("household_person_audits", {
  actorId: text("actor_id").notNull(),
  atEpochMs: integer("at_epoch_ms").notNull(),
  command: text("command", {
    enum: [
      "associate_invitation",
      "bootstrap_creator",
      "cancel_departure",
      "confirm_access_revoked",
      "complete_link",
      "create",
      "archive",
      "finalize_departure",
      "prepare_departure",
      "repair_departure",
      "repair_link",
      "restore",
      "restore_returning_link",
      "retry_departure",
      "start_departure",
    ],
  }).notNull(),
  nextAssociationState: text("next_association_state", {
    enum: [
      "unlinked",
      "invitation_pending",
      "linked",
      "departure_pending",
      "detached",
    ],
  }),
  nextLifecycle: text("next_lifecycle", { enum: ["active", "archived"] }),
  nextVersion: integer("next_version").notNull(),
  operationId: text("operation_id"),
  personId: text("person_id").notNull(),
  previousAssociationState: text("previous_association_state", {
    enum: [
      "unlinked",
      "invitation_pending",
      "linked",
      "departure_pending",
      "detached",
    ],
  }),
  previousLifecycle: text("previous_lifecycle", {
    enum: ["active", "archived"],
  }),
  sequence: integer("sequence").primaryKey({ autoIncrement: true }),
});

/** Cross-command mutation receipt ledger for exact idempotent replay. */
export const householdPersonMutationReceipts = sqliteTable(
  "household_person_mutation_receipts",
  {
    intentDigest: text("intent_digest").notNull(),
    mutationId: text("mutation_id").primaryKey(),
    resultJson: text("result_json").notNull(),
  }
);

/** Canonical household-local batch aggregate; Queue is transport only. */
export const householdImportBatches = sqliteTable("household_import_batches", {
  actorId: text("actor_id").notNull(),
  batchId: text("batch_id").primaryKey(),
  createdAt: text("created_at").notNull(),
  idempotencyKeyDigest: text("idempotency_key_digest").notNull().unique(),
  organizationId: text("organization_id").notNull(),
  requestDigest: text("request_digest").notNull(),
  status: text("status").notNull(),
  updatedAt: text("updated_at").notNull(),
  version: integer("version").notNull(),
});

/** Canonical item membership and lifecycle for one household batch. */
export const householdImportBatchItems = sqliteTable(
  "household_import_batch_items",
  {
    batchId: text("batch_id").notNull(),
    failureCode: text("failure_code"),
    generation: integer("generation").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    intentId: text("intent_id"),
    itemId: text("item_id").primaryKey(),
    ordinal: integer("ordinal").notNull(),
    sourceJson: text("source_json").notNull(),
    status: text("status").notNull(),
  },
  (table) => [
    uniqueIndex("household_import_batch_item_ordinal_unique").on(
      table.batchId,
      table.ordinal
    ),
    uniqueIndex("household_import_batch_item_key_unique").on(
      table.batchId,
      table.idempotencyKey
    ),
  ]
);

/** Transactional queue-dispatch state; alarms retry only committed rows. */
export const householdImportBatchOutbox = sqliteTable(
  "household_import_batch_outbox",
  {
    attempts: integer("attempts").notNull(),
    batchId: text("batch_id").notNull(),
    generation: integer("generation").notNull(),
    itemId: text("item_id").primaryKey(),
    nextAttemptAtEpochMs: integer("next_attempt_at_epoch_ms").notNull(),
    state: text("state").notNull(),
  }
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

/** Durable allocation ledger for create-only R2 acquisition identities. */
export const householdImportAcquisitionAttempts = sqliteTable(
  "household_import_acquisition_attempts",
  {
    acquisitionAttemptGeneration: integer(
      "acquisition_attempt_generation"
    ).notNull(),
    attemptIdentity: text("attempt_identity").primaryKey(),
    attemptOrdinal: integer("attempt_ordinal").notNull(),
    canonicalSourceId: text("canonical_source_id").notNull(),
    claimedAt: text("claimed_at").notNull(),
    executionGeneration: integer("execution_generation").notNull(),
    intentId: text("intent_id").notNull(),
  },
  (table) => [
    uniqueIndex("household_import_acquisition_attempt_ordinal_unique").on(
      table.intentId,
      table.executionGeneration,
      table.attemptOrdinal
    ),
    uniqueIndex("household_import_acquisition_generation_unique").on(
      table.intentId,
      table.acquisitionAttemptGeneration
    ),
  ]
);

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
