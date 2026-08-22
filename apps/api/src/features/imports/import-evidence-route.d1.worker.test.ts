import { applyD1Migrations, env } from "cloudflare:test";
import type { AnyD1Database } from "drizzle-orm/d1";
import { Effect, Schema } from "effect";
import { beforeAll, describe, expect, it } from "vitest";

import { HouseholdOrganizationId } from "../households/household.contract.js";
import { ImportEvidenceRoute } from "./import-evidence-event.js";
import { makeD1ImportEvidenceRouteRepository } from "./import-evidence-route.repository.d1.js";
import { ImportId } from "./import.contracts.js";

const testEnv = env as unknown as {
  readonly MealPlannerDatabase: AnyD1Database;
  readonly TEST_MIGRATIONS: {
    readonly name: string;
    readonly queries: string[];
  }[];
};

beforeAll(async () => {
  await applyD1Migrations(
    testEnv.MealPlannerDatabase,
    [...testEnv.TEST_MIGRATIONS],
    "d1_migrations"
  );
});

describe("D1 import evidence route authority", () => {
  it("serializes concurrent registration without overwriting the immutable winner", async () => {
    const repository = makeD1ImportEvidenceRouteRepository(
      testEnv.MealPlannerDatabase
    );
    const importId = Schema.decodeUnknownSync(ImportId)(
      "019d5aa3-1090-70c1-9ef0-bef8f7452621"
    );
    const routeA = Schema.decodeUnknownSync(ImportEvidenceRoute)({
      importId,
      organizationId: Schema.decodeUnknownSync(HouseholdOrganizationId)(
        "019d5aa3-1090-70c2-9ef0-bef8f7452621"
      ),
      routeVersion: 1,
    });
    const routeB = Schema.decodeUnknownSync(ImportEvidenceRoute)({
      importId,
      organizationId: Schema.decodeUnknownSync(HouseholdOrganizationId)(
        "019d5aa3-1090-70c3-9ef0-bef8f7452621"
      ),
      routeVersion: 1,
    });

    const outcomes = await Promise.all(
      [routeA, routeB].map((route) =>
        Effect.runPromise(repository.register(route))
      )
    );
    expect(outcomes.toSorted()).toEqual(["ConflictRejected", "Registered"]);

    const winner = await Effect.runPromise(repository.get(importId));
    expect(winner).not.toBeNull();
    const loser =
      winner?.organizationId === routeA.organizationId ? routeB : routeA;
    await expect(Effect.runPromise(repository.register(loser))).resolves.toBe(
      "ConflictRejected"
    );
    await expect(Effect.runPromise(repository.get(importId))).resolves.toEqual(
      winner
    );

    const stored = await testEnv.MealPlannerDatabase.prepare(
      `SELECT COUNT(*) AS count
         FROM import_evidence_routes
        WHERE import_id = ?`
    )
      .bind(importId)
      .first<{ readonly count: number }>();
    expect(stored?.count).toBe(1);
  });
});
