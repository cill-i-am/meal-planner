import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
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
    executionGeneration: integer("execution_generation").notNull(),
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

/** Cross-household provider cost authority. It owns no Household product state. */
export const providerAccountingBudgets = sqliteTable(
  "provider_accounting_budgets",
  {
    accountingScope: text("accounting_scope").primaryKey(),
    budgetCapMicroUsd: integer("budget_cap_micro_usd")
      .notNull()
      .default(10_000_000),
    createdAt: text("created_at").notNull(),
    invokingDispatchId: text("invoking_dispatch_id"),
    poisonDispatchId: text("poison_dispatch_id"),
    reservedMicroUsd: integer("reserved_micro_usd").notNull().default(0),
    settledMicroUsd: integer("settled_micro_usd").notNull().default(0),
    state: text("state", { enum: ["open", "invoking", "poisoned"] })
      .notNull()
      .default("open"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check(
      "provider_accounting_budgets_scope_check",
      sql`${table.accountingScope} = 'recipe-import'`
    ),
    check(
      "provider_accounting_budgets_cap_check",
      sql`typeof(${table.budgetCapMicroUsd}) = 'integer' AND ${table.budgetCapMicroUsd} = 10000000`
    ),
    check(
      "provider_accounting_budgets_amounts_check",
      sql`typeof(${table.settledMicroUsd}) = 'integer' AND ${table.settledMicroUsd} >= 0 AND typeof(${table.reservedMicroUsd}) = 'integer' AND ${table.reservedMicroUsd} >= 0 AND ${table.settledMicroUsd} + ${table.reservedMicroUsd} <= ${table.budgetCapMicroUsd}`
    ),
    check(
      "provider_accounting_budgets_state_check",
      sql`(${table.state} = 'open' AND ${table.invokingDispatchId} IS NULL AND ${table.poisonDispatchId} IS NULL) OR (${table.state} = 'invoking' AND ${table.invokingDispatchId} IS NOT NULL AND ${table.poisonDispatchId} IS NULL) OR (${table.state} = 'poisoned' AND ${table.invokingDispatchId} IS NULL AND ${table.poisonDispatchId} IS NOT NULL)`
    ),
  ]
);

export const providerAccountingDispatches = sqliteTable(
  "provider_accounting_dispatches",
  {
    accountingScope: text("accounting_scope").notNull(),
    actualCostMicroUsd: integer("actual_cost_micro_usd"),
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull(),
    dispatchId: text("dispatch_id").notNull(),
    invocationExpiresAt: text("invocation_expires_at"),
    invocationGeneration: integer("invocation_generation").notNull().default(0),
    invocationStartedAt: text("invocation_started_at"),
    maximumCostMicroUsd: integer("maximum_cost_micro_usd").notNull(),
    providerStageId: text("provider_stage_id").notNull(),
    runId: text("run_id").notNull(),
    state: text("state", {
      enum: [
        "reserved",
        "invoking",
        "released",
        "settled_known",
        "settled_unknown",
        "settled_conservative",
      ],
    })
      .notNull()
      .default("reserved"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.accountingScope, table.dispatchId] }),
    foreignKey({
      columns: [table.accountingScope],
      foreignColumns: [providerAccountingBudgets.accountingScope],
      name: "provider_accounting_dispatches_budget_fk",
    }).onDelete("restrict"),
    uniqueIndex("provider_accounting_dispatches_run_idx").on(
      table.accountingScope,
      table.runId,
      table.dispatchId
    ),
    check(
      "provider_accounting_dispatches_scope_check",
      sql`${table.accountingScope} = 'recipe-import'`
    ),
    check(
      "provider_accounting_dispatches_maximum_check",
      sql`typeof(${table.maximumCostMicroUsd}) = 'integer' AND ${table.maximumCostMicroUsd} > 0 AND ${table.maximumCostMicroUsd} <= 10000000`
    ),
    check(
      "provider_accounting_dispatches_shape_check",
      sql`(${table.state} = 'reserved' AND ${table.actualCostMicroUsd} IS NULL AND ${table.invocationGeneration} = 0 AND ${table.invocationStartedAt} IS NULL AND ${table.invocationExpiresAt} IS NULL AND ${table.completedAt} IS NULL) OR (${table.state} = 'invoking' AND ${table.actualCostMicroUsd} IS NULL AND typeof(${table.invocationGeneration}) = 'integer' AND ${table.invocationGeneration} >= 1 AND ${table.invocationStartedAt} IS NOT NULL AND ${table.invocationExpiresAt} IS NOT NULL AND ${table.completedAt} IS NULL) OR (${table.state} = 'released' AND ${table.actualCostMicroUsd} IS NULL AND ${table.invocationGeneration} = 0 AND ${table.invocationStartedAt} IS NULL AND ${table.invocationExpiresAt} IS NULL AND ${table.completedAt} IS NOT NULL) OR (${table.state} = 'settled_known' AND typeof(${table.actualCostMicroUsd}) = 'integer' AND ${table.actualCostMicroUsd} >= 0 AND ${table.actualCostMicroUsd} <= ${table.maximumCostMicroUsd} AND typeof(${table.invocationGeneration}) = 'integer' AND ${table.invocationGeneration} >= 1 AND ${table.invocationStartedAt} IS NOT NULL AND ${table.invocationExpiresAt} IS NULL AND ${table.completedAt} IS NOT NULL) OR (${table.state} = 'settled_unknown' AND ${table.actualCostMicroUsd} IS NULL AND typeof(${table.invocationGeneration}) = 'integer' AND ${table.invocationGeneration} >= 1 AND ${table.invocationStartedAt} IS NOT NULL AND ${table.invocationExpiresAt} IS NULL AND ${table.completedAt} IS NOT NULL) OR (${table.state} = 'settled_conservative' AND ${table.actualCostMicroUsd} IS NULL AND typeof(${table.invocationGeneration}) = 'integer' AND ${table.invocationGeneration} >= 1 AND ${table.invocationStartedAt} IS NOT NULL AND ${table.invocationExpiresAt} IS NULL AND ${table.completedAt} IS NOT NULL)`
    ),
  ]
);

