import { Cause, Effect, Exit, Option, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { EvidenceRetentionSeconds } from "../imports/import-media.model.js";
import {
  buildRecipeQualityPilotReport,
  PilotManifest,
  RecipeQualityPilotReport,
  runRecipeQualityPilotPreflight,
} from "./recipe-quality-pilot.js";

const Now = "2026-08-01T09:00:00.000Z";
const DeleteBy = "2026-08-08T09:00:00.000Z";
const ValidUntil = "2026-08-02T09:00:00.000Z";

const sample = (
  sampleId: string,
  sourceClass:
    | "carousel"
    | "dense_on_screen_text"
    | "expected_failure"
    | "normal_video"
    | "sparse_description"
    | "speech_heavy"
) => ({
  authorization: {
    authorizedAt: "2026-07-31T09:00:00.000Z",
    reference: `auth:${sampleId}`,
    route: "documented_permission" as const,
    validUntil: ValidUntil,
  },
  deleteBy: DeleteBy,
  mediaKind:
    sourceClass === "carousel" ? ("carousel" as const) : ("video" as const),
  noteCodes:
    sourceClass === "expected_failure"
      ? (["expected_failure"] as const)
      : ([] as const),
  sampleId,
  sourceClass,
});

const manifestInput = () => ({
  manifestId: "pilot-manifest-001",
  samples: [
    sample("normal-001", "normal_video"),
    sample("sparse-001", "sparse_description"),
    sample("visual-001", "dense_on_screen_text"),
    sample("speech-001", "speech_heavy"),
    sample("carousel-001", "carousel"),
    sample("failure-001", "expected_failure"),
  ],
  schemaVersion: 1 as const,
});

const preflightInput = () => ({
  budgetCapMicroUsd: 10_000_000,
  manifest: manifestInput(),
  providerReadiness: {
    mediaAcquisition: "configured" as const,
    recipeExtraction: "configured" as const,
    speechTranscription: "configured" as const,
    visualEvidence: "configured" as const,
  },
  retentionPolicy: {
    cleanupVerification: "required_after_run" as const,
    evidenceRetentionSeconds: EvidenceRetentionSeconds,
  },
  stage: "pilot-gaia-118",
});

type CostInput =
  | {
      readonly certainty: "estimated" | "known";
      readonly estimatedMicroUsd: number;
      readonly status: "reported";
    }
  | {
      readonly reason: "not_applicable_on_failure" | "provider_not_reported";
      readonly status: "unknown";
    };

const DefaultCost: CostInput = {
  certainty: "known",
  estimatedMicroUsd: 1000,
  status: "reported",
};

const metrics = (cost?: CostInput) => ({
  cost: cost ?? DefaultCost,
  latencyMilliseconds: 100,
  providerCalls: 3,
  storageBytes: 1024,
});

const quality = {
  firstPassUsefulness: "usable" as const,
  inventedQuantities: 0,
  postReviewUsability: "approved" as const,
  reviewDurationMilliseconds: 120_000,
  schemaValid: true,
  transcriptUsefulness: "useful" as const,
  unsupportedFacts: 0,
  visualCoverage: "complete" as const,
};

const successfulObservation = (
  sampleId: string,
  sourceClass: Exclude<
    ReturnType<typeof sample>["sourceClass"],
    "carousel" | "expected_failure"
  >,
  options?: {
    readonly cost?: Parameters<typeof metrics>[0];
    readonly outcome?: "approved" | "rejected";
  }
) => ({
  mediaKind: "video" as const,
  metrics: metrics(options?.cost),
  outcome: options?.outcome ?? ("approved" as const),
  quality:
    options?.outcome === "rejected"
      ? {
          ...quality,
          firstPassUsefulness: "unusable" as const,
          postReviewUsability: "rejected" as const,
        }
      : quality,
  sampleId,
  sourceClass,
  status: "evaluated" as const,
});

const unsupportedCarouselObservation = () => ({
  failureCode: "unsupported_carousel" as const,
  mediaKind: "carousel" as const,
  metrics: {
    cost: {
      certainty: "known" as const,
      estimatedMicroUsd: 0,
      status: "reported" as const,
    },
    latencyMilliseconds: 50,
    providerCalls: 0,
    storageBytes: 0,
  },
  outcome: "failed" as const,
  sampleId: "carousel-001",
  sourceClass: "carousel" as const,
  status: "evaluated" as const,
});

const notARecipeObservation = () => ({
  failureCode: "not_a_recipe" as const,
  mediaKind: "video" as const,
  metrics: metrics({
    reason: "not_applicable_on_failure",
    status: "unknown",
  }),
  outcome: "failed" as const,
  sampleId: "failure-001",
  sourceClass: "expected_failure" as const,
  status: "evaluated" as const,
});

const completeObservations = () => [
  successfulObservation("normal-001", "normal_video"),
  successfulObservation("sparse-001", "sparse_description"),
  successfulObservation("visual-001", "dense_on_screen_text"),
  successfulObservation("speech-001", "speech_heavy"),
  unsupportedCarouselObservation(),
  notARecipeObservation(),
];

const expectPreflightCode = async (input: unknown, code: string) => {
  const exit = await Effect.runPromiseExit(
    runRecipeQualityPilotPreflight(input, Now)
  );
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isSuccess(exit)) {
    throw new Error("Expected preflight failure");
  }
  expect(Option.getOrThrow(Cause.findErrorOption(exit.cause))).toEqual({
    _tag: "PilotPreflightError",
    code,
  });
};

