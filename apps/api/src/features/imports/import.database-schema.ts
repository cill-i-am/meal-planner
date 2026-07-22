import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const recipeImports = sqliteTable(
  "recipe_imports",
  {
    acquisitionGeneration: integer("acquisition_generation")
      .notNull()
      .default(0),
    canonicalSourceId: text("canonical_source_id").notNull(),
    compatibilityFingerprint: text("compatibility_fingerprint").notNull(),
    createdAt: text("created_at").notNull(),
    evidenceReferencesJson: text("evidence_references_json").notNull(),
    id: text("id").notNull(),
    recoveryAction: text("recovery_action", {
      enum: [
        "check_source_visibility",
        "retry_later",
        "submit_supported_public_video",
      ],
    }),
    sourceKind: text("source_kind", { enum: ["tiktok"] }).notNull(),
    status: text("status", {
      enum: [
        "acquired",
        "acquiring",
        "failed",
        "queued",
        "transcribed",
        "transcribing",
        "unsupported",
      ],
    }).notNull(),
    statusCode: text("status_code", {
      enum: [
        "acquisition_temporarily_unavailable",
        "invalid_or_unsupported_media",
        "private_or_unavailable",
        "transcription_failed",
        "unsupported_post_type",
      ],
    }),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    uniqueIndex("recipe_imports_canonical_identity_unique").on(
      table.sourceKind,
      table.canonicalSourceId
    ),
    uniqueIndex("recipe_imports_id_generation_unique").on(
      table.id,
      table.acquisitionGeneration
    ),
    check(
      "recipe_imports_evidence_json_check",
      sql`json_valid(${table.evidenceReferencesJson})`
    ),
    check(
      "recipe_imports_acquisition_generation_check",
      sql`typeof(${table.acquisitionGeneration}) = 'integer' AND ${table.acquisitionGeneration} >= 0 AND ${table.acquisitionGeneration} <= 9007199254740991`
    ),
    check(
      "recipe_imports_status_details_check",
      sql`(
        ${table.status} = 'queued'
        AND ${table.statusCode} IS NULL
        AND ${table.recoveryAction} IS NULL
        AND json_array_length(${table.evidenceReferencesJson}) = 0
      ) OR (
        ${table.status} = 'acquiring'
        AND ${table.statusCode} IS NULL
        AND ${table.recoveryAction} IS NULL
        AND json_array_length(${table.evidenceReferencesJson}) = 0
      ) OR (
        ${table.status} = 'acquired'
        AND ${table.statusCode} IS NULL
        AND ${table.recoveryAction} IS NULL
        AND json_array_length(${table.evidenceReferencesJson}) = 2
        AND json_extract(${table.evidenceReferencesJson}, '$[0].kind') = 'original_media'
        AND json_extract(${table.evidenceReferencesJson}, '$[0].referenceId') = 'imports/' || ${table.id} || '/acquisition/v1/generations/' || ${table.acquisitionGeneration} || '/original.mp4'
        AND json_extract(${table.evidenceReferencesJson}, '$[1].kind') = 'acquisition_manifest'
        AND json_extract(${table.evidenceReferencesJson}, '$[1].referenceId') = 'imports/' || ${table.id} || '/acquisition/v1/generations/' || ${table.acquisitionGeneration} || '/manifest.json'
      ) OR (
        ${table.status} = 'transcribing'
        AND ${table.statusCode} IS NULL
        AND ${table.recoveryAction} IS NULL
        AND json_array_length(${table.evidenceReferencesJson}) = 2
        AND json_extract(${table.evidenceReferencesJson}, '$[0].kind') = 'original_media'
        AND json_extract(${table.evidenceReferencesJson}, '$[0].referenceId') = 'imports/' || ${table.id} || '/acquisition/v1/generations/' || ${table.acquisitionGeneration} || '/original.mp4'
        AND json_extract(${table.evidenceReferencesJson}, '$[1].kind') = 'acquisition_manifest'
        AND json_extract(${table.evidenceReferencesJson}, '$[1].referenceId') = 'imports/' || ${table.id} || '/acquisition/v1/generations/' || ${table.acquisitionGeneration} || '/manifest.json'
      ) OR (
        ${table.status} = 'transcribed'
        AND ${table.statusCode} IS NULL
        AND ${table.recoveryAction} IS NULL
        AND json_array_length(${table.evidenceReferencesJson}) = 3
        AND json_extract(${table.evidenceReferencesJson}, '$[0].kind') = 'original_media'
        AND json_extract(${table.evidenceReferencesJson}, '$[0].referenceId') = 'imports/' || ${table.id} || '/acquisition/v1/generations/' || ${table.acquisitionGeneration} || '/original.mp4'
        AND json_extract(${table.evidenceReferencesJson}, '$[1].kind') = 'acquisition_manifest'
        AND json_extract(${table.evidenceReferencesJson}, '$[1].referenceId') = 'imports/' || ${table.id} || '/acquisition/v1/generations/' || ${table.acquisitionGeneration} || '/manifest.json'
        AND json_extract(${table.evidenceReferencesJson}, '$[2].kind') = 'speech_transcript'
        AND json_extract(${table.evidenceReferencesJson}, '$[2].referenceId') = 'imports/' || ${table.id} || '/transcription/v1/generations/' || ${table.acquisitionGeneration} || '/transcript.json'
      ) OR (
        ${table.status} = 'failed'
        AND ${table.statusCode} = 'private_or_unavailable'
        AND ${table.recoveryAction} = 'check_source_visibility'
        AND json_array_length(${table.evidenceReferencesJson}) = 0
      ) OR (
        ${table.status} = 'failed'
        AND ${table.statusCode} = 'acquisition_temporarily_unavailable'
        AND ${table.recoveryAction} = 'retry_later'
        AND json_array_length(${table.evidenceReferencesJson}) = 0
      ) OR (
        ${table.status} = 'failed'
        AND ${table.statusCode} = 'invalid_or_unsupported_media'
        AND ${table.recoveryAction} = 'submit_supported_public_video'
        AND json_array_length(${table.evidenceReferencesJson}) = 0
      ) OR (
        ${table.status} = 'failed'
        AND ${table.statusCode} = 'transcription_failed'
        AND ${table.recoveryAction} = 'retry_later'
        AND json_array_length(${table.evidenceReferencesJson}) = 2
        AND json_extract(${table.evidenceReferencesJson}, '$[0].kind') = 'original_media'
        AND json_extract(${table.evidenceReferencesJson}, '$[0].referenceId') = 'imports/' || ${table.id} || '/acquisition/v1/generations/' || ${table.acquisitionGeneration} || '/original.mp4'
        AND json_extract(${table.evidenceReferencesJson}, '$[1].kind') = 'acquisition_manifest'
        AND json_extract(${table.evidenceReferencesJson}, '$[1].referenceId') = 'imports/' || ${table.id} || '/acquisition/v1/generations/' || ${table.acquisitionGeneration} || '/manifest.json'
      ) OR (
        ${table.status} = 'unsupported'
        AND ${table.statusCode} = 'unsupported_post_type'
        AND ${table.recoveryAction} = 'submit_supported_public_video'
        AND json_array_length(${table.evidenceReferencesJson}) = 0
      )`
    ),
  ]
);

