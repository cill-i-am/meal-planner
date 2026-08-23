import type { RecipeImportIntentId } from "@meal-planner/recipe-import-api";
import { Effect, Option, Schema } from "effect";

import {
  HouseholdMutateEvidenceStageInput,
  HouseholdMutateEvidenceStageResult,
  HouseholdReadEvidenceReferencesResult,
  HouseholdReadEvidenceStageResult,
} from "../households/evidence/household-evidence.contract.js";
import type { HouseholdDomainWorkerMethods } from "../households/household-domain-worker.js";
import type { HouseholdOrganizationId } from "../households/household.contract.js";
import type { HouseholdImportMutationId } from "../households/recipe-import/household-recipe-import.contract.js";
import { HouseholdRecipeImportExecutionView } from "../households/recipe-import/household-recipe-import.contract.js";
import type {
  CarouselEvidenceClaim,
  CarouselEvidenceRepository,
  CompletedCarouselEvidence,
} from "./import-carousel.repository.js";
import type { ImportIntentExecutionGeneration } from "./import-intent-transition.js";
import { AcquisitionGeneration, Sha256Hex } from "./import-media.model.js";
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
import { SpeechTranscriptionFailureCode } from "./import-speech-transcription.repository.js";
import type {
  CompletedVisualEvidence,
  VisualDispatchClaim,
  VisualEvidenceRepository,
} from "./import-visual-evidence.repository.js";
import { VisualEvidenceFailureCode } from "./import-visual-evidence.repository.js";
import type { ImportTimestamp, SourceCanonicalId } from "./import.contracts.js";
import { ImportId } from "./import.contracts.js";
import {
  importPersistenceUnavailable,
  importTransitionRejected,
} from "./import.errors.js";
import type { ImportTransitionError } from "./import.repository.js";

type MutationId = (seed: string) => Effect.Effect<HouseholdImportMutationId>;

export type HouseholdEvidenceDomain = Pick<
  HouseholdDomainWorkerMethods,
  | "mutateEvidenceStage"
  | "readEvidenceReferences"
  | "readEvidenceStage"
  | "readRecipeImportExecution"
>;

