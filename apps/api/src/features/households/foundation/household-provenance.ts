import { HouseholdOrganizationId } from "@meal-planner/household-api";
import type { EffectSQLiteDoDatabase } from "drizzle-orm/effect-sqlite-do";
import { Clock, Effect, Schema } from "effect";

import type { HouseholdMetadata } from "../household.contract.js";
import {
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
    const persistedOrganizationId = yield* Schema.decodeUnknownEffect(
      HouseholdOrganizationId
    )(persisted.organizationId).pipe(
      Effect.flatMap((value) =>
        value === organizationId
          ? Effect.succeed(organizationId)
          : Effect.fail(HouseholdProvenanceMismatch.make({}))
      ),
      Effect.mapError((failure) =>
        failure._tag === "HouseholdProvenanceMismatch"
          ? failure
          : HouseholdPersistenceFailure.make({ operation: "read" })
      )
    );
    return {
      createdAtEpochMs: persisted.createdAtEpochMs,
      organizationId: persistedOrganizationId,
    } satisfies HouseholdMetadata;
  });