export const importRequests = sqliteTable(
  "import_requests",
  {
    createdAt: text("created_at").notNull(),
    idempotencyKeyHash: text("idempotency_key_hash").notNull().primaryKey(),
    importId: text("import_id").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    sourceLocatorHash: text("source_locator_hash").notNull(),
  },
  (table) => [index("import_requests_import_id_index").on(table.importId)]
);

export const importTranscriptions = sqliteTable(
  "import_transcriptions",
  {
    acquisitionGeneration: integer("acquisition_generation").notNull(),
    completedAt: text("completed_at"),
    costCertainty: text("cost_certainty", { enum: ["estimated", "known"] }),
    costCurrency: text("cost_currency", { enum: ["USD"] }),
    createdAt: text("created_at").notNull(),
    detectedLanguage: text("detected_language"),
    dispatchId: text("dispatch_id").notNull(),
    estimatedCostMicroUsd: integer("estimated_cost_micro_usd"),
    failureCode: text("failure_code", {
      enum: [
        "audio_extraction_failed",
        "outcome_unknown",
        "source_evidence_invalid",
        "transcription_failed",
        "transcript_evidence_failed",
      ],
    }),
    importId: text("import_id").notNull(),
    model: text("model"),
    provider: text("provider"),
    segmentsCount: integer("segments_count"),
    sourceMediaSha256: text("source_media_sha256").notNull(),
    state: text("state", {
      enum: ["dispatching", "failed", "transcribed"],
    }).notNull(),
    transcriptKey: text("transcript_key"),
    transcriptSha256: text("transcript_sha256"),
    updatedAt: text("updated_at").notNull(),
    usageAudioMilliseconds: integer("usage_audio_milliseconds"),
    usageInputBytes: integer("usage_input_bytes"),
  },
  (table) => [
    primaryKey({ columns: [table.importId, table.acquisitionGeneration] }),
    foreignKey({
      columns: [table.importId, table.acquisitionGeneration],
      foreignColumns: [recipeImports.id, recipeImports.acquisitionGeneration],
      name: "import_transcriptions_import_generation_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    uniqueIndex("import_transcriptions_dispatch_id_unique").on(
      table.dispatchId
    ),
    index("import_transcriptions_state_updated_index").on(
      table.state,
      table.updatedAt
    ),
    check(
      "import_transcriptions_generation_check",
      sql`typeof(${table.acquisitionGeneration}) = 'integer' AND ${table.acquisitionGeneration} >= 0 AND ${table.acquisitionGeneration} <= 9007199254740991`
    ),
    check(
      "import_transcriptions_dispatch_id_check",
      sql`length(${table.dispatchId}) BETWEEN 1 AND 100`
    ),
    check(
      "import_transcriptions_source_sha_check",
      sql`length(${table.sourceMediaSha256}) = 64 AND ${table.sourceMediaSha256} NOT GLOB '*[^0-9a-f]*'`
    ),
    check(
      "import_transcriptions_state_check",
      sql`(
        ${table.state} = 'dispatching'
        AND ${table.transcriptKey} IS NULL
        AND ${table.transcriptSha256} IS NULL
        AND ${table.provider} IS NULL
        AND ${table.model} IS NULL
        AND ${table.detectedLanguage} IS NULL
        AND ${table.usageAudioMilliseconds} IS NULL
        AND ${table.usageInputBytes} IS NULL
        AND ${table.estimatedCostMicroUsd} IS NULL
        AND ${table.costCurrency} IS NULL
        AND ${table.costCertainty} IS NULL
        AND ${table.segmentsCount} IS NULL
        AND ${table.failureCode} IS NULL
        AND ${table.completedAt} IS NULL
      ) OR (
        ${table.state} = 'transcribed'
        AND ${table.transcriptKey} IS NOT NULL
        AND length(${table.transcriptSha256}) = 64
        AND ${table.transcriptSha256} NOT GLOB '*[^0-9a-f]*'
        AND length(${table.provider}) BETWEEN 1 AND 64
        AND length(${table.model}) BETWEEN 1 AND 64
        AND ${table.detectedLanguage} GLOB '[a-z][a-z]'
        AND typeof(${table.usageAudioMilliseconds}) = 'integer'
        AND ${table.usageAudioMilliseconds} > 0
        AND typeof(${table.usageInputBytes}) = 'integer'
        AND ${table.usageInputBytes} > 0
        AND typeof(${table.estimatedCostMicroUsd}) = 'integer'
        AND ${table.estimatedCostMicroUsd} >= 0
        AND ${table.costCurrency} = 'USD'
        AND ${table.costCertainty} IN ('estimated', 'known')
        AND typeof(${table.segmentsCount}) = 'integer'
        AND ${table.segmentsCount} > 0
        AND ${table.failureCode} IS NULL
        AND ${table.completedAt} IS NOT NULL
      ) OR (
        ${table.state} = 'failed'
        AND ${table.transcriptKey} IS NULL
        AND ${table.transcriptSha256} IS NULL
        AND ${table.provider} IS NULL
        AND ${table.model} IS NULL
        AND ${table.detectedLanguage} IS NULL
        AND ${table.usageAudioMilliseconds} IS NULL
        AND ${table.usageInputBytes} IS NULL
        AND ${table.estimatedCostMicroUsd} IS NULL
        AND ${table.costCurrency} IS NULL
        AND ${table.costCertainty} IS NULL
        AND ${table.segmentsCount} IS NULL
        AND ${table.failureCode} IN (
          'audio_extraction_failed', 'outcome_unknown',
          'source_evidence_invalid', 'transcription_failed',
          'transcript_evidence_failed'
        )
        AND ${table.completedAt} IS NOT NULL
      )`
    ),
  ]
);

export const importVisualEvidence = sqliteTable(
  "import_visual_evidence",
  {
    acquisitionGeneration: integer("acquisition_generation").notNull(),
    completedAt: text("completed_at"),
    costCertainty: text("cost_certainty", { enum: ["estimated", "known"] }),
    costCurrency: text("cost_currency", { enum: ["USD"] }),
    createdAt: text("created_at").notNull(),
    dispatchId: text("dispatch_id").notNull(),
    estimatedCostMicroUsd: integer("estimated_cost_micro_usd"),
    failureCode: text("failure_code", {
      enum: [
        "frame_evidence_failed",
        "frame_sampling_failed",
        "outcome_unknown",
        "source_evidence_invalid",
        "visual_evidence_failed",
        "visual_extraction_failed",
      ],
    }),
    importId: text("import_id").notNull(),
    inputBytes: integer("input_bytes"),
    inputFrames: integer("input_frames"),
    manifestKey: text("manifest_key"),
    manifestSha256: text("manifest_sha256"),
    model: text("model"),
    modelCalls: integer("model_calls"),
    observationsCount: integer("observations_count"),
    outcome: text("outcome", {
      enum: ["empty", "found", "low_confidence"],
    }),
    provider: text("provider"),
    sourceMediaSha256: text("source_media_sha256").notNull(),
    state: text("state", {
      enum: ["completed", "dispatching", "failed"],
    }).notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.importId, table.acquisitionGeneration] }),
    foreignKey({
      columns: [table.importId, table.acquisitionGeneration],
      foreignColumns: [recipeImports.id, recipeImports.acquisitionGeneration],
      name: "import_visual_evidence_import_generation_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    uniqueIndex("import_visual_evidence_dispatch_id_unique").on(
      table.dispatchId
    ),
    index("import_visual_evidence_state_updated_index").on(
      table.state,
      table.updatedAt
    ),
    check(
      "import_visual_evidence_generation_check",
      sql`typeof(${table.acquisitionGeneration}) = 'integer' AND ${table.acquisitionGeneration} >= 0 AND ${table.acquisitionGeneration} <= 9007199254740991`
    ),
    check(
      "import_visual_evidence_dispatch_id_check",
      sql`length(${table.dispatchId}) BETWEEN 1 AND 100`
    ),
    check(
      "import_visual_evidence_source_sha_check",
      sql`length(${table.sourceMediaSha256}) = 64 AND ${table.sourceMediaSha256} NOT GLOB '*[^0-9a-f]*'`
    ),
    check(
      "import_visual_evidence_state_check",
      sql`(
        ${table.state} = 'dispatching'
        AND ${table.outcome} IS NULL
        AND ${table.manifestKey} IS NULL
        AND ${table.manifestSha256} IS NULL
        AND ${table.provider} IS NULL
        AND ${table.model} IS NULL
        AND ${table.inputFrames} IS NULL
        AND ${table.inputBytes} IS NULL
        AND ${table.modelCalls} IS NULL
        AND ${table.estimatedCostMicroUsd} IS NULL
        AND ${table.costCurrency} IS NULL
        AND ${table.costCertainty} IS NULL
        AND ${table.observationsCount} IS NULL
        AND ${table.failureCode} IS NULL
        AND ${table.completedAt} IS NULL
      ) OR (
        ${table.state} = 'completed'
        AND ${table.outcome} IN ('empty', 'found', 'low_confidence')
        AND ${table.manifestKey} IS NOT NULL
        AND length(${table.manifestSha256}) = 64
        AND ${table.manifestSha256} NOT GLOB '*[^0-9a-f]*'
        AND length(${table.provider}) BETWEEN 1 AND 64
        AND length(${table.model}) BETWEEN 1 AND 64
        AND typeof(${table.inputFrames}) = 'integer'
        AND ${table.inputFrames} BETWEEN 1 AND 12
        AND typeof(${table.inputBytes}) = 'integer'
        AND ${table.inputBytes} > 0
        AND typeof(${table.modelCalls}) = 'integer'
        AND ${table.modelCalls} = 1
        AND typeof(${table.estimatedCostMicroUsd}) = 'integer'
        AND ${table.estimatedCostMicroUsd} >= 0
        AND ${table.costCurrency} = 'USD'
        AND ${table.costCertainty} IN ('estimated', 'known')
        AND typeof(${table.observationsCount}) = 'integer'
        AND ${table.observationsCount} >= 0
        AND ${table.failureCode} IS NULL
        AND ${table.completedAt} IS NOT NULL
      ) OR (
        ${table.state} = 'failed'
        AND ${table.outcome} IS NULL
        AND ${table.manifestKey} IS NULL
        AND ${table.manifestSha256} IS NULL
        AND ${table.provider} IS NULL
        AND ${table.model} IS NULL
        AND ${table.inputFrames} IS NULL
        AND ${table.inputBytes} IS NULL
        AND ${table.modelCalls} IS NULL
        AND ${table.estimatedCostMicroUsd} IS NULL
        AND ${table.costCurrency} IS NULL
        AND ${table.costCertainty} IS NULL
        AND ${table.observationsCount} IS NULL
        AND ${table.failureCode} IN (
          'frame_evidence_failed', 'frame_sampling_failed', 'outcome_unknown',
          'source_evidence_invalid', 'visual_evidence_failed',
          'visual_extraction_failed'
        )
        AND ${table.completedAt} IS NOT NULL
      )`
    ),
  ]
);

