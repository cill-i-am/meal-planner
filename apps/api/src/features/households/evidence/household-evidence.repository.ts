import { and, asc, eq } from "drizzle-orm";
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
  HouseholdReadEvidenceStageResult,
  HouseholdReadEvidenceReferencesResult,
} from "./household-evidence.contract.js";
import type {
  HouseholdCommitAcquisitionEvidenceInput as HouseholdCommitAcquisitionEvidenceInputType,
  HouseholdObserveEvidenceReferenceInput as HouseholdObserveEvidenceReferenceInputType,
  HouseholdMutateEvidenceStageInput as HouseholdMutateEvidenceStageInputType,
  HouseholdReadEvidenceStageInput as HouseholdReadEvidenceStageInputType,
  HouseholdReadEvidenceReferencesInput as HouseholdReadEvidenceReferencesInputType,
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

const validateEvidence = (
  input: HouseholdCommitAcquisitionEvidenceInputType,
  nowEpochMs: number
) => {
  const [media, manifest] = input.result.references;
  const [expectedMediaKey, expectedManifestKey] = expectedReferenceKeys(
    input.intentId,
    input.expectedGeneration
  );
  const acquiredAtEpochMs = DateTime.toEpochMillis(input.result.acquiredAt);
  const deleteAtEpochMs = DateTime.toEpochMillis(media.deleteAt);
  const manifestDeleteAtEpochMs = DateTime.toEpochMillis(manifest.deleteAt);
  const valid =
    media.key === expectedMediaKey &&
    manifest.key === expectedManifestKey &&
    deleteAtEpochMs === manifestDeleteAtEpochMs &&
    deleteAtEpochMs - acquiredAtEpochMs === EvidenceRetentionSeconds * 1000 &&
    deleteAtEpochMs > nowEpochMs;
  return valid ? Effect.void : Effect.fail(failure("invalid_input"));
};

const resultStage = (tag: string) =>
  tag === "Speech"
    ? "speech"
    : tag === "Visual"
      ? "visual"
      : tag === "Carousel"
        ? "carousel"
        : tag === "Extraction"
          ? "extraction"
          : undefined;

const expectedStageReference = (
  stage: "carousel" | "extraction" | "speech" | "visual",
  intentId: string,
  generation: number
) => {
  switch (stage) {
    case "carousel":
      return {
        key: `imports/${intentId}/carousel/v1/generations/${generation}/manifest.json`,
        kind: "carousel_manifest" as const,
        ordinal: 0,
      };
    case "speech":
      return {
        key: `imports/${intentId}/transcription/v1/generations/${generation}/transcript.json`,
        kind: "speech_transcript" as const,
        ordinal: 2,
      };
    case "visual":
      return {
        key: `imports/${intentId}/visual/v1/generations/${generation}/manifest.json`,
        kind: "visual_manifest" as const,
        ordinal: 3,
      };
    case "extraction":
      return undefined;
  }
};

const validateStageMutation = (
  input: HouseholdMutateEvidenceStageInputType,
  nowEpochMs: number
) => {
  if (input.operation._tag !== "Complete") {
    return Effect.void;
  }
  if (resultStage(input.operation.result._tag) !== input.operation.stage) {
    return Effect.fail(failure("invalid_input"));
  }
  const result = input.operation.result;
  const identityValid =
    result._tag === "Extraction"
      ? String(result.draft.importId) === String(input.intentId) &&
        result.draft.generation === input.expectedGeneration &&
        result.draft.extractionFingerprint === input.inputFingerprint
      : result.dispatchId.length > 0;
  if (!identityValid) {
    return Effect.fail(failure("invalid_input"));
  }
  const expected = expectedStageReference(
    input.operation.stage,
    input.intentId,
    input.expectedGeneration
  );
  if (expected === undefined) {
    return input.operation.reference === undefined
      ? Effect.void
      : Effect.fail(failure("invalid_input"));
  }
  const reference = input.operation.reference;
  const resultReference =
    result._tag === "Speech"
      ? { key: result.transcriptKey, sha256: result.transcriptSha256 }
      : result._tag === "Visual" || result._tag === "Carousel"
        ? { key: result.manifestKey, sha256: result.manifestSha256 }
        : undefined;
  return reference !== undefined &&
    resultReference !== undefined &&
    reference.kind === expected.kind &&
    reference.key === expected.key &&
    reference.key === resultReference.key &&
    reference.sha256 === resultReference.sha256 &&
    DateTime.toEpochMillis(reference.deleteAt) > nowEpochMs
    ? Effect.void
    : Effect.fail(failure("invalid_input"));
};

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
      yield* validateEvidence(input, nowEpochMs);
      const encodedInput = yield* Schema.encodeEffect(
        HouseholdCommitAcquisitionEvidenceInput
      )(input).pipe(Effect.mapError(persistenceFailure));
      const commandDigest = yield* digestJson({
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
      const acquisitionJson = JSON.stringify({
        acquiredAt: encodedInput.result.acquiredAt,
        audioStreams: encodedInput.result.audioStreams,
        durationSeconds: encodedInput.result.durationSeconds,
        ...(encodedInput.result.source === undefined
          ? {}
          : { source: encodedInput.result.source }),
        videoStreams: encodedInput.result.videoStreams,
      });

      return yield* database
        .transaction((transaction) =>
          Effect.gen(function* commitEvidenceTransaction() {
            const replay = yield* readReceipt(
              transaction,
              input.mutationId,
              commandDigest,
              (value) => decode(EncodedCommitResult, value)
            );
            if (Option.isSome(replay)) {
              return replay.value;
            }
            const [intent] = yield* transaction
              .select({
                canonicalSourceId: householdRecipeImports.canonicalSourceId,
                executionGeneration: householdRecipeImports.executionGeneration,
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
        availability: encodedInput.availability,
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
            const observationOrdinal = reference.observationOrdinal + 1;
            const result = yield* decode(
              HouseholdObserveEvidenceReferenceResult,
              {
                availability: input.availability,
                committedAt,
                executionGeneration: input.expectedGeneration,
                intentId: input.intentId,
                kind: input.reference.kind,
                observationOrdinal,
                receiptVersion: 1,
              }
            );
            const resultJson = yield* encode(EncodedObservationResult, result);
            yield* transaction
              .update(householdEvidenceReferences)
              .set({
                availability: input.availability,
                observationOrdinal,
                observedAt: committedAt,
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
      yield* validateStageMutation(input, nowEpochMs);
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
            const replay = yield* readReceipt(
              transaction,
              input.mutationId,
              commandDigest,
              (value) => decode(EncodedStageMutationResult, value)
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
            let outcome:
              | "Completed"
              | "DispatchClaimed"
              | "Failed"
              | "ResumeDispatch";
            if (input.operation._tag === "Claim") {
              if (current === undefined) {
                yield* transaction
                  .insert(householdEvidenceStageExecutions)
                  .values({
                    committedAt,
                    dispatchId: input.operation.dispatchId,
                    executionGeneration: input.expectedGeneration,
                    inputFingerprint: input.inputFingerprint,
                    intentId: input.intentId,
                    stage: input.operation.stage,
                    state: "dispatching",
                  });
                outcome = "DispatchClaimed";
              } else {
                if (
                  current.inputFingerprint !== input.inputFingerprint ||
                  current.dispatchId !== input.operation.dispatchId
                ) {
                  return yield* Effect.fail(failure("idempotency_conflict"));
                }
                outcome =
                  current.state === "completed"
                    ? "Completed"
                    : current.state === "failed"
                      ? "Failed"
                      : "ResumeDispatch";
              }
            } else if (input.operation._tag === "Complete") {
              if (
                current === undefined ||
                current.inputFingerprint !== input.inputFingerprint
              ) {
                return yield* Effect.fail(failure("illegal_transition"));
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
              } else if (current.state !== "dispatching") {
                return yield* Effect.fail(failure("illegal_transition"));
              } else {
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
                      eq(householdEvidenceStageExecutions.state, "dispatching")
                    )
                  );
                const reference = input.operation.reference;
                const expected = expectedStageReference(
                  input.operation.stage,
                  input.intentId,
                  input.expectedGeneration
                );
                if (reference !== undefined && expected !== undefined) {
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
              }
              outcome = "Completed";
            } else {
              if (
                current === undefined ||
                current.inputFingerprint !== input.inputFingerprint
              ) {
                return yield* Effect.fail(failure("illegal_transition"));
              }
              if (current.state === "failed") {
                if (current.failureCode !== input.operation.failureCode) {
                  return yield* Effect.fail(failure("idempotency_conflict"));
                }
              } else if (current.state !== "dispatching") {
                return yield* Effect.fail(failure("illegal_transition"));
              } else {
                yield* transaction
                  .update(householdEvidenceStageExecutions)
                  .set({
                    committedAt,
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
                      eq(householdEvidenceStageExecutions.state, "dispatching")
                    )
                  );
              }
              outcome = "Failed";
            }
            const result = yield* decode(HouseholdMutateEvidenceStageResult, {
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
      const expectedReference = expectedStageReference(
        input.stage,
        input.intentId,
        input.expectedGeneration
      );
      const [reference] =
        expectedReference === undefined
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
        committedAt: stage.committedAt,
        executionGeneration: input.expectedGeneration,
        failureCode: stage.failureCode,
        inputFingerprint: stage.inputFingerprint,
        intentId: input.intentId,
        outcome:
          stage.state === "completed"
            ? "Completed"
            : stage.state === "failed"
              ? "Failed"
              : "Dispatching",
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
      const [execution] = yield* database
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
      if (execution === undefined) {
        return yield* Effect.fail(failure("illegal_transition"));
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
        committedAt: execution.committedAt,
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
    readReferences,
    readStage,
  } as const;
};
