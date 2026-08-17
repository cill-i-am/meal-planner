import { DateTime, Effect, Option, Schema } from "effect";

import {
  AcquisitionTaskOutcome,
  EvidenceRetentionSeconds,
  manifestObjectKey,
  mediaObjectKey,
} from "./import-media.model.js";
import type { VerifiedAcquisitionEvidence } from "./import-media.model.js";
import type { ImportId, SourceCanonicalId } from "./import.contracts.js";
import type { StoredImport } from "./import.repository.js";

export const AcquisitionCheckpointRejected = Schema.Struct({
  _tag: Schema.Literal("AcquisitionCheckpointRejected"),
  code: Schema.Literal("acquisition_checkpoint_invalid"),
});
export type AcquisitionCheckpointRejected =
  typeof AcquisitionCheckpointRejected.Type;

export const AcquisitionCheckpointAccepted = Schema.Struct({
  _tag: Schema.Literal("Accepted"),
});
export type AcquisitionCheckpointAccepted =
  typeof AcquisitionCheckpointAccepted.Type;

export const AcquisitionCheckpointContinuation = Schema.Union([
  AcquisitionCheckpointAccepted,
  AcquisitionCheckpointRejected,
]);
export type AcquisitionCheckpointContinuation =
  typeof AcquisitionCheckpointContinuation.Type;

export type DecodedAcquisitionCheckpoint =
  | {
      readonly _tag: "Accepted";
      readonly outcome: AcquisitionTaskOutcome;
    }
  | AcquisitionCheckpointRejected;

const rejected = (): AcquisitionCheckpointRejected => ({
  _tag: "AcquisitionCheckpointRejected",
  code: "acquisition_checkpoint_invalid",
});

const normalizeDurableCheckpoint = (raw: unknown): unknown => {
  try {
    return structuredClone(raw) as unknown;
  } catch {
    return undefined;
  }
};

export const decodeAcquisitionCheckpoint = (
  raw: unknown
): DecodedAcquisitionCheckpoint => {
  const decoded = Schema.decodeUnknownOption(AcquisitionTaskOutcome, {
    onExcessProperty: "error",
  })(normalizeDurableCheckpoint(raw));
  return Option.match(decoded, {
    onNone: rejected,
    onSome: (outcome) => ({ _tag: "Accepted", outcome }),
  });
};

const ownsSpeechContinuation = (stored: StoredImport) =>
  stored.view.status.kind === "acquired" ||
  stored.view.status.kind === "transcribing" ||
  (stored.view.status.kind === "failed" &&
    stored.view.status.code === "transcription_failed");

/**
 * Reconstructs a missing post-acquisition journal entry only when durable
 * repository state already owns downstream continuation. A normal acquiring
 * import returns `null` so the ordinary acquisition attempt remains unchanged.
 */
export const recoverVerifiedAcquisitionCheckpoint = <
  FindError,
  VerifyError,
>(input: {
  readonly findStored: Effect.Effect<Option.Option<StoredImport>, FindError>;
  readonly importId: ImportId;
  readonly expectedCanonicalId: SourceCanonicalId;
  readonly readEvidence: (
    stored: StoredImport
  ) => Effect.Effect<VerifiedAcquisitionEvidence | null, VerifyError>;
}) =>
  input.findStored.pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.succeed<null>(null),
        onSome: (stored) => {
          if (!ownsSpeechContinuation(stored)) {
            return Effect.succeed<null>(null);
          }
          if (
            stored.view.id !== input.importId ||
            stored.sourceKind !== "tiktok" ||
            stored.view.source.kind !== "tiktok" ||
            stored.canonicalSourceId !== input.expectedCanonicalId ||
            stored.view.source.canonicalId !== stored.canonicalSourceId
          ) {
            return Effect.succeed(rejected());
          }
          return input.readEvidence(stored).pipe(
            Effect.map((evidence) =>
              evidence === null
                ? rejected()
                : ({
                    _tag: "VerifiedAcquisition" as const,
                    evidence,
                    generation: stored.acquisitionGeneration,
                  } satisfies AcquisitionTaskOutcome)
            )
          );
        },
      })
    )
  );

export const verifyAcquisitionCheckpointContinuation = (input: {
  readonly importId: ImportId;
  readonly outcome: AcquisitionTaskOutcome;
  readonly stored: StoredImport;
}): AcquisitionCheckpointContinuation => {
  if (input.outcome._tag !== "VerifiedAcquisition") {
    return { _tag: "Accepted" };
  }
  const { evidence, generation } = input.outcome;
  const expectedMediaKey = mediaObjectKey(input.importId, generation);
  const expectedManifestKey = manifestObjectKey(input.importId, generation);
  const [mediaReference, manifestReference] = input.stored.view.evidence;
  const retentionMilliseconds =
    DateTime.toEpochMillis(evidence.deleteAt) -
    DateTime.toEpochMillis(evidence.acquiredAt);
  return input.stored.view.id === input.importId &&
    input.stored.sourceKind === "tiktok" &&
    input.stored.view.source.kind === "tiktok" &&
    input.stored.view.source.canonicalId === input.stored.canonicalSourceId &&
    input.stored.acquisitionGeneration === generation &&
    evidence.generation === generation &&
    evidence.mediaKey === expectedMediaKey &&
    evidence.manifestKey === expectedManifestKey &&
    mediaReference?.kind === "original_media" &&
    mediaReference.referenceId === expectedMediaKey &&
    manifestReference?.kind === "acquisition_manifest" &&
    manifestReference.referenceId === expectedManifestKey &&
    retentionMilliseconds === EvidenceRetentionSeconds * 1000 &&
    ownsSpeechContinuation(input.stored)
    ? { _tag: "Accepted" }
    : rejected();
};

export const continueAcquisitionCheckpoint = <
  Value,
  FindError,
  AcceptedError,
  AcceptedRequirements,
>(input: {
  readonly findStored: Effect.Effect<Option.Option<StoredImport>, FindError>;
  readonly importId: ImportId;
  readonly onAccepted: () => Effect.Effect<
    Value,
    AcceptedError,
    AcceptedRequirements
  >;
  readonly outcome: AcquisitionTaskOutcome;
}) =>
  input.findStored.pipe(
    Effect.map(
      Option.match({
        onNone: rejected,
        onSome: (stored) =>
          verifyAcquisitionCheckpointContinuation({
            importId: input.importId,
            outcome: input.outcome,
            stored,
          }),
      })
    ),
    Effect.flatMap((continuation) =>
      continuation._tag === "AcquisitionCheckpointRejected"
        ? Effect.succeed<Value | AcquisitionCheckpointRejected>(continuation)
        : input
            .onAccepted()
            .pipe(
              Effect.map(
                (value): Value | AcquisitionCheckpointRejected => value
              )
            )
    )
  );