export const importCarouselEvidence = sqliteTable(
  "import_carousel_evidence",
  {
    acquisitionGeneration: integer("acquisition_generation").notNull(),
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull(),
    descriptorFingerprint: text("descriptor_fingerprint").notNull(),
    dispatchId: text("dispatch_id").notNull(),
    failureCode: text("failure_code", {
      enum: [
        "carousel_inaccessible",
        "carousel_layout_drift",
        "carousel_partial",
      ],
    }),
    imageCount: integer("image_count"),
    importId: text("import_id").notNull(),
    manifestKey: text("manifest_key"),
    manifestSha256: text("manifest_sha256"),
    recoveryAction: text("recovery_action", {
      enum: [
        "check_source_visibility",
        "request_complete_carousel",
        "update_carousel_adapter",
      ],
    }),
    state: text("state", {
      enum: ["completed", "dispatching", "failed"],
    }).notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.importId, table.acquisitionGeneration] }),
    foreignKey({
      columns: [table.importId, table.acquisitionGeneration],
      foreignColumns: [recipeImports.id, recipeImports.acquisitionGeneration],
      name: "import_carousel_evidence_import_generation_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    uniqueIndex("import_carousel_evidence_dispatch_id_unique").on(
      table.dispatchId
    ),
    index("import_carousel_evidence_state_updated_index").on(
      table.state,
      table.updatedAt
    ),
    check(
      "import_carousel_evidence_generation_check",
      sql`typeof(${table.acquisitionGeneration}) = 'integer' AND ${table.acquisitionGeneration} >= 0 AND ${table.acquisitionGeneration} <= 9007199254740991`
    ),
    check(
      "import_carousel_evidence_identity_check",
      sql`length(${table.descriptorFingerprint}) = 64 AND ${table.descriptorFingerprint} NOT GLOB '*[^0-9a-f]*' AND length(${table.dispatchId}) BETWEEN 1 AND 100`
    ),
    check(
      "import_carousel_evidence_state_check",
      sql`(
        ${table.state} = 'dispatching'
        AND ${table.manifestKey} IS NULL
        AND ${table.manifestSha256} IS NULL
        AND ${table.imageCount} IS NULL
        AND ${table.failureCode} IS NULL
        AND ${table.recoveryAction} IS NULL
        AND ${table.completedAt} IS NULL
      ) OR (
        ${table.state} = 'completed'
        AND length(${table.manifestKey}) BETWEEN 1 AND 500
        AND length(${table.manifestSha256}) = 64
        AND ${table.manifestSha256} NOT GLOB '*[^0-9a-f]*'
        AND typeof(${table.imageCount}) = 'integer'
        AND ${table.imageCount} BETWEEN 1 AND 12
        AND ${table.failureCode} IS NULL
        AND ${table.recoveryAction} IS NULL
        AND ${table.completedAt} IS NOT NULL
      ) OR (
        ${table.state} = 'failed'
        AND ${table.manifestKey} IS NULL
        AND ${table.manifestSha256} IS NULL
        AND ${table.imageCount} IS NULL
        AND ${table.completedAt} IS NOT NULL
        AND (
          (${table.failureCode} = 'carousel_inaccessible' AND ${table.recoveryAction} = 'check_source_visibility')
          OR (${table.failureCode} = 'carousel_partial' AND ${table.recoveryAction} = 'request_complete_carousel')
          OR (${table.failureCode} = 'carousel_layout_drift' AND ${table.recoveryAction} = 'update_carousel_adapter')
        )
      )`
    ),
  ]
);

