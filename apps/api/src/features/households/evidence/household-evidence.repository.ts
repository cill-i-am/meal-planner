import {
  FailedRecipeImportIntent,
  ProcessingRecipeImportIntent,
  RecipeImportIntent,
  RecipeImportTimelineEvent,
} from "@meal-planner/recipe-import-api";
import { and, asc, desc, eq } from "drizzle-orm";
import type { EffectSQLiteDoDatabase } from "drizzle-orm/effect-sqlite-do";
import { Clock, DateTime, Effect, Option, Schema } from "effect";

import { EvidenceRetentionSeconds } from "../../imports/import-media.model.js";
import { ensureHouseholdProvenance } from "../foundation/household-provenance.js";
import {
  householdEvidenceMutationReceipts,
  householdEvidenceReferences,
  householdEvidenceStageExecutions,
  householdImportEvidenceExecutions,
  householdRecipeImports,
  householdRecipeImportTimeline,
  importRecipeRecoveryAttempts,
  importTerminalCheckpoints,
} from "../household.database-schema.js";
import { HouseholdRecipeImportFailure } from "../recipe-import/household-recipe-import.contract.js";
import {
  HouseholdCanonicalEncoding,
  HouseholdDigest,
} from "../shared-kernel/authority-services.js";
import {
  HouseholdCommitAcquisitionEvidenceInput,
  HouseholdCommitAcquisitionEvidenceResult,
  HouseholdObserveEvidenceReferenceInput,
  HouseholdObserveEvidenceReferenceResult,
  HouseholdMutateEvidenceStageInput,
  HouseholdMutateEvidenceStageResult,
  HouseholdEvidenceStageResult,
  HouseholdExtractionClaimContext,
  HouseholdReadEvidenceStageResult,
  HouseholdReadEvidenceReferencesResult,
  HouseholdReadImportTerminalCheckpointResult,
  HouseholdPrepareRecipeRecoveryInput,
  HouseholdPrepareRecipeRecoveryResult,
  HouseholdReadRecipeRecoveryAttemptResult,
} from "./household-evidence.contract.js";
import type {
  HouseholdCommitAcquisitionEvidenceInput as HouseholdCommitAcquisitionEvidenceInputType,
  HouseholdObserveEvidenceReferenceInput as HouseholdObserveEvidenceReferenceInputType,
  HouseholdMutateEvidenceStageInput as HouseholdMutateEvidenceStageInputType,
  HouseholdReadEvidenceStageInput as HouseholdReadEvidenceStageInputType,
  HouseholdReadEvidenceReferencesInput as HouseholdReadEvidenceReferencesInputType,
  HouseholdReadImportTerminalCheckpointInput as HouseholdReadImportTerminalCheckpointInputType,
  HouseholdPrepareRecipeRecoveryInput as HouseholdPrepareRecipeRecoveryInputType,
  HouseholdReadRecipeRecoveryAttemptInput as HouseholdReadRecipeRecoveryAttemptInputType,
} from "./household-evidence.contract.js";

const failure = (reason: HouseholdRecipeImportFailure["reason"]) =>
  HouseholdRecipeImportFailure.make({ reason });
const persistenceFailure = () => failure("persistence_unavailable");
const normalizePersistenceFailure = <E>(error: E) =>
  Schema.is(HouseholdRecipeImportFailure)(error) ? error : persistenceFailure();
const mapPersistence = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.mapError(persistenceFailure));
const mapTransaction = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.mapError(normalizePersistenceFailure));

const EncodedCommitResult = Schema.fromJsonString(
  HouseholdCommitAcquisitionEvidenceResult
);
const EncodedObservationResult = Schema.fromJsonString(
  HouseholdObserveEvidenceReferenceResult
);
const EncodedStageMutationResult = Schema.fromJsonString(
  HouseholdMutateEvidenceStageResult
);
const EncodedRecoveryPreparationResult = Schema.fromJsonString(
  HouseholdPrepareRecipeRecoveryResult
);
const EncodedRecipeImportIntent = Schema.fromJsonString(RecipeImportIntent);
const EncodedRecipeImportTimelineEvent = Schema.fromJsonString(
  RecipeImportTimelineEvent
);

const encode = <S extends Schema.Top>(schema: S, value: S["Type"]) =>
  Schema.encodeEffect(schema)(value).pipe(Effect.mapError(persistenceFailure));
const decode = <S extends Schema.Top>(schema: S, value: Schema.Json) =>
  Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError(persistenceFailure)
  );

const expectedReferenceKeys = (intentId: string, generation: number) =>
  [
    `imports/${intentId}/acquisition/v1/generations/${generation}/original.mp4`,
    `imports/${intentId}/acquisition/v1/generations/${generation}/manifest.json`,
  ] as const;

const validateEvidenceStructure = (
  input: HouseholdCommitAcquisitionEvidenceInputType
) => {
  const [media, manifest] = input.result.references;
  const [expectedMediaKey, expectedManifestKey] = expectedReferenceKeys(
    input.intentId,
    input.acquisitionAttemptGeneration
  );
  const acquiredAtEpochMs = DateTime.toEpochMillis(input.result.acquiredAt);
  const deleteAtEpochMs = DateTime.toEpochMillis(media.deleteAt);
  const manifestDeleteAtEpochMs = DateTime.toEpochMillis(manifest.deleteAt);
  const valid =
    media.key === expectedMediaKey &&
    manifest.key === expectedManifestKey &&
    deleteAtEpochMs === manifestDeleteAtEpochMs &&
    deleteAtEpochMs - acquiredAtEpochMs === EvidenceRetentionSeconds * 1000;
  return valid ? Effect.void : Effect.fail(failure("invalid_input"));
};

const validateEvidenceFreshness = (
  input: HouseholdCommitAcquisitionEvidenceInputType,
  nowEpochMs: number
) =>
  DateTime.toEpochMillis(input.result.references[0].deleteAt) > nowEpochMs
    ? Effect.void
    : Effect.fail(failure("invalid_input"));

const resultStage = (
  tag: string
): "carousel" | "extraction" | "speech" | "visual" | null => {
  switch (tag) {
    case "Carousel": {
      return "carousel";
    }
    case "Extraction": {
      return "extraction";
    }
    case "Speech": {
      return "speech";
    }
    case "Visual": {
      return "visual";
    }
    default: {
      return null;
    }
  }
};

const expectedStageReference = (
  stage: "carousel" | "extraction" | "speech" | "visual",
  intentId: string,
  generation: number
): {
  readonly key: string;
  readonly kind: "carousel_manifest" | "speech_transcript" | "visual_manifest";
  readonly ordinal: number;
} | null => {
  switch (stage) {
    case "carousel": {
      return {
        key: `imports/${intentId}/carousel/v1/generations/${generation}/manifest.json`,
        kind: "carousel_manifest" as const,
        ordinal: 0,
      };
    }
    case "speech": {
      return {
        key: `imports/${intentId}/transcription/v1/generations/${generation}/transcript.json`,
        kind: "speech_transcript" as const,
        ordinal: 2,
      };
    }
    case "visual": {
      return {
        key: `imports/${intentId}/visual/v1/generations/${generation}/manifest.json`,
        kind: "visual_manifest" as const,
        ordinal: 3,
      };
    }
    case "extraction": {
      return null;
    }
    default: {
      return null;
    }
  }
};

const observationActionRank = {
  CompleteMultipartUpload: 0,
  CopyObject: 1,
  DeleteObject: 4,
  IntegrityProbe: 3,
  LifecycleDeletion: 5,
  PutObject: 2,
} as const;

const stageOutcome = (state: string) => {
  if (state === "completed") {
    return "Completed" as const;
  }
  if (state === "failed") {
    return "Failed" as const;
  }
  return "Dispatching" as const;
};

