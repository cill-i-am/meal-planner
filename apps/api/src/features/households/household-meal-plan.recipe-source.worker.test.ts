import {
  HouseholdOrganizationId,
  MealPlanRecipeSnapshot,
  MealPlanRecipeSnapshotId,
} from "@meal-planner/household-api";
import { applyD1Migrations, env } from "cloudflare:test";
import { Effect, Option, Schema } from "effect";
import { beforeAll, describe, expect, it } from "vitest";

import { AcquisitionGeneration } from "../imports/import-media.model.js";
import { RecipeDraft } from "../imports/import-recipe-draft.repository.d1.js";
import { workerTestMigrations } from "../imports/import-worker-test-environment.js";
import { ImportId } from "../imports/import.contracts.js";
import {
  findApprovedMealPlanRecipeSnapshot,
  listApprovedMealPlanRecipeSnapshots,
} from "./household-meal-plan.recipe-source.js";

const organizationId = Schema.decodeUnknownSync(HouseholdOrganizationId)(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
);
const otherOrganizationId = Schema.decodeUnknownSync(HouseholdOrganizationId)(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
);

// SHA-256 of each immutable organization ID. These fixtures intentionally do
// not share the production derivation function, so a routing drift fails here.
const householdScopeId =
  "303617b9730210ef3c86c52dc2aecc4dce54aaca6af8c8b0f4ceec9ecc54e57e";
const otherHouseholdScopeId =
  "00f765af1c54eb24e437746c4f64b5841490757b647bf3a392b042f872ad7090";
const instant = "2026-08-19T12:00:00.000Z";

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
      ingredientLines: supportedList(["1 onion", "2 tomatoes"]),
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
  readonly extractionFingerprint: string;
  readonly householdScopeId: string;
  readonly importId: typeof ImportId.Type;
  readonly lifecycle: "approved" | "needs_review";
  readonly name: string;
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
      JSON.stringify(Schema.encodeSync(RecipeDraft)(draft)),
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
      input.lifecycle === "approved" ? 1 : 0,
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
       ) VALUES (?, 1, 'authority-fixture', 'needs_review', 'approved',
                 'Approved for household planning.', ?)`
    )
      .bind(input.extractionFingerprint, instant)
      .run();
  }
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

    const snapshots = await Effect.runPromise(
      listApprovedMealPlanRecipeSnapshots(
        env.MealPlannerDatabase,
        organizationId
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

    const otherSnapshots = await Effect.runPromise(
      listApprovedMealPlanRecipeSnapshots(
        env.MealPlannerDatabase,
        otherOrganizationId
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

  it("keeps generation bounded while resolving an older explicit swap recipe through household authority", async () => {
    const approvedImportIds = Array.from({ length: 130 }, (_, index) =>
      Schema.decodeUnknownSync(ImportId)(
        `10000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`
      )
    );
    await Promise.all(
      approvedImportIds.map((importId, index) =>
        seedImport({
          current: true,
          extractionFingerprint: index.toString(16).padStart(64, "0"),
          householdScopeId,
          importId,
          lifecycle: "approved",
          name: `Bounded Approved Recipe ${index}`,
          sourceUrl: `https://www.tiktok.com/@fixture/video/7520000000000001${index.toString().padStart(3, "0")}`,
        })
      )
    );

    const olderApprovedImportId = Schema.decodeUnknownSync(
      MealPlanRecipeSnapshotId
    )(approvedImportIds.at(-1));
    const candidates = await Effect.runPromise(
      listApprovedMealPlanRecipeSnapshots(
        env.MealPlannerDatabase,
        organizationId
      )
    );
    expect(candidates).toHaveLength(128);
    expect(
      candidates.some(({ importId }) => importId === olderApprovedImportId)
    ).toBe(false);

    const explicitlyRequested = await Effect.runPromise(
      findApprovedMealPlanRecipeSnapshot(
        env.MealPlannerDatabase,
        organizationId,
        olderApprovedImportId
      )
    );
    expect(Option.getOrUndefined(explicitlyRequested)).toMatchObject({
      importId: olderApprovedImportId,
      recipe: { name: "Bounded Approved Recipe 129" },
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
});
