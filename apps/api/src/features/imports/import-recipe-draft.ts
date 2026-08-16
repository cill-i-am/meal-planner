import { Effect, Option, Schema } from "effect";

import { readVerifiedAcquisitionEvidence } from "./import-media-acquirer.js";
import type { AcquisitionBucketLike } from "./import-media-acquirer.js";
import type {
  VerifiedAcquisitionEvidence,
  VerifiedSourceMetadata,
} from "./import-media.model.js";
import { Sha256Hex } from "./import-media.model.js";
import { ProviderTaskDiagnosticReasonCode } from "./import-provider-workflow-checkpoint.js";
import type {
  RecipeDispatchClaim,
  RecipeDraftRepositoryShape,
} from "./import-recipe-draft.repository.d1.js";
import type {
  RecipeEvidenceAssembly,
  RecipeEvidenceItem,
  RecipeExtractionFailureCode,
  RecipeExtraction,
  RecipeExtractorShape,
  RecipeExtractorDescriptor as RecipeExtractorDescriptorType,
  RecipeNumberFact,
  RecipeStringFact,
  RecipeUnresolvedField,
} from "./import-recipe-extractor.js";
import {
  DurableRecipeExtractionFailureCode,
  decodeRecipeExtraction,
  RecipeExtractorDescriptor,
} from "./import-recipe-extractor.js";
import { recipeEvidenceContains } from "./import-recipe-grounding.js";
import type { ImportId, ImportTimestamp } from "./import.contracts.js";
import type {
  ImportRepositoryShape,
  ImportTransitionError,
} from "./import.repository.js";
import {
  TranscriptEvidenceStore,
  TranscriptEvidenceStoreLive,
} from "./transcript-evidence-store.js";
import {
  VisualEvidenceStore,
  VisualEvidenceStoreLive,
} from "./visual-evidence-store.js";

export const RecipeDraftPipelineFailureCode = Schema.Union([
  DurableRecipeExtractionFailureCode,
  Schema.Literals([
    "outcome_unknown",
    "provider_unavailable",
    "source_evidence_invalid",
    "throttled",
    "timeout",
  ]),
]);
export type RecipeDraftPipelineFailureCode =
  typeof RecipeDraftPipelineFailureCode.Type;

const EvidenceStoreFailureCode = Schema.Literals([
  "storage_failure",
  "malformed",
  "oversized",
  "checksum_unavailable",
  "checksum_mismatch",
  "identity_mismatch",
  "metadata_mismatch",
  "invalid_frame",
  "invalid_manifest",
]);
type EvidenceStoreFailureCode = typeof EvidenceStoreFailureCode.Type;

export interface RecipeDraftPipelineFailure {
  readonly _tag: "RecipeDraftPipelineFailure";
  readonly code: RecipeDraftPipelineFailureCode;
  readonly evidenceStoreFailureCode?: EvidenceStoreFailureCode;
  readonly reasonCode?: ProviderTaskDiagnosticReasonCode;
}
export const RecipeDraftPipelineFailure =
  // eslint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is Effect's constructor factory, not a thrown expression.
  Schema.TaggedError<RecipeDraftPipelineFailure>()(
    "RecipeDraftPipelineFailure",
    {
      code: RecipeDraftPipelineFailureCode,
      evidenceStoreFailureCode: Schema.optionalKey(EvidenceStoreFailureCode),
      reasonCode: Schema.optionalKey(ProviderTaskDiagnosticReasonCode),
    }
  );

const pipelineFailure = (
  code: RecipeDraftPipelineFailure["code"],
  reasonCode?: ProviderTaskDiagnosticReasonCode,
  evidenceStoreFailureCode?: EvidenceStoreFailureCode
): RecipeDraftPipelineFailure =>
  new RecipeDraftPipelineFailure({
    code,
    ...(reasonCode === undefined ? {} : { reasonCode }),
    ...(evidenceStoreFailureCode === undefined
      ? {}
      : { evidenceStoreFailureCode }),
  });

