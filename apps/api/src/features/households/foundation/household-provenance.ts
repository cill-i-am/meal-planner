import type { HouseholdOrganizationId } from "@meal-planner/household-api";
import type { EffectSQLiteDoDatabase } from "drizzle-orm/effect-sqlite-do";
import { Clock, Effect, Schema } from "effect";

import {
  HouseholdMetadata,
  HouseholdPersistenceFailure,
  HouseholdProvenanceMismatch,
} from "../household.contract.js";
import { householdMeta } from "../household.database-schema.js";

const singletonKey = "household";

export const ensureHouseholdProvenance = (
  database: EffectSQLiteDoDatabase,
  organizationId: HouseholdOrganizationId
) =>
  Effect.gen(function* ensureHouseholdProvenanceRecord() {
    const createdAtEpochMs = yield* Clock.currentTimeMillis;
    yield* database
      .insert(householdMeta)
      .values({ createdAtEpochMs, organizationId, singletonKey })
      .onConflictDoNothing()
      .pipe(
        Effect.mapError(() =>
          HouseholdPersistenceFailure.make({ operation: "ensure" })
        )
      );
    const [persisted] = yield* database
      .select()
      .from(householdMeta)
      .limit(1)
      .pipe(
        Effect.mapError(() =>
          HouseholdPersistenceFailure.make({ operation: "read" })
        )
      );
    if (persisted === undefined) {
      return yield* Effect.fail(
        HouseholdPersistenceFailure.make({ operation: "read" })
      );
    }
    const metadata = yield* Schema.decodeUnknownEffect(HouseholdMetadata)({
      createdAtEpochMs: persisted.createdAtEpochMs,
      organizationId: persisted.organizationId,
    }).pipe(
      Effect.mapError(() =>
        HouseholdPersistenceFailure.make({ operation: "read" })
      )
    );
    if (metadata.organizationId !== organizationId) {
      return yield* Effect.fail(HouseholdProvenanceMismatch.make({}));
    }
    return metadata;
  });
