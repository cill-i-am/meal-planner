import type { RecipeImportIntentId } from "@meal-planner/recipe-import-api";
import { Effect, Option, Schema } from "effect";

import {
  HouseholdMutateEvidenceStageResult,
  HouseholdReadEvidenceReferencesResult,
  HouseholdReadEvidenceStageResult,
} from "../households/evidence/household-evidence.contract.js";
import type { HouseholdDomainWorkerMethods } from "../households/household-domain-worker.js";
import type { HouseholdOrganizationId } from "../households/household.contract.js";
import type { HouseholdImportMutationId } from "../households/recipe-import/household-recipe-import.contract.js";
import type {
  CarouselEvidenceClaim,
  CarouselEvidenceRepository,
  CompletedCarouselEvidence,
} from "./import-carousel.repository.js";
import type { AcquisitionGeneration } from "./import-media.model.js";
import { Sha256Hex } from "./import-media.model.js";
import type { ImportCorrelationId } from "./import-observability.js";
import type {
  RecipeDispatchClaim,
  RecipeDraft,
  RecipeDraftRepository,
} from "./import-recipe-draft.repository.js";
import type {
  CompletedTranscriptEvidence,
  SpeechDispatchClaim,
  SpeechTranscriptionRepository,
} from "./import-speech-transcription.repository.js";
import type {
  CompletedVisualEvidence,
  VisualDispatchClaim,
  VisualEvidenceRepository,
} from "./import-visual-evidence.repository.js";
import type { SourceCanonicalId } from "./import.contracts.js";
import { ImportId, ImportTimestamp, ImportView } from "./import.contracts.js";
import {
  importPersistenceUnavailable,
  importTransitionRejected,
} from "./import.errors.js";
import type {
  ImportRepository,
  ImportTransitionError,
  StoredImport,
} from "./import.repository.js";

type MutationId = (seed: string) => Effect.Effect<HouseholdImportMutationId>;

export type HouseholdEvidenceDomain = Pick<
  HouseholdDomainWorkerMethods,
  "mutateEvidenceStage" | "readEvidenceReferences" | "readEvidenceStage"
>;

interface HouseholdEvidenceRepositoryInput {
  readonly canonicalSourceId: SourceCanonicalId;
  readonly correlationId: ImportCorrelationId;
  readonly generation: AcquisitionGeneration;
  readonly householdDomain: HouseholdEvidenceDomain;
  readonly intentId: RecipeImportIntentId;
  readonly mutationId: MutationId;
  readonly organizationId: HouseholdOrganizationId;
}

const PersistenceUnavailableFailure = Schema.Struct({
  reason: Schema.Literal("persistence_unavailable"),
});

const mapFailure = <E>(error: E): ImportTransitionError =>
  Schema.is(PersistenceUnavailableFailure)(error)
    ? importPersistenceUnavailable()
    : importTransitionRejected();

const makeBoundary = (input: HouseholdEvidenceRepositoryInput) => {
  const admission = {
    actor: {
      _tag: "System" as const,
      purpose: "recipe_import_lifecycle_commit" as const,
    },
    organizationId: input.organizationId,
  };
  const mutate = (
    seed: string,
    command: Omit<
      Parameters<HouseholdDomainWorkerMethods["mutateEvidenceStage"]>[0],
      "admission" | "expectedGeneration" | "intentId" | "mutationId"
    >
  ) =>
    input.mutationId(seed).pipe(
      Effect.flatMap((mutationId) =>
        input.householdDomain.mutateEvidenceStage({
          admission,
          expectedGeneration: input.generation,
          intentId: input.intentId,
          mutationId,
          ...command,
        })
      ),
      Effect.flatMap(
        Schema.decodeUnknownEffect(HouseholdMutateEvidenceStageResult, {
          onExcessProperty: "error",
        })
      ),
      Effect.mapError(mapFailure)
    );
  const read = (stage: "carousel" | "extraction" | "speech" | "visual") =>
    input.householdDomain
      .readEvidenceStage({
        admission,
        expectedGeneration: input.generation,
        intentId: input.intentId,
        stage,
      })
      .pipe(
        Effect.flatMap(
          Schema.decodeUnknownEffect(HouseholdReadEvidenceStageResult, {
            onExcessProperty: "error",
          })
        ),
        Effect.mapError(mapFailure)
      );
  const readReferences = () =>
    input.householdDomain
      .readEvidenceReferences({
        admission,
        expectedGeneration: input.generation,
        intentId: input.intentId,
      })
      .pipe(
        Effect.flatMap(
          Schema.decodeUnknownEffect(HouseholdReadEvidenceReferencesResult, {
            onExcessProperty: "error",
          })
        ),
        Effect.mapError(mapFailure)
      );
  return { admission, mutate, read, readReferences } as const;
};

