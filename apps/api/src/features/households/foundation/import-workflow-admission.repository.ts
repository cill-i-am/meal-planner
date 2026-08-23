import { eq } from "drizzle-orm";
import type { EffectSQLiteDoDatabase } from "drizzle-orm/effect-sqlite-do";
import { Effect, Option, Schema } from "effect";

import type { ImportTraceContext } from "../../imports/import-observability.js";
import {
  householdImportWorkflowAdmissions,
  householdOutbox,
} from "../household.database-schema.js";
import type { ImportWorkflowIdentity } from "../shared-kernel/workflow-identity.js";
import {
  HouseholdImportWorkflowAdmissionResult,
  HouseholdImportWorkflowDispatchView,
  HouseholdWorkflowAdmissionPersistenceFailure,
} from "./import-workflow-admission.contract.js";
import type { HouseholdDispatchId } from "./import-workflow-admission.contract.js";

const EncodedAdmissionResult = Schema.fromJsonString(
  HouseholdImportWorkflowAdmissionResult
);

const persistenceFailure = () =>
  HouseholdWorkflowAdmissionPersistenceFailure.make({});

const decodeResult = (encoded: string) =>
  Schema.decodeUnknownEffect(EncodedAdmissionResult)(encoded).pipe(
    Effect.mapError(persistenceFailure)
  );

const mapQueryFailure = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.mapError(persistenceFailure));

export const makeImportWorkflowAdmissionRepository = (
  database: EffectSQLiteDoDatabase
) => ({
  inspect: (
    dispatchId: HouseholdDispatchId
  ): Effect.Effect<
    Option.Option<typeof HouseholdImportWorkflowDispatchView.Type>,
    typeof HouseholdWorkflowAdmissionPersistenceFailure.Type
  > =>
    Effect.gen(function* inspectImportWorkflowDispatch() {
      const [row] = yield* database
        .select()
        .from(householdOutbox)
        .where(eq(householdOutbox.dispatchId, dispatchId))
        .limit(1)
        .pipe(mapQueryFailure);
      if (row === undefined) {
        return Option.none<typeof HouseholdImportWorkflowDispatchView.Type>();
      }
      const [admissionRow] = yield* database
        .select()
        .from(householdImportWorkflowAdmissions)
        .where(eq(householdImportWorkflowAdmissions.dispatchId, dispatchId))
        .limit(1)
        .pipe(mapQueryFailure);
      if (admissionRow === undefined) {
        return yield* Effect.fail(persistenceFailure());
      }
      const admission = yield* decodeResult(admissionRow.committedResultJson);
      const view = yield* Schema.decodeUnknownEffect(
        HouseholdImportWorkflowDispatchView
      )({
        admission,
        attempts: row.attempts,
        exhaustedAtEpochMs: row.exhaustedAtEpochMs,
        state: row.state,
      }).pipe(Effect.mapError(persistenceFailure));
      return Option.some(view);
    }),

  recordDispatch: (input: {
    readonly dispatchId: HouseholdDispatchId;
    readonly nowEpochMs: number;
    readonly outcome: "prepared" | "started" | "unavailable";
    readonly originalTrace: ImportTraceContext;
    readonly workflowIdentity: ImportWorkflowIdentity;
  }) =>
    database.transaction((transaction) =>
      Effect.gen(function* recordImportWorkflowDispatch() {
        const [row] = yield* transaction
          .select()
          .from(householdOutbox)
          .where(eq(householdOutbox.dispatchId, input.dispatchId))
          .limit(1)
          .pipe(mapQueryFailure);
        const [admissionRow] = yield* transaction
          .select()
          .from(householdImportWorkflowAdmissions)
          .where(
            eq(householdImportWorkflowAdmissions.dispatchId, input.dispatchId)
          )
          .limit(1)
          .pipe(mapQueryFailure);
        if (
          row === undefined ||
          admissionRow === undefined ||
          admissionRow.workflowIdentity !== input.workflowIdentity
        ) {
          return yield* Effect.fail(persistenceFailure());
        }
        const originalTraceJson = JSON.stringify(input.originalTrace);
        if (
          admissionRow.originalTraceJson !== null &&
          admissionRow.originalTraceJson !== originalTraceJson
        ) {
          return yield* Effect.fail(persistenceFailure());
        }
        if (admissionRow.originalTraceJson === null) {
          yield* transaction
            .update(householdImportWorkflowAdmissions)
            .set({ originalTraceJson })
            .where(
              eq(householdImportWorkflowAdmissions.dispatchId, input.dispatchId)
            )
            .pipe(mapQueryFailure);
        }
        if (input.outcome === "prepared") {
          return yield* Schema.decodeUnknownEffect(
            HouseholdImportWorkflowDispatchView
          )({
            admission: yield* decodeResult(admissionRow.committedResultJson),
            attempts: row.attempts,
            exhaustedAtEpochMs: row.exhaustedAtEpochMs,
            state: row.state,
          }).pipe(Effect.mapError(persistenceFailure));
        }
        if (row.state === "dispatched" || row.state === "exhausted") {
          return yield* Schema.decodeUnknownEffect(
            HouseholdImportWorkflowDispatchView
          )({
            admission: yield* decodeResult(admissionRow.committedResultJson),
            attempts: row.attempts,
            exhaustedAtEpochMs: row.exhaustedAtEpochMs,
            state: row.state,
          }).pipe(Effect.mapError(persistenceFailure));
        }
        const attempts = row.attempts + 1;
        const exhausted = input.outcome === "unavailable" && attempts >= 5;
        let state: "dispatched" | "exhausted" | "pending" = "pending";
        if (input.outcome === "started") {
          state = "dispatched";
        } else if (exhausted) {
          state = "exhausted";
        }
        const exhaustedAtEpochMs = exhausted ? input.nowEpochMs : null;
        yield* transaction
          .update(householdOutbox)
          .set({
            attempts,
            exhaustedAtEpochMs,
            nextAttemptAtEpochMs:
              state === "pending"
                ? input.nowEpochMs + Math.min(60_000, 2 ** attempts * 1000)
                : input.nowEpochMs,
            state,
          })
          .where(eq(householdOutbox.dispatchId, input.dispatchId))
          .pipe(mapQueryFailure);
        return yield* Schema.decodeUnknownEffect(
          HouseholdImportWorkflowDispatchView
        )({
          admission: yield* decodeResult(admissionRow.committedResultJson),
          attempts,
          exhaustedAtEpochMs,
          state,
        }).pipe(Effect.mapError(persistenceFailure));
      })
    ),
});
