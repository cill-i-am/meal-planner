import { DateTime, Effect, Option, Schema } from "effect";

import {
  readVerifiedAcquisitionEvidence,
  type AcquisitionBucketLike,
} from "./import-media-acquirer.js";
import type { VerifiedAcquisitionEvidence } from "./import-media.model.js";
import type {
  RecipeDraftRepositoryShape,
  RecipeExtractionFailureCode,
} from "./import-recipe-draft.repository.d1.js";
import type {
  RecipeEvidenceAssembly,
  RecipeEvidenceItem,
  RecipeExtraction,
  RecipeExtractorShape,
  RecipeStringFact,
  RecipeUnresolvedField,
} from "./import-recipe-extractor.js";
import {
  decodeRecipeExtraction,
  RecipeExtractorDescriptor,
} from "./import-recipe-extractor.js";
import { readVerifiedTranscriptEvidence } from "./import-speech-transcription.js";
import { readVerifiedVisualEvidence } from "./import-visual-evidence.js";
import type { ImportId, ImportTimestamp } from "./import.contracts.js";
import type { ImportRepositoryShape } from "./import.repository.js";

export interface RecipeDraftPipelineFailure {
  readonly _tag: "RecipeDraftPipelineFailure";
  readonly code:
    | RecipeExtractionFailureCode
    | "outcome_unknown"
    | "source_evidence_invalid";
}

const pipelineFailure = (
  code: RecipeDraftPipelineFailure["code"]
): RecipeDraftPipelineFailure => ({ _tag: "RecipeDraftPipelineFailure", code });

