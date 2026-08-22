import type { EffectSQLiteDoDatabase } from "drizzle-orm/effect-sqlite-do";
import { Clock, Effect, Option, Schema } from "effect";

import { requireHouseholdCommandAdmission } from "../rpc/command-envelope.js";
import {
  HouseholdCanonicalEncoding,
  HouseholdDigest,
  HouseholdIdentityGenerator,
} from "../shared-kernel/authority-services.js";
import { makeImportWorkflowIdentity } from "../shared-kernel/workflow-identity.js";
import { HouseholdOutboxAlarm } from "./household-outbox-alarm.js";
import { ensureHouseholdProvenance } from "./household-provenance.js";
import {
  HouseholdAdmitImportWorkflowInput,
  HouseholdDispatchId,
  HouseholdWorkflowAdmissionCommandDigest,
  HouseholdWorkflowAdmissionInvalidInput,
} from "./import-workflow-admission.contract.js";
import { makeImportWorkflowAdmissionRepository } from "./import-workflow-admission.repository.js";

const invalidInput = () => HouseholdWorkflowAdmissionInvalidInput.make({});

/**
 * Records future Workflow admission without moving import product authority.
 * Alarm scheduling is intentionally outside the SQLite transaction.
 */
export const admitImportWorkflow = (
  database: EffectSQLiteDoDatabase,
  untrustedInput: HouseholdAdmitImportWorkflowInput
) =>
  Effect.gen(function* admitImportWorkflowExecution() {
    const input = yield* Schema.decodeUnknownEffect(
      HouseholdAdmitImportWorkflowInput,
      { onExcessProperty: "error" }
    )(untrustedInput).pipe(Effect.mapError(invalidInput));
    yield* requireHouseholdCommandAdmission(
      input.admission,
      "admit_import_workflow"
    );
    yield* ensureHouseholdProvenance(database, input.admission.organizationId);
    const canonical = yield* HouseholdCanonicalEncoding;
    const digest = yield* HouseholdDigest;
    const identities = yield* HouseholdIdentityGenerator;
    const alarm = yield* HouseholdOutboxAlarm;
    const repository = makeImportWorkflowAdmissionRepository(database);
    const commandEncoding = yield* canonical.encode({
      executionGeneration: input.executionGeneration,
      importId: input.importId,
      mutationId: input.mutationId,
      purpose: "import_workflow_dispatch",
      version: 1,
    });
    const commandDigest = yield* digest.sha256(commandEncoding).pipe(
      Effect.flatMap((value) =>
        Schema.decodeUnknownEffect(HouseholdWorkflowAdmissionCommandDigest)(
          value
        )
      ),
      Effect.mapError(invalidInput)
    );
    const replay = yield* repository.findByMutation(
      input.mutationId,
      commandDigest
    );
    if (Option.isSome(replay)) {
      return replay.value;
    }

    const committedAtEpochMs = yield* Clock.currentTimeMillis;
    const dispatchId = yield* identities.generate().pipe(
      Effect.flatMap((value) =>
        Schema.decodeUnknownEffect(HouseholdDispatchId)(value)
      ),
      Effect.mapError(invalidInput)
    );
    const workflowIdentity = yield* makeImportWorkflowIdentity(input).pipe(
      Effect.mapError(invalidInput)
    );
    const committed = yield* repository.persist({
      commandDigest,
      dispatchId,
      executionGeneration: input.executionGeneration,
      importId: input.importId,
      mutationId: input.mutationId,
      result: {
        committedAtEpochMs,
        dispatchId,
        workflowIdentity,
      },
      workflowIdentity,
    });
    yield* alarm
      .schedule(committed.committedAtEpochMs)
      .pipe(Effect.catch(() => Effect.void));
    return committed;
  });
