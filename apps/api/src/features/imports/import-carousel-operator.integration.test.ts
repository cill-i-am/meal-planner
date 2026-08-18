import { fileURLToPath } from "node:url";

import { readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { RecipeImportIntentId } from "@meal-planner/recipe-import-api";
import type { AnyD1Database } from "drizzle-orm/d1";
import { Effect, Layer, Schema } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { Miniflare } from "miniflare";
import { describe, expect, it } from "vitest";

import { AuthPrincipalResolver } from "../auth/auth.principal.js";
import { OperatorCarouselRoutes } from "./import-carousel-operator.routes.js";
import {
  makeOperatorCarouselImportService,
  OperatorCarouselImportService,
} from "./import-carousel-operator.service.js";
import { makeImportIntentApplication } from "./import-intent.js";
import { ImportTimestamp, SourceCanonicalId } from "./import.contracts.js";
import { makeD1ImportRepository } from "./import.repository.d1.js";
import {
  makeTestAuthPrincipalResolver,
  TestImportTrace,
} from "./import.test-fixtures.js";
import { makeTikTokCanonicalSourceIdentityResolver } from "./source-identity.tiktok.js";

const apiToken = "operator-integration-token";
const intentId = Schema.decodeUnknownSync(RecipeImportIntentId)(
  "018f47ad-91aa-7c35-b6fe-000000000162"
);
const timestamp = Schema.decodeUnknownSync(ImportTimestamp)(
  "2026-07-25T20:00:00.000Z"
);
const encodedTimestamp = Schema.encodeSync(ImportTimestamp)(timestamp);
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
        ...(authorized
          ? { cookie: `better-auth.session_token=${apiToken}` }
          : {}),
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      method: "POST",
    })
  );

describe("operator carousel HTTP integration", () => {
  it("durably resolves one intent and stages one provider-free carousel", async () => {
    const runtime = new Miniflare({
      compatibilityDate: "2026-07-14",
      d1Databases: { MealPlannerDatabase: "operator-carousel-integration" },
      modules: true,
      script:
        "export default { fetch() { return new Response('local bindings'); } }",
    });
    const database = (await runtime.getD1Database(
      "MealPlannerDatabase"
    )) as AnyD1Database;
    const migrations = await readD1Migrations(
      fileURLToPath(new URL("../../../migrations", import.meta.url))
    );
    await database.batch(
      migrations.flatMap(({ queries }) =>
        queries.map((query) => database.prepare(query))
      )
    );
    const repository = makeD1ImportRepository(database);
    const stageCalls: unknown[] = [];
    const starterCalls: unknown[][] = [];
    let providerCalls = 0;
    const application = makeImportIntentApplication(
      repository,
      {
        ensureStarted: (startedImportId, executionGeneration, trace) =>
          Effect.sync(() => {
            starterCalls.push([startedImportId, executionGeneration, trace]);
            return "created" as const;
          }),
      },
      TestImportTrace
    );
    const service = makeOperatorCarouselImportService({
      application,
      identityResolver: makeTikTokCanonicalSourceIdentityResolver(() => {
        providerCalls += 1;
        return Promise.reject(new Error("Provider must not be used"));
      }),
      newIntentId: () => intentId,
      now: () => encodedTimestamp,
      pipeline: {
        stage: (input) =>
          Effect.sync(() => {
            stageCalls.push(input);
          }),
      },
    });
    const app = HttpRouter.toWebHandler(
      Layer.mergeAll(
        OperatorCarouselRoutes,
        Layer.succeed(
          AuthPrincipalResolver,
          AuthPrincipalResolver.of(makeTestAuthPrincipalResolver(apiToken))
        ),
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
      expect(stageCalls).toEqual([]);
      expect(starterCalls).toEqual([]);
      expect(providerCalls).toBe(0);

      const admitted = await postBundle(app.handler, body, "operator-valid");
      const replay = await postBundle(app.handler, body, "operator-valid");
      expect(admitted.status).toBe(202);
      expect(replay.status).toBe(202);
      const admittedIntent = await admitted.json();
      const replayedIntent = await replay.json();
      expect(admittedIntent).toMatchObject({
        id: intentId,
        intentVersion: 2,
        processing: {
          sourceKind: "carousel",
          type: "acquiring_media",
        },
        source: {
          canonicalUrl: `https://www.tiktok.com/@cook/photo/${canonicalId}`,
          resolution: "resolved",
        },
        status: "processing",
      });
      expect(replayedIntent).toEqual(admittedIntent);
      expect(stageCalls).toEqual([
        expect.objectContaining({
          canonicalId,
          declaredPageCount: 2,
          importId: intentId,
          sourceUrl: `https://www.tiktok.com/@cook/photo/${canonicalId}`,
        }),
      ]);
      expect(starterCalls).toEqual([[intentId, 1, TestImportTrace]]);
      expect(providerCalls).toBe(0);
      expect(
        await database
          .prepare(
            `SELECT public_source_kind AS sourceKind,
                    public_stage AS stage,
                    public_status AS status,
                    resolved_canonical_source_id AS canonicalId
               FROM recipe_imports WHERE id = ?`
          )
          .bind(intentId)
          .first()
      ).toEqual({
        canonicalId,
        sourceKind: "carousel",
        stage: "acquiring_media",
        status: "processing",
      });
      expect(
        await database
          .prepare(
            "SELECT count(*) AS count FROM import_requests WHERE import_id = ?"
          )
          .bind(intentId)
          .first()
      ).toEqual({ count: 1 });
      const fingerprintConflict = await postBundle(
        app.handler,
        {
          ...body,
          declaredPageCount: 1,
          images: [completeJpegs[0]],
        },
        "operator-valid"
      );
      expect(fingerprintConflict.status).toBe(409);
      await expect(fingerprintConflict.json()).resolves.toMatchObject({
        error: { code: "idempotency_conflict" },
      });
      expect(stageCalls).toHaveLength(1);
      expect(starterCalls).toHaveLength(1);
      expect(providerCalls).toBe(0);
      expect(
        await database
          .prepare("SELECT count(*) AS count FROM import_requests")
          .first()
      ).toEqual({ count: 1 });
    } finally {
      await app.dispose();
      await runtime.dispose();
    }
  });
});