const expectReportCode = async (
  effect: ReturnType<typeof buildRecipeQualityPilotReport>,
  code: string
) => {
  const exit = await Effect.runPromiseExit(effect);
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isSuccess(exit)) {
    throw new Error("Expected report failure");
  }
  expect(Option.getOrThrow(Cause.findErrorOption(exit.cause))).toEqual({
    _tag: "PilotReportError",
    code,
  });
};

describe("recipe quality pilot readiness", () => {
  it("boundary-parses a privacy-safe representative manifest", () => {
    const manifest = Schema.decodeUnknownSync(PilotManifest, {
      onExcessProperty: "error",
    })(manifestInput());

    expect(manifest.samples.map(({ sourceClass }) => sourceClass)).toEqual([
      "normal_video",
      "sparse_description",
      "dense_on_screen_text",
      "speech_heavy",
      "carousel",
      "expected_failure",
    ]);
    expect(JSON.stringify(manifest)).not.toMatch(
      /https?:|credential|providerResponse|sourceUrl/u
    );
  });

  it("rejects source locators, credentials, raw provider output, and media", async () => {
    await Promise.all(
      [
        { sourceUrl: "https://www.tiktok.com/@creator/video/123" },
        { credential: "secret" },
        { providerResponse: { raw: true } },
        { media: "copyrighted bytes" },
      ].map((forbidden) => {
        const input = preflightInput();
        return expectPreflightCode(
          {
            ...input,
            manifest: {
              ...input.manifest,
              samples: input.manifest.samples.map((manifestSample, index) =>
                index === 0
                  ? { ...manifestSample, ...forbidden }
                  : manifestSample
              ),
            },
          },
          "invalid_request"
        );
      })
    );

    const unsafeManifestId = preflightInput();
    unsafeManifestId.manifest.manifestId =
      "https://www.tiktok.com/@creator/video/123";
    await expectPreflightCode(unsafeManifestId, "invalid_request");
  });

  it("fails closed for every missing execution prerequisite", async () => {
    const cases: readonly [
      mutate: (input: ReturnType<typeof preflightInput>) => void,
      code: string,
    ][] = [
      [
        (input) => {
          delete (
            input.manifest.samples[0] as {
              authorization?: ReturnType<typeof sample>["authorization"];
            }
          ).authorization;
        },
        "authorization_missing",
      ],
      [(input) => (input.stage = "prod"), "stage_not_allowed"],
      [(input) => (input.stage = "pilot-gaia-117"), "stage_not_allowed"],
      [(input) => (input.stage = "development"), "stage_not_allowed"],
      [(input) => (input.budgetCapMicroUsd = 0), "budget_missing"],
      [(input) => (input.budgetCapMicroUsd = 9_999_999), "budget_exceeded"],
      [(input) => (input.budgetCapMicroUsd = 10_000_001), "budget_exceeded"],
      [
        (input) => (input.retentionPolicy.evidenceRetentionSeconds = 60),
        "retention_policy_mismatch",
      ],
      [
        (input) => {
          delete (
            input.retentionPolicy as {
              cleanupVerification?: "required_after_run";
            }
          ).cleanupVerification;
        },
        "cleanup_verification_missing",
      ],
      [
        (input) => {
          delete (
            input.providerReadiness as {
              recipeExtraction?: "configured";
            }
          ).recipeExtraction;
        },
        "provider_configuration_missing",
      ],
      [
        (input) => {
          input.manifest.samples = input.manifest.samples.filter(
            ({ sourceClass }) => sourceClass !== "carousel"
          );
        },
        "sample_coverage_incomplete",
      ],
    ];

    await Promise.all(
      cases.map(([mutate, code]) => {
        const input = preflightInput();
        mutate(input);
        return expectPreflightCode(input, code);
      })
    );
  });

  it("rejects identity, authorization, media, and deletion defects", async () => {
    const duplicate = preflightInput();
    const [firstDuplicateSample, secondDuplicateSample] =
      duplicate.manifest.samples;
    if (
      firstDuplicateSample === undefined ||
      secondDuplicateSample === undefined
    ) {
      throw new Error("Expected duplicate fixtures");
    }
    duplicate.manifest.samples[1] = {
      ...secondDuplicateSample,
      sampleId: firstDuplicateSample.sampleId,
    };
    await expectPreflightCode(duplicate, "sample_identity_duplicate");

    const expired = preflightInput();
    const [expiredSample] = expired.manifest.samples;
    const expiredAuthorization = expiredSample?.authorization;
    if (expiredAuthorization !== undefined) {
      expiredAuthorization.validUntil = "2026-08-01T08:59:59.999Z";
    }
    await expectPreflightCode(expired, "authorization_expired");

    const notStarted = preflightInput();
    const [notStartedSample] = notStarted.manifest.samples;
    if (notStartedSample !== undefined) {
      notStartedSample.authorization.authorizedAt = "2026-08-01T09:00:00.001Z";
    }
    await expectPreflightCode(notStarted, "authorization_not_started");

    const mediaMismatch = preflightInput();
    const carouselSample = mediaMismatch.manifest.samples.find(
      ({ sourceClass }) => sourceClass === "carousel"
    );
    if (carouselSample !== undefined) {
      carouselSample.mediaKind = "video";
    }
    await expectPreflightCode(mediaMismatch, "sample_media_mismatch");

    const invalidDeletion = preflightInput();
    const [first] = invalidDeletion.manifest.samples;
    if (first !== undefined) {
      first.deleteBy = "2026-08-08T09:00:00.001Z";
    }
    await expectPreflightCode(invalidDeletion, "deletion_deadline_invalid");
  });
});