const bytesToHex = (value: ArrayBuffer) =>
  Array.from(new Uint8Array(value), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");

const sha256Text = (value: string) =>
  Effect.promise(() =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  ).pipe(Effect.map(bytesToHex));

const sourceEvidenceItems = (evidence: VerifiedAcquisitionEvidence) => {
  const source = evidence.source;
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
      return yield* Effect.fail(pipelineFailure("source_evidence_invalid"));
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

const extractionIsGrounded = (
  extraction: RecipeExtraction,
  assembly: RecipeEvidenceAssembly,
  evidence: VerifiedAcquisitionEvidence
) => {
  const evidenceById = new Map(
    assembly.items.map((item) => [item.evidenceId, item] as const)
  );
  const citationsAreReal = allSupportedFacts(extraction).every((fact) => {
    if (fact.state !== "supported") {
      return true;
    }
    return fact.citations.every((citation) => {
      const item = evidenceById.get(citation.evidenceId);
      return (
        item !== undefined &&
        item.origin === citation.origin &&
        (fact.origin === "inferred" || fact.origin === citation.origin)
      );
    });
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
    evidence.source?.creator.displayName ??
    evidence.source?.creator.handle ??
    null;
  const author = supportedStringValue(extraction.author);
  const sourceUrlEvidence = assembly.items.find(
    (item) => item.kind === "source_url"
  );
  const creatorEvidence = assembly.items.find(
    (item) => item.kind === "creator"
  );
  const cites = (fact: RecipeStringFact, evidenceId: string | undefined) =>
    fact.state === "supported" &&
    evidenceId !== undefined &&
    fact.citations.some((citation) => citation.evidenceId === evidenceId);
  const unresolved = extraction.unresolvedFields;
  const requiredUnresolved = [
    ...expectedUnresolvedFields(extraction),
    "ingredient_quantities" as const,
    "ingredient_units" as const,
  ];
  return (
    citationsAreReal &&
    listsAreConsistent &&
    extraction.usage.inputEvidenceItems === assembly.items.length &&
    sourceUrl === evidence.source?.canonicalUrl &&
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

/** Run one provider-free evidence-to-reviewable-recipe tracer. */
export const produceRecipeDraftForImport = Effect.fn(
  "Imports.produceRecipeDraft"
)(function* produceRecipeDraft(input: {
  readonly bucket: AcquisitionBucketLike;
  readonly extractor: RecipeExtractorShape;
  readonly importId: ImportId;
  readonly importRepository: ImportRepositoryShape;
  readonly now: () => ImportTimestamp;
  readonly recipeRepository: RecipeDraftRepositoryShape;
}) {
  const storedOption = yield* input.importRepository.findById(input.importId);
  const stored = yield* Option.match(storedOption, {
    onNone: () => Effect.fail(pipelineFailure("source_evidence_invalid")),
    onSome: Effect.succeed,
  });
  if (
    ![
      "needs_review",
      "visual_evidence_empty",
      "visual_evidence_found",
      "visual_evidence_low_confidence",
    ].includes(stored.view.status.kind)
  ) {
    return yield* Effect.fail(pipelineFailure("source_evidence_invalid"));
  }
  const now = input.now();
  const descriptor = yield* Schema.decodeUnknownEffect(
    RecipeExtractorDescriptor,
    { onExcessProperty: "error" }
  )(input.extractor.descriptor).pipe(
    Effect.mapError(() => pipelineFailure("invalid_schema"))
  );
  const evidence = yield* readVerifiedAcquisitionEvidence(input.bucket, {
    canonicalId: stored.canonicalSourceId,
    generation: stored.acquisitionGeneration,
    importId: input.importId,
    now: () => new Date(DateTime.toEpochMillis(now)),
  }).pipe(Effect.mapError(() => pipelineFailure("source_evidence_invalid")));
  if (evidence === null) {
    return yield* Effect.fail(pipelineFailure("source_evidence_invalid"));
  }
  const transcript = yield* readVerifiedTranscriptEvidence(input.bucket, {
    dispatchId: `speech:${input.importId}:${evidence.generation}`,
    generation: evidence.generation,
    importId: input.importId,
    sourceMediaSha256: evidence.sha256,
  }).pipe(Effect.mapError(() => pipelineFailure("source_evidence_invalid")));
  const visual = yield* readVerifiedVisualEvidence(input.bucket, {
    dispatchId: `visual:${input.importId}:${evidence.generation}`,
    generation: evidence.generation,
    importId: input.importId,
    sourceEvidenceDeleteAt: evidence.deleteAt,
    sourceMediaSha256: evidence.sha256,
  }).pipe(Effect.mapError(() => pipelineFailure("source_evidence_invalid")));
  if (Option.isNone(transcript) || Option.isNone(visual)) {
    return yield* Effect.fail(pipelineFailure("source_evidence_invalid"));
  }
  const assembly = yield* assembleEvidence(
    evidence,
    transcript.value,
    visual.value,
    input.importId
  );
  const extractionFingerprint = yield* sha256Text(
    JSON.stringify({
      evidenceFingerprint: assembly.evidenceFingerprint,
      extractor: descriptor,
    })
  );
  const claim = yield* input.recipeRepository.claim({
    descriptor,
    evidenceFingerprint: assembly.evidenceFingerprint,
    extractionFingerprint,
    generation: evidence.generation,
    importId: input.importId,
    sourceMediaSha256: evidence.sha256,
    startedAt: now,
    transcriptSha256: transcript.value.sha256,
    visualManifestSha256: visual.value.sha256,
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

  const raw = yield* input.extractor.extract(assembly).pipe(
    Effect.mapError((failure) => pipelineFailure(failure.code)),
    Effect.catch((failure) =>
      failure.code === "outcome_unknown"
        ? Effect.fail(failure)
        : input.recipeRepository
            .fail({
              completedAt: now,
              extractionFingerprint,
              failureCode:
                failure.code === "model_refusal"
                  ? "model_refusal"
                  : "provider_error",
            })
            .pipe(Effect.andThen(Effect.fail(failure)))
    )
  );
  const extraction = yield* decodeRecipeExtraction(raw).pipe(
    Effect.mapError(() => pipelineFailure("invalid_schema")),
    Effect.catch((failure) =>
      input.recipeRepository
        .fail({
          completedAt: now,
          extractionFingerprint,
          failureCode: "invalid_schema",
        })
        .pipe(Effect.andThen(Effect.fail(failure)))
    )
  );
  if (!extractionIsGrounded(extraction, assembly, evidence)) {
    yield* input.recipeRepository.fail({
      completedAt: now,
      extractionFingerprint,
      failureCode: "invalid_schema",
    });
    return yield* Effect.fail(pipelineFailure("invalid_schema"));
  }
  return yield* input.recipeRepository.complete({
    createdAt: now,
    evidenceFingerprint: assembly.evidenceFingerprint,
    extraction,
    extractionFingerprint,
    extractor: descriptor,
    generation: evidence.generation,
    importId: input.importId,
    lifecycle: "needs_review",
    schemaVersion: 1,
  });
});