const assertIdentity = (
  input: HouseholdEvidenceRepositoryInput,
  importId: string,
  generation: number
) =>
  String(input.intentId) === importId && input.generation === generation
    ? Effect.void
    : Effect.fail(importTransitionRejected());

const decodeImportId = (intentId: RecipeImportIntentId) =>
  Schema.decodeUnknownSync(ImportId)(intentId);

const visualStatus = (outcome: "empty" | "found" | "low_confidence") => {
  if (outcome === "found") {
    return "visual_evidence_found" as const;
  }
  if (outcome === "empty") {
    return "visual_evidence_empty" as const;
  }
  return "visual_evidence_low_confidence" as const;
};

const resumedClaimTag = (outcome: "DispatchClaimed" | "ResumeDispatch") => {
  if (outcome === "DispatchClaimed") {
    return "DispatchClaimed" as const;
  }
  return "ResumeDispatch" as const;
};

const carouselRecovery = (
  failureCode:
    | "carousel_inaccessible"
    | "carousel_layout_drift"
    | "carousel_partial"
) => {
  if (failureCode === "carousel_inaccessible") {
    return "check_source_visibility" as const;
  }
  if (failureCode === "carousel_partial") {
    return "request_complete_carousel" as const;
  }
  return "update_carousel_adapter" as const;
};

/**
 * Internal provider-stage projection assembled only from household-owned
 * metadata. It intentionally exposes the legacy ImportRepository shape only
 * to the existing provider use cases while Slice 3 retains the execution
 * settlement ledger.
 */
