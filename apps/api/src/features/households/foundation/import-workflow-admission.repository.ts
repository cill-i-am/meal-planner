import { and, eq } from "drizzle-orm";
import type { EffectSQLiteDoDatabase } from "drizzle-orm/effect-sqlite-do";
import { Effect, Option, Schema } from "effect";

import type { ImportIntentExecutionGeneration } from "../../imports/import-intent-transition.js";
import type { ImportId } from "../../imports/import.contracts.js";
import {
  householdImportWorkflowAdmissions,
  householdOutbox,
} from "../household.database-schema.js";
import type { ImportWorkflowIdentity } from "../shared-kernel/workflow-identity.js";
import {
  HouseholdImportWorkflowAdmissionResult,
  HouseholdImportWorkflowOutboxPayload,
  HouseholdWorkflowAdmissionConflict,
  HouseholdWorkflowAdmissionPersistenceFailure,
} from "./import-workflow-admission.contract.js";
import type {
  HouseholdDispatchId,
  HouseholdImportWorkflowDispatchView,
  HouseholdOutboxState,
  HouseholdWorkflowAdmissionCommandDigest,
  HouseholdWorkflowAdmissionMutationId,
} from "./import-workflow-admission.contract.js";

const EncodedAdmissionResult = Schema.fromJsonString(
  HouseholdImportWorkflowAdmissionResult
);
const EncodedOutboxPayload = Schema.fromJsonString(
  HouseholdImportWorkflowOutboxPayload
);

const persistenceFailure = () =>
  HouseholdWorkflowAdmissionPersistenceFailure.make({});
const conflict = () => HouseholdWorkflowAdmissionConflict.make({});

const encodeResult = (result: HouseholdImportWorkflowAdmissionResult) =>
  Schema.encodeEffect(EncodedAdmissionResult)(result).pipe(
    Effect.mapError(persistenceFailure)
  );

const decodeResult = (encoded: string) =>
  Schema.decodeUnknownEffect(EncodedAdmissionResult)(encoded).pipe(
    Effect.mapError(persistenceFailure)
  );

const encodeOutboxPayload = (payload: HouseholdImportWorkflowOutboxPayload) =>
  Schema.encodeEffect(EncodedOutboxPayload)(payload).pipe(
    Effect.mapError(persistenceFailure)
  );

const mapQueryFailure = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.mapError(() => persistenceFailure()));

export interface PersistImportWorkflowAdmissionInput {
  readonly commandDigest: HouseholdWorkflowAdmissionCommandDigest;
  readonly dispatchId: HouseholdDispatchId;
  readonly executionGeneration: ImportIntentExecutionGeneration;
  readonly importId: ImportId;
  readonly mutationId: HouseholdWorkflowAdmissionMutationId;
  readonly result: HouseholdImportWorkflowAdmissionResult;
  readonly workflowIdentity: ImportWorkflowIdentity;
}

type AdmissionRepositoryFailure =
  | HouseholdWorkflowAdmissionConflict
  | HouseholdWorkflowAdmissionPersistenceFailure;

