import { sql } from "drizzle-orm";
import {
  check,
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
      enum: ["acquired", "acquiring", "failed", "queued", "unsupported"],
    }).notNull(),
    statusCode: text("status_code", {
      enum: [
        "acquisition_temporarily_unavailable",
        "invalid_or_unsupported_media",
        "private_or_unavailable",
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
    importId: text("import_id")
      .notNull()
      .references(() => recipeImports.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    requestFingerprint: text("request_fingerprint").notNull(),
    sourceLocatorHash: text("source_locator_hash").notNull(),
  },
  (table) => [index("import_requests_import_id_index").on(table.importId)]
);
