import { sql } from "drizzle-orm";
import {
  check,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/** Private immutable routing authority for household-owned R2 evidence. */
export const importEvidenceRoutes = sqliteTable(
  "import_evidence_routes",
  {
    importId: text("import_id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    routeVersion: integer("route_version").notNull(),
  },
  (table) => [
    check(
      "import_evidence_routes_version_check",
      sql`${table.routeVersion} = 1`
    ),
  ]
);

export const importExecutionRuns = sqliteTable(
  "import_execution_runs",
  {
    acquisitionGeneration: integer("acquisition_generation")
      .notNull()
      .default(0),
    canonicalSourceId: text("canonical_source_id").notNull(),
    correlationId: text("correlation_id").notNull(),
    createdAt: text("created_at").notNull(),
    id: text("id").notNull(),
    recoveryAction: text("recovery_action", {
      enum: [
        "check_source_visibility",
        "retry_later",
        "submit_supported_public_video",
      ],
    }),
    sourceKind: text("source_kind", { enum: ["tiktok"] }).notNull(),
    sourceType: text("source_type", {
      enum: ["video", "carousel"],
    }).notNull(),
    status: text("status", {
      enum: ["acquiring", "failed", "queued", "unsupported"],
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
    uniqueIndex("import_execution_runs_id_generation_unique").on(
      table.id,
      table.acquisitionGeneration
    ),
    check(
      "import_execution_runs_acquisition_generation_check",
      sql`typeof(${table.acquisitionGeneration}) = 'integer' AND ${table.acquisitionGeneration} >= 0 AND ${table.acquisitionGeneration} <= 9007199254740991`
    ),
    check(
      "import_execution_runs_status_details_check",
      sql`(
        ${table.status} = 'queued'
        AND ${table.statusCode} IS NULL
        AND ${table.recoveryAction} IS NULL
      ) OR (
        ${table.status} = 'acquiring'
        AND ${table.statusCode} IS NULL
        AND ${table.recoveryAction} IS NULL
      ) OR (
        ${table.status} = 'failed'
        AND ${table.statusCode} = 'private_or_unavailable'
        AND ${table.recoveryAction} = 'check_source_visibility'
      ) OR (
        ${table.status} = 'failed'
        AND ${table.statusCode} = 'acquisition_temporarily_unavailable'
        AND ${table.recoveryAction} = 'retry_later'
      ) OR (
        ${table.status} = 'failed'
        AND ${table.statusCode} = 'invalid_or_unsupported_media'
        AND ${table.recoveryAction} = 'submit_supported_public_video'
      ) OR (
        ${table.status} = 'unsupported'
        AND ${table.statusCode} = 'unsupported_post_type'
        AND ${table.recoveryAction} = 'submit_supported_public_video'
      )`
    ),
  ]
);
