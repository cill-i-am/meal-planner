import { DateTime, Effect, Schema } from "effect";

import { EvidenceRetentionSeconds } from "../imports/import-media.model.js";
import { ImportTimestamp } from "../imports/import.contracts.js";

const TrimmedNonEmptyString = Schema.String.pipe(
  Schema.check(Schema.isTrimmed(), Schema.isNonEmpty())
);
const OpaquePilotId = TrimmedNonEmptyString.pipe(
  Schema.check(Schema.isMaxLength(64), Schema.isPattern(/^[a-z\d][a-z\d_-]*$/u))
);
const SafeInteger = Schema.Number.pipe(
  Schema.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(0),
    Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)
  )
);
/** The one already-isolated non-production stage approved for pilot evidence. */
export const RecipeQualityPilotStage = "pilot-gaia-118";
export const RecipeQualityPilotBudgetCapMicroUsd = 10_000_000;

/** Opaque identity that never contains a source locator. */
export const PilotSampleId = OpaquePilotId.pipe(Schema.brand("PilotSampleId"));
export type PilotSampleId = typeof PilotSampleId.Type;

export const PilotManifestId = OpaquePilotId.pipe(
  Schema.brand("PilotManifestId")
);
export type PilotManifestId = typeof PilotManifestId.Type;

export const PilotSourceClass = Schema.Literals([
  "normal_video",
  "sparse_description",
  "dense_on_screen_text",
  "speech_heavy",
  "carousel",
  "expected_failure",
]);
export type PilotSourceClass = typeof PilotSourceClass.Type;

export const PilotMediaKind = Schema.Literals(["video", "carousel"]);
export type PilotMediaKind = typeof PilotMediaKind.Type;

export const PilotAuthorizationRoute = Schema.Literals([
  "creator_owned",
  "documented_permission",
  "approved_research_basis",
]);
export type PilotAuthorizationRoute = typeof PilotAuthorizationRoute.Type;

const PilotAuthorizationReference = TrimmedNonEmptyString.pipe(
  Schema.check(
    Schema.isMaxLength(128),
    Schema.isPattern(/^auth:[a-z\d][a-z\d._-]*$/iu)
  ),
  Schema.brand("PilotAuthorizationReference")
);

export const PilotNoteCode = Schema.Literals([
  "edge_case",
  "expected_failure",
  "manual_review_priority",
]);
export type PilotNoteCode = typeof PilotNoteCode.Type;

export const PilotSampleAuthorization = Schema.Struct({
  authorizedAt: ImportTimestamp,
  reference: PilotAuthorizationReference,
  route: PilotAuthorizationRoute,
  validUntil: ImportTimestamp,
});
export type PilotSampleAuthorization = typeof PilotSampleAuthorization.Type;

export const PilotManifestSample = Schema.Struct({
  authorization: Schema.optionalKey(PilotSampleAuthorization),
  deleteBy: ImportTimestamp,
  mediaKind: PilotMediaKind,
  noteCodes: Schema.Array(PilotNoteCode).pipe(
    Schema.check(Schema.isMaxLength(3))
  ),
  sampleId: PilotSampleId,
  sourceClass: PilotSourceClass,
});
export type PilotManifestSample = typeof PilotManifestSample.Type;

export const PilotManifest = Schema.Struct({
  manifestId: PilotManifestId,
  samples: Schema.NonEmptyArray(PilotManifestSample).pipe(
    Schema.check(Schema.isMaxLength(50))
  ),
  schemaVersion: Schema.Literal(1),
});
export type PilotManifest = typeof PilotManifest.Type;

const ProviderReadiness = Schema.Struct({
  mediaAcquisition: Schema.optionalKey(Schema.Literal("configured")),
  recipeExtraction: Schema.optionalKey(Schema.Literal("configured")),
  speechTranscription: Schema.optionalKey(Schema.Literal("configured")),
  visualEvidence: Schema.optionalKey(Schema.Literal("configured")),
});