export const makeHouseholdImportEvidenceViewRepository = (
  input: HouseholdEvidenceRepositoryInput
): ImportRepository => {
  const boundary = makeBoundary(input);
  const importId = decodeImportId(input.intentId);
  const findById: ImportRepository["findById"] = (id) =>
    (id === importId
      ? Effect.all({
          extraction: boundary.read("extraction"),
          references: boundary.readReferences(),
          speech: boundary.read("speech"),
          visual: boundary.read("visual"),
        })
      : Effect.fail(importTransitionRejected())
    ).pipe(
      // eslint-disable-next-line complexity -- one closed projection preserves the precedence of mutually exclusive provider-stage states
      Effect.flatMap(({ extraction, references, speech, visual }) => {
        if (references === null) {
          return Effect.succeed(Option.none<StoredImport>());
        }
        const original = references.references.find(
          ({ kind }) => kind === "original_media"
        );
        const manifest = references.references.find(
          ({ kind }) => kind === "acquisition_manifest"
        );
        if (original === undefined || manifest === undefined) {
          return Effect.fail(importTransitionRejected());
        }
        const evidence: { kind: string; referenceId: string }[] = [
          { kind: "original_media", referenceId: original.key },
          { kind: "acquisition_manifest", referenceId: manifest.key },
        ];
        let status: Record<string, string> = { kind: "acquired" };
        let updatedAt = references.committedAt;

        if (speech?.outcome === "Dispatching") {
          status = { kind: "transcribing" };
          updatedAt = speech.committedAt;
        } else if (speech?.outcome === "Failed") {
          status = {
            code: "transcription_failed",
            kind: "failed",
            recovery: "retry_later",
          };
          updatedAt = speech.committedAt;
        } else if (speech?.outcome === "Completed") {
          const transcript = references.references.find(
            ({ kind }) => kind === "speech_transcript"
          );
          if (transcript === undefined) {
            return Effect.fail(importTransitionRejected());
          }
          evidence.push({
            kind: "speech_transcript",
            referenceId: transcript.key,
          });
          status = { kind: "transcribed" };
          updatedAt = speech.committedAt;
        }

        if (visual?.outcome === "Dispatching") {
          status = { kind: "extracting_visual" };
          updatedAt = visual.committedAt;
        } else if (visual?.outcome === "Failed") {
          status = {
            code: "visual_evidence_failed",
            kind: "failed",
            recovery: "operator_reconcile",
          };
          updatedAt = visual.committedAt;
        } else if (
          visual?.outcome === "Completed" &&
          visual.result?._tag === "Visual"
        ) {
          const visualManifest = references.references.find(
            ({ kind }) => kind === "visual_manifest"
          );
          if (visualManifest === undefined) {
            return Effect.fail(importTransitionRejected());
          }
          evidence.push({
            kind: "visual_evidence_manifest",
            referenceId: visualManifest.key,
          });
          status = {
            kind: visualStatus(visual.result.outcome),
          };
          updatedAt = visual.committedAt;
        }

        if (extraction?.outcome === "Failed") {
          status = {
            code: "recipe_extraction_failed",
            kind: "failed",
            recovery: "operator_reconcile",
          };
          updatedAt = extraction.committedAt;
        } else if (extraction?.outcome === "Completed") {
          evidence.push({
            kind: "recipe_draft",
            referenceId: `recipe-drafts/${extraction.inputFingerprint}`,
          });
          status = { kind: "needs_review" };
          updatedAt = extraction.committedAt;
        }

        const view = Schema.decodeUnknownSync(ImportView, {
          onExcessProperty: "error",
        })({
          createdAt: Schema.encodeSync(ImportTimestamp)(references.committedAt),
          evidence,
          id: importId,
          source: { canonicalId: input.canonicalSourceId, kind: "tiktok" },
          status,
          updatedAt: Schema.encodeSync(ImportTimestamp)(updatedAt),
        });
        return Effect.succeed(
          Option.some<StoredImport>({
            acquisitionGeneration: input.generation,
            canonicalSourceId: input.canonicalSourceId,
            sourceKind: "tiktok",
            trace: { correlationId: input.correlationId },
            view,
          })
        );
      }),
      Effect.mapError(() => importPersistenceUnavailable())
    );
  return {
    findById,
    isAudioExtractionRecoveryEligible: () => Effect.succeed(false),
  };
};

