import {
  CreateMealPlanPayload,
  HouseholdMealPlanPrincipal,
  HouseholdOrganizationId,
  MealPlanPersistenceFailure,
  MealPlanRecipeSnapshot,
  MealPlanRecipeSnapshotId,
} from "@meal-planner/household-api";
import { RecipeImportHouseholdScopeId } from "@meal-planner/recipe-import-api";
import { applyD1Migrations, env } from "cloudflare:test";
import { Effect, Option, Schema } from "effect";
import { beforeAll, describe, expect, it } from "vitest";

import {
  ApprovedRecipeAuthorityMismatch,
  ApprovedRecipeCandidatePageSize,
  ApprovedRecipeCandidatePageTooLarge,
  ApprovedRecipeCandidateQueryCapacityExceeded,
  ApprovedRecipeProjectionTooLarge,
  findCurrentApprovedRecipeProjections,
  readCurrentApprovedRecipeCandidateCatalogue,
} from "../imports/import-approved-recipe-projection.d1.js";
import { AcquisitionGeneration } from "../imports/import-media.model.js";
import { RecipeDraft } from "../imports/import-recipe-draft.repository.d1.js";
import { workerTestMigrations } from "../imports/import-worker-test-environment.js";
import { ImportId } from "../imports/import.contracts.js";
import {
  ApprovedMealPlanRecipePayloadTooLarge,
  findApprovedMealPlanRecipeSnapshot,
  hydrateApprovedMealPlanRecipeSnapshots,
  readApprovedMealPlanRecipeCandidateCatalogue,
} from "./household-meal-plan.recipe-source.js";
import { makeHouseholdMealPlanGateway } from "./household-request-composition.js";

const organizationId = Schema.decodeUnknownSync(HouseholdOrganizationId)(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
);
const otherOrganizationId = Schema.decodeUnknownSync(HouseholdOrganizationId)(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
);
const oversizedOrganizationId = Schema.decodeUnknownSync(
  HouseholdOrganizationId
)("cccccccc-cccc-4ccc-8ccc-cccccccccccc");
const boundedHistoryOrganizationId = Schema.decodeUnknownSync(
  HouseholdOrganizationId
)("dddddddd-dddd-4ddd-8ddd-dddddddddddd");
const changedAuthorityOrganizationId = Schema.decodeUnknownSync(
  HouseholdOrganizationId
)("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");
const heavyProjectionOrganizationId = Schema.decodeUnknownSync(
  HouseholdOrganizationId
)("ffffffff-ffff-4fff-8fff-ffffffffffff");
const oversizedTagsOrganizationId = Schema.decodeUnknownSync(
  HouseholdOrganizationId
)("99999999-9999-4999-8999-999999999999");
const exactSwapRaceOrganizationId = Schema.decodeUnknownSync(
  HouseholdOrganizationId
)("12121212-1212-4212-8212-121212121212");
const exactSwapGuardOrganizationId = Schema.decodeUnknownSync(
  HouseholdOrganizationId
)("13131313-1313-4313-8313-131313131313");

// SHA-256 of each immutable organization ID. These fixtures intentionally do
// not share the production derivation function, so a routing drift fails here.
const householdScopeId =
  "303617b9730210ef3c86c52dc2aecc4dce54aaca6af8c8b0f4ceec9ecc54e57e";
const otherHouseholdScopeId =
  "00f765af1c54eb24e437746c4f64b5841490757b647bf3a392b042f872ad7090";
const oversizedHouseholdScopeId =
  "50d86b120e98f07660afbbced8b9bcc875f8747ec369c205aaab35bb8d169849";
const boundedHistoryHouseholdScopeId =
  "0bb5de138389a087e1b8fad73c3855374680b8bb6d2163900244eacdf96ad2b0";
const changedAuthorityHouseholdScopeId =
  "6cc9b1298c8fcbf207dd4082f223d8404090286eb5b0e221bb5563b48b9e66ff";
const heavyProjectionHouseholdScopeId =
  "2dab195ed4f7382f1f6ef09c9d6a2e788e2203bf7a1f59d7e12bb4abcc01807e";
const oversizedTagsHouseholdScopeId =
  "e8d95748107aceb93f7fab2901c84c97372d2853a2aea63be35fc4b5822fa19c";
const catalogueCapacityHouseholdScopeId =
  "f2da1f9533d46ea37e5dc22bbd7e2357f96b93141e5ced93f02b480065b3ee81";
const catalogueSnapshotHouseholdScopeId =
  "a9703d75e61670054471bf04ee63439c365fcb5f0c54dcb9d8d44ffb30cc56a1";
const oversizedIdentityHouseholdScopeId =
  "8181818181818181818181818181818181818181818181818181818181818181";
const oversizedTransitionHouseholdScopeId =
  "8282828282828282828282828282828282828282828282828282828282828282";
const exactSwapRaceHouseholdScopeId =
  "cd2a20671fb6b3d5a3fe8672279fe90fce2191e9a161e87d87969c6cd1955335";
const exactSwapGuardHouseholdScopeId =
  "cff622f8551359598c6fb631f9d18255d45c1a37d93d40fcb0aaf4776a811924";
const admittedHouseholdScopeId = Schema.decodeUnknownSync(
  RecipeImportHouseholdScopeId
)(householdScopeId);
const admittedBoundedHistoryHouseholdScopeId = Schema.decodeUnknownSync(
  RecipeImportHouseholdScopeId
)(boundedHistoryHouseholdScopeId);
const admittedChangedAuthorityHouseholdScopeId = Schema.decodeUnknownSync(
  RecipeImportHouseholdScopeId
)(changedAuthorityHouseholdScopeId);
const admittedHeavyProjectionHouseholdScopeId = Schema.decodeUnknownSync(
  RecipeImportHouseholdScopeId
)(heavyProjectionHouseholdScopeId);
const admittedOversizedTagsHouseholdScopeId = Schema.decodeUnknownSync(
  RecipeImportHouseholdScopeId
)(oversizedTagsHouseholdScopeId);
const admittedCatalogueCapacityHouseholdScopeId = Schema.decodeUnknownSync(
  RecipeImportHouseholdScopeId
)(catalogueCapacityHouseholdScopeId);
const admittedCatalogueSnapshotHouseholdScopeId = Schema.decodeUnknownSync(
  RecipeImportHouseholdScopeId
)(catalogueSnapshotHouseholdScopeId);
const admittedOversizedIdentityHouseholdScopeId = Schema.decodeUnknownSync(
  RecipeImportHouseholdScopeId
)(oversizedIdentityHouseholdScopeId);
const admittedOversizedTransitionHouseholdScopeId = Schema.decodeUnknownSync(
  RecipeImportHouseholdScopeId
)(oversizedTransitionHouseholdScopeId);
const instant = "2026-08-19T12:00:00.000Z";
type DatabaseBatchStatements = Parameters<
  typeof env.MealPlannerDatabase.batch
>[0];

const tags = {
  cuisines: ["Irish"],
  dietaryFit: "household_match",
  difficulty: "easy",
  leftovers: "one_meal",
  mealTypes: ["dinner"],
  totalTimeBand: "30_to_60_minutes",
} as const;

const citation = {
  citations: [
    {
      confidence: 1,
      evidenceId: "caption:authority-fixture",
      origin: "creator_provided" as const,
    },
  ],
  origin: "creator_provided" as const,
  state: "supported" as const,
};

const unreachableHouseholdDomain = () =>
  Effect.die(new Error("The household domain must not be reached."));
const supportedString = (value: string) => ({ ...citation, value });
const supportedNumber = (value: number) => ({ ...citation, value });
const supportedList = (values: readonly string[]) => ({
  items: values.map(supportedString),
  state: "supported" as const,
});
const unresolved = (reason: string) => ({
  citations: [] as const,
  origin: "unresolved" as const,
  reason,
  state: "unresolved" as const,
});

