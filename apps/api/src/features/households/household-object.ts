import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle/Cloudflare";
import { Effect, Schema } from "effect";

import migrations from "../../../household-migrations/migrations.js";
import type { HouseholdMetadata } from "./household.contract.js";
import {
  HouseholdEnsureInput,
  HouseholdInvalidInput,
  HouseholdPersistenceFailure,
  HouseholdProvenanceMismatch,
} from "./household.contract.js";
import { householdMeta } from "./household.database-schema.js";

const singletonKey = "household";

export const HouseholdObjectRuntime = Effect.gen(
  function* initializeHouseholdObject() {
    const durableObjectState = yield* Cloudflare.DurableObjectState;
    return Effect.succeed({
      ensureHousehold: (untrustedInput: HouseholdEnsureInput) =>
        Effect.gen(function* ensureHousehold() {
          // Alchemy beta.72 cannot acquire scoped Drizzle during object
          // construction. Give each RPC its own lifecycle scope instead;
          // the real-runtime test protects this host-specific placement.
          const database = yield* Drizzle.DurableObject({ migrations });
          const input = yield* Schema.decodeUnknownEffect(HouseholdEnsureInput)(
            untrustedInput
          ).pipe(Effect.mapError(() => HouseholdInvalidInput.make({})));
          const createdAtEpochMs = Date.now();
          yield* database
            .insert(householdMeta)
            .values({
              createdAtEpochMs,
              organizationId: input.organizationId,
              singletonKey,
            })
            .onConflictDoNothing()
            .pipe(
              Effect.mapError(() =>
                HouseholdPersistenceFailure.make({ operation: "ensure" })
              )
            );
          const rows = yield* database
            .select()
            .from(householdMeta)
            .limit(1)
            .pipe(
              Effect.mapError(() =>
                HouseholdPersistenceFailure.make({ operation: "read" })
              )
            );
          const [persisted] = rows;
          if (persisted === undefined) {
            return yield* Effect.fail(
              HouseholdPersistenceFailure.make({ operation: "read" })
            );
          }
          const persistedOrganizationId = yield* Schema.decodeUnknownEffect(
            HouseholdEnsureInput.fields.organizationId
          )(persisted.organizationId).pipe(
            Effect.mapError(() =>
              HouseholdPersistenceFailure.make({ operation: "read" })
            )
          );
          if (persistedOrganizationId !== input.organizationId) {
            return yield* Effect.fail(
              HouseholdProvenanceMismatch.make({
                organizationId: input.organizationId,
                persistedOrganizationId,
              })
            );
          }
          return {
            createdAtEpochMs: persisted.createdAtEpochMs,
            organizationId: persistedOrganizationId,
          } satisfies HouseholdMetadata;
        }).pipe(
          Effect.provideService(
            Cloudflare.DurableObjectState,
            durableObjectState
          ),
          Effect.scoped
        ),
    });
  }
);

export default class HouseholdObject extends Cloudflare.DurableObject<HouseholdObject>()(
  "HouseholdObject",
  HouseholdObjectRuntime
) {}