export const makeHouseholdSpeechTranscriptionRepository = (
  input: HouseholdEvidenceRepositoryInput
): SpeechTranscriptionRepository => {
  const boundary = makeBoundary(input);
  const completed = (
    stage: NonNullable<Effect.Success<ReturnType<typeof boundary.read>>>
  ) => {
    if (
      stage.outcome !== "Completed" ||
      stage.result?._tag !== "Speech" ||
      stage.reference?.kind !== "speech_transcript"
    ) {
      return Effect.fail(importTransitionRejected());
    }
    const { result } = stage;
    return Effect.succeed({
      byteLength: stage.reference.byteLength,
      completedAt: result.completedAt,
      cost: result.cost,
      deleteAt: stage.reference.deleteAt,
      detectedLanguage: result.detectedLanguage,
      dispatchId: result.dispatchId,
      generation: input.generation,
      importId: decodeImportId(input.intentId),
      model: result.model,
      provider: result.provider,
      segmentsCount: result.segmentsCount,
      sourceMediaSha256: result.sourceMediaSha256,
      transcriptKey: result.transcriptKey,
      transcriptSha256: result.transcriptSha256,
      usage: result.usage,
    } satisfies CompletedTranscriptEvidence);
  };
  return {
    claim: (claim) =>
      Effect.gen(function* claimSpeechEvidence() {
        yield* assertIdentity(input, claim.importId, claim.generation);
        const receipt = yield* boundary.mutate(
          `speech:claim:${claim.sourceMediaSha256}`,
          {
            inputFingerprint: Schema.decodeUnknownSync(Sha256Hex)(
              claim.sourceMediaSha256
            ),
            operation: {
              _tag: "Claim",
              dispatchId: claim.dispatchId,
              stage: "speech",
              startedAt: claim.startedAt,
            },
          }
        );
        if (receipt.outcome === "Completed") {
          const stage = yield* boundary.read("speech");
          if (stage === null) {
            return yield* Effect.fail(importTransitionRejected());
          }
          return {
            _tag: "Completed" as const,
            evidence: yield* completed(stage),
          };
        }
        if (receipt.outcome === "Failed") {
          const stage = yield* boundary.read("speech");
          if (stage === null || stage.failureCode === null) {
            return yield* Effect.fail(importTransitionRejected());
          }
          return {
            _tag: "Failed" as const,
            code: stage.failureCode,
            dispatchId: claim.dispatchId,
          };
        }
        return {
          _tag: resumedClaimTag(receipt.outcome),
          dispatchId: claim.dispatchId,
        } satisfies SpeechDispatchClaim;
      }),
    complete: (evidence) =>
      assertIdentity(input, evidence.importId, evidence.generation).pipe(
        Effect.andThen(
          evidence.byteLength === undefined || evidence.deleteAt === undefined
            ? Effect.fail(importTransitionRejected())
            : boundary.mutate(`speech:complete:${evidence.transcriptSha256}`, {
                inputFingerprint: Schema.decodeUnknownSync(Sha256Hex)(
                  evidence.sourceMediaSha256
                ),
                operation: {
                  _tag: "Complete",
                  dispatchId: evidence.dispatchId,
                  reference: {
                    byteLength: evidence.byteLength,
                    deleteAt: evidence.deleteAt,
                    key: evidence.transcriptKey,
                    kind: "speech_transcript",
                    sha256: Schema.decodeUnknownSync(Sha256Hex)(
                      evidence.transcriptSha256
                    ),
                  },
                  result: {
                    _tag: "Speech",
                    completedAt: evidence.completedAt,
                    cost: evidence.cost,
                    detectedLanguage: evidence.detectedLanguage,
                    dispatchId: evidence.dispatchId,
                    model: evidence.model,
                    provider: evidence.provider,
                    segmentsCount: evidence.segmentsCount,
                    sourceMediaSha256: Schema.decodeUnknownSync(Sha256Hex)(
                      evidence.sourceMediaSha256
                    ),
                    transcriptKey: evidence.transcriptKey,
                    transcriptSha256: Schema.decodeUnknownSync(Sha256Hex)(
                      evidence.transcriptSha256
                    ),
                    usage: evidence.usage,
                  },
                  stage: "speech",
                },
              })
        ),
        Effect.as(evidence)
      ),
    fail: (failure) =>
      assertIdentity(input, failure.importId, failure.generation).pipe(
        Effect.andThen(
          boundary.mutate(
            `speech:fail:${failure.sourceMediaSha256}:${failure.failureCode}`,
            {
              inputFingerprint: Schema.decodeUnknownSync(Sha256Hex)(
                failure.sourceMediaSha256
              ),
              operation: {
                _tag: "Fail",
                completedAt: failure.completedAt,
                dispatchId: failure.dispatchId,
                failureCode: failure.failureCode,
                recovery: "retry_later",
                stage: "speech",
              },
            }
          )
        ),
        Effect.asVoid
      ),
  };
};