const makeDraft = (input: {
  readonly extractionFingerprint: string;
  readonly importId: typeof ImportId.Type;
  readonly ingredientLines?: readonly string[];
  readonly name: string;
  readonly sourceUrl: string;
}) =>
  Schema.decodeUnknownSync(RecipeDraft)({
    createdAt: instant,
    evidenceFingerprint: input.extractionFingerprint.replaceAll("d", "e"),
    extraction: {
      author: supportedString("Authority Fixture Cook"),
      category: supportedString("Dinner"),
      cookTimeMinutes: supportedNumber(20),
      cost: {
        certainty: "known",
        currency: "USD",
        estimatedMicroUsd: 0,
      },
      cuisine: supportedString("Irish"),
      description: supportedString("A household-scoped authority fixture."),
      ingredientLines: supportedList(
        input.ingredientLines ?? ["1 onion", "2 tomatoes"]
      ),
      instructions: supportedList([
        "Chop the onion.",
        "Simmer for 20 minutes.",
      ]),
      name: supportedString(input.name),
      nutrition: unresolved("Nutrition was not stated."),
      prepTimeMinutes: supportedNumber(10),
      sourceUrl: supportedString(input.sourceUrl),
      supportedClaims: supportedList(["Simmer for 20 minutes."]),
      temperatureCelsius: unresolved("Temperature was not stated."),
      tools: supportedList(["Saucepan"]),
      totalTimeMinutes: supportedNumber(30),
      unresolvedFields: [
        "nutrition",
        "temperature_celsius",
        "ingredient_quantities",
        "ingredient_units",
      ],
      usage: {
        inputEvidenceItems: 1,
        inputTokens: 0,
        latencyMilliseconds: 0,
        modelCalls: 1,
        outputTokens: 0,
      },
      yield: supportedString("2 servings"),
    },
    extractionFingerprint: input.extractionFingerprint,
    extractor: {
      model: "authority-fixture-v1",
      provider: "deterministic_fake",
      version: "schema-1",
    },
    generation: Schema.decodeUnknownSync(AcquisitionGeneration)(1),
    importId: input.importId,
    lifecycle: "needs_review",
    schemaVersion: 1,
  });