const sourcePermitsStage = (
  sourceKind: "carousel" | "video" | null,
  stage: "carousel" | "extraction" | "speech" | "visual"
) =>
  sourceKind === "video"
    ? stage !== "carousel"
    : sourceKind === "carousel" &&
      (stage === "carousel" || stage === "extraction");

const validateRecoveryStageMutationStructure = (
  input: HouseholdMutateEvidenceStageInputType
) =>
  input.operation._tag !== "PrepareRecovery" ||
  (input.inputFingerprint === input.operation.predecessorInputFingerprint &&
    input.operation.dispatchId !== input.operation.predecessorDispatchId)
    ? Effect.void
    : Effect.fail(failure("invalid_input"));

type CompleteStageOperation = Extract<
  HouseholdMutateEvidenceStageInputType["operation"],
  { readonly _tag: "Complete" }
>;

const validateCompleteStageMutationStructure = (
  input: HouseholdMutateEvidenceStageInputType,
  operation: CompleteStageOperation
) => {
  if (resultStage(operation.result._tag) !== operation.stage) {
    return Effect.fail(failure("invalid_input"));
  }
  const { result } = operation;
  const identityValid =
    result._tag === "Extraction"
      ? String(result.draft.importId) === String(input.intentId) &&
        result.draft.generation === input.acquisitionAttemptGeneration &&
        result.draft.extractionFingerprint === input.inputFingerprint
      : result.dispatchId === operation.dispatchId;
  if (!identityValid) {
    return Effect.fail(failure("invalid_input"));
  }
  const expected = expectedStageReference(
    operation.stage,
    input.intentId,
    input.acquisitionAttemptGeneration
  );
  if (expected === null) {
    if (operation.reference === undefined) {
      return Effect.void;
    }
    return Effect.fail(failure("invalid_input"));
  }
  const { reference } = operation;
  let resultReference: {
    readonly key: string;
    readonly sha256: string;
  } | null = null;
  if (result._tag === "Speech") {
    resultReference = {
      key: result.transcriptKey,
      sha256: result.transcriptSha256,
    };
  } else if (result._tag === "Visual" || result._tag === "Carousel") {
    resultReference = {
      key: result.manifestKey,
      sha256: result.manifestSha256,
    };
  }
  return reference !== undefined &&
    resultReference !== undefined &&
    resultReference !== null &&
    reference.kind === expected.kind &&
    reference.key === expected.key &&
    reference.key === resultReference.key &&
    reference.sha256 === resultReference.sha256
    ? Effect.void
    : Effect.fail(failure("invalid_input"));
};

const validateStageMutationStructure = (
  input: HouseholdMutateEvidenceStageInputType
) => {
  if (input.operation._tag === "Claim") {
    return input.operation.stage === "extraction" ||
      input.operation.extractionContext === undefined
      ? Effect.void
      : Effect.fail(failure("invalid_input"));
  }
  return input.operation._tag === "Complete"
    ? validateCompleteStageMutationStructure(input, input.operation)
    : Effect.void;
};

type RecoveryIntentRow = Pick<
  typeof householdRecipeImports.$inferSelect,
  "executionGeneration" | "sourceKind" | "status"
>;
type RecoveryStageRow = typeof householdEvidenceStageExecutions.$inferSelect;
type RecoveryAttemptRow = typeof importRecipeRecoveryAttempts.$inferSelect;
type TerminalCheckpointRow = typeof importTerminalCheckpoints.$inferSelect;

const requireRecoveryIntent = (
  intent: RecoveryIntentRow | undefined,
  expectedGeneration: number
) => {
  if (intent === undefined) {
    return Effect.fail(failure("intent_not_found"));
  }
  if (intent.executionGeneration !== expectedGeneration) {
    return Effect.fail(failure("generation_conflict"));
  }
  return intent.status === "processing" && intent.sourceKind === "video"
    ? Effect.succeed(intent)
    : Effect.fail(failure("illegal_transition"));
};

const requireRecoveryStage = (stage: RecoveryStageRow | undefined) =>
  stage !== undefined &&
  stage.state === "failed" &&
  stage.failureCode === "provider_error" &&
  stage.claimJson !== null
    ? Effect.succeed(stage)
    : Effect.fail(failure("illegal_transition"));

const validateRecoveryCheckpoint = (
  checkpoint: TerminalCheckpointRow | undefined,
  stage: RecoveryStageRow
) =>
  checkpoint !== undefined &&
  checkpoint.failureCode === stage.failureCode &&
  checkpoint.inputFingerprint === stage.inputFingerprint
    ? Effect.succeed(checkpoint)
    : Effect.fail(failure("illegal_transition"));

const validateRecoverySequence = (input: {
  readonly acquisitionAttemptGeneration: number;
  readonly current: RecoveryAttemptRow | undefined;
  readonly expectedPredecessorFingerprint: string;
  readonly expectedOrdinal: number;
  readonly evidenceFingerprint: string;
  readonly intentId: string;
  readonly generation: number;
  readonly predecessorDispatchId: string;
  readonly stage: RecoveryStageRow;
}) => {
  const ordinal = input.current === undefined ? 1 : input.current.ordinal + 1;
  const predecessorExtractionFingerprint =
    input.current?.currentExtractionFingerprint ?? input.stage.inputFingerprint;
  const expectedPredecessorDispatchId =
    input.current?.currentDispatchId ??
    `recipe:${input.intentId}:${input.generation}:${input.evidenceFingerprint}`;
  if (ordinal > 8) {
    return Effect.fail(failure("illegal_transition"));
  }
  const valid =
    ordinal === input.expectedOrdinal &&
    (input.current === undefined ||
      input.current.acquisitionAttemptGeneration ===
        input.acquisitionAttemptGeneration) &&
    input.stage.inputFingerprint === input.expectedPredecessorFingerprint &&
    input.predecessorDispatchId === expectedPredecessorDispatchId &&
    input.stage.inputFingerprint === predecessorExtractionFingerprint;
  return valid
    ? Effect.succeed({
        ordinal,
        predecessorExtractionFingerprint,
        rootDispatchId:
          input.current?.rootDispatchId ?? input.predecessorDispatchId,
        rootExtractionFingerprint:
          input.current?.rootExtractionFingerprint ??
          input.stage.inputFingerprint,
      })
    : Effect.fail(failure("idempotency_conflict"));
};

const validateStageMutationFreshness = (
  input: HouseholdMutateEvidenceStageInputType,
  nowEpochMs: number
) =>
  input.operation._tag !== "Complete" ||
  input.operation.reference === undefined ||
  DateTime.toEpochMillis(input.operation.reference.deleteAt) > nowEpochMs
    ? Effect.void
    : Effect.fail(failure("invalid_input"));