export const makeHouseholdVisualEvidenceRepository = (
  input: HouseholdEvidenceRepositoryInput
): VisualEvidenceRepository => {
  const boundary = makeBoundary(input);
  const completed = (
    stage: NonNullable<Effect.Success<ReturnType<typeof boundary.read>>>
  ) => {
    if (
      stage.outcome !== "Completed" ||
      stage.result?._tag !== "Visual" ||
      stage.reference?.kind !== "visual_manifest"
    ) {
      return Effect.fail(importTransitionRejected());
    }
    const { result } = stage;
    return Effect.succeed({
      byteLength: stage.reference.byteLength,
      completedAt: result.completedAt,
      cost: result.cost,
      deleteAt: stage.reference.deleteAt,
      dispatchId: result.dispatchId,
      generation: input.generation,
      importId: decodeImportId(input.intentId),
      manifestKey: result.manifestKey,
      manifestSha256: result.manifestSha256,
      model: result.model,
      observationsCount: result.observationsCount,
      outcome: result.outcome,
      provider: result.provider,
      sourceMediaSha256: result.sourceMediaSha256,
      usage: result.usage,
    } satisfies CompletedVisualEvidence);
  };
  return {
    claim: (claim) =>
      assertIdentity(input, claim.importId, claim.generation).pipe(
        Effect.andThen(
          boundary.mutate(`visual:claim:${claim.sourceMediaSha256}`, {
            inputFingerprint: Schema.decodeUnknownSync(Sha256Hex)(
              claim.sourceMediaSha256
            ),
            operation: {
              _tag: "Claim",
              dispatchId: claim.dispatchId,
              stage: "visual",
              startedAt: claim.startedAt,
            },
          })
        ),
        Effect.flatMap((receipt) => {
          if (receipt.outcome === "Completed") {
            return boundary.read("visual").pipe(
              Effect.flatMap((stage) =>
                stage === null
                  ? Effect.fail(importTransitionRejected())
                  : completed(stage)
              ),
              Effect.map(
                (evidence): VisualDispatchClaim => ({
                  _tag: "Completed",
                  evidence,
                })
              )
            );
          }
          if (receipt.outcome === "Failed") {
            return boundary.read("visual").pipe(
              Effect.flatMap((stage) =>
                stage?.failureCode === null || stage === null
                  ? Effect.fail(importTransitionRejected())
                  : Effect.succeed<VisualDispatchClaim>({
                      _tag: "Failed",
                      code: stage.failureCode,
                      dispatchId: claim.dispatchId,
                    })
              )
            );
          }
          return Effect.succeed<VisualDispatchClaim>({
            _tag:
              receipt.outcome === "DispatchClaimed"
                ? "DispatchClaimed"
                : "ResumeDispatch",
            dispatchId: claim.dispatchId,
          });
        })
      ),
    complete: (evidence) =>
      assertIdentity(input, evidence.importId, evidence.generation).pipe(
        Effect.andThen(
          evidence.byteLength === undefined || evidence.deleteAt === undefined
            ? Effect.fail(importTransitionRejected())
            : boundary.mutate(`visual:complete:${evidence.manifestSha256}`, {
                inputFingerprint: Schema.decodeUnknownSync(Sha256Hex)(
                  evidence.sourceMediaSha256
                ),
                operation: {
                  _tag: "Complete",
                  dispatchId: evidence.dispatchId,
                  reference: {
                    byteLength: evidence.byteLength,
                    deleteAt: evidence.deleteAt,
                    key: evidence.manifestKey,
                    kind: "visual_manifest",
                    sha256: Schema.decodeUnknownSync(Sha256Hex)(
                      evidence.manifestSha256
                    ),
                  },
                  result: {
                    _tag: "Visual",
                    completedAt: evidence.completedAt,
                    cost: evidence.cost,
                    dispatchId: evidence.dispatchId,
                    manifestKey: evidence.manifestKey,
                    manifestSha256: Schema.decodeUnknownSync(Sha256Hex)(
                      evidence.manifestSha256
                    ),
                    model: evidence.model,
                    observationsCount: evidence.observationsCount,
                    outcome: evidence.outcome,
                    provider: evidence.provider,
                    sourceMediaSha256: Schema.decodeUnknownSync(Sha256Hex)(
                      evidence.sourceMediaSha256
                    ),
                    usage: evidence.usage,
                  },
                  stage: "visual",
                },
              })
        ),
        Effect.as(evidence)
      ),
    fail: (failure) =>
      assertIdentity(input, failure.importId, failure.generation).pipe(
        Effect.andThen(
          boundary.mutate(
            `visual:fail:${failure.sourceMediaSha256}:${failure.failureCode}`,
            {
              inputFingerprint: Schema.decodeUnknownSync(Sha256Hex)(
                failure.sourceMediaSha256
              ),
              operation: {
                _tag: "Fail",
                completedAt: failure.completedAt,
                dispatchId: failure.dispatchId,
                failureCode: failure.failureCode,
                recovery: "operator_review",
                stage: "visual",
              },
            }
          )
        ),
        Effect.asVoid
      ),
  };
};