const PilotRetentionPolicy = Schema.Struct({
  cleanupVerification: Schema.optionalKey(Schema.Literal("required_after_run")),
  evidenceRetentionSeconds: SafeInteger,
});

export const RecipeQualityPilotPreflightRequest = Schema.Struct({
  budgetCapMicroUsd: SafeInteger,
  manifest: PilotManifest,
  providerReadiness: ProviderReadiness,
  retentionPolicy: PilotRetentionPolicy,
  stage: TrimmedNonEmptyString,
});
export type RecipeQualityPilotPreflightRequest =
  typeof RecipeQualityPilotPreflightRequest.Type;

export const PilotPreflightErrorCode = Schema.Literals([
  "authorization_expired",
  "authorization_missing",
  "authorization_not_started",
  "budget_exceeded",
  "budget_missing",
  "cleanup_verification_missing",
  "deletion_deadline_invalid",
  "invalid_request",
  "provider_configuration_missing",
  "retention_policy_mismatch",
  "sample_coverage_incomplete",
  "sample_identity_duplicate",
  "sample_media_mismatch",
  "stage_not_allowed",
]);
export type PilotPreflightErrorCode = typeof PilotPreflightErrorCode.Type;

export interface PilotPreflightError {
  readonly _tag: "PilotPreflightError";
  readonly code: PilotPreflightErrorCode;
}

const preflightError = (
  code: PilotPreflightErrorCode
): PilotPreflightError => ({
  _tag: "PilotPreflightError",
  code,
});

export interface RecipeQualityPilotReadiness {
  readonly budgetCapMicroUsd: number;
  readonly manifest: PilotManifest;
  readonly stage: typeof RecipeQualityPilotStage;
}

const RequiredSourceClasses: ReadonlySet<PilotSourceClass> = new Set([
  "normal_video",
  "sparse_description",
  "dense_on_screen_text",
  "speech_heavy",
  "carousel",
  "expected_failure",
]);

const epochMilliseconds = DateTime.toEpochMillis;

const sampleMediaMatches = (sample: PilotManifestSample) =>
  sample.sourceClass === "carousel"
    ? sample.mediaKind === "carousel"
    : sample.mediaKind === "video";