export const importRecipeExtractions = sqliteTable(
  "import_recipe_extractions",
  {
    acquisitionGeneration: integer("acquisition_generation").notNull(),
    completedAt: text("completed_at"),
    costCertainty: text("cost_certainty", { enum: ["estimated", "known"] }),
    costCurrency: text("cost_currency", { enum: ["USD"] }),
    createdAt: text("created_at").notNull(),
    draftJson: text("draft_json"),
    estimatedCostMicroUsd: integer("estimated_cost_micro_usd"),
    evidenceFingerprint: text("evidence_fingerprint").notNull(),
    extractionFingerprint: text("extraction_fingerprint").notNull(),
    extractorModel: text("extractor_model").notNull(),
    extractorProvider: text("extractor_provider").notNull(),
    extractorVersion: text("extractor_version").notNull(),
    failureCode: text("failure_code", {
      enum: [
        "insufficient_evidence",
        "invalid_schema",
        "model_refusal",
        "provider_error",
      ],
    }),
    importId: text("import_id").notNull(),
    inputEvidenceItems: integer("input_evidence_items"),
    inputTokens: integer("input_tokens"),
    isCurrent: integer("is_current").notNull().default(0),
    latencyMilliseconds: integer("latency_milliseconds"),
    modelCalls: integer("model_calls"),
    outputTokens: integer("output_tokens"),
    state: text("state", {
      enum: ["dispatching", "failed", "needs_review"],
    }).notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.extractionFingerprint] }),
    foreignKey({
      columns: [table.importId, table.acquisitionGeneration],
      foreignColumns: [recipeImports.id, recipeImports.acquisitionGeneration],
      name: "import_recipe_extractions_import_generation_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    uniqueIndex("import_recipe_extractions_current_unique")
      .on(table.importId, table.acquisitionGeneration)
      .where(sql`${table.isCurrent} = 1`),
    index("import_recipe_extractions_state_updated_index").on(
      table.state,
      table.updatedAt
    ),
    check(
      "import_recipe_extractions_fingerprint_check",
      sql`length(${table.evidenceFingerprint}) = 64 AND ${table.evidenceFingerprint} NOT GLOB '*[^0-9a-f]*' AND length(${table.extractionFingerprint}) = 64 AND ${table.extractionFingerprint} NOT GLOB '*[^0-9a-f]*'`
    ),
    check(
      "import_recipe_extractions_descriptor_check",
      sql`length(${table.extractorProvider}) BETWEEN 1 AND 64 AND length(${table.extractorModel}) BETWEEN 1 AND 64 AND length(${table.extractorVersion}) BETWEEN 1 AND 64`
    ),
    check(
      "import_recipe_extractions_state_check",
      sql`(
        ${table.state} = 'dispatching'
        AND ${table.draftJson} IS NULL
        AND ${table.failureCode} IS NULL
        AND ${table.inputEvidenceItems} IS NULL
        AND ${table.inputTokens} IS NULL
        AND ${table.outputTokens} IS NULL
        AND ${table.modelCalls} IS NULL
        AND ${table.latencyMilliseconds} IS NULL
        AND ${table.estimatedCostMicroUsd} IS NULL
        AND ${table.costCurrency} IS NULL
        AND ${table.costCertainty} IS NULL
        AND ${table.completedAt} IS NULL
        AND ${table.isCurrent} = 0
      ) OR (
        ${table.state} = 'needs_review'
        AND json_valid(${table.draftJson})
        AND ${table.failureCode} IS NULL
        AND typeof(${table.inputEvidenceItems}) = 'integer' AND ${table.inputEvidenceItems} > 0
        AND typeof(${table.inputTokens}) = 'integer' AND ${table.inputTokens} >= 0
        AND typeof(${table.outputTokens}) = 'integer' AND ${table.outputTokens} >= 0
        AND ${table.modelCalls} = 1
        AND typeof(${table.latencyMilliseconds}) = 'integer' AND ${table.latencyMilliseconds} >= 0
        AND typeof(${table.estimatedCostMicroUsd}) = 'integer' AND ${table.estimatedCostMicroUsd} >= 0
        AND ${table.costCurrency} = 'USD'
        AND ${table.costCertainty} IN ('estimated', 'known')
        AND ${table.completedAt} IS NOT NULL
        AND ${table.isCurrent} IN (0, 1)
      ) OR (
        ${table.state} = 'failed'
        AND ${table.draftJson} IS NULL
        AND ${table.failureCode} IN ('insufficient_evidence', 'invalid_schema', 'model_refusal', 'provider_error')
        AND ${table.inputEvidenceItems} IS NULL
        AND ${table.inputTokens} IS NULL
        AND ${table.outputTokens} IS NULL
        AND ${table.modelCalls} IS NULL
        AND ${table.latencyMilliseconds} IS NULL
        AND ${table.estimatedCostMicroUsd} IS NULL
        AND ${table.costCurrency} IS NULL
        AND ${table.costCertainty} IS NULL
        AND ${table.completedAt} IS NOT NULL
        AND ${table.isCurrent} = 0
      )`
    ),
  ]
);

