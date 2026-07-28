import { DateTime, Option, Schema } from "effect";

import {
  AcquisitionTaskOutcome,
  EvidenceRetentionSeconds,
  manifestObjectKey,
  mediaObjectKey,
  VerifiedAcquisitionEvidence,
  VerifiedSourceMetadata,
} from "./import-media.model.js";
import type { ImportId, ImportTimestamp } from "./import.contracts.js";
import type { StoredImport } from "./import.repository.js";

export const AcquisitionCheckpointRejected = Schema.Struct({
  _tag: Schema.Literal("AcquisitionCheckpointRejected"),
  code: Schema.Literal("historical_acquisition_checkpoint_invalid"),
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
  code: "historical_acquisition_checkpoint_invalid",
});

const PersistedHistoricalTimestamp = Schema.Struct({
  epochMilliseconds: Schema.Number.pipe(
    Schema.check(Schema.isFinite(), Schema.isInt())
  ),
});
type PersistedHistoricalTimestamp = typeof PersistedHistoricalTimestamp.Type;

const isValidHistoricalTimestamp = (value: PersistedHistoricalTimestamp) => {
  try {
    return (
      Number.isSafeInteger(value.epochMilliseconds) &&
      Date.parse(new Date(value.epochMilliseconds).toISOString()) ===
        value.epochMilliseconds
    );
  } catch {
    return false;
  }
};

const HistoricalVerifiedSourceMetadata = Schema.Struct({
  ...VerifiedSourceMetadata.fields,
  observedAt: PersistedHistoricalTimestamp,
  publishedAt: Schema.NullOr(PersistedHistoricalTimestamp),
});

const HistoricalVerifiedAcquisitionEvidence = Schema.Struct({
  ...VerifiedAcquisitionEvidence.fields,
  acquiredAt: PersistedHistoricalTimestamp,
  deleteAt: PersistedHistoricalTimestamp,
  source: Schema.optionalKey(HistoricalVerifiedSourceMetadata),
});

const HistoricalVerifiedAcquisition = Schema.Struct({
  _tag: Schema.Literal("VerifiedAcquisition"),
  evidence: HistoricalVerifiedAcquisitionEvidence,
  generation: VerifiedAcquisitionEvidence.fields.generation,
});

const timestampFromHistoricalCheckpoint = (
  value: PersistedHistoricalTimestamp
) => DateTime.makeUnsafe(value.epochMilliseconds) as ImportTimestamp;

const normalizeDurableCheckpoint = (raw: unknown): unknown => {
  try {
    return structuredClone(raw) as unknown;
  } catch {
    return undefined;
  }
};

const decodeVerifiedCheckpoint = (
  raw: unknown
): DecodedAcquisitionCheckpoint => {
  const decoded = Schema.decodeUnknownOption(HistoricalVerifiedAcquisition, {
    onExcessProperty: "error",
  })(normalizeDurableCheckpoint(raw));
  if (Option.isNone(decoded)) {
    return rejected();
  }
  const historical = decoded.value;
  const { acquiredAt, deleteAt, source, ...evidence } = historical.evidence;
  if (
    !isValidHistoricalTimestamp(acquiredAt) ||
    !isValidHistoricalTimestamp(deleteAt) ||
    (source !== undefined &&
      (!isValidHistoricalTimestamp(source.observedAt) ||
        (source.publishedAt !== null &&
          !isValidHistoricalTimestamp(source.publishedAt))))
  ) {
    return rejected();
  }
  const decodedSource =
    source === undefined
      ? {}
      : {
          source: {
            ...source,
            observedAt: timestampFromHistoricalCheckpoint(source.observedAt),
            publishedAt:
              source.publishedAt === null
                ? null
                : timestampFromHistoricalCheckpoint(source.publishedAt),
          },
        };
  const candidate: AcquisitionTaskOutcome = {
    ...historical,
    evidence: {
      ...evidence,
      ...decodedSource,
      acquiredAt: timestampFromHistoricalCheckpoint(acquiredAt),
      deleteAt: timestampFromHistoricalCheckpoint(deleteAt),
    },
  };
  return {
    _tag: "Accepted",
    outcome: candidate,
  };
};

/**
 * Decodes the one proven historical Workflow checkpoint representation.
 *
 * This deliberately does not change the application-wide timestamp or source
 * schemas. Verified acquisition checkpoints must carry the exact
 * `epochMilliseconds` object left after a historical Effect DateTime crossed
 * the native Workflow structured-clone boundary.
 */
export const decodeAcquisitionCheckpoint = (
  raw: unknown
): DecodedAcquisitionCheckpoint => {
  const current = Schema.decodeUnknownOption(AcquisitionTaskOutcome, {
    onExcessProperty: "error",
  })(raw);
  if (Option.isSome(current)) {
    return { _tag: "Accepted", outcome: current.value };
  }
  if (
    typeof raw === "object" &&
    raw !== null &&
    "_tag" in raw &&
    raw._tag === "VerifiedAcquisition"
  ) {
    return decodeVerifiedCheckpoint(raw);
  }
  return rejected();
};

const ownsSpeechContinuation = (stored: StoredImport) =>
  stored.view.status.kind === "acquired" ||
  stored.view.status.kind === "transcribing" ||
  (stored.view.status.kind === "failed" &&
    stored.view.status.code === "transcription_failed");

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