const validatePreflight = (
  request: RecipeQualityPilotPreflightRequest,
  now: ImportTimestamp
): Effect.Effect<RecipeQualityPilotReadiness, PilotPreflightError> => {
  const nowEpoch = epochMilliseconds(now);
  const maximumDeletionEpoch = nowEpoch + EvidenceRetentionSeconds * 1000;
  const authorizations = request.manifest.samples.map(
    ({ authorization }) => authorization
  );

  if (authorizations.some((authorization) => authorization === undefined)) {
    return Effect.fail(preflightError("authorization_missing"));
  }
  if (
    authorizations.some(
      (authorization) =>
        authorization !== undefined &&
        epochMilliseconds(authorization.authorizedAt) > nowEpoch
    )
  ) {
    return Effect.fail(preflightError("authorization_not_started"));
  }
  if (
    authorizations.some(
      (authorization) =>
        authorization !== undefined &&
        epochMilliseconds(authorization.validUntil) <= nowEpoch
    )
  ) {
    return Effect.fail(preflightError("authorization_expired"));
  }
  if (request.stage !== RecipeQualityPilotStage) {
    return Effect.fail(preflightError("stage_not_allowed"));
  }
  if (request.budgetCapMicroUsd < 1) {
    return Effect.fail(preflightError("budget_missing"));
  }
  if (request.budgetCapMicroUsd !== RecipeQualityPilotBudgetCapMicroUsd) {
    return Effect.fail(preflightError("budget_exceeded"));
  }
  if (
    request.retentionPolicy.evidenceRetentionSeconds !==
    EvidenceRetentionSeconds
  ) {
    return Effect.fail(preflightError("retention_policy_mismatch"));
  }
  if (request.retentionPolicy.cleanupVerification !== "required_after_run") {
    return Effect.fail(preflightError("cleanup_verification_missing"));
  }
  if (
    request.providerReadiness.mediaAcquisition !== "configured" ||
    request.providerReadiness.recipeExtraction !== "configured" ||
    request.providerReadiness.speechTranscription !== "configured" ||
    request.providerReadiness.visualEvidence !== "configured"
  ) {
    return Effect.fail(preflightError("provider_configuration_missing"));
  }

  const sampleIds = request.manifest.samples.map(({ sampleId }) => sampleId);
  if (new Set(sampleIds).size !== sampleIds.length) {
    return Effect.fail(preflightError("sample_identity_duplicate"));
  }
  if (!request.manifest.samples.every(sampleMediaMatches)) {
    return Effect.fail(preflightError("sample_media_mismatch"));
  }
  if (
    request.manifest.samples.some(({ deleteBy }) => {
      const deletionEpoch = epochMilliseconds(deleteBy);
      return deletionEpoch <= nowEpoch || deletionEpoch > maximumDeletionEpoch;
    })
  ) {
    return Effect.fail(preflightError("deletion_deadline_invalid"));
  }

  const actualClasses = new Set(
    request.manifest.samples.map(({ sourceClass }) => sourceClass)
  );
  if (
    [...RequiredSourceClasses].some(
      (sourceClass) => !actualClasses.has(sourceClass)
    )
  ) {
    return Effect.fail(preflightError("sample_coverage_incomplete"));
  }

  return Effect.succeed({
    budgetCapMicroUsd: request.budgetCapMicroUsd,
    manifest: request.manifest,
    stage: RecipeQualityPilotStage,
  });
};

/**
 * Parse and validate every prerequisite without opening provider or cloud
 * capabilities.
 */
export const runRecipeQualityPilotPreflight = (
  input: unknown,
  now: unknown
): Effect.Effect<RecipeQualityPilotReadiness, PilotPreflightError> =>
  Effect.all({
    now: Schema.decodeUnknownEffect(ImportTimestamp)(now),
    request: Schema.decodeUnknownEffect(RecipeQualityPilotPreflightRequest, {
      onExcessProperty: "error",
    })(input),
  }).pipe(
    Effect.mapError(() => preflightError("invalid_request")),
    Effect.flatMap(({ now: decodedNow, request }) =>
      validatePreflight(request, decodedNow)
    )
  );

export const PilotCost = Schema.Union([
  Schema.Struct({
    certainty: Schema.Literals(["estimated", "known"]),
    estimatedMicroUsd: SafeInteger,
    status: Schema.Literal("reported"),
  }),
  Schema.Struct({
    reason: Schema.Literals([
      "not_applicable_on_failure",
      "provider_not_reported",
    ]),
    status: Schema.Literal("unknown"),
  }),
]);
export type PilotCost = typeof PilotCost.Type;

export const PilotAccountingMetrics = Schema.Struct({
  cost: PilotCost,
  latencyMilliseconds: SafeInteger,
  providerCalls: SafeInteger,
  storageBytes: SafeInteger,
});
export type PilotAccountingMetrics = typeof PilotAccountingMetrics.Type;

export const PilotQualityMeasures = Schema.Struct({
  firstPassUsefulness: Schema.Literals([
    "usable",
    "needs_correction",
    "unusable",
  ]),
  inventedQuantities: SafeInteger,
  postReviewUsability: Schema.Literals([
    "approved",
    "rejected",
    "not_reviewed",
  ]),
  reviewDurationMilliseconds: SafeInteger,
  schemaValid: Schema.Boolean,
  transcriptUsefulness: Schema.Literals([
    "useful",
    "partial",
    "not_useful",
    "not_applicable",
  ]),
  unsupportedFacts: SafeInteger,
  visualCoverage: Schema.Literals(["complete", "partial", "insufficient"]),
});
export type PilotQualityMeasures = typeof PilotQualityMeasures.Type;

