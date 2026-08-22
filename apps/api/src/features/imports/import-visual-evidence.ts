import { Effect, Option } from "effect";

import { readVerifiedAcquisitionEvidence } from "./import-media-acquirer.js";
import type { AcquisitionBucketLike } from "./import-media-acquirer.js";
import { EvidenceRetentionSeconds } from "./import-media.model.js";
import type { ProviderTaskDiagnosticReasonCode } from "./import-provider-workflow-checkpoint.js";
import type {
  VisualEvidenceExtractor,
  VisualFrameSampler,
} from "./import-visual-evidence-extractor.js";
import {
  decodeVisualEvidence,
  representativeVisualFrameIndex,
  validateVisualFrames,
} from "./import-visual-evidence-extractor.js";
import type {
  CompletedVisualEvidence,
  VisualEvidenceFailureCode,
  VisualEvidenceRepository,
} from "./import-visual-evidence.repository.js";
import type { ImportId, ImportTimestamp } from "./import.contracts.js";
import { importTransitionRejected } from "./import.errors.js";
import type { ImportRepository } from "./import.repository.js";
import {
  TranscriptEvidenceStore,
  TranscriptEvidenceStoreLive,
} from "./transcript-evidence-store.js";
import {
  VisualEvidenceStore,
  VisualEvidenceStoreLive,
} from "./visual-evidence-store.js";
import type { VisualEvidenceManifest } from "./visual-evidence-store.js";

export interface VisualEvidencePipelineFailure {
  readonly _tag: "VisualEvidencePipelineFailure";
  readonly code:
    | VisualEvidenceFailureCode
    | "provider_unavailable"
    | "throttled"
    | "timeout"
    | "visual_evidence_unknown";
  readonly reasonCode?: ProviderTaskDiagnosticReasonCode;
}
const pipelineFailure = (
  code: VisualEvidencePipelineFailure["code"],
  reasonCode?: ProviderTaskDiagnosticReasonCode
): VisualEvidencePipelineFailure =>
  reasonCode === undefined
    ? { _tag: "VisualEvidencePipelineFailure", code }
    : { _tag: "VisualEvidencePipelineFailure", code, reasonCode };
const bytesToHex = (value: ArrayBuffer) =>
  Array.from(new Uint8Array(value), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
const sha256Hex = (bytes: Uint8Array) =>
  Effect.promise(() =>
    crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer)
  ).pipe(Effect.map(bytesToHex));
const observationsMatchFrames = (
  observations: readonly {
    readonly frameIndex: number;
    readonly timestampMilliseconds: number;
  }[],
  frames: readonly { readonly timestampMilliseconds: number }[]
) =>
  observations.every(
    (observation) =>
      frames[observation.frameIndex]?.timestampMilliseconds ===
      observation.timestampMilliseconds
  );
const completedFromDocument = (
  document: VisualEvidenceManifest,
  byteLength: number,
  manifestSha256: string,
  manifestKey: string
): CompletedVisualEvidence => ({
  byteLength,
  completedAt: document.createdAt,
  cost: document.cost,
  deleteAt: document.sourceEvidenceDeleteAt,
  dispatchId: document.dispatchId,
  generation: document.acquisitionGeneration,
  importId: document.importId,
  manifestKey,
  manifestSha256,
  model: document.model,
  observationsCount: document.observations.length,
  outcome: document.outcome,
  provider: document.provider,
  sourceMediaSha256: document.sourceMediaSha256,
  usage: document.usage,
});