const transcriptEvidenceReason = (error: {
  readonly reasonCode?: string;
}): ProviderTaskDiagnosticReasonCode => {
  if (error.reasonCode === "transcript_native_checksum_mismatch") {
    return "transcript_native_checksum_mismatch";
  }
  if (error.reasonCode === "transcript_native_checksum_missing") {
    return "transcript_native_checksum_missing";
  }
  return "transcript_evidence_invalid";
};

const visualEvidenceReason = (error: {
  readonly reasonCode?: string;
}): ProviderTaskDiagnosticReasonCode => {
  if (error.reasonCode === "visual_manifest_native_checksum_mismatch") {
    return "visual_manifest_native_checksum_mismatch";
  }
  if (error.reasonCode === "visual_manifest_native_checksum_missing") {
    return "visual_manifest_native_checksum_missing";
  }
  if (error.reasonCode === "visual_frame_native_checksum_mismatch") {
    return "visual_frame_native_checksum_mismatch";
  }
  return "visual_evidence_invalid";
};

export const RecipeFailureRecoveryPolicy = Schema.Literals([
  "dispatch_retry",
  "durable_recovery",
  "none",
  "operator_reconcile",
]);

export const RecipeExtractionFailureDisposition = Schema.Struct({
  durableCode: Schema.NullOr(DurableRecipeExtractionFailureCode),
  pipelineCode: RecipeDraftPipelineFailureCode,
  recoveryPolicy: RecipeFailureRecoveryPolicy,
});
export type RecipeExtractionFailureDisposition =
  typeof RecipeExtractionFailureDisposition.Type;

const RecipeExtractionFailureDispositionByCode = {
  insufficient_evidence: {
    durableCode: "insufficient_evidence",
    pipelineCode: "insufficient_evidence",
    recoveryPolicy: "none",
  },
  malformed_response: {
    durableCode: "invalid_schema",
    pipelineCode: "invalid_schema",
    recoveryPolicy: "none",
  },
  model_refusal: {
    durableCode: "model_refusal",
    pipelineCode: "model_refusal",
    recoveryPolicy: "none",
  },
  outcome_unknown: {
    durableCode: null,
    pipelineCode: "outcome_unknown",
    recoveryPolicy: "operator_reconcile",
  },
  provider_error: {
    durableCode: "provider_error",
    pipelineCode: "provider_error",
    recoveryPolicy: "durable_recovery",
  },
  provider_unavailable: {
    durableCode: null,
    pipelineCode: "provider_unavailable",
    recoveryPolicy: "dispatch_retry",
  },
  throttled: {
    durableCode: null,
    pipelineCode: "throttled",
    recoveryPolicy: "dispatch_retry",
  },
  timeout: {
    durableCode: null,
    pipelineCode: "timeout",
    recoveryPolicy: "dispatch_retry",
  },
} as const satisfies Record<
  RecipeExtractionFailureCode,
  RecipeExtractionFailureDisposition
>;

/** Total, compile-time exhaustive projection into persistence and recovery. */
export const projectRecipeExtractionFailure = (
  code: RecipeExtractionFailureCode
): RecipeExtractionFailureDisposition =>
  RecipeExtractionFailureDispositionByCode[code];

const completedVisualStatuses = new Set([
  "visual_evidence_empty",
  "visual_evidence_found",
  "visual_evidence_low_confidence",
]);

const isRecipeEvidenceReadyStatus = (
  status: {
    readonly code?: string;
    readonly kind: string;
    readonly recovery?: string;
  },
  isRecovery: boolean
) => {
  if (completedVisualStatuses.has(status.kind)) {
    return true;
  }
  if (!isRecovery) {
    return status.kind === "needs_review";
  }
  if (status.kind === "transcribed") {
    return true;
  }
  return (
    status.kind === "failed" &&
    status.code === "recipe_extraction_failed" &&
    status.recovery === "operator_reconcile"
  );
};