export const makeHouseholdCarouselEvidenceRepository = (
  input: HouseholdEvidenceRepositoryInput
): CarouselEvidenceRepository => {
  const boundary = makeBoundary(input);
  const completed = (
    stage: NonNullable<Effect.Success<ReturnType<typeof boundary.read>>>
  ) => {
    if (
      stage.outcome !== "Completed" ||
      stage.result?._tag !== "Carousel" ||
      stage.reference?.kind !== "carousel_manifest"
    ) {
      return Effect.fail(importTransitionRejected());
    }
    const { result } = stage;
    return Effect.succeed({
      byteLength: stage.reference.byteLength,
      completedAt: result.completedAt,
      deleteAt: stage.reference.deleteAt,
      descriptorFingerprint: result.descriptorFingerprint,
      dispatchId: result.dispatchId,
      generation: input.generation,
      imageCount: result.imageCount,
      importId: decodeImportId(input.intentId),
      manifestKey: result.manifestKey,
      manifestSha256: result.manifestSha256,
    } satisfies CompletedCarouselEvidence);
  };
  return {
    claim: (claim) =>
      Effect.gen(function* claimCarouselEvidence() {
        yield* assertIdentity(input, claim.importId, claim.generation);
        const receipt = yield* boundary.mutate(
          `carousel:claim:${claim.descriptorFingerprint}`,
          {
            inputFingerprint: Schema.decodeUnknownSync(Sha256Hex)(
              claim.descriptorFingerprint
            ),
            operation: {
              _tag: "Claim",
              dispatchId: claim.dispatchId,
              stage: "carousel",
              startedAt: claim.startedAt,
            },
          }
        );
        if (receipt.outcome === "Completed") {
          const stage = yield* boundary.read("carousel");
          if (stage === null) {
            return yield* Effect.fail(importTransitionRejected());
          }
          return {
            _tag: "Completed" as const,
            evidence: yield* completed(stage),
          };
        }
        if (receipt.outcome === "Failed") {
          const stage = yield* boundary.read("carousel");
          const code = stage?.failureCode;
          if (
            code !== "carousel_inaccessible" &&
            code !== "carousel_layout_drift" &&
            code !== "carousel_partial"
          ) {
            return yield* Effect.fail(importTransitionRejected());
          }
          return {
            _tag: "Failed" as const,
            code,
            recovery: carouselRecovery(code),
          };
        }
        return {
          _tag: resumedClaimTag(receipt.outcome),
        } satisfies CarouselEvidenceClaim;
      }),
    complete: (evidence) =>
      assertIdentity(input, evidence.importId, evidence.generation).pipe(
        Effect.andThen(
          evidence.byteLength === undefined || evidence.deleteAt === undefined
            ? Effect.fail(importTransitionRejected())
            : boundary.mutate(`carousel:complete:${evidence.manifestSha256}`, {
                inputFingerprint: Schema.decodeUnknownSync(Sha256Hex)(
                  evidence.descriptorFingerprint
                ),
                operation: {
                  _tag: "Complete",
                  dispatchId: evidence.dispatchId,
                  reference: {
                    byteLength: evidence.byteLength,
                    deleteAt: evidence.deleteAt,
                    key: evidence.manifestKey,
                    kind: "carousel_manifest",
                    sha256: Schema.decodeUnknownSync(Sha256Hex)(
                      evidence.manifestSha256
                    ),
                  },
                  result: {
                    _tag: "Carousel",
                    completedAt: evidence.completedAt,
                    descriptorFingerprint: Schema.decodeUnknownSync(Sha256Hex)(
                      evidence.descriptorFingerprint
                    ),
                    dispatchId: evidence.dispatchId,
                    imageCount: evidence.imageCount,
                    manifestKey: evidence.manifestKey,
                    manifestSha256: Schema.decodeUnknownSync(Sha256Hex)(
                      evidence.manifestSha256
                    ),
                  },
                  stage: "carousel",
                },
              })
        ),
        Effect.as(evidence)
      ),
    fail: (failure) =>
      assertIdentity(input, failure.importId, failure.generation).pipe(
        Effect.andThen(
          boundary.mutate(
            `carousel:fail:${failure.descriptorFingerprint}:${failure.code}`,
            {
              inputFingerprint: Schema.decodeUnknownSync(Sha256Hex)(
                failure.descriptorFingerprint
              ),
              operation: {
                _tag: "Fail",
                completedAt: failure.completedAt,
                dispatchId: `carousel:${failure.importId}:${failure.generation}`,
                failureCode: failure.code,
                recovery: failure.recovery,
                stage: "carousel",
              },
            }
          )
        ),
        Effect.asVoid
      ),
    findParent: (importId) =>
      String(importId) === String(input.intentId)
        ? Effect.succeed(
            Option.some({
              canonicalId: input.canonicalSourceId,
              generation: input.generation,
              status: "queued",
            })
          )
        : Effect.succeed(Option.none()),
  };
};

