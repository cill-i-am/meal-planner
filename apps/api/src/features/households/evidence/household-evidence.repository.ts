import { and, eq } from "drizzle-orm";
import type { EffectSQLiteDoDatabase } from "drizzle-orm/effect-sqlite-do";
import { Clock, DateTime, Effect, Option, Schema } from "effect";

import { EvidenceRetentionSeconds } from "../../imports/import-media.model.js";
import { ensureHouseholdProvenance } from "../foundation/household-provenance.js";
import {
  householdEvidenceMutationReceipts,
  householdEvidenceReferences,
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
} from "./household-evidence.contract.js";
import type { HouseholdCommitAcquisitionEvidenceInput as HouseholdCommitAcquisitionEvidenceInputType } from "./household-evidence.contract.js";

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

  const readReceipt = (
    connection: EffectSQLiteDoDatabase,
    mutationId: string,
    commandDigest: string
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
            return Effect.succeed(
              Option.none<
                typeof HouseholdCommitAcquisitionEvidenceResult.Type
              >()
            );
          }
          if (row.commandDigest !== commandDigest) {
            return Effect.fail(failure("idempotency_conflict"));
          }
          return decode(EncodedCommitResult, row.resultJson).pipe(
            Effect.map(Option.some)
          );
        })
      );

  const persistReceipt = (
    transaction: EffectSQLiteDoDatabase,
    input: {
      readonly commandDigest: string;
      readonly mutationId: string;
      readonly result: typeof HouseholdCommitAcquisitionEvidenceResult.Type;
      readonly resultJson?: string;
    }
  ) =>
    (input.resultJson === undefined
      ? encode(EncodedCommitResult, input.result)
      : Effect.succeed(input.resultJson)
    ).pipe(
      Effect.flatMap((resultJson) =>
        transaction.insert(householdEvidenceMutationReceipts).values({
          commandDigest: input.commandDigest,
          mutationId: input.mutationId,
          resultJson,
        })
      ),
      mapPersistence,
      Effect.asVoid
    );

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
              commandDigest
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
                result: existingResult,
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
              result,
              resultJson,
            });
            return result;
          })
        )
        .pipe(mapTransaction);
    });

  return { commitAcquisition } as const;
};