const recoveryEvidenceMismatchReason = (input: {
  readonly actualEvidenceFingerprint: string;
  readonly actualGeneration: number;
  readonly actualTranscriptSha256: string;
  readonly actualVisualManifestSha256: string;
  readonly expectedEvidenceFingerprint: string;
  readonly expectedGeneration: number;
  readonly expectedTranscriptSha256: string;
  readonly expectedVisualManifestSha256: string;
}): ProviderTaskDiagnosticReasonCode | null => {
  if (input.actualGeneration !== input.expectedGeneration) {
    return "recovery_generation_mismatch";
  }
  if (input.actualTranscriptSha256 !== input.expectedTranscriptSha256) {
    return "recovery_transcript_hash_mismatch";
  }
  if (input.actualVisualManifestSha256 !== input.expectedVisualManifestSha256) {
    return "recovery_visual_hash_mismatch";
  }
  if (input.actualEvidenceFingerprint !== input.expectedEvidenceFingerprint) {
    return "recovery_assembly_fingerprint_mismatch";
  }
  return null;
};

const bytesToHex = (value: ArrayBuffer) =>
  Array.from(new Uint8Array(value), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");

const sha256Text = (value: string) =>
  Effect.promise(() =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  ).pipe(
    Effect.map(bytesToHex),
    Effect.map(Schema.decodeUnknownSync(Sha256Hex))
  );

const sourceEvidenceItems = (evidence: VerifiedAcquisitionEvidence) => {
  const { source } = evidence;
  if (source === undefined) {
    return null;
  }
  const items: RecipeEvidenceItem[] = [
    {
      artifactReference: evidence.manifestKey,
      evidenceId: `source_url:${evidence.sha256}`,
      kind: "source_url",
      origin: "observed",
      value: source.canonicalUrl,
    },
  ];
  const creator = source.creator.displayName ?? source.creator.handle;
  if (creator !== null) {
    items.push({
      artifactReference: evidence.manifestKey,
      evidenceId: `creator:${evidence.sha256}`,
      kind: "creator",
      origin: "observed",
      value: creator,
    });
  }
  if (source.caption !== null) {
    items.push({
      artifactReference: evidence.manifestKey,
      evidenceId: `caption:${evidence.sha256}`,
      kind: "caption",
      origin: "creator_provided",
      value: source.caption,
    });
  }
  return items;
};

const assembleEvidence = (
  evidence: VerifiedAcquisitionEvidence,
  transcript: {
    readonly document: { readonly text: string };
    readonly sha256: string;
  },
  visual: {
    readonly document: {
      readonly observations: readonly { readonly text: string }[];
    };
    readonly sha256: string;
  },
  importId: ImportId
) =>
  Effect.gen(function* assemble() {
    const sourceItems = sourceEvidenceItems(evidence);
    if (sourceItems === null) {
      return yield* Effect.fail(
        pipelineFailure("source_evidence_invalid", "source_metadata_missing")
      );
    }
    const items: RecipeEvidenceItem[] = [
      ...sourceItems,
      {
        artifactReference: `imports/${importId}/transcription/v1/generations/${evidence.generation}/transcript.json`,
        evidenceId: `transcript:${transcript.sha256}`,
        kind: "transcript",
        origin: "creator_provided",
        value: transcript.document.text,
      },
      ...visual.document.observations.map((observation, index) => ({
        artifactReference: `imports/${importId}/visual/v1/generations/${evidence.generation}/manifest.json`,
        evidenceId: `visual:${visual.sha256}:${index}`,
        kind: "visual_observation" as const,
        origin: "observed" as const,
        value: observation.text,
      })),
    ];
    const evidenceFingerprint = yield* sha256Text(
      JSON.stringify({
        generation: evidence.generation,
        importId,
        items,
        sourceMediaSha256: evidence.sha256,
        transcriptSha256: transcript.sha256,
        visualManifestSha256: visual.sha256,
      })
    );
    return {
      evidenceFingerprint,
      generation: evidence.generation,
      importId,
      items,
    } satisfies RecipeEvidenceAssembly;
  });

const scalarFacts = (extraction: RecipeExtraction) => [
  extraction.author,
  extraction.category,
  extraction.cookTimeMinutes,
  extraction.cuisine,
  extraction.description,
  extraction.name,
  extraction.nutrition,
  extraction.prepTimeMinutes,
  extraction.sourceUrl,
  extraction.temperatureCelsius,
  extraction.totalTimeMinutes,
  extraction.yield,
];

const allSupportedFacts = (extraction: RecipeExtraction) => [
  ...scalarFacts(extraction),
  ...(extraction.ingredientLines.state === "supported"
    ? extraction.ingredientLines.items
    : []),
  ...(extraction.instructions.state === "supported"
    ? extraction.instructions.items
    : []),
  ...(extraction.supportedClaims.state === "supported"
    ? extraction.supportedClaims.items
    : []),
  ...(extraction.tools.state === "supported" ? extraction.tools.items : []),
];

const expectedUnresolvedFields = (extraction: RecipeExtraction) => {
  const fields: [RecipeUnresolvedField, { readonly state: string }][] = [
    ["author", extraction.author],
    ["category", extraction.category],
    ["cook_time_minutes", extraction.cookTimeMinutes],
    ["cuisine", extraction.cuisine],
    ["description", extraction.description],
    ["ingredient_lines", extraction.ingredientLines],
    ["instructions", extraction.instructions],
    ["name", extraction.name],
    ["nutrition", extraction.nutrition],
    ["prep_time_minutes", extraction.prepTimeMinutes],
    ["temperature_celsius", extraction.temperatureCelsius],
    ["tools", extraction.tools],
    ["total_time_minutes", extraction.totalTimeMinutes],
    ["yield", extraction.yield],
  ];
  return fields
    .filter(([, fact]) => fact.state === "unresolved")
    .map(([field]) => field);
};

const supportedStringValue = (fact: RecipeStringFact) =>
  fact.state === "supported" ? fact.value : null;

const cites = (fact: RecipeStringFact, evidenceId: string | undefined) =>
  fact.state === "supported" &&
  evidenceId !== undefined &&
  fact.citations.some((citation) => citation.evidenceId === evidenceId);

const numberFactIsSupportedBy = (
  fact: RecipeNumberFact,
  evidenceById: ReadonlyMap<string, RecipeEvidenceItem>,
  predicate: (item: RecipeEvidenceItem, value: number) => boolean
) =>
  fact.state === "unresolved" ||
  fact.citations.some((citation) => {
    const item = evidenceById.get(citation.evidenceId);
    return item !== undefined && predicate(item, fact.value);
  });

const timeIsSupported = (item: RecipeEvidenceItem, value: number) =>
  new RegExp(`\\b${value}\\s*(?:minutes?|mins?)\\b`, "iu").test(item.value);

const temperatureIsSupported = (item: RecipeEvidenceItem, value: number) =>
  new RegExp(`\\b${value}\\s*(?:°\\s*)?c\\b`, "iu").test(item.value);

const numericFactsAreGrounded = (
  extraction: RecipeExtraction,
  evidenceById: ReadonlyMap<string, RecipeEvidenceItem>
) =>
  [
    extraction.cookTimeMinutes,
    extraction.prepTimeMinutes,
    extraction.totalTimeMinutes,
  ].every((fact) =>
    numberFactIsSupportedBy(fact, evidenceById, timeIsSupported)
  ) &&
  numberFactIsSupportedBy(
    extraction.temperatureCelsius,
    evidenceById,
    temperatureIsSupported
  );

const extractionIsGrounded = (
  extraction: RecipeExtraction,
  assembly: RecipeEvidenceAssembly,
  source: VerifiedSourceMetadata
) => {
  const evidenceById = new Map(
    assembly.items.map((item) => [item.evidenceId, item] as const)
  );
  const citationsAreReal = allSupportedFacts(extraction).every((fact) => {
    if (fact.state !== "supported") {
      return true;
    }
    const citedEvidence = fact.citations.map((citation) => ({
      citation,
      item: evidenceById.get(citation.evidenceId),
    }));
    return (
      citedEvidence.every(
        ({ citation, item }) =>
          item !== undefined &&
          item.origin === citation.origin &&
          (fact.origin === "inferred" || fact.origin === citation.origin)
      ) &&
      citedEvidence.some(({ item }) =>
        item === undefined
          ? false
          : recipeEvidenceContains(item.value, String(fact.value))
      )
    );
  });
  const listsAreConsistent = [
    extraction.ingredientLines,
    extraction.instructions,
    extraction.supportedClaims,
    extraction.tools,
  ].every(
    (list) =>
      list.state === "unresolved" ||
      list.items.every((item) => item.state === "supported")
  );
  const sourceUrl = supportedStringValue(extraction.sourceUrl);
  const expectedAuthor =
    source.creator.displayName ?? source.creator.handle ?? null;
  const author = supportedStringValue(extraction.author);
  const sourceUrlEvidence = assembly.items.find(
    (item) => item.kind === "source_url"
  );
  const creatorEvidence = assembly.items.find(
    (item) => item.kind === "creator"
  );
  const unresolved = extraction.unresolvedFields;
  const requiredUnresolved = [
    ...expectedUnresolvedFields(extraction),
    "ingredient_quantities" as const,
    "ingredient_units" as const,
  ];
  return (
    citationsAreReal &&
    numericFactsAreGrounded(extraction, evidenceById) &&
    listsAreConsistent &&
    extraction.usage.inputEvidenceItems === assembly.items.length &&
    sourceUrl === source.canonicalUrl &&
    cites(extraction.sourceUrl, sourceUrlEvidence?.evidenceId) &&
    (expectedAuthor === null
      ? extraction.author.state === "unresolved"
      : author === expectedAuthor &&
        cites(extraction.author, creatorEvidence?.evidenceId)) &&
    new Set(unresolved).size === unresolved.length &&
    requiredUnresolved.length === unresolved.length &&
    requiredUnresolved.every((field) => unresolved.includes(field))
  );
};

/** Semantic recipe boundary: accessible non-food evidence must never become a draft. */
export const hasMinimumRecipeEvidence = (extraction: RecipeExtraction) =>
  extraction.ingredientLines.state === "supported" &&
  extraction.ingredientLines.items.length > 0 &&
  extraction.instructions.state === "supported" &&
  extraction.instructions.items.length > 0;

interface RecipeDraftClaimContext {
  readonly descriptor: RecipeExtractorDescriptorType;
  readonly evidenceFingerprint: string;
  readonly extractionFingerprint: string;
}

interface ProduceRecipeDraftFromEvidenceInput {
  readonly assembly: RecipeEvidenceAssembly;
  readonly claim: (
    context: RecipeDraftClaimContext
  ) => Effect.Effect<RecipeDispatchClaim, ImportTransitionError>;
  readonly extractor: RecipeExtractorShape;
  readonly extractionFingerprint?: string;
  readonly now: ImportTimestamp;
  readonly recipeRepository: RecipeDraftRepositoryShape;
  readonly source: VerifiedSourceMetadata;
  readonly transcript:
    | { readonly route: "video_v1" }
    | {
        readonly reason: "source_type_carousel";
        readonly route: "carousel_v2";
        readonly status: "not_applicable";
      };
}

/** Shared extraction, grounding, and review-draft boundary for every source type. */
export const produceRecipeDraftFromEvidence = Effect.fn(
  "Imports.produceRecipeDraftFromEvidence"
)(function* produceFromEvidence(input: ProduceRecipeDraftFromEvidenceInput) {
  const descriptor = yield* Schema.decodeUnknownEffect(
    RecipeExtractorDescriptor,
    {
      onExcessProperty: "error",
    }
  )(input.extractor.descriptor).pipe(
    Effect.mapError(() => pipelineFailure("invalid_schema"))
  );
  const evidenceFingerprint = yield* Schema.decodeUnknownEffect(Sha256Hex)(
    input.assembly.evidenceFingerprint
  ).pipe(Effect.mapError(() => pipelineFailure("invalid_schema")));
  const extractionFingerprintEffect =
    input.extractionFingerprint === undefined
      ? sha256Text(
          JSON.stringify({
            evidenceFingerprint,
            extractor: descriptor,
          })
        )
      : Schema.decodeUnknownEffect(Sha256Hex)(input.extractionFingerprint).pipe(
          Effect.mapError(() => pipelineFailure("invalid_schema"))
        );
  const extractionFingerprint = yield* extractionFingerprintEffect;
  const claim = yield* input.claim({
    descriptor,
    evidenceFingerprint,
    extractionFingerprint,
  });
  if (claim._tag === "NeedsReview") {
    return claim.draft;
  }
  if (claim._tag === "Failed") {
    return yield* Effect.fail(pipelineFailure(claim.code));
  }
  if (claim._tag === "ResumeDispatch") {
    return yield* Effect.fail(pipelineFailure("outcome_unknown"));
  }

  const raw = yield* input.extractor.extract(input.assembly).pipe(
    Effect.catch((error) => {
      const disposition = projectRecipeExtractionFailure(error.code);
      const pipelineError = pipelineFailure(disposition.pipelineCode);
      return disposition.durableCode === null
        ? Effect.fail(pipelineError)
        : input.recipeRepository
            .fail({
              completedAt: input.now,
              extractionFingerprint,
              failureCode: disposition.durableCode,
            })
            .pipe(Effect.andThen(Effect.fail(pipelineError)));
    })
  );
  const extraction = yield* decodeRecipeExtraction(raw).pipe(
    Effect.mapError(() => pipelineFailure("invalid_schema")),
    Effect.catch((error) =>
      input.recipeRepository
        .fail({
          completedAt: input.now,
          extractionFingerprint,
          failureCode: "invalid_schema",
        })
        .pipe(Effect.andThen(Effect.fail(error)))
    )
  );
  if (!extractionIsGrounded(extraction, input.assembly, input.source)) {
    yield* input.recipeRepository.fail({
      completedAt: input.now,
      extractionFingerprint,
      failureCode: "invalid_schema",
    });
    return yield* Effect.fail(pipelineFailure("invalid_schema"));
  }
  if (!hasMinimumRecipeEvidence(extraction)) {
    yield* input.recipeRepository.fail({
      completedAt: input.now,
      extractionFingerprint,
      failureCode: "insufficient_evidence",
    });
    return yield* Effect.fail(pipelineFailure("insufficient_evidence"));
  }
  return yield* input.recipeRepository.complete(
    input.transcript.route === "video_v1"
      ? {
          createdAt: input.now,
          evidenceFingerprint,
          extraction,
          extractionFingerprint,
          extractor: descriptor,
          generation: input.assembly.generation,
          importId: input.assembly.importId,
          lifecycle: "needs_review",
          schemaVersion: 1,
        }
      : {
          createdAt: input.now,
          evidenceFingerprint,
          extraction,
          extractionFingerprint,
          extractor: descriptor,
          generation: input.assembly.generation,
          importId: input.assembly.importId,
          lifecycle: "needs_review",
          schemaVersion: 2,
          transcript: {
            reason: input.transcript.reason,
            status: input.transcript.status,
          },
        }
  );
});

/** Run one provider-free evidence-to-reviewable-recipe tracer. */
export const produceRecipeDraftForImport = Effect.fn(
  "Imports.produceRecipeDraft"
)(function* produceRecipeDraft(input: {
  readonly bucket: AcquisitionBucketLike;
  readonly extractor: RecipeExtractorShape;
  readonly importId: ImportId;
  readonly importRepository: ImportRepositoryShape;
  readonly now: () => ImportTimestamp;
  readonly recovery?: {
    readonly acquisitionGeneration: number;
    readonly dispatchId: string;
    readonly evidenceFingerprint: string;
    readonly extractionFingerprint: string;
    readonly transcriptSha256: string;
    readonly visualManifestSha256: string;
  };
  readonly recipeRepository: RecipeDraftRepositoryShape;
}) {
  const storedOption = yield* input.importRepository.findById(input.importId);
  const stored = yield* Option.match(storedOption, {
    onNone: () =>
      Effect.fail(pipelineFailure("source_evidence_invalid", "import_missing")),
    onSome: Effect.succeed,
  });
  const allowedStatus = isRecipeEvidenceReadyStatus(
    stored.view.status,
    input.recovery !== undefined
  );
  if (!allowedStatus) {
    return yield* Effect.fail(
      pipelineFailure("source_evidence_invalid", "parent_state_invalid")
    );
  }
  const now = input.now();
  const evidence = yield* readVerifiedAcquisitionEvidence(input.bucket, {
    canonicalId: stored.canonicalSourceId,
    generation: stored.acquisitionGeneration,
    importId: input.importId,
    observedAt: now,
  }).pipe(
    Effect.mapError(() =>
      pipelineFailure("source_evidence_invalid", "acquisition_evidence_invalid")
    )
  );
  if (evidence === null) {
    return yield* Effect.fail(
      pipelineFailure("source_evidence_invalid", "acquisition_evidence_missing")
    );
  }
  const transcript = yield* TranscriptEvidenceStore.pipe(
    Effect.flatMap((store) =>
      store.readVerified({
        dispatchId: `speech:${input.importId}:${evidence.generation}`,
        generation: evidence.generation,
        importId: input.importId,
        ...(input.recovery === undefined
          ? {}
          : {
              recoverySha256: Schema.decodeUnknownSync(Sha256Hex)(
                input.recovery.transcriptSha256
              ),
            }),
        sourceMediaSha256: evidence.sha256,
      })
    ),
    Effect.provide(TranscriptEvidenceStoreLive(input.bucket)),
    Effect.mapError((error) =>
      pipelineFailure(
        "source_evidence_invalid",
        transcriptEvidenceReason(error),
        error.code
      )
    )
  );
  const visual = yield* VisualEvidenceStore.pipe(
    Effect.flatMap((store) =>
      store.readVerified({
        dispatchId: `visual:${input.importId}:${evidence.generation}`,
        generation: evidence.generation,
        importId: input.importId,
        ...(input.recovery === undefined
          ? {}
          : {
              recoverySha256: Schema.decodeUnknownSync(Sha256Hex)(
                input.recovery.visualManifestSha256
              ),
            }),
        sourceEvidenceDeleteAt: evidence.deleteAt,
        sourceMediaSha256: evidence.sha256,
      })
    ),
    Effect.provide(VisualEvidenceStoreLive(input.bucket)),
    Effect.mapError((error) =>
      pipelineFailure(
        "source_evidence_invalid",
        visualEvidenceReason(error),
        error.code
      )
    )
  );
  if (Option.isNone(transcript)) {
    return yield* Effect.fail(
      pipelineFailure("source_evidence_invalid", "transcript_evidence_missing")
    );
  }
  if (Option.isNone(visual)) {
    return yield* Effect.fail(
      pipelineFailure("source_evidence_invalid", "visual_evidence_missing")
    );
  }
  const assembly = yield* assembleEvidence(
    evidence,
    transcript.value,
    visual.value,
    input.importId
  );
  if (input.recovery !== undefined) {
    const mismatchReason = recoveryEvidenceMismatchReason({
      actualEvidenceFingerprint: assembly.evidenceFingerprint,
      actualGeneration: evidence.generation,
      actualTranscriptSha256: transcript.value.sha256,
      actualVisualManifestSha256: visual.value.sha256,
      expectedEvidenceFingerprint: input.recovery.evidenceFingerprint,
      expectedGeneration: input.recovery.acquisitionGeneration,
      expectedTranscriptSha256: input.recovery.transcriptSha256,
      expectedVisualManifestSha256: input.recovery.visualManifestSha256,
    });
    if (mismatchReason !== null) {
      return yield* Effect.fail(
        pipelineFailure("source_evidence_invalid", mismatchReason)
      );
    }
  }
  const dispatchedAssembly =
    input.recovery === undefined
      ? assembly
      : {
          ...assembly,
          dispatchId: input.recovery.dispatchId,
        };
  const { source } = evidence;
  if (source === undefined) {
    return yield* Effect.fail(
      pipelineFailure("source_evidence_invalid", "source_metadata_missing")
    );
  }
  return yield* produceRecipeDraftFromEvidence({
    assembly: dispatchedAssembly,
    claim: ({ descriptor, evidenceFingerprint, extractionFingerprint }) =>
      input.recipeRepository.claim({
        descriptor,
        evidenceFingerprint,
        extractionFingerprint,
        generation: evidence.generation,
        importId: input.importId,
        sourceMediaSha256: evidence.sha256,
        startedAt: now,
        transcriptSha256: transcript.value.sha256,
        visualManifestSha256: visual.value.sha256,
      }),
    extractor: input.extractor,
    ...(input.recovery === undefined
      ? {}
      : { extractionFingerprint: input.recovery.extractionFingerprint }),
    now,
    recipeRepository: input.recipeRepository,
    source,
    transcript: { route: "video_v1" },
  });
});