export const recipeReviews = sqliteTable(
  "recipe_reviews",
  {
    createdAt: text("created_at").notNull(),
    extractionFingerprint: text("extraction_fingerprint").notNull(),
    lastMutationId: text("last_mutation_id"),
    lifecycle: text("lifecycle", {
      enum: ["needs_review", "approved", "rejected"],
    }).notNull(),
    tagsJson: text("tags_json"),
    updatedAt: text("updated_at").notNull(),
    version: integer("version").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.extractionFingerprint] }),
    foreignKey({
      columns: [table.extractionFingerprint],
      foreignColumns: [importRecipeExtractions.extractionFingerprint],
      name: "recipe_reviews_extraction_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    index("recipe_reviews_lifecycle_updated_index").on(
      table.lifecycle,
      table.updatedAt
    ),
    check(
      "recipe_reviews_lifecycle_check",
      sql`${table.lifecycle} IN ('needs_review', 'approved', 'rejected')`
    ),
    check(
      "recipe_reviews_version_check",
      sql`typeof(${table.version}) = 'integer' AND ${table.version} >= 0 AND ${table.version} <= 9007199254740991`
    ),
    check(
      "recipe_reviews_tags_check",
      sql`(${table.tagsJson} IS NULL OR json_valid(${table.tagsJson})) AND (${table.lifecycle} <> 'approved' OR ${table.tagsJson} IS NOT NULL)`
    ),
    check(
      "recipe_reviews_mutation_check",
      sql`${table.lastMutationId} IS NULL OR length(${table.lastMutationId}) BETWEEN 1 AND 512`
    ),
  ]
);