export const makeImportWorkflowAdmissionRepository = (
  database: EffectSQLiteDoDatabase
) =>
  // eslint-disable-next-line sort-keys -- Repository commands follow read, commit, transition, then inspection lifecycle.
  ({
    findByMutation: (
      mutationId: HouseholdWorkflowAdmissionMutationId,
      commandDigest: HouseholdWorkflowAdmissionCommandDigest
    ): Effect.Effect<
      Option.Option<HouseholdImportWorkflowAdmissionResult>,
      AdmissionRepositoryFailure
    > =>
      Effect.gen(function* findAdmissionByMutation() {
        const [row] = yield* database
          .select()
          .from(householdImportWorkflowAdmissions)
          .where(eq(householdImportWorkflowAdmissions.mutationId, mutationId))
          .limit(1)
          .pipe(mapQueryFailure);
        if (row === undefined) {
          return Option.none<HouseholdImportWorkflowAdmissionResult>();
        }
        if (row.commandDigest !== commandDigest) {
          return yield* Effect.fail(conflict());
        }
        return Option.some(yield* decodeResult(row.committedResultJson));
      }),

    persist: (
      input: PersistImportWorkflowAdmissionInput
    ): Effect.Effect<
      HouseholdImportWorkflowAdmissionResult,
      AdmissionRepositoryFailure
    > =>
      encodeResult(input.result).pipe(
        Effect.bindTo("committedResultJson"),
        Effect.bind("outboxPayloadJson", () =>
          encodeOutboxPayload({
            executionGeneration: input.executionGeneration,
            importId: input.importId,
            workflowIdentity: input.result.workflowIdentity,
          })
        ),
        Effect.flatMap(({ committedResultJson, outboxPayloadJson }) =>
          database.transaction((transaction) =>
            Effect.gen(function* persistAdmissionAndOutbox() {
              const [existingMutation] = yield* transaction
                .select()
                .from(householdImportWorkflowAdmissions)
                .where(
                  eq(
                    householdImportWorkflowAdmissions.mutationId,
                    input.mutationId
                  )
                )
                .limit(1)
                .pipe(mapQueryFailure);
              if (existingMutation !== undefined) {
                return existingMutation.commandDigest === input.commandDigest
                  ? yield* decodeResult(existingMutation.committedResultJson)
                  : yield* Effect.fail(conflict());
              }

              const [existingExecution] = yield* transaction
                .select()
                .from(householdImportWorkflowAdmissions)
                .where(
                  and(
                    eq(
                      householdImportWorkflowAdmissions.importId,
                      input.importId
                    ),
                    eq(
                      householdImportWorkflowAdmissions.executionGeneration,
                      input.executionGeneration
                    )
                  )
                )
                .limit(1)
                .pipe(mapQueryFailure);
              if (existingExecution !== undefined) {
                return yield* Effect.fail(conflict());
              }

              yield* transaction
                .insert(householdImportWorkflowAdmissions)
                .values({
                  commandDigest: input.commandDigest,
                  committedAtEpochMs: input.result.committedAtEpochMs,
                  committedResultJson,
                  dispatchId: input.dispatchId,
                  executionGeneration: input.executionGeneration,
                  importId: input.importId,
                  mutationId: input.mutationId,
                  workflowIdentity: input.workflowIdentity,
                })
                .pipe(mapQueryFailure);
              yield* transaction
                .insert(householdOutbox)
                .values({
                  attempts: 0,
                  dispatchId: input.dispatchId,
                  exhaustedAtEpochMs: null,
                  nextAttemptAtEpochMs: input.result.committedAtEpochMs,
                  payloadJson: outboxPayloadJson,
                  purpose: "import_workflow_dispatch",
                  state: "pending",
                })
                .pipe(mapQueryFailure);
              return input.result;
            })
          )
        ),
        Effect.catchTag("SqlError", () => Effect.fail(persistenceFailure()))
      ),

    markExhausted: (
      dispatchId: HouseholdDispatchId,
      exhaustedAtEpochMs: number
    ) =>
      database
        .update(householdOutbox)
        .set({ exhaustedAtEpochMs, state: "exhausted" })
        .where(eq(householdOutbox.dispatchId, dispatchId))
        .pipe(mapQueryFailure, Effect.asVoid),

    inspect: (
      dispatchId: HouseholdDispatchId
    ): Effect.Effect<
      Option.Option<HouseholdImportWorkflowDispatchView>,
      HouseholdWorkflowAdmissionPersistenceFailure
    > =>
      Effect.gen(function* inspectImportWorkflowDispatch() {
        const [row] = yield* database
          .select()
          .from(householdOutbox)
          .where(eq(householdOutbox.dispatchId, dispatchId))
          .limit(1)
          .pipe(mapQueryFailure);
        if (row === undefined) {
          return Option.none<HouseholdImportWorkflowDispatchView>();
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
        return Option.some({
          admission,
          attempts: row.attempts,
          exhaustedAtEpochMs: row.exhaustedAtEpochMs,
          state: row.state as HouseholdOutboxState,
        });
      }),
  });