const EvaluatedObservationBase = {
  mediaKind: PilotMediaKind,
  metrics: PilotAccountingMetrics,
  sampleId: PilotSampleId,
  sourceClass: PilotSourceClass,
  status: Schema.Literal("evaluated"),
};

const SuccessfulPilotObservation = Schema.Struct({
  ...EvaluatedObservationBase,
  outcome: Schema.Literals(["approved", "rejected"]),
  quality: PilotQualityMeasures,
});

const FailedPilotObservation = Schema.Struct({
  ...EvaluatedObservationBase,
  failureCode: Schema.Literals([
    "invalid_media",
    "limit_exceeded",
    "model_refusal",
    "not_a_recipe",
    "provider_error",
    "retry_exhausted",
    "source_unavailable",
    "unsupported_carousel",
    "unsupported_source",
  ]),
  outcome: Schema.Literal("failed"),
});

export const RecipeQualityPilotObservation = Schema.Union([
  SuccessfulPilotObservation,
  FailedPilotObservation,
]);
export type RecipeQualityPilotObservation =
  typeof RecipeQualityPilotObservation.Type;
type SuccessfulPilotObservationType = Extract<
  RecipeQualityPilotObservation,
  { readonly outcome: "approved" | "rejected" }
>;

const RedactedPilotManifestSample = Schema.Struct({
  mediaKind: PilotMediaKind,
  noteCodes: Schema.Array(PilotNoteCode),
  sampleId: PilotSampleId,
  sourceClass: PilotSourceClass,
});

const RedactedPilotManifest = Schema.Struct({
  manifestId: PilotManifestId,
  samples: Schema.Array(RedactedPilotManifestSample),
  schemaVersion: Schema.Literal(1),
});

const RecipeQualityPilotReportSample = Schema.Struct({
  noteCodes: Schema.Array(PilotNoteCode),
  observation: RecipeQualityPilotObservation,
});

const PilotAggregateCounts = Schema.Struct({
  approved: SafeInteger,
  carousel: SafeInteger,
  failed: SafeInteger,
  rejected: SafeInteger,
  total: SafeInteger,
  video: SafeInteger,
});

const PilotAggregateAccounting = Schema.Struct({
  budgetStatus: Schema.Literals(["within_budget", "indeterminate"]),
  estimatedCostMicroUsd: SafeInteger,
  estimatedCostSamples: SafeInteger,
  knownCostSamples: SafeInteger,
  latencyMilliseconds: SafeInteger,
  providerCalls: SafeInteger,
  storageBytes: SafeInteger,
  unknownCostSamples: SafeInteger,
});

const PilotAggregateQuality = Schema.Struct({
  firstPassUsable: SafeInteger,
  inventedQuantities: SafeInteger,
  postReviewUsable: SafeInteger,
  reviewedSamples: SafeInteger,
  schemaValid: SafeInteger,
  unsupportedFacts: SafeInteger,
});

export const RecipeQualityPilotReport = Schema.Struct({
  generatedAt: ImportTimestamp,
  manifest: RedactedPilotManifest,
  samples: Schema.Array(RecipeQualityPilotReportSample),
  stage: Schema.Literal(RecipeQualityPilotStage),
  summary: Schema.Struct({
    accounting: PilotAggregateAccounting,
    counts: PilotAggregateCounts,
    quality: PilotAggregateQuality,
  }),
});
export type RecipeQualityPilotReport = typeof RecipeQualityPilotReport.Type;

export const PilotReportErrorCode = Schema.Literals([
  "accounting_overflow",
  "budget_exceeded",
  "invalid_generated_at",
  "invalid_observations",
  "observations_do_not_reconcile",
  "quality_outcome_mismatch",
  "sample_identity_mismatch",
  "sample_outcome_mismatch",
]);
export type PilotReportErrorCode = typeof PilotReportErrorCode.Type;

