import { fileURLToPath } from "node:url";

import { readD1Migrations } from "@cloudflare/vitest-pool-workers";
import type { AnyD1Database } from "drizzle-orm/d1";
import { Effect, Layer, Redacted, Schema } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { Miniflare } from "miniflare";
import { describe, expect, it } from "vitest";

import {
  makeOperatorCarouselImportService,
  OperatorCarouselImportService,
} from "./import-carousel-operator.service.js";
import {
  CarouselEvidenceManifestDocument,
  importTikTokCarouselToRecipeDraft,
} from "./import-carousel.js";
import { makeD1CarouselEvidenceRepository } from "./import-carousel.repository.d1.js";
import type { AcquisitionBucketLike } from "./import-media-acquirer.js";
import { makeD1RecipeDraftRepository } from "./import-recipe-draft.repository.d1.js";
import { makeDeterministicRecipeExtractor } from "./import-recipe-extractor.fake.js";
import type { RecipeEvidenceAssembly } from "./import-recipe-extractor.js";
import { makeDeterministicVisualEvidenceExtractor } from "./import-visual-evidence.fake.js";
import { ImportAuthorizer, makeImportAuthorizer } from "./import.auth.js";
import {
  ImportId,
  ImportTimestamp,
  SourceCanonicalId,
} from "./import.contracts.js";
import { makeD1ImportRepository } from "./import.repository.d1.js";
import { OperatorCarouselRoutes } from "./import.routes.js";
import { makeTikTokCanonicalSourceIdentityResolver } from "./source-identity.tiktok.js";

interface TestR2Object {
  readonly checksums?: { readonly sha256?: ArrayBuffer };
  readonly customMetadata?: Record<string, string>;
  readonly httpMetadata?: {
    readonly cacheControl?: string;
    readonly contentType?: string;
  };
  readonly size: number;
  readonly text: () => Promise<string>;
}

interface TestR2Bucket {
  readonly get: (key: string) => Promise<TestR2Object | null>;
  readonly head: AcquisitionBucketLike["head"];
  readonly list: () => Promise<{
    readonly objects: readonly { readonly key: string }[];
  }>;
  readonly put: AcquisitionBucketLike["put"];
}

const apiToken = "operator-integration-token";
const importId = Schema.decodeUnknownSync(ImportId)(
  "018f47ad-91aa-7c35-b6fe-000000000162"
);
const timestamp = Schema.decodeUnknownSync(ImportTimestamp)(
  "2026-07-25T20:00:00.000Z"
);
const canonicalId = Schema.decodeUnknownSync(SourceCanonicalId)(
  "7520000000000000162"
);
const completeJpegs = [
  {
    height: 3,
    jpegBase64:
      "/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAADAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABgj/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABykX//Z",
    orderIndex: 0,
    sha256: "7f593180ed96b891629067143da2fb44eb996b1a45e7561870a5754d5bba506e",
    width: 2,
  },
  {
    height: 2,
    jpegBase64:
      "/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAACAAMDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABQj/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCewFIh3//Z",
    orderIndex: 1,
    sha256: "8a2cbe47caa698585b361ae9a034bea0363d4c5fc05807262673be911dd7cf32",
    width: 3,
  },
] as const;

const unresolvedFact = {
  citations: [],
  origin: "unresolved" as const,
  reason: "not supplied",
  state: "unresolved" as const,
};
const unresolvedList = {
  items: [],
  reason: "not supplied",
  state: "unresolved" as const,
};

const recipeFixture = (input: RecipeEvidenceAssembly) => {
  const source = input.items.find(({ kind }) => kind === "source_url");
  const visual = input.items.find(({ kind }) => kind === "visual_observation");
  if (source === undefined || visual === undefined) {
    throw new Error("Missing canonical recipe evidence");
  }
  const supportedVisual = {
    citations: [
      {
        confidence: 1,
        evidenceId: visual.evidenceId,
        origin: "observed" as const,
      },
    ],
    origin: "observed" as const,
    state: "supported" as const,
    value: visual.value,
  };
  return {
    author: unresolvedFact,
    category: unresolvedFact,
    cookTimeMinutes: unresolvedFact,
    cost: {
      certainty: "known" as const,
      currency: "USD" as const,
      estimatedMicroUsd: 0,
    },
    cuisine: unresolvedFact,
    description: unresolvedFact,
    ingredientLines: {
      items: [supportedVisual],
      state: "supported" as const,
    },
    instructions: { items: [supportedVisual], state: "supported" as const },
    name: unresolvedFact,
    nutrition: unresolvedFact,
    prepTimeMinutes: unresolvedFact,
    sourceUrl: {
      citations: [
        {
          confidence: 1,
          evidenceId: source.evidenceId,
          origin: "observed" as const,
        },
      ],
      origin: "observed" as const,
      state: "supported" as const,
      value: source.value,
    },
    supportedClaims: unresolvedList,
    temperatureCelsius: unresolvedFact,
    tools: unresolvedList,
    totalTimeMinutes: unresolvedFact,
    unresolvedFields: [
      "author",
      "category",
      "cook_time_minutes",
      "cuisine",
      "description",
      "ingredient_quantities",
      "ingredient_units",
      "name",
      "nutrition",
      "prep_time_minutes",
      "temperature_celsius",
      "tools",
      "total_time_minutes",
      "yield",
    ],
    usage: {
      inputEvidenceItems: input.items.length,
      inputTokens: 0,
      latencyMilliseconds: 0,
      modelCalls: 1 as const,
      outputTokens: 0,
    },
    yield: unresolvedFact,
  };
};