export const recipeReviewCorrections = sqliteTable(
  "recipe_review_corrections",
  {
    actorId: text("actor_id").notNull(),
    afterJson: text("after_json").notNull(),
    beforeJson: text("before_json").notNull(),
    correctedAt: text("corrected_at").notNull(),
    extractionFingerprint: text("extraction_fingerprint").notNull(),
    field: text("field").notNull(),
    reason: text("reason").notNull(),
    tagsAfterJson: text("tags_after_json").notNull(),
    tagsBeforeJson: text("tags_before_json").notNull(),
    version: integer("version").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.extractionFingerprint, table.version] }),
    foreignKey({
      columns: [table.extractionFingerprint],
      foreignColumns: [recipeReviews.extractionFingerprint],
      name: "recipe_review_corrections_review_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    check(
      "recipe_review_corrections_version_check",
      sql`typeof(${table.version}) = 'integer' AND ${table.version} > 0 AND ${table.version} <= 9007199254740991`
    ),
    check(
      "recipe_review_corrections_actor_check",
      sql`length(${table.actorId}) BETWEEN 1 AND 128`
    ),
    check(
      "recipe_review_corrections_field_check",
      sql`${table.field} IN ('author', 'category', 'cook_time_minutes', 'cuisine', 'description', 'ingredient_lines', 'ingredient_quantities', 'ingredient_units', 'instructions', 'name', 'nutrition', 'prep_time_minutes', 'temperature_celsius', 'tools', 'total_time_minutes', 'yield')`
    ),
    check(
      "recipe_review_corrections_json_check",
      sql`json_valid(${table.beforeJson}) AND json_valid(${table.afterJson}) AND json_valid(${table.tagsBeforeJson}) AND json_valid(${table.tagsAfterJson})`
    ),
    check(
      "recipe_review_corrections_reason_check",
      sql`length(${table.reason}) BETWEEN 1 AND 4096`
    ),
  ]
);