export interface PilotReportError {
  readonly _tag: "PilotReportError";
  readonly code: PilotReportErrorCode;
}

const reportError = (code: PilotReportErrorCode): PilotReportError => ({
  _tag: "PilotReportError",
  code,
});

const safeSum = <Observation>(
  observations: readonly Observation[],
  value: (observation: Observation) => number
) => {
  const total = observations.reduce(
    (sum, observation) => sum + value(observation),
    0
  );
  return Number.isSafeInteger(total) ? total : null;
};

const observationMatchesSample = (
  observation: RecipeQualityPilotObservation,
  sample: PilotManifestSample
) =>
  observation.sampleId === sample.sampleId &&
  observation.sourceClass === sample.sourceClass &&
  observation.mediaKind === sample.mediaKind;

const qualityMatchesOutcome = (observation: RecipeQualityPilotObservation) =>
  observation.outcome === "failed" ||
  (observation.outcome === "approved" &&
    observation.quality.postReviewUsability === "approved") ||
  (observation.outcome === "rejected" &&
    observation.quality.postReviewUsability === "rejected");

const observationMatchesSourceRole = (
  observation: RecipeQualityPilotObservation
) => {
  switch (observation.sourceClass) {
    case "carousel": {
      return (
        observation.outcome === "failed" &&
        observation.failureCode === "unsupported_carousel" &&
        observation.metrics.providerCalls === 0 &&
        observation.metrics.cost.status === "reported" &&
        observation.metrics.cost.certainty === "known" &&
        observation.metrics.cost.estimatedMicroUsd === 0
      );
    }
    case "expected_failure": {
      return (
        observation.outcome === "failed" &&
        observation.failureCode === "not_a_recipe"
      );
    }
    default: {
      return observation.outcome !== "failed";
    }
  }
};