describe("recipe quality pilot report", () => {
  it("reconciles four evaluated videos and two distinct typed failures", async () => {
    const ready = await Effect.runPromise(
      runRecipeQualityPilotPreflight(preflightInput(), Now)
    );
    const observations = [
      successfulObservation("normal-001", "normal_video"),
      successfulObservation("sparse-001", "sparse_description", {
        outcome: "rejected",
      }),
      successfulObservation("visual-001", "dense_on_screen_text"),
      successfulObservation("speech-001", "speech_heavy", {
        cost: { reason: "provider_not_reported", status: "unknown" },
      }),
      unsupportedCarouselObservation(),
      notARecipeObservation(),
    ];

    const report = await Effect.runPromise(
      buildRecipeQualityPilotReport(ready, observations, Now)
    );

    expect(report.summary.counts).toEqual({
      approved: 3,
      carousel: 1,
      failed: 2,
      rejected: 1,
      total: 6,
      video: 5,
    });
    expect(report.summary.accounting).toEqual({
      budgetStatus: "indeterminate",
      estimatedCostMicroUsd: 3000,
      estimatedCostSamples: 0,
      knownCostSamples: 4,
      latencyMilliseconds: 550,
      providerCalls: 15,
      storageBytes: 5120,
      unknownCostSamples: 2,
    });
    expect(report.summary.quality).toEqual({
      firstPassUsable: 3,
      inventedQuantities: 0,
      postReviewUsable: 3,
      reviewedSamples: 4,
      schemaValid: 4,
      unsupportedFacts: 0,
    });
    expect(
      Schema.encodeSync(RecipeQualityPilotReport)(report)
    ).not.toHaveProperty("manifest.samples.0.authorization");
    expect(JSON.stringify(report)).not.toMatch(
      /https?:|auth:|credential|providerResponse|sourceUrl/u
    );
  });

  it("fails when observations do not reconcile exactly or exceed the budget", async () => {
    const ready = await Effect.runPromise(
      runRecipeQualityPilotPreflight(preflightInput(), Now)
    );
    const complete = completeObservations();

    await expectReportCode(
      buildRecipeQualityPilotReport(ready, complete.slice(1), Now),
      "observations_do_not_reconcile"
    );

    await expectReportCode(
      buildRecipeQualityPilotReport(
        ready,
        [...complete.slice(0, -1), complete[0]],
        Now
      ),
      "observations_do_not_reconcile"
    );

    const overBudget = complete.map((observation) =>
      observation.sourceClass === "carousel"
        ? observation
        : {
            ...observation,
            metrics: metrics({
              certainty: "known" as const,
              estimatedMicroUsd: 2_000_001,
              status: "reported" as const,
            }),
          }
    );
    await expectReportCode(
      buildRecipeQualityPilotReport(ready, overBudget, Now),
      "budget_exceeded"
    );
  });

  it("rejects mismatched media kinds and any observation excess property", async () => {
    const ready = await Effect.runPromise(
      runRecipeQualityPilotPreflight(preflightInput(), Now)
    );
    const mismatch = unsupportedCarouselObservation();
    await expectReportCode(
      buildRecipeQualityPilotReport(
        ready,
        [
          successfulObservation("normal-001", "normal_video"),
          successfulObservation("sparse-001", "sparse_description"),
          successfulObservation("visual-001", "dense_on_screen_text"),
          successfulObservation("speech-001", "speech_heavy"),
          { ...mismatch, mediaKind: "video" },
          notARecipeObservation(),
        ],
        Now
      ),
      "sample_identity_mismatch"
    );

    const leaked = {
      ...successfulObservation("normal-001", "normal_video"),
      sourceUrl: "https://example.com/private",
    };
    await expectReportCode(
      buildRecipeQualityPilotReport(ready, [leaked], Now),
      "invalid_observations"
    );
  });

  it("rejects carousel spend or calls and preserves each slot's typed outcome", async () => {
    const ready = await Effect.runPromise(
      runRecipeQualityPilotPreflight(preflightInput(), Now)
    );
    const complete = completeObservations();
    const carouselSuccess = {
      ...successfulObservation("normal-001", "normal_video"),
      mediaKind: "carousel" as const,
      sampleId: "carousel-001",
      sourceClass: "carousel" as const,
    };
    const carouselFailure = unsupportedCarouselObservation();
    const semanticFailure = notARecipeObservation();
    const invalidObservations = [
      carouselSuccess,
      { ...carouselFailure, failureCode: "not_a_recipe" as const },
      {
        ...carouselFailure,
        metrics: { ...carouselFailure.metrics, providerCalls: 1 },
      },
      {
        ...carouselFailure,
        metrics: {
          ...carouselFailure.metrics,
          cost: {
            certainty: "known" as const,
            estimatedMicroUsd: 1,
            status: "reported" as const,
          },
        },
      },
      {
        ...carouselFailure,
        metrics: {
          ...carouselFailure.metrics,
          cost: {
            reason: "provider_not_reported" as const,
            status: "unknown" as const,
          },
        },
      },
      { ...semanticFailure, failureCode: "unsupported_carousel" as const },
    ];

    await Promise.all(
      invalidObservations.map((invalidObservation) =>
        expectReportCode(
          buildRecipeQualityPilotReport(
            ready,
            complete.map((observation) =>
              observation.sampleId === invalidObservation.sampleId
                ? invalidObservation
                : observation
            ),
            Now
          ),
          "sample_outcome_mismatch"
        )
      )
    );
  });

  it("rejects invalid generation time, contradictory quality, and aggregate overflow", async () => {
    const ready = await Effect.runPromise(
      runRecipeQualityPilotPreflight(preflightInput(), Now)
    );
    const complete = completeObservations();

    await expectReportCode(
      buildRecipeQualityPilotReport(ready, complete, "not-a-timestamp"),
      "invalid_generated_at"
    );

    const contradictory = complete.map((observation) =>
      observation.sampleId === "normal-001" && observation.outcome !== "failed"
        ? {
            ...observation,
            outcome: "rejected" as const,
          }
        : observation
    );
    await expectReportCode(
      buildRecipeQualityPilotReport(ready, contradictory, Now),
      "quality_outcome_mismatch"
    );

    const overflowing = complete.map((observation) =>
      observation.sourceClass === "carousel"
        ? observation
        : {
            ...observation,
            metrics: {
              ...observation.metrics,
              providerCalls: Number.MAX_SAFE_INTEGER,
            },
          }
    );
    await expectReportCode(
      buildRecipeQualityPilotReport(ready, overflowing, Now),
      "accounting_overflow"
    );
  });
});