export const makeHouseholdEvidenceRepository = (
  database: EffectSQLiteDoDatabase
) => {
  const digestJson = (value: Schema.Json) =>
    HouseholdCanonicalEncoding.pipe(
      Effect.zip(HouseholdDigest),
      Effect.flatMap(([canonical, digest]) =>
        canonical.encode(value).pipe(Effect.flatMap(digest.sha256))
      ),
      Effect.mapError(persistenceFailure)
    );

  const readReceipt = <A>(
    connection: EffectSQLiteDoDatabase,
    mutationId: string,
    commandDigest: string,
    decodeResult: (
      resultJson: string
    ) => Effect.Effect<A, HouseholdRecipeImportFailure>
  ) =>
    connection
      .select()
      .from(householdEvidenceMutationReceipts)
      .where(eq(householdEvidenceMutationReceipts.mutationId, mutationId))
      .limit(1)
      .pipe(
        mapPersistence,
        Effect.flatMap(([row]) => {
          if (row === undefined) {
            return Effect.succeed(Option.none<A>());
          }
          if (row.commandDigest !== commandDigest) {
            return Effect.fail(failure("idempotency_conflict"));
          }
          return decodeResult(row.resultJson).pipe(Effect.map(Option.some));
        })
      );

  const persistReceipt = (
    transaction: EffectSQLiteDoDatabase,
    input: {
      readonly commandDigest: string;
      readonly mutationId: string;
      readonly resultJson: string;
    }
  ) =>
    transaction
      .insert(householdEvidenceMutationReceipts)
      .values({
        commandDigest: input.commandDigest,
        mutationId: input.mutationId,
        resultJson: input.resultJson,
      })
      .pipe(mapPersistence, Effect.asVoid);

  const commitAcquisition = (
    input: HouseholdCommitAcquisitionEvidenceInputType
  ) =>
    Effect.gen(function* commitHouseholdAcquisitionEvidence() {
      yield* ensureHouseholdProvenance(
        database,
        input.admission.organizationId
      ).pipe(Effect.mapError(persistenceFailure));
      const nowEpochMs = yield* Clock.currentTimeMillis;
      yield* validateEvidenceStructure(input);
      const encodedInput = yield* Schema.encodeEffect(
        HouseholdCommitAcquisitionEvidenceInput
      )(input).pipe(Effect.mapError(persistenceFailure));
      const commandDigest = yield* digestJson({
        acquisitionAttemptGeneration: encodedInput.acquisitionAttemptGeneration,
        expectedGeneration: encodedInput.expectedGeneration,
        intentId: encodedInput.intentId,
        operation: "commit-acquisition-evidence",
        result: encodedInput.result,
        version: 1,
      });
      const committedAt = new Date(nowEpochMs).toISOString();
      const result = yield* decode(HouseholdCommitAcquisitionEvidenceResult, {
        committedAt,
        executionGeneration: input.expectedGeneration,
        intentId: input.intentId,
        outcome: "Recorded",
        receiptVersion: 1,
      });
      const resultJson = yield* encode(EncodedCommitResult, result);
      const acquisition: {
        readonly acquiredAt: typeof encodedInput.result.acquiredAt;
        readonly audioStreams: typeof encodedInput.result.audioStreams;
        readonly durationSeconds: number;
        source?: NonNullable<typeof encodedInput.result.source>;
        readonly videoStreams: typeof encodedInput.result.videoStreams;
      } = {
        acquiredAt: encodedInput.result.acquiredAt,
        audioStreams: encodedInput.result.audioStreams,
        durationSeconds: encodedInput.result.durationSeconds,
        videoStreams: encodedInput.result.videoStreams,
      };
      if (encodedInput.result.source !== undefined) {
        acquisition.source = encodedInput.result.source;
      }
      const acquisitionJson = JSON.stringify(acquisition);

      return yield* database
        .transaction((transaction) =>
          Effect.gen(function* commitEvidenceTransaction() {
            const [intent] = yield* transaction
              .select({
                canonicalSourceId: householdRecipeImports.canonicalSourceId,
                executionGeneration: householdRecipeImports.executionGeneration,
                sourceKind: householdRecipeImports.sourceKind,
                status: householdRecipeImports.status,
              })
              .from(householdRecipeImports)
              .where(eq(householdRecipeImports.intentId, input.intentId))
              .limit(1)
              .pipe(mapPersistence);
            if (intent === undefined) {
              return yield* Effect.fail(failure("intent_not_found"));
            }
            if (intent.executionGeneration !== input.expectedGeneration) {
              return yield* Effect.fail(failure("generation_conflict"));
            }
            if (intent.sourceKind !== "video") {
              return yield* Effect.fail(failure("illegal_transition"));
            }
            const replay = yield* readReceipt(
              transaction,
              input.mutationId,
              commandDigest,
              (value) => decode(EncodedCommitResult, value)
            );
            if (Option.isSome(replay)) {
              return replay.value;
            }
            yield* validateEvidenceFreshness(input, nowEpochMs);
            if (
              intent.status !== "processing" ||
              intent.canonicalSourceId === null
            ) {
              return yield* Effect.fail(failure("illegal_transition"));
            }
            const [current] = yield* transaction
              .select()
              .from(householdImportEvidenceExecutions)
              .where(
                and(
                  eq(
                    householdImportEvidenceExecutions.intentId,
                    input.intentId
                  ),
                  eq(
                    householdImportEvidenceExecutions.executionGeneration,
                    input.expectedGeneration
                  )
                )
              )
              .limit(1)
              .pipe(mapPersistence);
            if (current !== undefined) {
              if (current.commandDigest !== commandDigest) {
                return yield* Effect.fail(failure("idempotency_conflict"));
              }
              const existingResult = yield* decode(
                EncodedCommitResult,
                current.resultJson
              );
              yield* persistReceipt(transaction, {
                commandDigest,
                mutationId: input.mutationId,
                resultJson: current.resultJson,
              });
              return existingResult;
            }
            yield* transaction
              .insert(householdImportEvidenceExecutions)
              .values({
                acquisitionAttemptGeneration:
                  input.acquisitionAttemptGeneration,
                acquisitionJson,
                commandDigest,
                committedAt,
                executionGeneration: input.expectedGeneration,
                intentId: input.intentId,
                resultJson,
                status: "acquired",
              });
            yield* transaction.insert(householdEvidenceReferences).values(
              encodedInput.result.references.map((reference, ordinal) => ({
                byteLength: reference.byteLength,
                deleteAt: reference.deleteAt,
                executionGeneration: input.expectedGeneration,
                intentId: input.intentId,
                kind: reference.kind,
                objectKey: reference.key,
                ordinal,
                sha256: reference.sha256,
              }))
            );
            yield* persistReceipt(transaction, {
              commandDigest,
              mutationId: input.mutationId,
              resultJson,
            });
            return result;
          })
        )
        .pipe(mapTransaction);
    });

  const observeReference = (
    input: HouseholdObserveEvidenceReferenceInputType
  ) =>
    Effect.gen(function* observeHouseholdEvidenceReference() {
      yield* ensureHouseholdProvenance(
        database,
        input.admission.organizationId
      ).pipe(Effect.mapError(persistenceFailure));
      const encodedInput = yield* Schema.encodeEffect(
        HouseholdObserveEvidenceReferenceInput
      )(input).pipe(Effect.mapError(persistenceFailure));
      const commandDigest = yield* digestJson({
        event: encodedInput.event,
        expectedGeneration: encodedInput.expectedGeneration,
        intentId: encodedInput.intentId,
        operation: "observe-evidence-reference",
        reference: encodedInput.reference,
        version: 1,
      });

      return yield* database
        .transaction((transaction) =>
          Effect.gen(function* observeEvidenceTransaction() {
            const replay = yield* readReceipt(
              transaction,
              input.mutationId,
              commandDigest,
              (value) => decode(EncodedObservationResult, value)
            );
            if (Option.isSome(replay)) {
              return replay.value;
            }
            const [intent] = yield* transaction
              .select({
                executionGeneration: householdRecipeImports.executionGeneration,
              })
              .from(householdRecipeImports)
              .where(eq(householdRecipeImports.intentId, input.intentId))
              .limit(1)
              .pipe(mapPersistence);
            if (intent === undefined) {
              return yield* Effect.fail(failure("intent_not_found"));
            }
            if (intent.executionGeneration !== input.expectedGeneration) {
              return yield* Effect.fail(failure("generation_conflict"));
            }
            const [reference] = yield* transaction
              .select()
              .from(householdEvidenceReferences)
              .where(
                and(
                  eq(householdEvidenceReferences.intentId, input.intentId),
                  eq(
                    householdEvidenceReferences.executionGeneration,
                    input.expectedGeneration
                  ),
                  eq(householdEvidenceReferences.kind, input.reference.kind)
                )
              )
              .limit(1)
              .pipe(mapPersistence);
            if (
              reference === undefined ||
              reference.objectKey !== input.reference.key ||
              reference.sha256 !== input.reference.sha256
            ) {
              return yield* Effect.fail(failure("invalid_input"));
            }
            const nowEpochMs = yield* Clock.currentTimeMillis;
            const committedAt = new Date(nowEpochMs).toISOString();
            const incomingEventTime = DateTime.toEpochMillis(
              input.event.eventTime
            );
            const currentEventTime =
              reference.observedEventTime === null
                ? null
                : Date.parse(reference.observedEventTime);
            const currentActionRank =
              reference.observedEventAction === null
                ? null
                : observationActionRank[reference.observedEventAction];
            const incomingActionRank =
              observationActionRank[input.event.action];
            const ignored =
              currentEventTime !== null &&
              (incomingEventTime < currentEventTime ||
                (incomingEventTime === currentEventTime &&
                  currentActionRank !== null &&
                  incomingActionRank <= currentActionRank));
            const observationOrdinal = ignored
              ? reference.observationOrdinal
              : reference.observationOrdinal + 1;
            const result = yield* decode(
              HouseholdObserveEvidenceReferenceResult,
              {
                availability: ignored
                  ? reference.availability
                  : input.availability,
                committedAt,
                executionGeneration: input.expectedGeneration,
                intentId: input.intentId,
                kind: input.reference.kind,
                observationOrdinal,
                outcome: ignored ? "IgnoredOlder" : "Applied",
                receiptVersion: 1,
              }
            );
            const resultJson = yield* encode(EncodedObservationResult, result);
            if (!ignored) {
              yield* transaction
                .update(householdEvidenceReferences)
                .set({
                  availability: input.availability,
                  observationOrdinal,
                  observedAt: committedAt,
                  observedEventAction: input.event.action,
                  observedEventTime: encodedInput.event.eventTime,
                })
                .where(
                  and(
                    eq(householdEvidenceReferences.intentId, input.intentId),
                    eq(
                      householdEvidenceReferences.executionGeneration,
                      input.expectedGeneration
                    ),
                    eq(householdEvidenceReferences.kind, input.reference.kind),
                    eq(
                      householdEvidenceReferences.observationOrdinal,
                      reference.observationOrdinal
                    )
                  )
                );
            }
            yield* persistReceipt(transaction, {
              commandDigest,
              mutationId: input.mutationId,
              resultJson,
            });
            return result;
          })
        )
        .pipe(mapTransaction);
    });

  const mutateStage = (input: HouseholdMutateEvidenceStageInputType) =>
    Effect.gen(function* mutateHouseholdEvidenceStage() {
      yield* ensureHouseholdProvenance(
        database,
        input.admission.organizationId
      ).pipe(Effect.mapError(persistenceFailure));
      const nowEpochMs = yield* Clock.currentTimeMillis;
      yield* validateRecoveryStageMutationStructure(input);
      yield* validateStageMutationStructure(input);
      const encodedInput = yield* Schema.encodeEffect(
        HouseholdMutateEvidenceStageInput
      )(input).pipe(Effect.mapError(persistenceFailure));
      const commandDigest = yield* digestJson({
        expectedGeneration: encodedInput.expectedGeneration,
        inputFingerprint: encodedInput.inputFingerprint,
        intentId: encodedInput.intentId,
        operation: encodedInput.operation,
        version: 1,
      });

      return yield* database
        .transaction((transaction) =>
          Effect.gen(function* mutateEvidenceStageTransaction() {
            const [intent] = yield* transaction
              .select({
                executionGeneration: householdRecipeImports.executionGeneration,
                sourceKind: householdRecipeImports.sourceKind,
                status: householdRecipeImports.status,
              })
              .from(householdRecipeImports)
              .where(eq(householdRecipeImports.intentId, input.intentId))
              .limit(1)
              .pipe(mapPersistence);
            if (intent === undefined) {
              return yield* Effect.fail(failure("intent_not_found"));
            }
            if (intent.executionGeneration !== input.expectedGeneration) {
              return yield* Effect.fail(failure("generation_conflict"));
            }
            if (!sourcePermitsStage(intent.sourceKind, input.operation.stage)) {
              return yield* Effect.fail(failure("illegal_transition"));
            }
            if (
              input.operation._tag === "Claim" &&
              input.operation.stage === "extraction" &&
              (intent.sourceKind === "video") !==
                (input.operation.extractionContext !== undefined)
            ) {
              return yield* Effect.fail(failure("invalid_input"));
            }
            const replay = yield* readReceipt(
              transaction,
              input.mutationId,
              commandDigest,
              (value) => decode(EncodedStageMutationResult, value)
            );
            if (Option.isSome(replay)) {
              return replay.value;
            }
            yield* validateStageMutationFreshness(input, nowEpochMs);
            if (
              intent.status !== "processing" &&
              input.operation._tag !== "PrepareRecovery"
            ) {
              return yield* Effect.fail(failure("illegal_transition"));
            }
            const [current] = yield* transaction
              .select()
              .from(householdEvidenceStageExecutions)
              .where(
                and(
                  eq(householdEvidenceStageExecutions.intentId, input.intentId),
                  eq(
                    householdEvidenceStageExecutions.executionGeneration,
                    input.expectedGeneration
                  ),
                  eq(
                    householdEvidenceStageExecutions.stage,
                    input.operation.stage
                  )
                )
              )
              .limit(1)
              .pipe(mapPersistence);
            const committedAt = new Date(nowEpochMs).toISOString();
            const claimStage = Effect.gen(function* claimEvidenceStage() {
              if (input.operation._tag !== "Claim") {
                return yield* Effect.fail(failure("invalid_input"));
              }
              if (current === undefined) {
                const claimJson =
                  input.operation.extractionContext === undefined
                    ? null
                    : JSON.stringify(input.operation.extractionContext);
                yield* transaction
                  .insert(householdEvidenceStageExecutions)
                  .values({
                    acquisitionAttemptGeneration:
                      input.acquisitionAttemptGeneration,
                    claimJson,
                    committedAt,
                    dispatchId: input.operation.dispatchId,
                    executionGeneration: input.expectedGeneration,
                    inputFingerprint: input.inputFingerprint,
                    intentId: input.intentId,
                    stage: input.operation.stage,
                    startedAt: DateTime.formatIso(input.operation.startedAt),
                    state: "dispatching",
                  });
                return "DispatchClaimed" as const;
              }
              if (
                current.acquisitionAttemptGeneration !==
                  input.acquisitionAttemptGeneration ||
                current.inputFingerprint !== input.inputFingerprint ||
                current.dispatchId !== input.operation.dispatchId
              ) {
                return yield* Effect.fail(failure("idempotency_conflict"));
              }
              if (current.state === "completed") {
                return "Completed" as const;
              }
              if (current.state === "failed") {
                return "Failed" as const;
              }
              return "ResumeDispatch" as const;
            });
            const completeStage = Effect.gen(function* completeEvidenceStage() {
              if (input.operation._tag !== "Complete") {
                return yield* Effect.fail(failure("invalid_input"));
              }
              if (
                current === undefined ||
                current.acquisitionAttemptGeneration !==
                  input.acquisitionAttemptGeneration ||
                current.inputFingerprint !== input.inputFingerprint ||
                current.dispatchId !== input.operation.dispatchId
              ) {
                return yield* Effect.fail(
                  failure(
                    current === undefined
                      ? "illegal_transition"
                      : "idempotency_conflict"
                  )
                );
              }
              const encodedResult = yield* Schema.encodeEffect(
                HouseholdEvidenceStageResult
              )(input.operation.result).pipe(
                Effect.mapError(persistenceFailure)
              );
              const resultJson = JSON.stringify(encodedResult);
              if (current.state === "completed") {
                if (current.resultJson !== resultJson) {
                  return yield* Effect.fail(failure("idempotency_conflict"));
                }
              } else if (current.state === "dispatching") {
                yield* transaction
                  .update(householdEvidenceStageExecutions)
                  .set({ committedAt, resultJson, state: "completed" })
                  .where(
                    and(
                      eq(
                        householdEvidenceStageExecutions.intentId,
                        input.intentId
                      ),
                      eq(
                        householdEvidenceStageExecutions.executionGeneration,
                        input.expectedGeneration
                      ),
                      eq(
                        householdEvidenceStageExecutions.stage,
                        input.operation.stage
                      ),
                      eq(
                        householdEvidenceStageExecutions.dispatchId,
                        input.operation.dispatchId
                      ),
                      eq(householdEvidenceStageExecutions.state, "dispatching")
                    )
                  );
                const { reference } = input.operation;
                const expected = expectedStageReference(
                  input.operation.stage,
                  input.intentId,
                  input.acquisitionAttemptGeneration
                );
                if (reference !== undefined && expected !== null) {
                  yield* transaction
                    .insert(householdEvidenceReferences)
                    .values({
                      byteLength: reference.byteLength,
                      deleteAt: DateTime.formatIso(reference.deleteAt),
                      executionGeneration: input.expectedGeneration,
                      intentId: input.intentId,
                      kind: reference.kind,
                      objectKey: reference.key,
                      ordinal: expected.ordinal,
                      sha256: reference.sha256,
                    });
                }
              } else {
                return yield* Effect.fail(failure("illegal_transition"));
              }
              return "Completed" as const;
            });
            const failStage = Effect.gen(function* failEvidenceStage() {
              if (input.operation._tag !== "Fail") {
                return yield* Effect.fail(failure("invalid_input"));
              }
              if (
                current === undefined ||
                current.acquisitionAttemptGeneration !==
                  input.acquisitionAttemptGeneration ||
                current.inputFingerprint !== input.inputFingerprint ||
                current.dispatchId !== input.operation.dispatchId
              ) {
                return yield* Effect.fail(
                  failure(
                    current === undefined
                      ? "illegal_transition"
                      : "idempotency_conflict"
                  )
                );
              }
              if (current.state === "failed") {
                if (
                  current.failureCode !== input.operation.failureCode ||
                  current.completedAt !==
                    DateTime.formatIso(input.operation.completedAt)
                ) {
                  return yield* Effect.fail(failure("idempotency_conflict"));
                }
              } else if (current.state === "dispatching") {
                yield* transaction
                  .update(householdEvidenceStageExecutions)
                  .set({
                    committedAt,
                    completedAt: DateTime.formatIso(
                      input.operation.completedAt
                    ),
                    failureCode: input.operation.failureCode,
                    state: "failed",
                  })
                  .where(
                    and(
                      eq(
                        householdEvidenceStageExecutions.intentId,
                        input.intentId
                      ),
                      eq(
                        householdEvidenceStageExecutions.executionGeneration,
                        input.expectedGeneration
                      ),
                      eq(
                        householdEvidenceStageExecutions.stage,
                        input.operation.stage
                      ),
                      eq(
                        householdEvidenceStageExecutions.dispatchId,
                        input.operation.dispatchId
                      ),
                      eq(householdEvidenceStageExecutions.state, "dispatching")
                    )
                  );
                if (input.operation.stage !== "carousel") {
                  yield* transaction.insert(importTerminalCheckpoints).values({
                    completedAt: DateTime.formatIso(
                      input.operation.completedAt
                    ),
                    executionGeneration: input.expectedGeneration,
                    failureCode: input.operation.failureCode,
                    inputFingerprint: input.inputFingerprint,
                    intentId: input.intentId,
                    ownershipId: input.operation.dispatchId,
                    stage: input.operation.stage,
                  });
                }
              } else {
                return yield* Effect.fail(failure("illegal_transition"));
              }
              return "Failed" as const;
            });
            const currentMatchesRecoveryAttempt =
              current?.acquisitionAttemptGeneration ===
                input.acquisitionAttemptGeneration &&
              current?.inputFingerprint === input.inputFingerprint &&
              current.dispatchId === input.operation.dispatchId;
            const prepareRecoveryStage = Effect.gen(
              function* prepareFailedProviderRecovery() {
                if (input.operation._tag !== "PrepareRecovery") {
                  return yield* Effect.fail(failure("invalid_input"));
                }
                if (currentMatchesRecoveryAttempt) {
                  return "RecoveryPrepared" as const;
                }
                if (
                  current === undefined ||
                  current.inputFingerprint !==
                    input.operation.predecessorInputFingerprint ||
                  current.dispatchId !== input.operation.predecessorDispatchId
                ) {
                  return yield* Effect.fail(
                    failure(
                      current === undefined
                        ? "illegal_transition"
                        : "idempotency_conflict"
                    )
                  );
                }
                if (
                  current.state !== "failed" ||
                  current.failureCode !== "outcome_unknown"
                ) {
                  return yield* Effect.fail(failure("illegal_transition"));
                }
                const [checkpoint] = yield* transaction
                  .select()
                  .from(importTerminalCheckpoints)
                  .where(
                    and(
                      eq(importTerminalCheckpoints.intentId, input.intentId),
                      eq(
                        importTerminalCheckpoints.executionGeneration,
                        input.expectedGeneration
                      ),
                      eq(
                        importTerminalCheckpoints.stage,
                        input.operation.stage
                      ),
                      eq(
                        importTerminalCheckpoints.ownershipId,
                        input.operation.predecessorDispatchId
                      )
                    )
                  )
                  .limit(1)
                  .pipe(mapPersistence);
                if (
                  checkpoint === undefined ||
                  checkpoint.failureCode !== current.failureCode ||
                  checkpoint.inputFingerprint !== current.inputFingerprint
                ) {
                  return yield* Effect.fail(failure("illegal_transition"));
                }
                const recoveryStartedAt = checkpoint.completedAt;
                yield* transaction
                  .update(householdEvidenceStageExecutions)
                  .set({
                    acquisitionAttemptGeneration:
                      input.acquisitionAttemptGeneration,
                    committedAt,
                    completedAt: null,
                    dispatchId: input.operation.dispatchId,
                    failureCode: null,
                    inputFingerprint: input.inputFingerprint,
                    resultJson: null,
                    startedAt: recoveryStartedAt,
                    state: "dispatching",
                  })
                  .where(
                    and(
                      eq(
                        householdEvidenceStageExecutions.intentId,
                        input.intentId
                      ),
                      eq(
                        householdEvidenceStageExecutions.executionGeneration,
                        input.expectedGeneration
                      ),
                      eq(
                        householdEvidenceStageExecutions.stage,
                        input.operation.stage
                      ),
                      eq(
                        householdEvidenceStageExecutions.dispatchId,
                        input.operation.predecessorDispatchId
                      ),
                      eq(householdEvidenceStageExecutions.state, "failed")
                    )
                  );
                const [failedIntentRow] = yield* transaction
                  .select({ intentJson: householdRecipeImports.intentJson })
                  .from(householdRecipeImports)
                  .where(eq(householdRecipeImports.intentId, input.intentId))
                  .limit(1)
                  .pipe(mapPersistence);
                if (failedIntentRow === undefined) {
                  return yield* Effect.fail(failure("intent_not_found"));
                }
                const failedIntent = yield* decode(
                  EncodedRecipeImportIntent,
                  failedIntentRow.intentJson
                );
                if (failedIntent.status !== "failed") {
                  return yield* Effect.fail(failure("illegal_transition"));
                }
                const failedWire = yield* encode(
                  FailedRecipeImportIntent,
                  failedIntent
                );
                const {
                  error: _error,
                  failedAt: _failedAt,
                  ...common
                } = failedWire;
                const recoveredIntent = yield* decode(
                  ProcessingRecipeImportIntent,
                  {
                    ...common,
                    activity: { type: "working" },
                    intentVersion: failedIntent.intentVersion + 1,
                    processing: {
                      speech:
                        input.operation.stage === "speech"
                          ? "processing"
                          : "completed",
                      startedAt: recoveryStartedAt,
                      type: "analyzing_evidence",
                      visuals:
                        input.operation.stage === "visual"
                          ? "processing"
                          : "not_started",
                    },
                    status: "processing",
                    updatedAt: recoveryStartedAt,
                  }
                );
                yield* transaction
                  .update(householdRecipeImports)
                  .set({
                    intentJson: yield* encode(
                      EncodedRecipeImportIntent,
                      recoveredIntent
                    ),
                    status: "processing",
                    updatedAt: recoveryStartedAt,
                  })
                  .where(eq(householdRecipeImports.intentId, input.intentId));
                yield* transaction
                  .insert(householdRecipeImportTimeline)
                  .values({
                    eventJson: yield* encode(
                      EncodedRecipeImportTimelineEvent,
                      yield* decode(RecipeImportTimelineEvent, {
                        at: recoveryStartedAt,
                        intentVersion: recoveredIntent.intentVersion,
                        type: "recovered",
                      })
                    ),
                    intentId: input.intentId,
                    intentVersion: recoveredIntent.intentVersion,
                  });
                return "RecoveryPrepared" as const;
              }
            );
            let outcome:
              | "Completed"
              | "DispatchClaimed"
              | "Failed"
              | "RecoveryPrepared"
              | "ResumeDispatch";
            switch (input.operation._tag) {
              case "Claim": {
                outcome = yield* claimStage;
                break;
              }
              case "Complete": {
                outcome = yield* completeStage;
                break;
              }
              case "Fail": {
                outcome = yield* failStage;
                break;
              }
              case "PrepareRecovery": {
                outcome = yield* prepareRecoveryStage;
                break;
              }
              default: {
                return yield* Effect.fail(failure("invalid_input"));
              }
            }
            const result = yield* decode(HouseholdMutateEvidenceStageResult, {
              acquisitionAttemptGeneration: input.acquisitionAttemptGeneration,
              committedAt,
              executionGeneration: input.expectedGeneration,
              intentId: input.intentId,
              outcome,
              receiptVersion: 1,
              stage: input.operation.stage,
            });
            const resultJson = yield* encode(
              EncodedStageMutationResult,
              result
            );
            yield* persistReceipt(transaction, {
              commandDigest,
              mutationId: input.mutationId,
              resultJson,
            });
            return result;
          })
        )
        .pipe(mapTransaction);
    });

  const readTerminalCheckpoint = (
    input: HouseholdReadImportTerminalCheckpointInputType
  ) =>
    Effect.gen(function* readHouseholdImportTerminalCheckpoint() {
      yield* ensureHouseholdProvenance(
        database,
        input.admission.organizationId
      ).pipe(Effect.mapError(persistenceFailure));
      const [intent] = yield* database
        .select({
          executionGeneration: householdRecipeImports.executionGeneration,
        })
        .from(householdRecipeImports)
        .where(eq(householdRecipeImports.intentId, input.intentId))
        .limit(1)
        .pipe(mapPersistence);
      if (intent === undefined) {
        return yield* Effect.fail(failure("intent_not_found"));
      }
      if (intent.executionGeneration !== input.expectedGeneration) {
        return yield* Effect.fail(failure("generation_conflict"));
      }
      const [checkpoint] = yield* database
        .select()
        .from(importTerminalCheckpoints)
        .where(
          and(
            eq(importTerminalCheckpoints.intentId, input.intentId),
            eq(
              importTerminalCheckpoints.executionGeneration,
              input.expectedGeneration
            ),
            eq(importTerminalCheckpoints.stage, input.stage),
            eq(importTerminalCheckpoints.ownershipId, input.ownershipId)
          )
        )
        .limit(1)
        .pipe(mapPersistence);
      return yield* decode(
        HouseholdReadImportTerminalCheckpointResult,
        checkpoint === undefined
          ? null
          : {
              completedAt: checkpoint.completedAt,
              executionGeneration: checkpoint.executionGeneration,
              failureCode: checkpoint.failureCode,
              inputFingerprint: checkpoint.inputFingerprint,
              intentId: checkpoint.intentId,
              ownershipId: checkpoint.ownershipId,
              stage: checkpoint.stage,
            }
      );
    });

  const prepareRecipeRecovery = (
    input: HouseholdPrepareRecipeRecoveryInputType
  ) =>
    Effect.gen(function* prepareHouseholdRecipeRecovery() {
      yield* ensureHouseholdProvenance(
        database,
        input.admission.organizationId
      ).pipe(Effect.mapError(persistenceFailure));
      const encodedInput = yield* Schema.encodeEffect(
        HouseholdPrepareRecipeRecoveryInput
      )(input).pipe(Effect.mapError(persistenceFailure));
      const commandDigest = yield* digestJson({
        acquisitionAttemptGeneration: encodedInput.acquisitionAttemptGeneration,
        expectedGeneration: encodedInput.expectedGeneration,
        intentId: encodedInput.intentId,
        operation: "prepare-recipe-recovery",
        predecessorDispatchId: encodedInput.predecessorDispatchId,
        version: 1,
      });
      const nowEpochMs = yield* Clock.currentTimeMillis;
      const createdAt = new Date(nowEpochMs).toISOString();
      const [preflightStage] = yield* database
        .select({
          inputFingerprint: householdEvidenceStageExecutions.inputFingerprint,
        })
        .from(householdEvidenceStageExecutions)
        .where(
          and(
            eq(householdEvidenceStageExecutions.intentId, input.intentId),
            eq(
              householdEvidenceStageExecutions.executionGeneration,
              input.expectedGeneration
            ),
            eq(householdEvidenceStageExecutions.stage, "extraction")
          )
        )
        .limit(1)
        .pipe(mapPersistence);
      const [preflightCurrent] = yield* database
        .select({
          currentExtractionFingerprint:
            importRecipeRecoveryAttempts.currentExtractionFingerprint,
          ordinal: importRecipeRecoveryAttempts.ordinal,
        })
        .from(importRecipeRecoveryAttempts)
        .where(
          and(
            eq(importRecipeRecoveryAttempts.intentId, input.intentId),
            eq(
              importRecipeRecoveryAttempts.executionGeneration,
              input.expectedGeneration
            )
          )
        )
        .orderBy(desc(importRecipeRecoveryAttempts.ordinal))
        .limit(1)
        .pipe(mapPersistence);
      if (preflightStage === undefined) {
        return yield* Effect.fail(failure("illegal_transition"));
      }
      const preflightOrdinal =
        preflightCurrent === undefined ? 1 : preflightCurrent.ordinal + 1;
      const preflightPredecessorExtractionFingerprint =
        preflightCurrent?.currentExtractionFingerprint ??
        preflightStage.inputFingerprint;
      const proposedExtractionFingerprint = yield* digestJson({
        originalExtractionFingerprint:
          preflightPredecessorExtractionFingerprint,
        recoveryIdentity: `recovery:${preflightOrdinal}`,
      });

      return yield* database
        .transaction((transaction) =>
          Effect.gen(function* prepareRecipeRecoveryTransaction() {
            const [intent] = yield* transaction
              .select({
                executionGeneration: householdRecipeImports.executionGeneration,
                sourceKind: householdRecipeImports.sourceKind,
                status: householdRecipeImports.status,
              })
              .from(householdRecipeImports)
              .where(eq(householdRecipeImports.intentId, input.intentId))
              .limit(1)
              .pipe(mapPersistence);
            yield* requireRecoveryIntent(intent, input.expectedGeneration);
            const replay = yield* readReceipt(
              transaction,
              input.mutationId,
              commandDigest,
              (value) => decode(EncodedRecoveryPreparationResult, value)
            );
            if (Option.isSome(replay)) {
              return replay.value;
            }
            const [stage] = yield* transaction
              .select()
              .from(householdEvidenceStageExecutions)
              .where(
                and(
                  eq(householdEvidenceStageExecutions.intentId, input.intentId),
                  eq(
                    householdEvidenceStageExecutions.executionGeneration,
                    input.expectedGeneration
                  ),
                  eq(householdEvidenceStageExecutions.stage, "extraction")
                )
              )
              .limit(1)
              .pipe(mapPersistence);
            const [current] = yield* transaction
              .select()
              .from(importRecipeRecoveryAttempts)
              .where(
                and(
                  eq(importRecipeRecoveryAttempts.intentId, input.intentId),
                  eq(
                    importRecipeRecoveryAttempts.executionGeneration,
                    input.expectedGeneration
                  )
                )
              )
              .orderBy(desc(importRecipeRecoveryAttempts.ordinal))
              .limit(1)
              .pipe(mapPersistence);
            if (
              current !== undefined &&
              input.predecessorDispatchId !== current.currentDispatchId
            ) {
              return yield* Effect.fail(failure("idempotency_conflict"));
            }
            const validStage = yield* requireRecoveryStage(stage);
            const claimValue = yield* Effect.try({
              catch: persistenceFailure,
              try: () => JSON.parse(validStage.claimJson as string) as unknown,
            });
            const claim = yield* Schema.decodeUnknownEffect(
              HouseholdExtractionClaimContext,
              { onExcessProperty: "error" }
            )(claimValue).pipe(Effect.mapError(persistenceFailure));

            const [checkpoint] = yield* transaction
              .select()
              .from(importTerminalCheckpoints)
              .where(
                and(
                  eq(importTerminalCheckpoints.intentId, input.intentId),
                  eq(
                    importTerminalCheckpoints.executionGeneration,
                    input.expectedGeneration
                  ),
                  eq(importTerminalCheckpoints.stage, "extraction"),
                  eq(
                    importTerminalCheckpoints.ownershipId,
                    validStage.dispatchId
                  )
                )
              )
              .limit(1)
              .pipe(mapPersistence);
            const validCheckpoint = yield* validateRecoveryCheckpoint(
              checkpoint,
              validStage
            );
            const {
              ordinal,
              predecessorExtractionFingerprint,
              rootDispatchId,
              rootExtractionFingerprint,
            } = yield* validateRecoverySequence({
              acquisitionAttemptGeneration: input.acquisitionAttemptGeneration,
              current,
              evidenceFingerprint: claim.evidenceFingerprint,
              expectedOrdinal: preflightOrdinal,
              expectedPredecessorFingerprint:
                preflightPredecessorExtractionFingerprint,
              generation: input.acquisitionAttemptGeneration,
              intentId: input.intentId,
              predecessorDispatchId: input.predecessorDispatchId,
              stage: validStage,
            });
            const currentDispatchId = `${rootDispatchId}:recovery:${ordinal}`;
            const currentExtractionFingerprint = proposedExtractionFingerprint;
            const attempt = yield* Schema.decodeUnknownEffect(
              HouseholdReadRecipeRecoveryAttemptResult,
              { onExcessProperty: "error" }
            )({
              acquisitionGeneration: input.acquisitionAttemptGeneration,
              createdAt,
              currentDispatchId,
              currentExtractionFingerprint,
              evidenceFingerprint: claim.evidenceFingerprint,
              executionGeneration: input.expectedGeneration,
              importId: input.intentId,
              ordinal,
              predecessorDispatchId: input.predecessorDispatchId,
              predecessorExtractionFingerprint,
              rootDispatchId,
              rootExtractionFingerprint,
              sourceMediaSha256: claim.sourceMediaSha256,
              terminalCheckpointCompletedAt: validCheckpoint.completedAt,
              transcriptSha256: claim.transcriptSha256,
              visualManifestSha256: claim.visualManifestSha256,
            }).pipe(Effect.mapError(persistenceFailure));
            if (attempt === null) {
              return yield* Effect.fail(persistenceFailure());
            }
            const result: HouseholdPrepareRecipeRecoveryResult = {
              attempt,
              outcome: "Prepared",
              receiptVersion: 1,
            };
            const resultJson = yield* encode(
              EncodedRecoveryPreparationResult,
              result
            );
            yield* transaction.insert(importRecipeRecoveryAttempts).values({
              acquisitionAttemptGeneration: input.acquisitionAttemptGeneration,
              createdAt,
              currentDispatchId,
              currentExtractionFingerprint,
              evidenceFingerprint: claim.evidenceFingerprint,
              executionGeneration: input.expectedGeneration,
              intentId: input.intentId,
              ordinal,
              predecessorDispatchId: input.predecessorDispatchId,
              predecessorExtractionFingerprint,
              rootDispatchId,
              rootExtractionFingerprint,
              sourceMediaSha256: claim.sourceMediaSha256,
              terminalCheckpointCompletedAt: validCheckpoint.completedAt,
              transcriptSha256: claim.transcriptSha256,
              visualManifestSha256: claim.visualManifestSha256,
            });
            yield* transaction
              .update(householdEvidenceStageExecutions)
              .set({
                committedAt: createdAt,
                dispatchId: currentExtractionFingerprint,
                failureCode: null,
                inputFingerprint: currentExtractionFingerprint,
                resultJson: null,
                state: "dispatching",
              })
              .where(
                and(
                  eq(householdEvidenceStageExecutions.intentId, input.intentId),
                  eq(
                    householdEvidenceStageExecutions.executionGeneration,
                    input.expectedGeneration
                  ),
                  eq(householdEvidenceStageExecutions.stage, "extraction"),
                  eq(
                    householdEvidenceStageExecutions.dispatchId,
                    validStage.dispatchId
                  ),
                  eq(householdEvidenceStageExecutions.state, "failed")
                )
              );
            yield* persistReceipt(transaction, {
              commandDigest,
              mutationId: input.mutationId,
              resultJson,
            });
            return result;
          })
        )
        .pipe(mapTransaction);
    });

  const readRecipeRecoveryAttempt = (
    input: HouseholdReadRecipeRecoveryAttemptInputType
  ) =>
    Effect.gen(function* readHouseholdRecipeRecoveryAttempt() {
      yield* ensureHouseholdProvenance(
        database,
        input.admission.organizationId
      ).pipe(Effect.mapError(persistenceFailure));
      const [intent] = yield* database
        .select({
          executionGeneration: householdRecipeImports.executionGeneration,
        })
        .from(householdRecipeImports)
        .where(eq(householdRecipeImports.intentId, input.intentId))
        .limit(1)
        .pipe(mapPersistence);
      if (intent === undefined) {
        return yield* Effect.fail(failure("intent_not_found"));
      }
      if (intent.executionGeneration !== input.expectedGeneration) {
        return yield* Effect.fail(failure("generation_conflict"));
      }
      const conditions = [
        eq(importRecipeRecoveryAttempts.intentId, input.intentId),
        eq(
          importRecipeRecoveryAttempts.executionGeneration,
          input.expectedGeneration
        ),
      ];
      if (input.selector._tag === "Ordinal") {
        conditions.push(
          eq(importRecipeRecoveryAttempts.ordinal, input.selector.ordinal)
        );
      } else {
        conditions.push(
          eq(
            importRecipeRecoveryAttempts.rootDispatchId,
            input.selector.rootDispatchId
          )
        );
      }
      const [attempt] = yield* database
        .select()
        .from(importRecipeRecoveryAttempts)
        .where(and(...conditions))
        .orderBy(desc(importRecipeRecoveryAttempts.ordinal))
        .limit(1)
        .pipe(mapPersistence);
      return yield* decode(
        HouseholdReadRecipeRecoveryAttemptResult,
        attempt === undefined
          ? null
          : {
              acquisitionGeneration: attempt.acquisitionAttemptGeneration,
              createdAt: attempt.createdAt,
              currentDispatchId: attempt.currentDispatchId,
              currentExtractionFingerprint:
                attempt.currentExtractionFingerprint,
              evidenceFingerprint: attempt.evidenceFingerprint,
              executionGeneration: attempt.executionGeneration,
              importId: attempt.intentId,
              ordinal: attempt.ordinal,
              predecessorDispatchId: attempt.predecessorDispatchId,
              predecessorExtractionFingerprint:
                attempt.predecessorExtractionFingerprint,
              rootDispatchId: attempt.rootDispatchId,
              rootExtractionFingerprint: attempt.rootExtractionFingerprint,
              sourceMediaSha256: attempt.sourceMediaSha256,
              terminalCheckpointCompletedAt:
                attempt.terminalCheckpointCompletedAt,
              transcriptSha256: attempt.transcriptSha256,
              visualManifestSha256: attempt.visualManifestSha256,
            }
      );
    });

  const readStage = (input: HouseholdReadEvidenceStageInputType) =>
    Effect.gen(function* readHouseholdEvidenceStage() {
      yield* ensureHouseholdProvenance(
        database,
        input.admission.organizationId
      ).pipe(Effect.mapError(persistenceFailure));
      const [intent] = yield* database
        .select({
          executionGeneration: householdRecipeImports.executionGeneration,
        })
        .from(householdRecipeImports)
        .where(eq(householdRecipeImports.intentId, input.intentId))
        .limit(1)
        .pipe(mapPersistence);
      if (intent === undefined) {
        return yield* Effect.fail(failure("intent_not_found"));
      }
      if (intent.executionGeneration !== input.expectedGeneration) {
        return yield* Effect.fail(failure("generation_conflict"));
      }
      const [stage] = yield* database
        .select()
        .from(householdEvidenceStageExecutions)
        .where(
          and(
            eq(householdEvidenceStageExecutions.intentId, input.intentId),
            eq(
              householdEvidenceStageExecutions.executionGeneration,
              input.expectedGeneration
            ),
            eq(householdEvidenceStageExecutions.stage, input.stage)
          )
        )
        .limit(1)
        .pipe(mapPersistence);
      if (stage === undefined) {
        return null;
      }
      const result =
        stage.resultJson === null
          ? null
          : yield* Effect.try({
              catch: persistenceFailure,
              try: () => JSON.parse(stage.resultJson as string) as unknown,
            });
      const extractionContext =
        stage.claimJson === null
          ? null
          : yield* Effect.try({
              catch: persistenceFailure,
              try: () => JSON.parse(stage.claimJson as string) as unknown,
            });
      const expectedReference = expectedStageReference(
        input.stage,
        input.intentId,
        stage.acquisitionAttemptGeneration
      );
      const [reference] =
        expectedReference === null
          ? [undefined]
          : yield* database
              .select()
              .from(householdEvidenceReferences)
              .where(
                and(
                  eq(householdEvidenceReferences.intentId, input.intentId),
                  eq(
                    householdEvidenceReferences.executionGeneration,
                    input.expectedGeneration
                  ),
                  eq(householdEvidenceReferences.kind, expectedReference.kind)
                )
              )
              .limit(1)
              .pipe(mapPersistence);
      return yield* Schema.decodeUnknownEffect(
        HouseholdReadEvidenceStageResult,
        {
          onExcessProperty: "error",
        }
      )({
        acquisitionAttemptGeneration: stage.acquisitionAttemptGeneration,
        committedAt: stage.committedAt,
        completedAt: stage.completedAt,
        dispatchId: stage.dispatchId,
        executionGeneration: input.expectedGeneration,
        extractionContext,
        failureCode: stage.failureCode,
        inputFingerprint: stage.inputFingerprint,
        intentId: input.intentId,
        outcome: stageOutcome(stage.state),
        reference:
          reference === undefined
            ? null
            : {
                byteLength: reference.byteLength,
                deleteAt: reference.deleteAt,
                key: reference.objectKey,
                kind: reference.kind,
                sha256: reference.sha256,
              },
        result,
        stage: input.stage,
        startedAt: stage.startedAt,
      }).pipe(Effect.mapError(persistenceFailure));
    });

  const readReferences = (input: HouseholdReadEvidenceReferencesInputType) =>
    Effect.gen(function* readHouseholdEvidenceReferences() {
      yield* ensureHouseholdProvenance(
        database,
        input.admission.organizationId
      ).pipe(Effect.mapError(persistenceFailure));
      const [intent] = yield* database
        .select({
          executionGeneration: householdRecipeImports.executionGeneration,
          sourceKind: householdRecipeImports.sourceKind,
        })
        .from(householdRecipeImports)
        .where(eq(householdRecipeImports.intentId, input.intentId))
        .limit(1)
        .pipe(mapPersistence);
      if (intent === undefined) {
        return yield* Effect.fail(failure("intent_not_found"));
      }
      if (intent.executionGeneration !== input.expectedGeneration) {
        return yield* Effect.fail(failure("generation_conflict"));
      }
      const [acquisitionExecution] = yield* database
        .select({ committedAt: householdImportEvidenceExecutions.committedAt })
        .from(householdImportEvidenceExecutions)
        .where(
          and(
            eq(householdImportEvidenceExecutions.intentId, input.intentId),
            eq(
              householdImportEvidenceExecutions.executionGeneration,
              input.expectedGeneration
            )
          )
        )
        .limit(1)
        .pipe(mapPersistence);
      const [carouselExecution] = yield* database
        .select({
          committedAt: householdEvidenceStageExecutions.committedAt,
        })
        .from(householdEvidenceStageExecutions)
        .where(
          and(
            eq(householdEvidenceStageExecutions.intentId, input.intentId),
            eq(
              householdEvidenceStageExecutions.executionGeneration,
              input.expectedGeneration
            ),
            eq(householdEvidenceStageExecutions.stage, "carousel"),
            eq(householdEvidenceStageExecutions.state, "completed")
          )
        )
        .limit(1)
        .pipe(mapPersistence);
      if (
        (intent.sourceKind === "video" && carouselExecution !== undefined) ||
        (intent.sourceKind === "carousel" &&
          acquisitionExecution !== undefined) ||
        (intent.sourceKind === null &&
          (acquisitionExecution !== undefined ||
            carouselExecution !== undefined))
      ) {
        return yield* Effect.fail(persistenceFailure());
      }
      let committedAt: string | undefined;
      if (intent.sourceKind === "video") {
        committedAt = acquisitionExecution?.committedAt;
      } else if (intent.sourceKind === "carousel") {
        committedAt = carouselExecution?.committedAt;
      }
      if (committedAt === undefined) {
        return null;
      }
      const references = yield* database
        .select()
        .from(householdEvidenceReferences)
        .where(
          and(
            eq(householdEvidenceReferences.intentId, input.intentId),
            eq(
              householdEvidenceReferences.executionGeneration,
              input.expectedGeneration
            )
          )
        )
        .orderBy(asc(householdEvidenceReferences.ordinal))
        .pipe(mapPersistence);
      return yield* decode(HouseholdReadEvidenceReferencesResult, {
        committedAt,
        executionGeneration: input.expectedGeneration,
        intentId: input.intentId,
        references: references.map((reference) => ({
          availability: reference.availability,
          byteLength: reference.byteLength,
          deleteAt: reference.deleteAt,
          key: reference.objectKey,
          kind: reference.kind,
          observationOrdinal: reference.observationOrdinal,
          sha256: reference.sha256,
        })),
      });
    });

  return {
    commitAcquisition,
    mutateStage,
    observeReference,
    prepareRecipeRecovery,
    readRecipeRecoveryAttempt,
    readReferences,
    readStage,
    readTerminalCheckpoint,
  } as const;
};