export const providerAccountingReconciliations = sqliteTable(
  "provider_accounting_reconciliations",
  {
    accountingScope: text("accounting_scope").notNull(),
    actualCostWasUnknown: integer("actual_cost_was_unknown")
      .notNull()
      .default(1),
    authority: text("authority", {
      enum: ["authenticated_operator"],
    }).notNull(),
    conservativeChargeMicroUsd: integer(
      "conservative_charge_micro_usd"
    ).notNull(),
    createdAt: text("created_at").notNull(),
    dispatchId: text("dispatch_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.accountingScope, table.dispatchId] }),
    foreignKey({
      columns: [table.accountingScope, table.dispatchId],
      foreignColumns: [
        providerAccountingDispatches.accountingScope,
        providerAccountingDispatches.dispatchId,
      ],
      name: "provider_accounting_reconciliations_dispatch_fk",
    }).onDelete("restrict"),
    check(
      "provider_accounting_reconciliations_scope_check",
      sql`${table.accountingScope} = 'recipe-import'`
    ),
    check(
      "provider_accounting_reconciliations_charge_check",
      sql`typeof(${table.conservativeChargeMicroUsd}) = 'integer' AND ${table.conservativeChargeMicroUsd} > 0 AND ${table.conservativeChargeMicroUsd} <= 10000000`
    ),
    check(
      "provider_accounting_reconciliations_unknown_check",
      sql`${table.actualCostWasUnknown} = 1`
    ),
    check(
      "provider_accounting_reconciliations_authority_check",
      sql`${table.authority} = 'authenticated_operator'`
    ),
  ]
);

export const providerAccountingConservativeSettlements = sqliteTable(
  "provider_accounting_conservative_settlements",
  {
    accountingScope: text("accounting_scope").notNull(),
    actualCostWasUnknown: integer("actual_cost_was_unknown").notNull(),
    authority: text("authority", {
      enum: ["schema_valid_provider_response"],
    }).notNull(),
    conservativeChargeMicroUsd: integer(
      "conservative_charge_micro_usd"
    ).notNull(),
    createdAt: text("created_at").notNull(),
    dispatchId: text("dispatch_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.accountingScope, table.dispatchId] }),
    foreignKey({
      columns: [table.accountingScope, table.dispatchId],
      foreignColumns: [
        providerAccountingDispatches.accountingScope,
        providerAccountingDispatches.dispatchId,
      ],
      name: "provider_accounting_conservative_settlements_dispatch_fk",
    }).onDelete("restrict"),
    check(
      "provider_accounting_conservative_settlements_scope_check",
      sql`${table.accountingScope} = 'recipe-import'`
    ),
    check(
      "provider_accounting_conservative_settlements_charge_check",
      sql`${table.conservativeChargeMicroUsd} = 100000`
    ),
    check(
      "provider_accounting_conservative_settlements_unknown_check",
      sql`${table.actualCostWasUnknown} = 1`
    ),
    check(
      "provider_accounting_conservative_settlements_authority_check",
      sql`${table.authority} = 'schema_valid_provider_response'`
    ),
  ]
);

export const providerAccountingRecipeReplayValues = sqliteTable(
  "provider_accounting_recipe_replay_values",
  {
    accountingScope: text("accounting_scope").notNull(),
    createdAt: text("created_at").notNull(),
    dispatchId: text("dispatch_id").notNull(),
    evidenceFingerprint: text("evidence_fingerprint").notNull(),
    expiresAt: text("expires_at").notNull(),
    generation: integer("generation").notNull(),
    importId: text("import_id").notNull(),
    valueJson: text("value_json").notNull(),
    valueSha256: text("value_sha256").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.accountingScope, table.dispatchId] }),
    foreignKey({
      columns: [table.accountingScope, table.dispatchId],
      foreignColumns: [
        providerAccountingConservativeSettlements.accountingScope,
        providerAccountingConservativeSettlements.dispatchId,
      ],
      name: "provider_accounting_recipe_replay_values_audit_fk",
    }).onDelete("restrict"),
    check(
      "provider_accounting_recipe_replay_values_scope_check",
      sql`${table.accountingScope} = 'recipe-import'`
    ),
    check(
      "provider_accounting_recipe_replay_values_dispatch_check",
      sql`${table.dispatchId} = 'recipe:' || ${table.importId} || ':' || ${table.generation} || ':' || ${table.evidenceFingerprint} OR ${table.dispatchId} = 'recipe:' || ${table.importId} || ':' || ${table.generation} || ':' || ${table.evidenceFingerprint} || ':recovery:1' OR ${table.dispatchId} = 'recipe:' || ${table.importId} || ':' || ${table.generation} || ':' || ${table.evidenceFingerprint} || ':recovery:2' OR ${table.dispatchId} = 'recipe:' || ${table.importId} || ':' || ${table.generation} || ':' || ${table.evidenceFingerprint} || ':recovery:3' OR ${table.dispatchId} = 'recipe:' || ${table.importId} || ':' || ${table.generation} || ':' || ${table.evidenceFingerprint} || ':recovery:4' OR ${table.dispatchId} = 'recipe:' || ${table.importId} || ':' || ${table.generation} || ':' || ${table.evidenceFingerprint} || ':recovery:5' OR ${table.dispatchId} = 'recipe:' || ${table.importId} || ':' || ${table.generation} || ':' || ${table.evidenceFingerprint} || ':recovery:6' OR ${table.dispatchId} = 'recipe:' || ${table.importId} || ':' || ${table.generation} || ':' || ${table.evidenceFingerprint} || ':recovery:7' OR ${table.dispatchId} = 'recipe:' || ${table.importId} || ':' || ${table.generation} || ':' || ${table.evidenceFingerprint} || ':recovery:8'`
    ),
    check(
      "provider_accounting_recipe_replay_values_identity_check",
      sql`length(${table.importId}) BETWEEN 1 AND 128 AND ${table.generation} >= 1 AND length(${table.evidenceFingerprint}) = 64 AND ${table.evidenceFingerprint} NOT GLOB '*[^0-9a-f]*'`
    ),
    check(
      "provider_accounting_recipe_replay_values_value_check",
      sql`length(CAST(${table.valueJson} AS BLOB)) BETWEEN 1 AND 262144 AND json_valid(${table.valueJson}) AND length(${table.valueSha256}) = 64 AND ${table.valueSha256} NOT GLOB '*[^0-9a-f]*'`
    ),
    check(
      "provider_accounting_recipe_replay_values_lifecycle_check",
      sql`${table.expiresAt} = strftime('%Y-%m-%dT%H:%M:%fZ', ${table.createdAt}, '+7 days')`
    ),
  ]
);