const postBundle = (
  handler: (request: Request) => Promise<Response>,
  body: unknown,
  idempotencyKey: string,
  authorized = true
) =>
  handler(
    new Request("https://meal-planner.test/imports/operator-carousel", {
      body: JSON.stringify(body),
      headers: {
        ...(authorized ? { authorization: `Bearer ${apiToken}` } : {}),
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      method: "POST",
    })
  );

describe("operator carousel HTTP integration", () => {
  it("routes authenticated bundles through local D1/R2 without video acquisition", async () => {
    const runtime = new Miniflare({
      compatibilityDate: "2026-07-14",
      d1Databases: { MealPlannerDatabase: "operator-carousel-integration" },
      modules: true,
      r2Buckets: ["ImportEvidenceBucket"],
      script:
        "export default { fetch() { return new Response('local bindings'); } }",
    });
    const database = (await runtime.getD1Database(
      "MealPlannerDatabase"
    )) as AnyD1Database;
    const bucket = (await runtime.getR2Bucket(
      "ImportEvidenceBucket"
    )) as unknown as TestR2Bucket;
    const migrations = await readD1Migrations(
      fileURLToPath(new URL("../../../migrations", import.meta.url))
    );
    await database.batch(
      migrations.flatMap(({ queries }) =>
        queries.map((query) => database.prepare(query))
      )
    );
    const visual = makeDeterministicVisualEvidenceExtractor({
      cost: { certainty: "known", currency: "USD", estimatedMicroUsd: 0 },
      model: "provider-free-http-proof",
      observations: [
        {
          confidence: 1,
          frameIndex: 0,
          kind: "visible_text",
          regions: [{ height: 1, width: 1, x: 0, y: 0 }],
          text: "Chop onion then cook",
          timestampMilliseconds: 0,
        },
      ],
      outcome: "found",
      provider: "deterministic_fake",
      usage: { inputBytes: 270, inputFrames: 1, modelCalls: 1 },
    });
    const recipe = makeDeterministicRecipeExtractor(
      {
        model: "provider-free-http-proof",
        provider: "deterministic_fake",
        version: "operator-carousel-v1",
      },
      recipeFixture
    );
    const repository = makeD1ImportRepository(database);
    const service = makeOperatorCarouselImportService({
      identityResolver: makeTikTokCanonicalSourceIdentityResolver(() =>
        Promise.reject(new Error("Network must not be used"))
      ),
      newId: () => importId,
      now: () => timestamp,
      pipeline: {
        process: (input) =>
          importTikTokCarouselToRecipeDraft({
            adapter: input.adapter,
            bucket,
            carouselRepository: makeD1CarouselEvidenceRepository(database),
            descriptor: {
              canonicalId: input.canonicalId,
              declaredPageCount: input.declaredPageCount,
              kind: "tiktok_carousel",
              sourceUrl: input.sourceUrl,
            },
            extractor: recipe.service,
            importId: input.importId,
            now: () => timestamp,
            recipeRepository: makeD1RecipeDraftRepository(database),
            visualExtractor: visual.service,
          }).pipe(Effect.asVoid),
      },
      repository,
    });
    const authorizer = await Effect.runPromise(
      makeImportAuthorizer(Redacted.make(apiToken))
    );
    const app = HttpRouter.toWebHandler(
      Layer.mergeAll(
        OperatorCarouselRoutes,
        Layer.succeed(ImportAuthorizer, ImportAuthorizer.of(authorizer)),
        Layer.succeed(
          OperatorCarouselImportService,
          OperatorCarouselImportService.of(service)
        )
      ),
      { disableLogger: true }
    );
    const body = {
      declaredPageCount: 2,
      images: completeJpegs,
      source: {
        kind: "tiktok",
        url: `https://www.tiktok.com/@cook/photo/${canonicalId}?tracking=discard`,
      },
    };

    try {
      const unauthorized = await postBundle(
        app.handler,
        body,
        "operator-unauthorized",
        false
      );
      expect(unauthorized.status).toBe(401);
      expect(
        await database
          .prepare("SELECT count(*) AS count FROM recipe_imports")
          .first()
      ).toEqual({ count: 0 });
      expect(
        await database
          .prepare("SELECT count(*) AS count FROM import_recipe_extractions")
          .first()
      ).toEqual({ count: 0 });
      const objectsBeforeAdmission = await bucket.list();
      expect(objectsBeforeAdmission.objects).toEqual([]);

      const admitted = await postBundle(app.handler, body, "operator-valid");
      const replay = await postBundle(app.handler, body, "operator-valid");
      expect(admitted.status).toBe(200);
      await expect(admitted.json()).resolves.toMatchObject({
        disposition: "created",
        import: { id: importId, status: { kind: "needs_review" } },
      });
      await expect(replay.json()).resolves.toMatchObject({
        disposition: "idempotency_replay",
        import: { id: importId, status: { kind: "needs_review" } },
      });
      expect(visual.calls).toHaveLength(1);
      expect(recipe.calls).toHaveLength(1);
      expect(
        await database
          .prepare(
            "SELECT status FROM recipe_imports WHERE canonical_source_id = ?"
          )
          .bind(canonicalId)
          .first()
      ).toEqual({ status: "queued" });
      expect(
        await database
          .prepare(
            "SELECT count(*) AS count FROM import_transcriptions WHERE import_id = ?"
          )
          .bind(importId)
          .first()
      ).toEqual({ count: 0 });
      expect(
        await database
          .prepare(
            "SELECT count(*) AS count FROM import_recipe_extractions WHERE import_id = ?"
          )
          .bind(importId)
          .first()
      ).toEqual({ count: 1 });
      const successListing = await bucket.list();
      const objectsAfterSuccess = successListing.objects;
      expect(objectsAfterSuccess).toHaveLength(3);
      expect(objectsAfterSuccess.some(({ key }) => key.endsWith(".mp4"))).toBe(
        false
      );
      const manifestObject = await bucket.get(
        objectsAfterSuccess.find(({ key }) => key.endsWith("manifest.json"))
          ?.key ?? ""
      );
      if (manifestObject === null) {
        throw new Error("Expected private carousel manifest");
      }
      const manifest = Schema.decodeUnknownSync(
        CarouselEvidenceManifestDocument
      )(JSON.parse(await manifestObject.text()));
      expect(manifest.images.map(({ orderIndex }) => orderIndex)).toEqual([
        0, 1,
      ]);
      expect(manifest.retention.configuredAgeSeconds).toBe(604_800);
      expect(manifest.transcript).toEqual({
        reason: "source_type_carousel",
        status: "not_applicable",
      });
      expect(JSON.stringify(manifest)).not.toContain("https://");
      expect(JSON.stringify(manifest)).not.toContain("tracking=discard");

      const invalid = await postBundle(
        app.handler,
        {
          declaredPageCount: 1,
          images: [
            {
              height: 1,
              jpegBase64: "/9j/wAALCAABAAEBAREA/9k=",
              orderIndex: 0,
              sha256:
                "96b3455d1180f0ca4c617adbe4d6a0631c9a46b49e9fa10cc1563a207b001b41",
              width: 1,
            },
          ],
          source: {
            kind: "tiktok",
            url: "https://www.tiktok.com/@cook/photo/7520000000000000999",
          },
        },
        "operator-invalid-jpeg"
      );
      expect(invalid.status).toBe(422);
      await expect(invalid.json()).resolves.toMatchObject({
        error: { recovery: "request_complete_carousel" },
      });
      expect(
        await database
          .prepare(
            "SELECT count(*) AS count FROM recipe_imports WHERE canonical_source_id = ?"
          )
          .bind("7520000000000000999")
          .first()
      ).toEqual({ count: 0 });
      expect(
        await database
          .prepare("SELECT count(*) AS count FROM import_recipe_extractions")
          .first()
      ).toEqual({ count: 1 });
      const objectsAfterInvalid = await bucket.list();
      expect(objectsAfterInvalid.objects).toHaveLength(3);
    } finally {
      await app.dispose();
      await runtime.dispose();
    }
  });
});