export const extractVisualEvidenceForTranscribedImport = Effect.fn(
  "Imports.extractVisualEvidence"
)(function* extractVisualEvidenceForTranscribedImport(input: {
  readonly bucket: AcquisitionBucketLike;
  readonly extractor: VisualEvidenceExtractor;
  readonly frameSampler: VisualFrameSampler;
  readonly importId: ImportId;
  readonly importRepository: ImportRepository;
  readonly now: () => ImportTimestamp;
  readonly speechDispatchId?: string;
  readonly visualDispatchId?: string;
  readonly visualRepository: VisualEvidenceRepository;
}) {
  const stored = yield* input.importRepository.findById(input.importId).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.fail(importTransitionRejected()),
        onSome: Effect.succeed,
      })
    )
  );
  if (
    ![
      "extracting_visual",
      "transcribed",
      "visual_evidence_empty",
      "visual_evidence_found",
      "visual_evidence_low_confidence",
    ].includes(stored.view.status.kind)
  ) {
    return yield* Effect.fail(importTransitionRejected());
  }
  const now = input.now();
  const evidence = yield* readVerifiedAcquisitionEvidence(input.bucket, {
    canonicalId: stored.canonicalSourceId,
    generation: stored.acquisitionGeneration,
    importId: input.importId,
    observedAt: now,
  }).pipe(Effect.mapError(() => pipelineFailure("source_evidence_invalid")));
  if (evidence === null) {
    return yield* Effect.fail(pipelineFailure("source_evidence_invalid"));
  }
  const transcript = yield* TranscriptEvidenceStore.pipe(
    Effect.flatMap((store) =>
      store.readVerified({
        dispatchId:
          input.speechDispatchId ??
          `speech:${input.importId}:${evidence.generation}`,
        generation: evidence.generation,
        importId: input.importId,
        sourceMediaSha256: evidence.sha256,
      })
    ),
    Effect.provide(TranscriptEvidenceStoreLive(input.bucket)),
    Effect.mapError(() => pipelineFailure("source_evidence_invalid"))
  );
  if (Option.isNone(transcript)) {
    return yield* Effect.fail(pipelineFailure("source_evidence_invalid"));
  }
  const dispatchId =
    input.visualDispatchId ?? `visual:${input.importId}:${evidence.generation}`;
  const claim = yield* input.visualRepository.claim({
    dispatchId,
    generation: evidence.generation,
    importId: input.importId,
    sourceMediaSha256: evidence.sha256,
    startedAt: now,
  });
  if (claim._tag === "Completed" || claim._tag === "ResumeDispatch") {
    const committed = yield* VisualEvidenceStore.pipe(
      Effect.flatMap((store) =>
        store.readVerified({
          dispatchId,
          generation: evidence.generation,
          importId: input.importId,
          sourceEvidenceDeleteAt: evidence.deleteAt,
          sourceMediaSha256: evidence.sha256,
        })
      ),
      Effect.provide(VisualEvidenceStoreLive(input.bucket)),
      Effect.mapError(() => pipelineFailure("visual_evidence_failed"))
    );
    if (Option.isSome(committed)) {
      const completed =
        claim._tag === "Completed"
          ? claim.evidence
          : yield* input.visualRepository.complete(
              completedFromDocument(
                committed.value.document,
                committed.value.byteLength,
                committed.value.sha256,
                committed.value.manifestKey
              )
            );
      if (
        completed.manifestKey !== committed.value.manifestKey ||
        completed.manifestSha256 !== committed.value.sha256 ||
        completed.outcome !== committed.value.document.outcome
      ) {
        return yield* Effect.fail(pipelineFailure("visual_evidence_failed"));
      }
      return {
        _tag: "VisualEvidenceReady" as const,
        generation: completed.generation,
        importId: completed.importId,
        manifestKey: completed.manifestKey,
        outcome: completed.outcome,
      };
    }
    return yield* Effect.fail(
      pipelineFailure(
        claim._tag === "Completed"
          ? "visual_evidence_failed"
          : "outcome_unknown"
      )
    );
  }
  if (claim._tag === "Failed") {
    return yield* Effect.fail(pipelineFailure("outcome_unknown"));
  }
  const completed = yield* Effect.gen(function* completed() {
    const durationMilliseconds = Math.round(evidence.durationSeconds * 1000);
    const frames = yield* input.frameSampler
      .sample({
        durationMilliseconds,
        generation: evidence.generation,
        importId: input.importId,
        mediaKey: evidence.mediaKey,
        sourceMediaSha256: evidence.sha256,
      })
      .pipe(Effect.mapError(() => pipelineFailure("frame_sampling_failed")));
    if (!validateVisualFrames(frames, durationMilliseconds)) {
      return yield* Effect.fail(pipelineFailure("frame_sampling_failed"));
    }
    for (const frame of frames) {
      if ((yield* sha256Hex(frame.bytes)) !== frame.sha256) {
        return yield* Effect.fail(pipelineFailure("frame_sampling_failed"));
      }
    }
    const [firstFrame] = frames;
    if (firstFrame === undefined) {
      return yield* Effect.fail(pipelineFailure("frame_evidence_failed"));
    }
    const rawVisualEvidence = yield* input.extractor
      .extract({
        dispatchId,
        frames,
        generation: evidence.generation,
        importId: input.importId,
        sourceMediaSha256: evidence.sha256,
      })
      .pipe(
        Effect.mapError((error) =>
          pipelineFailure(
            error.code === "outcome_unknown" ||
              error.code === "provider_unavailable" ||
              error.code === "throttled" ||
              error.code === "timeout"
              ? error.code
              : "visual_extraction_failed"
          )
        )
      );
    const visualEvidence = yield* decodeVisualEvidence(rawVisualEvidence).pipe(
      Effect.mapError(() => pipelineFailure("visual_extraction_failed"))
    );
    const submittedFrame =
      frames[representativeVisualFrameIndex(frames.length)];
    if (
      submittedFrame === undefined ||
      visualEvidence.usage.inputBytes !== submittedFrame.bytes.byteLength ||
      visualEvidence.usage.inputFrames !== 1 ||
      !observationsMatchFrames(visualEvidence.observations, frames)
    ) {
      return yield* Effect.fail(pipelineFailure("visual_extraction_failed"));
    }
    const manifest: VisualEvidenceManifest = {
      acquisitionGeneration: evidence.generation,
      cost: visualEvidence.cost,
      createdAt: now,
      dispatchId,
      importId: input.importId,
      model: visualEvidence.model,
      observations: visualEvidence.observations,
      outcome: visualEvidence.outcome,
      provider: visualEvidence.provider,
      retention: {
        configuredAgeSeconds: EvidenceRetentionSeconds,
        policy: "r2_bucket_object_age",
      },
      schemaVersion: 1,
      sourceEvidenceDeleteAt: evidence.deleteAt,
      sourceMediaSha256: evidence.sha256,
      usage: visualEvidence.usage,
    };
    const committed = yield* VisualEvidenceStore.pipe(
      Effect.flatMap((store) => store.putVerified({ frames, manifest })),
      Effect.provide(VisualEvidenceStoreLive(input.bucket)),
      Effect.mapError(() => pipelineFailure("visual_evidence_failed"))
    );
    return yield* input.visualRepository.complete(
      completedFromDocument(
        committed.document,
        committed.byteLength,
        committed.sha256,
        committed.manifestKey
      )
    );
  }).pipe(
    Effect.catchTag("VisualEvidencePipelineFailure", (failure) => {
      if (
        failure.code === "outcome_unknown" ||
        failure.code === "provider_unavailable" ||
        failure.code === "throttled" ||
        failure.code === "timeout" ||
        failure.code === "visual_evidence_unknown"
      ) {
        return Effect.fail(failure);
      }
      return input.visualRepository
        .fail({
          completedAt: now,
          dispatchId,
          failureCode: failure.code,
          generation: evidence.generation,
          importId: input.importId,
          sourceMediaSha256: evidence.sha256,
        })
        .pipe(Effect.andThen(Effect.fail(failure)));
    })
  );
  return {
    _tag: "VisualEvidenceReady" as const,
    generation: completed.generation,
    importId: completed.importId,
    manifestKey: completed.manifestKey,
    outcome: completed.outcome,
  };
});