const seedImport = async (input: {
  readonly current: boolean;
  readonly draftJson?: string;
  readonly extractionFingerprint: string;
  readonly householdScopeId: string;
  readonly importId: typeof ImportId.Type;
  readonly ingredientLines?: readonly string[];
  readonly lifecycle: "approved" | "needs_review";
  readonly name: string;
  readonly reviewVersion?: number;
  readonly sourceUrl: string;
}) => {
  const draft = makeDraft(input);
  const evidence = [
    {
      kind: "original_media",
      referenceId: `imports/${input.importId}/acquisition/v1/generations/1/original.mp4`,
    },
    {
      kind: "acquisition_manifest",
      referenceId: `imports/${input.importId}/acquisition/v1/generations/1/manifest.json`,
    },
    {
      kind: "speech_transcript",
      referenceId: `imports/${input.importId}/transcription/v1/generations/1/transcript.json`,
    },
  ];

  const existing = await env.MealPlannerDatabase.prepare(
    "SELECT 1 FROM recipe_imports WHERE id = ?"
  )
    .bind(input.importId)
    .first();
  if (existing === null) {
    await env.MealPlannerDatabase.prepare(
      `INSERT INTO recipe_imports (
         id, acquisition_generation, actor_id, correlation_id,
         created_at, evidence_references_json, execution_generation,
         household_scope_id, recovery_action, resolved_canonical_source_id,
         source_kind, status, status_code, submitted_source_url,
         public_source_url, public_source_kind, public_status, public_stage,
         public_stage_started_at, public_activity, updated_at
       ) VALUES (?, 1, ?, ?, ?, ?, 1, ?, NULL, ?, 'tiktok', 'transcribed',
                 NULL, ?, ?, 'video', 'processing', 'preparing_review', ?,
                 'working', ?)`
    )
      .bind(
        input.importId,
        "a".repeat(64),
        "11111111-1111-4111-8111-111111111111",
        instant,
        JSON.stringify(evidence),
        input.householdScopeId,
        input.importId,
        input.sourceUrl,
        input.sourceUrl,
        instant,
        instant
      )
      .run();
  }

  await env.MealPlannerDatabase.batch([
    env.MealPlannerDatabase.prepare(
      `INSERT INTO import_recipe_extractions (
         extraction_fingerprint, import_id, acquisition_generation,
         evidence_fingerprint, extractor_provider, extractor_model,
         extractor_version, state, draft_json, failure_code,
         input_evidence_items, input_tokens, output_tokens, model_calls,
         latency_milliseconds, estimated_cost_micro_usd, cost_currency,
         cost_certainty, is_current, created_at, updated_at, completed_at
       ) VALUES (?, ?, 1, ?, 'deterministic_fake', 'authority-fixture-v1',
                 'schema-1', 'needs_review', ?, NULL, 1, 0, 0, 1, 0, 0,
                 'USD', 'known', ?, ?, ?, ?)`
    ).bind(
      input.extractionFingerprint,
      input.importId,
      draft.evidenceFingerprint,
      input.draftJson ?? JSON.stringify(Schema.encodeSync(RecipeDraft)(draft)),
      input.current ? 1 : 0,
      instant,
      instant,
      instant
    ),
    env.MealPlannerDatabase.prepare(
      `INSERT INTO recipe_reviews (
         extraction_fingerprint, lifecycle, version, tags_json,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(
      input.extractionFingerprint,
      input.lifecycle,
      input.lifecycle === "approved" ? (input.reviewVersion ?? 1) : 0,
      input.lifecycle === "approved" ? JSON.stringify(tags) : null,
      instant,
      instant
    ),
  ]);

  if (input.lifecycle === "approved") {
    await env.MealPlannerDatabase.prepare(
      `INSERT INTO recipe_review_transitions (
         extraction_fingerprint, version, actor_id, from_lifecycle,
         to_lifecycle, reason, transitioned_at
       ) VALUES (?, ?, 'authority-fixture', 'needs_review', 'approved',
                 'Approved for household planning.', ?)`
    )
      .bind(input.extractionFingerprint, input.reviewVersion ?? 1, instant)
      .run();
  }
};

const seedApprovedCandidateCatalogue = async (
  candidateHouseholdScopeId: string,
  count: number
) => {
  await env.MealPlannerDatabase.batch([
    env.MealPlannerDatabase.prepare(
      `WITH RECURSIVE sequence(value) AS (
         SELECT 0
         UNION ALL
         SELECT value + 1 FROM sequence WHERE value + 1 < ?
       ), candidates(id) AS (
         SELECT '70000000-0000-4000-8000-' || printf('%012x', value)
         FROM sequence
       )
       INSERT INTO recipe_imports (
         id, acquisition_generation, actor_id, correlation_id,
         created_at, evidence_references_json, execution_generation,
         household_scope_id, recovery_action, resolved_canonical_source_id,
         source_kind, status, status_code, submitted_source_url,
         public_source_url, public_source_kind, public_status, public_stage,
         public_stage_started_at, public_activity, updated_at
       )
       SELECT id, 1, ?, ?, ?,
              json_array(
                json_object('kind', 'original_media', 'referenceId',
                  'imports/' || id || '/acquisition/v1/generations/1/original.mp4'),
                json_object('kind', 'acquisition_manifest', 'referenceId',
                  'imports/' || id || '/acquisition/v1/generations/1/manifest.json'),
                json_object('kind', 'speech_transcript', 'referenceId',
                  'imports/' || id || '/transcription/v1/generations/1/transcript.json')
              ),
              1, ?, NULL, id, 'tiktok', 'transcribed', NULL,
              'https://www.tiktok.com/@fixture/video/' || id,
              'https://www.tiktok.com/@fixture/video/' || id,
              'video', 'processing', 'preparing_review', ?, 'working', ?
       FROM candidates`
    ).bind(
      count,
      "a".repeat(64),
      "77777777-7777-4777-8777-777777777778",
      instant,
      candidateHouseholdScopeId,
      instant,
      instant
    ),
    env.MealPlannerDatabase.prepare(
      `INSERT INTO import_recipe_extractions (
         extraction_fingerprint, import_id, acquisition_generation,
         evidence_fingerprint, extractor_provider, extractor_model,
         extractor_version, state, draft_json, failure_code,
         input_evidence_items, input_tokens, output_tokens, model_calls,
         latency_milliseconds, estimated_cost_micro_usd, cost_currency,
         cost_certainty, is_current, created_at, updated_at, completed_at
       )
       SELECT printf('%064x', rowid + 100000), id, 1,
              printf('%064x', rowid + 200000), 'deterministic_fake',
              'catalogue-capacity-v1', 'schema-1', 'needs_review', '{}', NULL,
              1, 0, 0, 1, 0, 0, 'USD', 'known', 1, ?, ?, ?
       FROM recipe_imports
       WHERE household_scope_id = ? AND id LIKE '70000000-%'
       ORDER BY id`
    ).bind(instant, instant, instant, candidateHouseholdScopeId),
    env.MealPlannerDatabase.prepare(
      `INSERT INTO recipe_reviews (
         extraction_fingerprint, lifecycle, version, tags_json,
         created_at, updated_at
       )
       SELECT extraction_fingerprint, 'approved', 1, ?, ?, ?
       FROM import_recipe_extractions
       INNER JOIN recipe_imports
         ON recipe_imports.id = import_recipe_extractions.import_id
       WHERE recipe_imports.household_scope_id = ?
         AND recipe_imports.id LIKE '70000000-%'`
    ).bind(JSON.stringify(tags), instant, instant, candidateHouseholdScopeId),
  ]);
};

const seedOversizedApprovedCandidateId = async () => {
  const oversizedImportId = "x".repeat(70_000);
  const extractionFingerprint = "7".repeat(64);
  const sourceUrl = "https://www.tiktok.com/@fixture/video/7580000000000000001";
  const evidence = [
    {
      kind: "original_media",
      referenceId: `imports/${oversizedImportId}/acquisition/v1/generations/1/original.mp4`,
    },
    {
      kind: "acquisition_manifest",
      referenceId: `imports/${oversizedImportId}/acquisition/v1/generations/1/manifest.json`,
    },
    {
      kind: "speech_transcript",
      referenceId: `imports/${oversizedImportId}/transcription/v1/generations/1/transcript.json`,
    },
  ];
  await env.MealPlannerDatabase.prepare(
    `INSERT INTO recipe_imports (
       id, acquisition_generation, actor_id, correlation_id,
       created_at, evidence_references_json, execution_generation,
       household_scope_id, recovery_action, resolved_canonical_source_id,
       source_kind, status, status_code, submitted_source_url,
       public_source_url, public_source_kind, public_status, public_stage,
       public_stage_started_at, public_activity, updated_at
     ) VALUES (?, 1, ?, ?, ?, ?, 1, ?, NULL, ?, 'tiktok', 'transcribed',
               NULL, ?, ?, 'video', 'processing', 'preparing_review', ?,
               'working', ?)`
  )
    .bind(
      oversizedImportId,
      "a".repeat(64),
      "88888888-8888-4888-8888-888888888888",
      instant,
      JSON.stringify(evidence),
      oversizedIdentityHouseholdScopeId,
      oversizedImportId,
      sourceUrl,
      sourceUrl,
      instant,
      instant
    )
    .run();
  await env.MealPlannerDatabase.batch([
    env.MealPlannerDatabase.prepare(
      `INSERT INTO import_recipe_extractions (
         extraction_fingerprint, import_id, acquisition_generation,
         evidence_fingerprint, extractor_provider, extractor_model,
         extractor_version, state, draft_json, failure_code,
         input_evidence_items, input_tokens, output_tokens, model_calls,
         latency_milliseconds, estimated_cost_micro_usd, cost_currency,
         cost_certainty, is_current, created_at, updated_at, completed_at
       ) VALUES (?, ?, 1, ?, 'deterministic_fake', 'identity-guard-v1',
                 'schema-1', 'needs_review', '{}', NULL, 1, 0, 0, 1, 0, 0,
                 'USD', 'known', 1, ?, ?, ?)`
    ).bind(
      extractionFingerprint,
      oversizedImportId,
      "6".repeat(64),
      instant,
      instant,
      instant
    ),
    env.MealPlannerDatabase.prepare(
      `INSERT INTO recipe_reviews (
         extraction_fingerprint, lifecycle, version, tags_json,
         created_at, updated_at
       ) VALUES (?, 'approved', 1, ?, ?, ?)`
    ).bind(extractionFingerprint, JSON.stringify(tags), instant, instant),
  ]);
};

beforeAll(async () => {
  await applyD1Migrations(
    env.MealPlannerDatabase,
    workerTestMigrations(env.TEST_MIGRATIONS),
    "d1_migrations"
  );
});

describe("household meal-plan approved recipe authority", () => {
  it("returns only current approved snapshots owned by the admitted organization", async () => {
    const approvedImportId = Schema.decodeUnknownSync(ImportId)(
      "04fd071a-36dc-41b7-a8a6-a1ca4d82e801"
    );
    const pendingImportId = Schema.decodeUnknownSync(ImportId)(
      "04fd071a-36dc-41b7-a8a6-a1ca4d82e802"
    );
    const otherImportId = Schema.decodeUnknownSync(ImportId)(
      "04fd071a-36dc-41b7-a8a6-a1ca4d82e803"
    );
    const replacedImportId = Schema.decodeUnknownSync(ImportId)(
      "04fd071a-36dc-41b7-a8a6-a1ca4d82e804"
    );

    await seedImport({
      current: true,
      extractionFingerprint: `${"d".repeat(63)}1`,
      householdScopeId,
      importId: approvedImportId,
      lifecycle: "approved",
      name: "Owned Approved Stew",
      sourceUrl: "https://www.tiktok.com/@fixture/video/7520000000000000801",
    });
    await seedImport({
      current: true,
      extractionFingerprint: `${"d".repeat(63)}2`,
      householdScopeId,
      importId: pendingImportId,
      lifecycle: "needs_review",
      name: "Owned Pending Soup",
      sourceUrl: "https://www.tiktok.com/@fixture/video/7520000000000000802",
    });
    await seedImport({
      current: true,
      extractionFingerprint: `${"d".repeat(63)}3`,
      householdScopeId: otherHouseholdScopeId,
      importId: otherImportId,
      lifecycle: "approved",
      name: "Other Household Curry",
      sourceUrl: "https://www.tiktok.com/@fixture/video/7520000000000000803",
    });
    await seedImport({
      current: false,
      extractionFingerprint: `${"d".repeat(63)}4`,
      householdScopeId,
      importId: replacedImportId,
      lifecycle: "approved",
      name: "Superseded Approved Pasta",
      sourceUrl: "https://www.tiktok.com/@fixture/video/7520000000000000804",
    });
    await seedImport({
      current: true,
      extractionFingerprint: `${"d".repeat(63)}5`,
      householdScopeId,
      importId: replacedImportId,
      lifecycle: "needs_review",
      name: "Current Pending Pasta",
      sourceUrl: "https://www.tiktok.com/@fixture/video/7520000000000000804",
    });

    const catalogue = await Effect.runPromise(
      readApprovedMealPlanRecipeCandidateCatalogue(
        env.MealPlannerDatabase,
        organizationId
      )
    );
    const snapshots = await Effect.runPromise(
      hydrateApprovedMealPlanRecipeSnapshots(
        env.MealPlannerDatabase,
        organizationId,
        catalogue.pages.flat().map(({ authorityToken, importId }) => ({
          authorityToken,
          importId: Schema.decodeUnknownSync(MealPlanRecipeSnapshotId)(
            importId
          ),
        }))
      )
    );

    expect(
      snapshots.map((snapshot) =>
        Schema.encodeSync(MealPlanRecipeSnapshot)(snapshot)
      )
    ).toEqual([
      {
        approvedAt: instant,
        extractionFingerprint: `${"d".repeat(63)}1`,
        importId: approvedImportId,
        recipe: {
          ingredientLines: ["1 onion", "2 tomatoes"],
          instructions: ["Chop the onion.", "Simmer for 20 minutes."],
          name: "Owned Approved Stew",
        },
        source: {
          evidenceFingerprint: `${"e".repeat(63)}1`,
          sourceUrl:
            "https://www.tiktok.com/@fixture/video/7520000000000000801",
        },
        tags,
        version: 1,
      },
    ]);

    const otherCatalogue = await Effect.runPromise(
      readApprovedMealPlanRecipeCandidateCatalogue(
        env.MealPlannerDatabase,
        otherOrganizationId
      )
    );
    const otherSnapshots = await Effect.runPromise(
      hydrateApprovedMealPlanRecipeSnapshots(
        env.MealPlannerDatabase,
        otherOrganizationId,
        otherCatalogue.pages.flat().map(({ authorityToken, importId }) => ({
          authorityToken,
          importId: Schema.decodeUnknownSync(MealPlanRecipeSnapshotId)(
            importId
          ),
        }))
      )
    );
    expect(
      otherSnapshots.map((snapshot) =>
        Schema.encodeSync(MealPlanRecipeSnapshot)(snapshot)
      )
    ).toEqual([
      expect.objectContaining({
        importId: otherImportId,
        recipe: expect.objectContaining({ name: "Other Household Curry" }),
      }),
    ]);
  });

  it("snapshots every current approved candidate without duplicates or count truncation", async () => {
    const approvedImportIds = Array.from({ length: 300 }, (_, index) =>
      Schema.decodeUnknownSync(ImportId)(
        `10000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`
      )
    );
    await Promise.all(
      approvedImportIds.map((importId, index) =>
        seedImport({
          current: true,
          extractionFingerprint: index.toString(16).padStart(64, "0"),
          householdScopeId: admittedHouseholdScopeId,
          importId,
          lifecycle: "approved",
          name: `Bounded Approved Recipe ${index}`,
          sourceUrl: `https://www.tiktok.com/@fixture/video/7520000000000001${index.toString().padStart(3, "0")}`,
        })
      )
    );

    const discoveredCatalogue = await Effect.runPromise(
      readCurrentApprovedRecipeCandidateCatalogue(
        env.MealPlannerDatabase,
        admittedHouseholdScopeId
      )
    );
    const discoveredImportIds = discoveredCatalogue.pages
      .flat()
      .map(({ importId }) => importId);

    expect(ApprovedRecipeCandidatePageSize).toBe(256);
    expect(discoveredCatalogue.pages).toHaveLength(2);
    expect(new Set(discoveredImportIds).size).toBe(discoveredImportIds.length);
    expect(
      approvedImportIds.every((importId) =>
        discoveredImportIds.includes(importId)
      )
    ).toBe(true);

    const olderApprovedImportId = Schema.decodeUnknownSync(
      MealPlanRecipeSnapshotId
    )(approvedImportIds.at(-1));

    const explicitlyRequested = await Effect.runPromise(
      findApprovedMealPlanRecipeSnapshot(
        env.MealPlannerDatabase,
        organizationId,
        olderApprovedImportId
      )
    );
    expect(Option.getOrUndefined(explicitlyRequested)).toMatchObject({
      importId: olderApprovedImportId,
      recipe: { name: "Bounded Approved Recipe 299" },
    });

    const crossHousehold = await Effect.runPromise(
      findApprovedMealPlanRecipeSnapshot(
        env.MealPlannerDatabase,
        otherOrganizationId,
        olderApprovedImportId
      )
    );
    expect(Option.isNone(crossHousehold)).toBe(true);

    const pendingImportId = Schema.decodeUnknownSync(ImportId)(
      "20000000-0000-4000-8000-000000000001"
    );
    await seedImport({
      current: true,
      extractionFingerprint: `${"a".repeat(63)}1`,
      householdScopeId,
      importId: pendingImportId,
      lifecycle: "needs_review",
      name: "Current Pending Explicit Recipe",
      sourceUrl: "https://www.tiktok.com/@fixture/video/7520000000000002001",
    });
    const pending = await Effect.runPromise(
      findApprovedMealPlanRecipeSnapshot(
        env.MealPlannerDatabase,
        organizationId,
        Schema.decodeUnknownSync(MealPlanRecipeSnapshotId)(pendingImportId)
      )
    );
    expect(Option.isNone(pending)).toBe(true);

    const supersededImportId = Schema.decodeUnknownSync(ImportId)(
      "20000000-0000-4000-8000-000000000002"
    );
    await seedImport({
      current: false,
      extractionFingerprint: `${"a".repeat(63)}2`,
      householdScopeId,
      importId: supersededImportId,
      lifecycle: "approved",
      name: "Superseded Approved Explicit Recipe",
      sourceUrl: "https://www.tiktok.com/@fixture/video/7520000000000002002",
    });
    await seedImport({
      current: true,
      extractionFingerprint: `${"a".repeat(63)}3`,
      householdScopeId,
      importId: supersededImportId,
      lifecycle: "needs_review",
      name: "Current Pending Explicit Recipe",
      sourceUrl: "https://www.tiktok.com/@fixture/video/7520000000000002002",
    });
    const superseded = await Effect.runPromise(
      findApprovedMealPlanRecipeSnapshot(
        env.MealPlannerDatabase,
        organizationId,
        Schema.decodeUnknownSync(MealPlanRecipeSnapshotId)(supersededImportId)
      )
    );
    expect(Option.isNone(superseded)).toBe(true);
  }, 30_000);

  it("reads 2,048 candidates through one eight-statement native batch and rejects candidate 2,049", async () => {
    await seedApprovedCandidateCatalogue(
      catalogueCapacityHouseholdScopeId,
      2048
    );
    let nativeBatchCalls = 0;
    let statementCount = 0;
    const observedDatabase = {
      batch<T = unknown>(statements: DatabaseBatchStatements) {
        nativeBatchCalls += 1;
        statementCount = statements.length;
        return env.MealPlannerDatabase.batch<T>(statements);
      },
      dump: env.MealPlannerDatabase.dump.bind(env.MealPlannerDatabase),
      exec: env.MealPlannerDatabase.exec.bind(env.MealPlannerDatabase),
      prepare: env.MealPlannerDatabase.prepare.bind(env.MealPlannerDatabase),
      withSession: env.MealPlannerDatabase.withSession.bind(
        env.MealPlannerDatabase
      ),
    } satisfies typeof env.MealPlannerDatabase;

    const catalogue = await Effect.runPromise(
      readCurrentApprovedRecipeCandidateCatalogue(
        observedDatabase,
        admittedCatalogueCapacityHouseholdScopeId
      )
    );
    expect(nativeBatchCalls).toBe(1);
    expect(statementCount).toBe(8);
    expect(catalogue.pages).toHaveLength(8);
    expect(catalogue.pages.every((page) => page.length === 256)).toBe(true);
    expect(catalogue.pages.flat()).toHaveLength(2048);

    await seedImport({
      current: true,
      extractionFingerprint:
        "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      householdScopeId: catalogueCapacityHouseholdScopeId,
      importId: Schema.decodeUnknownSync(ImportId)(
        "70000000-0000-4000-8000-000000000800"
      ),
      lifecycle: "approved",
      name: "Candidate Beyond Supported Catalogue",
      sourceUrl: "https://www.tiktok.com/@fixture/video/7570000000000002049",
    });
    const failure = await Effect.runPromise(
      readCurrentApprovedRecipeCandidateCatalogue(
        env.MealPlannerDatabase,
        admittedCatalogueCapacityHouseholdScopeId
      ).pipe(Effect.flip)
    );
    expect(failure).toBeInstanceOf(
      ApprovedRecipeCandidateQueryCapacityExceeded
    );
  }, 30_000);

  it("returns one coherent catalogue snapshot when authority changes after the native batch", async () => {
    const firstImportId = Schema.decodeUnknownSync(ImportId)(
      "65000000-0000-4000-8000-000000000001"
    );
    const secondImportId = Schema.decodeUnknownSync(ImportId)(
      "65000000-0000-4000-8000-000000000002"
    );
    const secondFingerprint =
      "234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1";
    await seedImport({
      current: true,
      extractionFingerprint:
        "134567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1",
      householdScopeId: catalogueSnapshotHouseholdScopeId,
      importId: firstImportId,
      lifecycle: "approved",
      name: "Snapshot Candidate One",
      sourceUrl: "https://www.tiktok.com/@fixture/video/7570000000000003001",
    });
    await seedImport({
      current: true,
      extractionFingerprint: secondFingerprint,
      householdScopeId: catalogueSnapshotHouseholdScopeId,
      importId: secondImportId,
      lifecycle: "approved",
      name: "Snapshot Candidate Two",
      sourceUrl: "https://www.tiktok.com/@fixture/video/7570000000000003002",
    });

    let nativeBatchCalls = 0;
    const mutateAfterSnapshotDatabase = {
      async batch<T = unknown>(statements: DatabaseBatchStatements) {
        nativeBatchCalls += 1;
        const snapshot = await env.MealPlannerDatabase.batch<T>(statements);
        await env.MealPlannerDatabase.prepare(
          "UPDATE recipe_reviews SET lifecycle = 'needs_review' WHERE extraction_fingerprint = ?"
        )
          .bind(secondFingerprint)
          .run();
        return snapshot;
      },
      dump: env.MealPlannerDatabase.dump.bind(env.MealPlannerDatabase),
      exec: env.MealPlannerDatabase.exec.bind(env.MealPlannerDatabase),
      prepare: env.MealPlannerDatabase.prepare.bind(env.MealPlannerDatabase),
      withSession: env.MealPlannerDatabase.withSession.bind(
        env.MealPlannerDatabase
      ),
    } satisfies typeof env.MealPlannerDatabase;
    const oldSnapshot = await Effect.runPromise(
      readCurrentApprovedRecipeCandidateCatalogue(
        mutateAfterSnapshotDatabase,
        admittedCatalogueSnapshotHouseholdScopeId
      )
    );
    expect(nativeBatchCalls).toBe(1);
    expect(oldSnapshot.pages.flat().map(({ importId }) => importId)).toEqual([
      firstImportId,
      secondImportId,
    ]);

    const newSnapshot = await Effect.runPromise(
      readCurrentApprovedRecipeCandidateCatalogue(
        env.MealPlannerDatabase,
        admittedCatalogueSnapshotHouseholdScopeId
      )
    );
    expect(newSnapshot.pages.flat().map(({ importId }) => importId)).toEqual([
      firstImportId,
    ]);
  });

  it("projects only the latest planning fields without hydrating unbounded review history", async () => {
    const importId = Schema.decodeUnknownSync(ImportId)(
      "40000000-0000-4000-8000-000000000001"
    );
    const extractionFingerprint = "b".repeat(64);
    await seedImport({
      current: true,
      extractionFingerprint,
      householdScopeId: boundedHistoryHouseholdScopeId,
      importId,
      lifecycle: "approved",
      name: "Original Historical Recipe",
      reviewVersion: 130,
      sourceUrl: "https://www.tiktok.com/@fixture/video/7540000000000000001",
    });

    const historicalCorrections = Array.from({ length: 120 }, (_, index) =>
      env.MealPlannerDatabase.prepare(
        `INSERT INTO recipe_review_corrections (
           extraction_fingerprint, version, ordinal, actor_id, field,
           before_json, after_json, tags_before_json, tags_after_json,
           reason, corrected_at
         ) VALUES (?, ?, 0, 'authority-fixture', 'description',
                   ?, ?, ?, ?, 'Historical description correction.', ?)`
      ).bind(
        extractionFingerprint,
        index + 1,
        index === 0 ? "null" : JSON.stringify("x".repeat(4096)),
        index === 17 ? "0" : JSON.stringify("x".repeat(4096)),
        JSON.stringify(tags),
        JSON.stringify(tags),
        instant
      )
    );
    await Promise.all(
      historicalCorrections.map((correction) => correction.run())
    );

    await env.MealPlannerDatabase.batch([
      env.MealPlannerDatabase.prepare(
        `INSERT INTO recipe_review_corrections (
           extraction_fingerprint, version, ordinal, actor_id, field,
           before_json, after_json, tags_before_json, tags_after_json,
           reason, corrected_at
         ) VALUES (?, 121, 0, 'authority-fixture', 'name', ?, ?, ?, ?,
                   'Correct the planning name.', ?)`
      ).bind(
        extractionFingerprint,
        JSON.stringify("Original Historical Recipe"),
        JSON.stringify("Current Planning Recipe"),
        JSON.stringify(tags),
        JSON.stringify(tags),
        instant
      ),
      env.MealPlannerDatabase.prepare(
        `INSERT INTO recipe_review_corrections (
           extraction_fingerprint, version, ordinal, actor_id, field,
           before_json, after_json, tags_before_json, tags_after_json,
           reason, corrected_at
         ) VALUES (?, 122, 0, 'authority-fixture', 'ingredient_lines', ?, ?, ?, ?,
                   'Correct the planning ingredients.', ?)`
      ).bind(
        extractionFingerprint,
        JSON.stringify(["1 onion", "2 tomatoes"]),
        JSON.stringify(["1 leek", "2 potatoes"]),
        JSON.stringify(tags),
        JSON.stringify(tags),
        instant
      ),
      env.MealPlannerDatabase.prepare(
        `INSERT INTO recipe_review_corrections (
           extraction_fingerprint, version, ordinal, actor_id, field,
           before_json, after_json, tags_before_json, tags_after_json,
           reason, corrected_at
         ) VALUES (?, 123, 0, 'authority-fixture', 'instructions', ?, ?, ?, ?,
                   'Correct the planning instructions.', ?)`
      ).bind(
        extractionFingerprint,
        JSON.stringify(["Chop the onion.", "Simmer for 20 minutes."]),
        JSON.stringify(["Slice the leek.", "Simmer for 25 minutes."]),
        JSON.stringify(tags),
        JSON.stringify(tags),
        instant
      ),
    ]);

    const candidateCatalogue = await Effect.runPromise(
      readCurrentApprovedRecipeCandidateCatalogue(
        env.MealPlannerDatabase,
        admittedBoundedHistoryHouseholdScopeId
      )
    );
    expect(candidateCatalogue.pages.flat()).toEqual([
      expect.objectContaining({
        importId,
        tags,
      }),
    ]);

    const exact = await Effect.runPromise(
      findApprovedMealPlanRecipeSnapshot(
        env.MealPlannerDatabase,
        boundedHistoryOrganizationId,
        Schema.decodeUnknownSync(MealPlanRecipeSnapshotId)(importId)
      )
    );
    expect(Option.getOrUndefined(exact)).toMatchObject({
      recipe: {
        ingredientLines: ["1 leek", "2 potatoes"],
        instructions: ["Slice the leek.", "Simmer for 25 minutes."],
        name: "Current Planning Recipe",
      },
      version: 130,
    });
  }, 30_000);

  it("fails an explicit swap when approval changes between authority discovery and hydration", async () => {
    const importId = Schema.decodeUnknownSync(ImportId)(
      "41000000-0000-4000-8000-000000000001"
    );
    const extractionFingerprint = `${"b".repeat(63)}3`;
    await seedImport({
      current: true,
      extractionFingerprint,
      householdScopeId: exactSwapRaceHouseholdScopeId,
      importId,
      lifecycle: "approved",
      name: "Concurrent Explicit Swap",
      sourceUrl: "https://www.tiktok.com/@fixture/video/7540000000000000003",
    });

    let authorityReadIntercepted = false;
    let authorityMutationCompleted = false;
    const observedDatabase = {
      batch: env.MealPlannerDatabase.batch.bind(env.MealPlannerDatabase),
      dump: env.MealPlannerDatabase.dump.bind(env.MealPlannerDatabase),
      exec: env.MealPlannerDatabase.exec.bind(env.MealPlannerDatabase),
      prepare(query: string) {
        const statement = env.MealPlannerDatabase.prepare(query);
        if (
          authorityReadIntercepted ||
          !query.includes('length(cast("recipe_reviews"."tags_json" as blob))')
        ) {
          return statement;
        }
        authorityReadIntercepted = true;
        const intercept = (prepared: typeof statement): typeof statement =>
          new Proxy(prepared, {
            get(target, property) {
              if (property === "bind") {
                return (...values: Parameters<typeof target.bind>) =>
                  intercept(target.bind(...values));
              }
              if (property === "all" || property === "raw") {
                return async () => {
                  const rows =
                    property === "all"
                      ? await target.all()
                      : await target.raw();
                  await env.MealPlannerDatabase.prepare(
                    "UPDATE recipe_reviews SET lifecycle = 'needs_review' WHERE extraction_fingerprint = ?"
                  )
                    .bind(extractionFingerprint)
                    .run();
                  authorityMutationCompleted = true;
                  return rows;
                };
              }
              return Reflect.get(target, property, target);
            },
          });
        return intercept(statement);
      },
      withSession: env.MealPlannerDatabase.withSession.bind(
        env.MealPlannerDatabase
      ),
    } satisfies typeof env.MealPlannerDatabase;

    const outcome = await Effect.runPromise(
      findApprovedMealPlanRecipeSnapshot(
        observedDatabase,
        exactSwapRaceOrganizationId,
        Schema.decodeUnknownSync(MealPlanRecipeSnapshotId)(importId)
      ).pipe(
        Effect.match({
          onFailure: (error) => ({ error, outcome: "failure" as const }),
          onSuccess: (value) => ({ outcome: "success" as const, value }),
        })
      )
    );
    expect(authorityReadIntercepted).toBe(true);
    expect(authorityMutationCompleted).toBe(true);
    expect(outcome.outcome).toBe("failure");
    if (outcome.outcome === "success") {
      throw new Error("Expected concurrent approval drift to fail safely.");
    }
    expect(outcome.error).toBeInstanceOf(ApprovedRecipeAuthorityMismatch);
  });

  it("guards every persisted text field before an explicit swap projection", async () => {
    const draftImportId = Schema.decodeUnknownSync(ImportId)(
      "42000000-0000-4000-8000-000000000001"
    );
    const tagsImportId = Schema.decodeUnknownSync(ImportId)(
      "42000000-0000-4000-8000-000000000002"
    );
    const correctionImportId = Schema.decodeUnknownSync(ImportId)(
      "42000000-0000-4000-8000-000000000003"
    );
    const transitionImportId = Schema.decodeUnknownSync(ImportId)(
      "42000000-0000-4000-8000-000000000004"
    );
    const draftFingerprint = `${"c".repeat(63)}1`;
    const tagsFingerprint = `${"c".repeat(63)}2`;
    const correctionFingerprint = `${"c".repeat(63)}3`;
    const transitionFingerprint = `${"c".repeat(63)}4`;
    await Promise.all([
      seedImport({
        current: true,
        draftJson: JSON.stringify("x".repeat(70_000)),
        extractionFingerprint: draftFingerprint,
        householdScopeId: exactSwapGuardHouseholdScopeId,
        importId: draftImportId,
        lifecycle: "approved",
        name: "Oversized Exact Draft",
        sourceUrl: "https://www.tiktok.com/@fixture/video/7540000000000000004",
      }),
      seedImport({
        current: true,
        extractionFingerprint: tagsFingerprint,
        householdScopeId: exactSwapGuardHouseholdScopeId,
        importId: tagsImportId,
        lifecycle: "approved",
        name: "Oversized Exact Tags",
        sourceUrl: "https://www.tiktok.com/@fixture/video/7540000000000000005",
      }),
      seedImport({
        current: true,
        extractionFingerprint: correctionFingerprint,
        householdScopeId: exactSwapGuardHouseholdScopeId,
        importId: correctionImportId,
        lifecycle: "approved",
        name: "Oversized Exact Correction",
        sourceUrl: "https://www.tiktok.com/@fixture/video/7540000000000000006",
      }),
      seedImport({
        current: true,
        extractionFingerprint: transitionFingerprint,
        householdScopeId: exactSwapGuardHouseholdScopeId,
        importId: transitionImportId,
        lifecycle: "approved",
        name: "Oversized Exact Timestamp",
        sourceUrl: "https://www.tiktok.com/@fixture/video/7540000000000000007",
      }),
    ]);
    await env.MealPlannerDatabase.batch([
      env.MealPlannerDatabase.prepare(
        "UPDATE recipe_reviews SET tags_json = ? WHERE extraction_fingerprint = ?"
      ).bind(
        JSON.stringify({ ...tags, cuisines: ["x".repeat(70_000)] }),
        tagsFingerprint
      ),
      env.MealPlannerDatabase.prepare(
        `INSERT INTO recipe_review_corrections (
           extraction_fingerprint, version, ordinal, actor_id, field,
           before_json, after_json, tags_before_json, tags_after_json,
           reason, corrected_at
         ) VALUES (?, 2, 0, 'authority-fixture', 'name', ?, ?, ?, ?,
                   'Oversized exact correction.', ?)`
      ).bind(
        correctionFingerprint,
        JSON.stringify("Oversized Exact Correction"),
        JSON.stringify("x".repeat(70_000)),
        JSON.stringify(tags),
        JSON.stringify(tags),
        instant
      ),
      env.MealPlannerDatabase.prepare(
        `INSERT INTO recipe_review_transitions (
           extraction_fingerprint, version, actor_id, from_lifecycle,
           to_lifecycle, reason, transitioned_at
         ) VALUES (?, 2, 'authority-fixture', 'approved', 'needs_review',
                   'Oversized exact transition timestamp.', ?)`
      ).bind(transitionFingerprint, "2".repeat(70_000)),
    ]);

    const preparedQueries: string[] = [];
    const observedDatabase = {
      batch: env.MealPlannerDatabase.batch.bind(env.MealPlannerDatabase),
      dump: env.MealPlannerDatabase.dump.bind(env.MealPlannerDatabase),
      exec: env.MealPlannerDatabase.exec.bind(env.MealPlannerDatabase),
      prepare(query: string) {
        preparedQueries.push(query);
        return env.MealPlannerDatabase.prepare(query);
      },
      withSession: env.MealPlannerDatabase.withSession.bind(
        env.MealPlannerDatabase
      ),
    } satisfies typeof env.MealPlannerDatabase;
    const findExactFailure = (importId: typeof ImportId.Type) =>
      Effect.runPromise(
        findApprovedMealPlanRecipeSnapshot(
          observedDatabase,
          exactSwapGuardOrganizationId,
          Schema.decodeUnknownSync(MealPlanRecipeSnapshotId)(importId)
        ).pipe(Effect.flip)
      );

    await expect(findExactFailure(draftImportId)).resolves.toBeInstanceOf(
      ApprovedRecipeProjectionTooLarge
    );
    await expect(findExactFailure(tagsImportId)).resolves.toBeInstanceOf(
      ApprovedRecipeProjectionTooLarge
    );
    await expect(findExactFailure(correctionImportId)).resolves.toBeInstanceOf(
      ApprovedRecipeProjectionTooLarge
    );
    await expect(findExactFailure(transitionImportId)).resolves.toMatchObject({
      _tag: "ImportPersistenceCorrupt",
    });
    const normalizedQueries = preparedQueries.map((query) =>
      query.replaceAll(/\s+/gu, " ")
    );

    expect(
      normalizedQueries.some(
        (query) =>
          query.includes(
            'length(cast("recipe_reviews"."tags_json" as blob))'
          ) && query.includes('then "recipe_reviews"."tags_json" else null end')
      )
    ).toBe(true);
    expect(
      normalizedQueries.some(
        (query) =>
          query.includes(
            'length(cast("import_recipe_extractions"."draft_json" as blob))'
          ) && !query.includes('then "import_recipe_extractions"."draft_json"')
      )
    ).toBe(true);
    expect(
      normalizedQueries.some(
        (query) =>
          query.includes(
            'length(cast("recipe_review_corrections"."after_json" as blob))'
          ) && !query.includes('then "recipe_review_corrections"."after_json"')
      )
    ).toBe(true);
    expect(
      normalizedQueries.some(
        (query) =>
          query.includes(
            'length(cast("recipe_review_transitions"."transitioned_at" as blob))'
          ) &&
          query.includes(
            'then "recipe_review_transitions"."transitioned_at" else null end'
          )
      )
    ).toBe(true);
  });

  it("rejects a pathological candidate tag row before JSON decoding", async () => {
    const importId = Schema.decodeUnknownSync(ImportId)(
      "40000000-0000-4000-8000-000000000002"
    );
    const extractionFingerprint = `${"b".repeat(63)}2`;
    await seedImport({
      current: true,
      extractionFingerprint,
      householdScopeId: boundedHistoryHouseholdScopeId,
      importId,
      lifecycle: "approved",
      name: "Pathological Tags Recipe",
      sourceUrl: "https://www.tiktok.com/@fixture/video/7540000000000000002",
    });
    await env.MealPlannerDatabase.prepare(
      "UPDATE recipe_reviews SET tags_json = ? WHERE extraction_fingerprint = ?"
    )
      .bind(
        JSON.stringify({ ...tags, cuisines: ["x".repeat(70_000)] }),
        extractionFingerprint
      )
      .run();

    const failure = await Effect.runPromise(
      readCurrentApprovedRecipeCandidateCatalogue(
        env.MealPlannerDatabase,
        admittedBoundedHistoryHouseholdScopeId
      ).pipe(Effect.flip)
    );
    expect(failure).toBeInstanceOf(ApprovedRecipeCandidatePageTooLarge);
  });

  it("rejects an oversized persisted import id before it crosses the catalogue seam", async () => {
    await seedOversizedApprovedCandidateId();
    const preparedQueries: string[] = [];
    const observedDatabase = {
      batch: env.MealPlannerDatabase.batch.bind(env.MealPlannerDatabase),
      dump: env.MealPlannerDatabase.dump.bind(env.MealPlannerDatabase),
      exec: env.MealPlannerDatabase.exec.bind(env.MealPlannerDatabase),
      prepare(query: string) {
        preparedQueries.push(query);
        return env.MealPlannerDatabase.prepare(query);
      },
      withSession: env.MealPlannerDatabase.withSession.bind(
        env.MealPlannerDatabase
      ),
    } satisfies typeof env.MealPlannerDatabase;

    await expect(
      Effect.runPromise(
        readCurrentApprovedRecipeCandidateCatalogue(
          observedDatabase,
          admittedOversizedIdentityHouseholdScopeId
        )
      )
    ).rejects.toMatchObject({ _tag: "ImportPersistenceCorrupt" });

    const catalogueQuery = preparedQueries.find((query) =>
      query.includes('from "recipe_imports"')
    );
    expect(catalogueQuery).toContain(
      'length(cast("recipe_imports"."id" as blob))'
    );
    expect(catalogueQuery).toContain(
      'then "recipe_imports"."id" else null end'
    );
  });

  it("rejects a changed authority token before stale selected payload decoding", async () => {
    const importId = Schema.decodeUnknownSync(ImportId)(
      "50000000-0000-4000-8000-000000000001"
    );
    const extractionFingerprint = `${"e".repeat(63)}7`;
    await seedImport({
      current: true,
      extractionFingerprint,
      householdScopeId: changedAuthorityHouseholdScopeId,
      importId,
      lifecycle: "approved",
      name: "Authority Changes After Selection",
      sourceUrl: "https://www.tiktok.com/@fixture/video/7550000000000000001",
    });
    const catalogue = await Effect.runPromise(
      readCurrentApprovedRecipeCandidateCatalogue(
        env.MealPlannerDatabase,
        admittedChangedAuthorityHouseholdScopeId
      )
    );
    const selected = catalogue.pages.flat().at(0);
    expect(selected).toBeDefined();
    if (selected === undefined) {
      throw new Error("Expected one approved authority fixture.");
    }
    await env.MealPlannerDatabase.prepare(
      "UPDATE recipe_reviews SET tags_json = ? WHERE extraction_fingerprint = ?"
    )
      .bind(
        JSON.stringify({ ...tags, cuisines: ["French"] }),
        extractionFingerprint
      )
      .run();
    const failure = await Effect.runPromise(
      hydrateApprovedMealPlanRecipeSnapshots(
        env.MealPlannerDatabase,
        changedAuthorityOrganizationId,
        [
          {
            authorityToken: selected.authorityToken,
            importId: Schema.decodeUnknownSync(MealPlanRecipeSnapshotId)(
              selected.importId
            ),
          },
        ]
      ).pipe(Effect.flip)
    );
    expect(failure).toBeInstanceOf(ApprovedRecipeAuthorityMismatch);
  });

  it("rejects an oversized persisted approval timestamp before it crosses the selected seam", async () => {
    const importId = Schema.decodeUnknownSync(ImportId)(
      "58000000-0000-4000-8000-000000000001"
    );
    const extractionFingerprint = `${"8".repeat(63)}1`;
    await seedImport({
      current: true,
      extractionFingerprint,
      householdScopeId: oversizedTransitionHouseholdScopeId,
      importId,
      lifecycle: "approved",
      name: "Oversized Approval Timestamp",
      sourceUrl: "https://www.tiktok.com/@fixture/video/7580000000000000002",
    });
    const catalogue = await Effect.runPromise(
      readCurrentApprovedRecipeCandidateCatalogue(
        env.MealPlannerDatabase,
        admittedOversizedTransitionHouseholdScopeId
      )
    );
    const selected = catalogue.pages.flat().at(0);
    expect(selected).toBeDefined();
    if (selected === undefined) {
      throw new Error("Expected one approved timestamp fixture.");
    }
    await env.MealPlannerDatabase.prepare(
      `INSERT INTO recipe_review_transitions (
         extraction_fingerprint, version, actor_id, from_lifecycle,
         to_lifecycle, reason, transitioned_at
       ) VALUES (?, 2, 'authority-fixture', 'approved', 'needs_review',
                 'Corrupt oversized persisted timestamp fixture.', ?)`
    )
      .bind(extractionFingerprint, "2".repeat(70_000))
      .run();

    const preparedQueries: string[] = [];
    const observedDatabase = {
      batch: env.MealPlannerDatabase.batch.bind(env.MealPlannerDatabase),
      dump: env.MealPlannerDatabase.dump.bind(env.MealPlannerDatabase),
      exec: env.MealPlannerDatabase.exec.bind(env.MealPlannerDatabase),
      prepare(query: string) {
        preparedQueries.push(query);
        return env.MealPlannerDatabase.prepare(query);
      },
      withSession: env.MealPlannerDatabase.withSession.bind(
        env.MealPlannerDatabase
      ),
    } satisfies typeof env.MealPlannerDatabase;
    await expect(
      Effect.runPromise(
        findCurrentApprovedRecipeProjections(observedDatabase, {
          householdScopeId: admittedOversizedTransitionHouseholdScopeId,
          selections: [
            {
              authorityToken: selected.authorityToken,
              importId: selected.importId,
            },
          ],
        })
      )
    ).rejects.toMatchObject({ _tag: "ImportPersistenceCorrupt" });

    const transitionQuery = preparedQueries.find((query) =>
      query.includes('from "recipe_review_transitions"')
    );
    expect(transitionQuery).toContain(
      'length(cast("recipe_review_transitions"."transitioned_at" as blob))'
    );
    expect(transitionQuery).toContain(
      'then "recipe_review_transitions"."transitioned_at" else null end'
    );
  });

  it("rejects a heavy selected draft during lightweight preflight", async () => {
    const importId = Schema.decodeUnknownSync(ImportId)(
      "50000000-0000-4000-8000-000000000002"
    );
    const extractionFingerprint = `${"e".repeat(63)}8`;
    await seedImport({
      current: true,
      draftJson: JSON.stringify("x".repeat(70_000)),
      extractionFingerprint,
      householdScopeId: heavyProjectionHouseholdScopeId,
      importId,
      lifecycle: "approved",
      name: "Heavy Selected Projection",
      sourceUrl: "https://www.tiktok.com/@fixture/video/7550000000000000002",
    });
    const catalogue = await Effect.runPromise(
      readCurrentApprovedRecipeCandidateCatalogue(
        env.MealPlannerDatabase,
        admittedHeavyProjectionHouseholdScopeId
      )
    );
    const selected = catalogue.pages.flat().at(0);
    expect(selected).toBeDefined();
    if (selected === undefined) {
      throw new Error("Expected one heavy projection fixture.");
    }
    const failure = await Effect.runPromise(
      hydrateApprovedMealPlanRecipeSnapshots(
        env.MealPlannerDatabase,
        heavyProjectionOrganizationId,
        [
          {
            authorityToken: selected.authorityToken,
            importId: Schema.decodeUnknownSync(MealPlanRecipeSnapshotId)(
              selected.importId
            ),
          },
        ]
      ).pipe(Effect.flip)
    );
    expect(failure).toBeInstanceOf(ApprovedRecipeProjectionTooLarge);
  });

  it("preflights 31 oversized selected tag rows without materializing their JSON", async () => {
    const selectedImportIds = Array.from({ length: 31 }, (_, index) =>
      Schema.decodeUnknownSync(ImportId)(
        `60000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`
      )
    );
    await Promise.all(
      selectedImportIds.map((importId, index) =>
        seedImport({
          current: true,
          extractionFingerprint: `9${index.toString(16).padStart(63, "0")}`,
          householdScopeId: oversizedTagsHouseholdScopeId,
          importId,
          lifecycle: "approved",
          name: `Oversized Tags Recipe ${index}`,
          sourceUrl: `https://www.tiktok.com/@fixture/video/7560000000000000${index.toString().padStart(3, "0")}`,
        })
      )
    );
    const catalogue = await Effect.runPromise(
      readCurrentApprovedRecipeCandidateCatalogue(
        env.MealPlannerDatabase,
        admittedOversizedTagsHouseholdScopeId
      )
    );
    const selectedFacts = catalogue.pages.flat();
    const oversizedTagsJson = JSON.stringify({
      ...tags,
      cuisines: ["x".repeat(5000)],
    });
    await env.MealPlannerDatabase.batch(
      selectedFacts.map(({ authorityToken }) =>
        env.MealPlannerDatabase.prepare(
          "UPDATE recipe_reviews SET tags_json = ? WHERE extraction_fingerprint = ?"
        ).bind(oversizedTagsJson, authorityToken.extractionFingerprint)
      )
    );

    const preparedQueries: string[] = [];
    const observedDatabase = {
      batch: env.MealPlannerDatabase.batch.bind(env.MealPlannerDatabase),
      dump: env.MealPlannerDatabase.dump.bind(env.MealPlannerDatabase),
      exec: env.MealPlannerDatabase.exec.bind(env.MealPlannerDatabase),
      prepare(query: string) {
        preparedQueries.push(query);
        return env.MealPlannerDatabase.prepare(query);
      },
      withSession: env.MealPlannerDatabase.withSession.bind(
        env.MealPlannerDatabase
      ),
    } satisfies typeof env.MealPlannerDatabase;
    const failure = await Effect.runPromise(
      hydrateApprovedMealPlanRecipeSnapshots(
        observedDatabase,
        oversizedTagsOrganizationId,
        selectedFacts.map(({ authorityToken, importId }) => ({
          authorityToken,
          importId: Schema.decodeUnknownSync(MealPlanRecipeSnapshotId)(
            importId
          ),
        }))
      ).pipe(Effect.flip)
    );
    expect(failure).toBeInstanceOf(ApprovedRecipeProjectionTooLarge);

    const sourcePreflightQuery = preparedQueries.find((query) =>
      query.includes("draft_json")
    );
    expect(sourcePreflightQuery).toBeDefined();
    expect(sourcePreflightQuery).not.toContain(
      'as blob)), "recipe_reviews"."tags_json"'
    );
  });

  it("rejects an oversized selected-recipe transfer before any household RPC", async () => {
    const largeIngredientLines = Array.from({ length: 14 }, () =>
      "x".repeat(4096)
    );
    const oversizedImportIds = Array.from({ length: 20 }, (_, index) =>
      Schema.decodeUnknownSync(ImportId)(
        `30000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`
      )
    );
    await Promise.all(
      oversizedImportIds.map((importId, index) =>
        seedImport({
          current: true,
          extractionFingerprint: `c${index.toString(16).padStart(63, "0")}`,
          householdScopeId: oversizedHouseholdScopeId,
          importId,
          ingredientLines: largeIngredientLines,
          lifecycle: "approved",
          name: `Oversized Approved Recipe ${index}`,
          sourceUrl: `https://www.tiktok.com/@fixture/video/7530000000000000${index.toString().padStart(3, "0")}`,
        })
      )
    );
    const hydrationTripwireImportId = Schema.decodeUnknownSync(ImportId)(
      "30000000-0000-4000-8000-ffffffffffff"
    );
    const hydrationTripwireFingerprint = "f".repeat(64);
    await seedImport({
      current: true,
      draftJson: "{}",
      extractionFingerprint: hydrationTripwireFingerprint,
      householdScopeId: oversizedHouseholdScopeId,
      importId: hydrationTripwireImportId,
      lifecycle: "approved",
      name: "Hydration Tripwire",
      sourceUrl: "https://www.tiktok.com/@fixture/video/7530000000000000999",
    });
    const oversizedCatalogue = await Effect.runPromise(
      readApprovedMealPlanRecipeCandidateCatalogue(
        env.MealPlannerDatabase,
        oversizedOrganizationId
      )
    );
    const selectedLargeRecipes = oversizedCatalogue.pages
      .flat()
      .filter(({ importId }) => oversizedImportIds.includes(importId))
      .map(({ authorityToken, importId }) => ({
        authorityToken,
        importId: Schema.decodeUnknownSync(MealPlanRecipeSnapshotId)(importId),
      }));
    const sourceFailure = await Effect.runPromise(
      hydrateApprovedMealPlanRecipeSnapshots(
        env.MealPlannerDatabase,
        oversizedOrganizationId,
        selectedLargeRecipes
      ).pipe(Effect.flip)
    );
    expect(sourceFailure).toBeInstanceOf(ApprovedMealPlanRecipePayloadTooLarge);

    let createCalls = 0;
    const gateway = makeHouseholdMealPlanGateway({
      database: env.MealPlannerDatabase,
      domain: {
        approveMealPlan: unreachableHouseholdDomain,
        createMealPlan: () => {
          createCalls += 1;
          return Effect.fail(
            MealPlanPersistenceFailure.make({ operation: "create" })
          );
        },
        readMealPlan: unreachableHouseholdDomain,
        rejectMealPlan: unreachableHouseholdDomain,
        swapMealPlan: unreachableHouseholdDomain,
      },
    });
    const principal = Schema.decodeUnknownSync(HouseholdMealPlanPrincipal)({
      actorId:
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      organizationId: oversizedOrganizationId,
    });
    const payload = Schema.decodeUnknownSync(CreateMealPlanPayload)({
      policy: {
        allowedDietaryFit: ["household_match"],
        allowedDifficulties: ["easy"],
        allowedTotalTimeBands: ["30_to_60_minutes"],
        maxRecipeUses: 1,
        preferredCuisines: ["Irish"],
        version: "oversized-authority-policy-v1",
      },
      request: {
        requestKey: "oversized-authority-test",
        slots: Array.from({ length: 19 }, (_, index) => ({
          date: `2026-09-${(index + 1).toString().padStart(2, "0")}`,
          mealType: "dinner",
          servings: 2,
          slotId: `oversized-authority-dinner-${index + 1}`,
        })),
      },
    });
    const gatewayFailure = await Effect.runPromise(
      gateway.create({ payload, principal }).pipe(Effect.flip)
    );
    expect(gatewayFailure).toEqual(
      MealPlanPersistenceFailure.make({ operation: "read" })
    );
    expect(createCalls).toBe(0);
  }, 30_000);
});