/** Build one exact, redacted report from already-measured terminal outcomes. */
export const buildRecipeQualityPilotReport = (
  readiness: RecipeQualityPilotReadiness,
  input: unknown,
  generatedAt: unknown
): Effect.Effect<RecipeQualityPilotReport, PilotReportError> =>
  Effect.all({
    generatedAt: Schema.decodeUnknownEffect(ImportTimestamp)(generatedAt).pipe(
      Effect.mapError(() => reportError("invalid_generated_at"))
    ),
    observations: Schema.decodeUnknownEffect(
      Schema.Array(RecipeQualityPilotObservation),
      { onExcessProperty: "error" }
    )(input).pipe(Effect.mapError(() => reportError("invalid_observations"))),
  }).pipe(
    Effect.flatMap(({ generatedAt: decodedGeneratedAt, observations }) => {
      const manifestSamples = readiness.manifest.samples;
      const observationIds = observations.map(({ sampleId }) => sampleId);
      const manifestIds = new Set(
        manifestSamples.map(({ sampleId }) => sampleId)
      );
      if (
        observations.length !== manifestSamples.length ||
        new Set(observationIds).size !== observationIds.length ||
        observationIds.some((sampleId) => !manifestIds.has(sampleId))
      ) {
        return Effect.fail(reportError("observations_do_not_reconcile"));
      }
      if (
        observations.some((observation) => {
          const sample = manifestSamples.find(
            ({ sampleId }) => sampleId === observation.sampleId
          );
          return (
            sample === undefined ||
            !observationMatchesSample(observation, sample)
          );
        })
      ) {
        return Effect.fail(reportError("sample_identity_mismatch"));
      }
      if (!observations.every(observationMatchesSourceRole)) {
        return Effect.fail(reportError("sample_outcome_mismatch"));
      }
      if (!observations.every(qualityMatchesOutcome)) {
        return Effect.fail(reportError("quality_outcome_mismatch"));
      }

      const reportedCosts = observations.filter(
        ({ metrics }) => metrics.cost.status === "reported"
      );
      const estimatedCostMicroUsd = safeSum(reportedCosts, ({ metrics }) =>
        metrics.cost.status === "reported" ? metrics.cost.estimatedMicroUsd : 0
      );
      const latencyMilliseconds = safeSum(
        observations,
        ({ metrics }) => metrics.latencyMilliseconds
      );
      const providerCalls = safeSum(
        observations,
        ({ metrics }) => metrics.providerCalls
      );
      const storageBytes = safeSum(
        observations,
        ({ metrics }) => metrics.storageBytes
      );
      const reviewed = observations.filter(
        (observation): observation is SuccessfulPilotObservationType =>
          observation.outcome !== "failed"
      );
      const inventedQuantities = safeSum(
        reviewed,
        ({ quality }) => quality.inventedQuantities
      );
      const unsupportedFacts = safeSum(
        reviewed,
        ({ quality }) => quality.unsupportedFacts
      );
      if (
        estimatedCostMicroUsd === null ||
        latencyMilliseconds === null ||
        providerCalls === null ||
        storageBytes === null ||
        inventedQuantities === null ||
        unsupportedFacts === null
      ) {
        return Effect.fail(reportError("accounting_overflow"));
      }
      if (estimatedCostMicroUsd > readiness.budgetCapMicroUsd) {
        return Effect.fail(reportError("budget_exceeded"));
      }

      const unknownCostSamples = observations.length - reportedCosts.length;
      const report: RecipeQualityPilotReport = {
        generatedAt: decodedGeneratedAt,
        manifest: {
          manifestId: readiness.manifest.manifestId,
          samples: manifestSamples.map(
            ({ mediaKind, noteCodes, sampleId, sourceClass }) => ({
              mediaKind,
              noteCodes,
              sampleId,
              sourceClass,
            })
          ),
          schemaVersion: readiness.manifest.schemaVersion,
        },
        samples: observations.map((observation) => {
          const sample = manifestSamples.find(
            ({ sampleId }) => sampleId === observation.sampleId
          );
          return {
            noteCodes: sample?.noteCodes ?? [],
            observation,
          };
        }),
        stage: readiness.stage,
        summary: {
          accounting: {
            budgetStatus:
              unknownCostSamples === 0 ? "within_budget" : "indeterminate",
            estimatedCostMicroUsd,
            estimatedCostSamples: reportedCosts.filter(
              ({ metrics }) =>
                metrics.cost.status === "reported" &&
                metrics.cost.certainty === "estimated"
            ).length,
            knownCostSamples: reportedCosts.filter(
              ({ metrics }) =>
                metrics.cost.status === "reported" &&
                metrics.cost.certainty === "known"
            ).length,
            latencyMilliseconds,
            providerCalls,
            storageBytes,
            unknownCostSamples,
          },
          counts: {
            approved: observations.filter(
              ({ outcome }) => outcome === "approved"
            ).length,
            carousel: observations.filter(
              ({ mediaKind }) => mediaKind === "carousel"
            ).length,
            failed: observations.filter(({ outcome }) => outcome === "failed")
              .length,
            rejected: observations.filter(
              ({ outcome }) => outcome === "rejected"
            ).length,
            total: observations.length,
            video: observations.filter(({ mediaKind }) => mediaKind === "video")
              .length,
          },
          quality: {
            firstPassUsable: reviewed.filter(
              ({ quality }) => quality.firstPassUsefulness === "usable"
            ).length,
            inventedQuantities,
            postReviewUsable: reviewed.filter(
              ({ quality }) => quality.postReviewUsability === "approved"
            ).length,
            reviewedSamples: reviewed.length,
            schemaValid: reviewed.filter(({ quality }) => quality.schemaValid)
              .length,
            unsupportedFacts,
          },
        },
      };
      return Effect.succeed(report);
    })
  );