interface HouseholdEvidenceRepositoryInput {
  readonly acquisitionGeneration: AcquisitionGeneration;
  readonly canonicalSourceId: SourceCanonicalId;
  readonly correlationId: ImportCorrelationId;
  readonly executionGeneration: ImportIntentExecutionGeneration;
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
      HouseholdMutateEvidenceStageInput,
      "admission" | "expectedGeneration" | "intentId" | "mutationId"
    >
  ) =>
    input.mutationId(seed).pipe(
      Effect.flatMap((mutationId) =>
        Schema.encodeEffect(HouseholdMutateEvidenceStageInput)({
          admission,
          expectedGeneration: input.executionGeneration,
          intentId: input.intentId,
          mutationId,
          ...command,
        }).pipe(Effect.flatMap(input.householdDomain.mutateEvidenceStage))
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
        expectedGeneration: input.executionGeneration,
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
        expectedGeneration: input.executionGeneration,
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
  const readExecution = () =>
    input.householdDomain
      .readRecipeImportExecution({
        admission,
        expectedGeneration: input.executionGeneration,
        intentId: input.intentId,
      })
      .pipe(
        Effect.flatMap(
          Schema.decodeUnknownEffect(HouseholdRecipeImportExecutionView, {
            onExcessProperty: "error",
          })
        ),
        Effect.mapError(mapFailure)
      );
  return { admission, mutate, read, readExecution, readReferences } as const;
};

const assertIdentity = (
  input: HouseholdEvidenceRepositoryInput,
  importId: string,
  generation: number
) =>
  String(input.intentId) === importId &&
  input.acquisitionGeneration === generation
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

export interface HouseholdImportEvidenceCurrent {
  readonly acquisitionGeneration: AcquisitionGeneration;
  readonly canonicalSourceId: SourceCanonicalId;
  readonly importId: ReturnType<typeof decodeImportId>;
  readonly sourceKind: "tiktok";
  readonly status: {
    readonly code?: string;
    readonly kind: string;
    readonly recovery?: string;
  };
}

export interface HouseholdImportEvidenceCurrentRepository {
  readonly readCurrent: (
    importId: ReturnType<typeof decodeImportId>
  ) => Effect.Effect<
    Option.Option<HouseholdImportEvidenceCurrent>,
    ImportTransitionError
  >;
}

type EvidenceReferences = Exclude<
  Schema.Schema.Type<typeof HouseholdReadEvidenceReferencesResult>,
  null
>;
type EvidenceStage = Schema.Schema.Type<
  typeof HouseholdReadEvidenceStageResult
>;
type CurrentEvidenceStatus = HouseholdImportEvidenceCurrent["status"];

const hasEvidenceReference = (
  references: EvidenceReferences,
  kind: EvidenceReferences["references"][number]["kind"]
) => references.references.some((reference) => reference.kind === kind);

const projectSpeechStatus = (
  stage: EvidenceStage,
  references: EvidenceReferences
): Effect.Effect<CurrentEvidenceStatus | null, ImportTransitionError> => {
  if (stage?.outcome === "Dispatching") {
    return Effect.succeed({ kind: "transcribing" });
  }
  if (stage?.outcome === "Failed") {
    return Schema.is(SpeechTranscriptionFailureCode)(stage.failureCode)
      ? Effect.succeed({
          code: stage.failureCode,
          kind: "failed",
          recovery: "retry_later",
        })
      : Effect.fail(importTransitionRejected());
  }
  if (stage?.outcome !== "Completed") {
    return Effect.succeed(null);
  }
  return hasEvidenceReference(references, "speech_transcript")
    ? Effect.succeed({ kind: "transcribed" })
    : Effect.fail(importTransitionRejected());
};

const projectVisualStatus = (
  stage: EvidenceStage,
  references: EvidenceReferences
): Effect.Effect<CurrentEvidenceStatus | null, ImportTransitionError> => {
  if (stage?.outcome === "Dispatching") {
    return Effect.succeed({ kind: "extracting_visual" });
  }
  if (stage?.outcome === "Failed") {
    return Schema.is(VisualEvidenceFailureCode)(stage.failureCode)
      ? Effect.succeed({
          code: stage.failureCode,
          kind: "failed",
          recovery: "operator_reconcile",
        })
      : Effect.fail(importTransitionRejected());
  }
  if (stage?.outcome !== "Completed" || stage.result?._tag !== "Visual") {
    return Effect.succeed(null);
  }
  return hasEvidenceReference(references, "visual_manifest")
    ? Effect.succeed({ kind: visualStatus(stage.result.outcome) })
    : Effect.fail(importTransitionRejected());
};

const projectExtractionStatus = (
  stage: EvidenceStage
): CurrentEvidenceStatus | undefined => {
  if (stage?.outcome === "Failed") {
    return {
      code: "recipe_extraction_failed",
      kind: "failed",
      recovery: "operator_reconcile",
    };
  }
  return stage?.outcome === "Completed" ? { kind: "needs_review" } : undefined;
};

/** Compact household-native current result for provider-stage decisions. */
export const makeHouseholdImportEvidenceCurrentRepository = (
  input: HouseholdEvidenceRepositoryInput
): HouseholdImportEvidenceCurrentRepository => {
  const boundary = makeBoundary(input);
  const importId = decodeImportId(input.intentId);
  const readCurrent: HouseholdImportEvidenceCurrentRepository["readCurrent"] = (
    id
  ) =>
    (id === importId
      ? Effect.all({
          execution: boundary.readExecution(),
          extraction: boundary.read("extraction"),
          references: boundary.readReferences(),
          speech: boundary.read("speech"),
          visual: boundary.read("visual"),
        })
      : Effect.fail(importTransitionRejected())
    ).pipe(
      Effect.flatMap(({ execution, extraction, references, speech, visual }) =>
        Effect.gen(function* projectHouseholdCurrentEvidence() {
          if (references === null) {
            return Option.none<HouseholdImportEvidenceCurrent>();
          }
          if (
            !hasEvidenceReference(references, "original_media") ||
            !hasEvidenceReference(references, "acquisition_manifest")
          ) {
            return yield* Effect.fail(importTransitionRejected());
          }
          if (execution.acquisitionAttemptGeneration === null) {
            return yield* Effect.fail(importTransitionRejected());
          }
          const speechStatus = yield* projectSpeechStatus(speech, references);
          const projectedVisualStatus = yield* projectVisualStatus(
            visual,
            references
          );
          const status = projectExtractionStatus(extraction) ??
            projectedVisualStatus ??
            speechStatus ?? { kind: "acquired" };
          return Option.some<HouseholdImportEvidenceCurrent>({
            acquisitionGeneration: Schema.decodeUnknownSync(
              AcquisitionGeneration
            )(execution.acquisitionAttemptGeneration),
            canonicalSourceId: input.canonicalSourceId,
            importId,
            sourceKind: "tiktok",
            status,
          });
        })
      ),
      Effect.mapError(() => importPersistenceUnavailable())
    );
  return {
    readCurrent,
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
      generation: input.acquisitionGeneration,
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
        const inputFingerprint = Schema.decodeUnknownSync(Sha256Hex)(
          claim.sourceMediaSha256
        );
        const current = yield* boundary.read("speech");
        if (
          current?.outcome === "Failed" &&
          current.dispatchId === claim.dispatchId &&
          current.inputFingerprint === inputFingerprint &&
          current.completedAt !== null &&
          Schema.is(SpeechTranscriptionFailureCode)(current.failureCode)
        ) {
          return {
            _tag: "Failed" as const,
            code: current.failureCode,
            completedAt: current.completedAt,
            dispatchId: claim.dispatchId,
          };
        }
        const startedAt =
          current?.dispatchId === claim.dispatchId &&
          current.inputFingerprint === inputFingerprint
            ? current.startedAt
            : claim.startedAt;
        const receipt = yield* boundary.mutate(
          `speech:claim:${claim.dispatchId}:${claim.sourceMediaSha256}`,
          {
            inputFingerprint,
            operation: {
              _tag: "Claim",
              dispatchId: claim.dispatchId,
              stage: "speech",
              startedAt,
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
          if (
            stage === null ||
            stage.completedAt === null ||
            !Schema.is(SpeechTranscriptionFailureCode)(stage.failureCode)
          ) {
            return yield* Effect.fail(importTransitionRejected());
          }
          return {
            _tag: "Failed" as const,
            code: stage.failureCode,
            completedAt: stage.completedAt,
            dispatchId: claim.dispatchId,
          };
        }
        if (receipt.outcome === "RecoveryPrepared") {
          return yield* Effect.fail(importTransitionRejected());
        }
        return {
          _tag: resumedClaimTag(receipt.outcome),
          dispatchId: claim.dispatchId,
          startedAt,
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
      Effect.gen(function* failSpeechEvidence() {
        yield* assertIdentity(input, failure.importId, failure.generation);
        const inputFingerprint = Schema.decodeUnknownSync(Sha256Hex)(
          failure.sourceMediaSha256
        );
        const current = yield* boundary.read("speech");
        if (
          current === null ||
          current.dispatchId !== failure.dispatchId ||
          current.inputFingerprint !== inputFingerprint
        ) {
          return yield* Effect.fail(importTransitionRejected());
        }
        yield* boundary.mutate(
          `speech:fail:${failure.dispatchId}:${failure.sourceMediaSha256}:${failure.failureCode}`,
          {
            inputFingerprint,
            operation: {
              _tag: "Fail",
              completedAt: failure.completedAt,
              dispatchId: failure.dispatchId,
              failureCode: failure.failureCode,
              recovery: "retry_later",
              stage: "speech",
            },
          }
        );
      }),
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
      generation: input.acquisitionGeneration,
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
      Effect.gen(function* claimVisualEvidence() {
        yield* assertIdentity(input, claim.importId, claim.generation);
        const inputFingerprint = Schema.decodeUnknownSync(Sha256Hex)(
          claim.sourceMediaSha256
        );
        const current = yield* boundary.read("visual");
        if (
          current?.outcome === "Failed" &&
          current.dispatchId === claim.dispatchId &&
          current.inputFingerprint === inputFingerprint &&
          current.completedAt !== null &&
          Schema.is(VisualEvidenceFailureCode)(current.failureCode)
        ) {
          return {
            _tag: "Failed" as const,
            code: current.failureCode,
            completedAt: current.completedAt,
            dispatchId: claim.dispatchId,
          };
        }
        const startedAt =
          current?.dispatchId === claim.dispatchId &&
          current.inputFingerprint === inputFingerprint
            ? current.startedAt
            : claim.startedAt;
        const receipt = yield* boundary.mutate(
          `visual:claim:${claim.dispatchId}:${claim.sourceMediaSha256}`,
          {
            inputFingerprint,
            operation: {
              _tag: "Claim",
              dispatchId: claim.dispatchId,
              stage: "visual",
              startedAt,
            },
          }
        );
        if (receipt.outcome === "Completed") {
          return yield* boundary.read("visual").pipe(
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
          return yield* boundary.read("visual").pipe(
            Effect.flatMap((stage) =>
              stage === null ||
              stage.completedAt === null ||
              !Schema.is(VisualEvidenceFailureCode)(stage.failureCode)
                ? Effect.fail(importTransitionRejected())
                : Effect.succeed<VisualDispatchClaim>({
                    _tag: "Failed",
                    code: stage.failureCode,
                    completedAt: stage.completedAt,
                    dispatchId: claim.dispatchId,
                  })
            )
          );
        }
        return {
          _tag:
            receipt.outcome === "DispatchClaimed"
              ? "DispatchClaimed"
              : "ResumeDispatch",
          dispatchId: claim.dispatchId,
          startedAt,
        } satisfies VisualDispatchClaim;
      }),
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
      Effect.gen(function* failVisualEvidence() {
        yield* assertIdentity(input, failure.importId, failure.generation);
        const inputFingerprint = Schema.decodeUnknownSync(Sha256Hex)(
          failure.sourceMediaSha256
        );
        const current = yield* boundary.read("visual");
        if (
          current === null ||
          current.dispatchId !== failure.dispatchId ||
          current.inputFingerprint !== inputFingerprint
        ) {
          return yield* Effect.fail(importTransitionRejected());
        }
        yield* boundary.mutate(
          `visual:fail:${failure.dispatchId}:${failure.sourceMediaSha256}:${failure.failureCode}`,
          {
            inputFingerprint,
            operation: {
              _tag: "Fail",
              completedAt: failure.completedAt,
              dispatchId: failure.dispatchId,
              failureCode: failure.failureCode,
              recovery: "operator_review",
              stage: "visual",
            },
          }
        );
      }),
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
      generation: input.acquisitionGeneration,
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
        if (receipt.outcome === "RecoveryPrepared") {
          return yield* Effect.fail(importTransitionRejected());
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
              generation: input.acquisitionGeneration,
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
  const claimStage = (
    claimInput: {
      readonly extractionFingerprint: string;
      readonly generation: AcquisitionGeneration;
      readonly importId: ImportId;
      readonly startedAt: ImportTimestamp;
    },
    extractionContext?: Parameters<RecipeDraftRepository["claim"]>[0]
  ) =>
    assertIdentity(input, claimInput.importId, claimInput.generation).pipe(
      Effect.andThen(
        boundary.mutate(
          `extraction:claim:${claimInput.extractionFingerprint}`,
          {
            inputFingerprint: Schema.decodeUnknownSync(Sha256Hex)(
              claimInput.extractionFingerprint
            ),
            operation:
              extractionContext === undefined
                ? {
                    _tag: "Claim",
                    dispatchId: claimInput.extractionFingerprint,
                    stage: "extraction",
                    startedAt: claimInput.startedAt,
                  }
                : {
                    _tag: "Claim",
                    dispatchId: claimInput.extractionFingerprint,
                    extractionContext: {
                      descriptor: extractionContext.descriptor,
                      evidenceFingerprint: Schema.decodeUnknownSync(Sha256Hex)(
                        extractionContext.evidenceFingerprint
                      ),
                      sourceMediaSha256: Schema.decodeUnknownSync(Sha256Hex)(
                        extractionContext.sourceMediaSha256
                      ),
                      transcriptSha256: Schema.decodeUnknownSync(Sha256Hex)(
                        extractionContext.transcriptSha256
                      ),
                      visualManifestSha256: Schema.decodeUnknownSync(Sha256Hex)(
                        extractionContext.visualManifestSha256
                      ),
                    },
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
    claim: (claimInput) => claimStage(claimInput, claimInput),
    claimCarousel: (claimInput) => claimStage(claimInput),
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