export const recipeReviewTransitions = sqliteTable(
  "recipe_review_transitions",
  {
    actorId: text("actor_id").notNull(),
    extractionFingerprint: text("extraction_fingerprint").notNull(),
    fromLifecycle: text("from_lifecycle", {
      enum: ["needs_review", "approved", "rejected"],
    }).notNull(),
    reason: text("reason").notNull(),
    toLifecycle: text("to_lifecycle", {
      enum: ["needs_review", "approved", "rejected"],
    }).notNull(),
    transitionedAt: text("transitioned_at").notNull(),
    version: integer("version").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.extractionFingerprint, table.version] }),
    foreignKey({
      columns: [table.extractionFingerprint],
      foreignColumns: [recipeReviews.extractionFingerprint],
      name: "recipe_review_transitions_review_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    check(
      "recipe_review_transitions_version_check",
      sql`typeof(${table.version}) = 'integer' AND ${table.version} > 0 AND ${table.version} <= 9007199254740991`
    ),
    check(
      "recipe_review_transitions_actor_check",
      sql`length(${table.actorId}) BETWEEN 1 AND 128`
    ),
    check(
      "recipe_review_transitions_lifecycle_check",
      sql`${table.fromLifecycle} IN ('needs_review', 'approved', 'rejected') AND ${table.toLifecycle} IN ('needs_review', 'approved', 'rejected') AND ${table.fromLifecycle} <> ${table.toLifecycle}`
    ),
    check(
      "recipe_review_transitions_reason_check",
      sql`length(${table.reason}) BETWEEN 1 AND 4096`
    ),
  ]
);
