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

const PersistedRuntimeTimestamp = Schema.Struct({
  epochMilliseconds: Schema.Number.pipe(
    Schema.check(Schema.isFinite(), Schema.isInt())
  ),
});
type PersistedRuntimeTimestamp = typeof PersistedRuntimeTimestamp.Type;

const isValidCanonicalTimestamp = (value: string) => {
  const epoch = Date.parse(value);
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) &&
    Number.isFinite(epoch) &&
    new Date(epoch).toISOString() === value
  );
};

const isValidRuntimeTimestamp = (value: PersistedRuntimeTimestamp) => {
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

const CanonicalVerifiedSourceMetadata = Schema.Struct({
  ...VerifiedSourceMetadata.fields,
  observedAt: Schema.String,
  publishedAt: Schema.NullOr(Schema.String),
});

const RuntimeVerifiedSourceMetadata = Schema.Struct({
  ...VerifiedSourceMetadata.fields,
  observedAt: PersistedRuntimeTimestamp,
  publishedAt: Schema.NullOr(PersistedRuntimeTimestamp),
});

const CanonicalVerifiedAcquisitionEvidence = Schema.Struct({
  ...VerifiedAcquisitionEvidence.fields,
  acquiredAt: Schema.String,
  deleteAt: Schema.String,
  source: Schema.optionalKey(CanonicalVerifiedSourceMetadata),
});

const RuntimeVerifiedAcquisitionEvidence = Schema.Struct({
  ...VerifiedAcquisitionEvidence.fields,
  acquiredAt: PersistedRuntimeTimestamp,
  deleteAt: PersistedRuntimeTimestamp,
  source: Schema.optionalKey(RuntimeVerifiedSourceMetadata),
});

const CanonicalVerifiedAcquisition = Schema.Struct({
  _tag: Schema.Literal("VerifiedAcquisition"),
  evidence: CanonicalVerifiedAcquisitionEvidence,
  generation: VerifiedAcquisitionEvidence.fields.generation,
});

const RuntimeVerifiedAcquisition = Schema.Struct({
  _tag: Schema.Literal("VerifiedAcquisition"),
  evidence: RuntimeVerifiedAcquisitionEvidence,
  generation: VerifiedAcquisitionEvidence.fields.generation,
});

const PersistedVerifiedAcquisition = Schema.Union([
  CanonicalVerifiedAcquisition,
  RuntimeVerifiedAcquisition,
]);
type PersistedVerifiedAcquisition = typeof PersistedVerifiedAcquisition.Type;

type PersistedTimestamp = string | PersistedRuntimeTimestamp;

const isValidPersistedTimestamp = (value: PersistedTimestamp) =>
  typeof value === "string"
    ? isValidCanonicalTimestamp(value)
    : isValidRuntimeTimestamp(value);

const timestampFromCheckpoint = (value: PersistedTimestamp) =>
  DateTime.makeUnsafe(
    typeof value === "string" ? value : value.epochMilliseconds
  ) as ImportTimestamp;

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
  const decoded = Schema.decodeUnknownOption(PersistedVerifiedAcquisition, {
    onExcessProperty: "error",
  })(normalizeDurableCheckpoint(raw));
  if (Option.isNone(decoded)) {
    return rejected();
  }
  const persisted = decoded.value;
  const { acquiredAt, deleteAt, source, ...evidence } = persisted.evidence;
  if (
    !isValidPersistedTimestamp(acquiredAt) ||
    !isValidPersistedTimestamp(deleteAt) ||
    (source !== undefined &&
      (!isValidPersistedTimestamp(source.observedAt) ||
        (source.publishedAt !== null &&
          !isValidPersistedTimestamp(source.publishedAt))))
  ) {
    return rejected();
  }
  const decodedSource =
    source === undefined
      ? {}
      : {
          source: {
            ...source,
            observedAt: timestampFromCheckpoint(source.observedAt),
            publishedAt:
              source.publishedAt === null
                ? null
                : timestampFromCheckpoint(source.publishedAt),
          },
        };
  const candidate: AcquisitionTaskOutcome = {
    ...persisted,
    evidence: {
      ...evidence,
      ...decodedSource,
      acquiredAt: timestampFromCheckpoint(acquiredAt),
      deleteAt: timestampFromCheckpoint(deleteAt),
    },
  };
  return {
    _tag: "Accepted",
    outcome: candidate,
  };
};

/**
 * Decodes the two proven Workflow checkpoint timestamp representations.
 *
 * This deliberately does not change the application-wide timestamp or source
 * schemas. A verified acquisition checkpoint must use either canonical
 * millisecond UTC strings emitted by the shipped schema encoder or exact
 * `epochMilliseconds` objects from the native Workflow structured-clone
 * boundary.
 */
export const decodeAcquisitionCheckpoint = (
  raw: unknown
): DecodedAcquisitionCheckpoint => {
  if (
    typeof raw === "object" &&
    raw !== null &&
    "_tag" in raw &&
    raw._tag === "VerifiedAcquisition"
  ) {
    return decodeVerifiedCheckpoint(raw);
  }
  const current = Schema.decodeUnknownOption(AcquisitionTaskOutcome, {
    onExcessProperty: "error",
  })(raw);
  return Option.match(current, {
    onNone: rejected,
    onSome: (outcome) => ({ _tag: "Accepted", outcome }),
  });
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