export const makeHouseholdRecipeDraftRepository = (
  input: HouseholdEvidenceRepositoryInput
): RecipeDraftRepository => {
  const boundary = makeBoundary(input);
  const claimResult = (fingerprint: string) =>
    boundary.read("extraction").pipe(
      Effect.flatMap((stage) => {
        if (stage === null || stage.inputFingerprint !== fingerprint) {
          return Effect.fail(importTransitionRejected());
        }
        if (
          stage.outcome === "Completed" &&
          stage.result?._tag === "Extraction"
        ) {
          return Effect.succeed<RecipeDispatchClaim>({
            _tag: "NeedsReview",
            draft: stage.result.draft,
          });
        }
        if (stage.outcome === "Failed" && stage.failureCode !== null) {
          return Effect.succeed<RecipeDispatchClaim>({
            _tag: "Failed",
            code: stage.failureCode as
              | "insufficient_evidence"
              | "invalid_schema"
              | "model_refusal"
              | "provider_error",
          });
        }
        return Effect.fail(importTransitionRejected());
      })
    );
  const claim = (claimInput: {
    readonly extractionFingerprint: string;
    readonly generation: AcquisitionGeneration;
    readonly importId: ImportId;
    readonly startedAt: ImportTimestamp;
  }) =>
    assertIdentity(input, claimInput.importId, claimInput.generation).pipe(
      Effect.andThen(
        boundary.mutate(
          `extraction:claim:${claimInput.extractionFingerprint}`,
          {
            inputFingerprint: Schema.decodeUnknownSync(Sha256Hex)(
              claimInput.extractionFingerprint
            ),
            operation: {
              _tag: "Claim",
              dispatchId: claimInput.extractionFingerprint,
              stage: "extraction",
              startedAt: claimInput.startedAt,
            },
          }
        )
      ),
      Effect.flatMap((receipt) => {
        if (receipt.outcome === "DispatchClaimed") {
          return Effect.succeed<RecipeDispatchClaim>({
            _tag: "DispatchClaimed",
          });
        }
        if (receipt.outcome === "ResumeDispatch") {
          return Effect.succeed<RecipeDispatchClaim>({
            _tag: "ResumeDispatch",
          });
        }
        return claimResult(claimInput.extractionFingerprint);
      })
    );
  return {
    claim,
    claimCarousel: claim,
    complete: (draft: RecipeDraft) =>
      assertIdentity(input, draft.importId, draft.generation).pipe(
        Effect.andThen(
          boundary.mutate(
            `extraction:complete:${draft.extractionFingerprint}`,
            {
              inputFingerprint: draft.extractionFingerprint,
              operation: {
                _tag: "Complete",
                dispatchId: draft.extractionFingerprint,
                result: { _tag: "Extraction", draft },
                stage: "extraction",
              },
            }
          )
        ),
        Effect.as(draft)
      ),
    fail: (failure) =>
      boundary
        .mutate(
          `extraction:fail:${failure.extractionFingerprint}:${failure.failureCode}`,
          {
            inputFingerprint: Schema.decodeUnknownSync(Sha256Hex)(
              failure.extractionFingerprint
            ),
            operation: {
              _tag: "Fail",
              completedAt: failure.completedAt,
              dispatchId: failure.extractionFingerprint,
              failureCode: failure.failureCode,
              recovery: "operator_review",
              stage: "extraction",
            },
          }
        )
        .pipe(Effect.asVoid),
  };
};
