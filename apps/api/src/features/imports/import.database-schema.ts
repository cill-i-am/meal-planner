import { sql } from "drizzle-orm";
import {
  check,
  index,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const recipeImports = sqliteTable(
  "recipe_imports",
  {
    canonicalSourceId: text("canonical_source_id").notNull(),
    compatibilityFingerprint: text("compatibility_fingerprint").notNull(),
    createdAt: text("created_at").notNull(),
    evidenceReferencesJson: text("evidence_references_json").notNull(),
    id: text("id").notNull().primaryKey(),
    recoveryAction: text("recovery_action", {
      enum: ["check_source_visibility", "submit_supported_public_video"],
    }),
    sourceKind: text("source_kind", { enum: ["tiktok"] }).notNull(),
    status: text("status", {
      enum: ["failed", "queued", "unsupported"],
    }).notNull(),
    statusCode: text("status_code", {
      enum: ["private_or_unavailable", "unsupported_post_type"],
    }),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("recipe_imports_canonical_identity_unique").on(
      table.sourceKind,
      table.canonicalSourceId
    ),
    check(
      "recipe_imports_evidence_json_check",
      sql`json_valid(${table.evidenceReferencesJson})`
    ),
    check(
      "recipe_imports_status_details_check",
      sql`(
        ${table.status} = 'queued'
        AND ${table.statusCode} IS NULL
        AND ${table.recoveryAction} IS NULL
      ) OR (
        ${table.status} = 'failed'
        AND ${table.statusCode} = 'private_or_unavailable'
        AND ${table.recoveryAction} = 'check_source_visibility'
      ) OR (
        ${table.status} = 'unsupported'
        AND ${table.statusCode} = 'unsupported_post_type'
        AND ${table.recoveryAction} = 'submit_supported_public_video'
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
