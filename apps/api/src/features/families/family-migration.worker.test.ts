import { applyD1Migrations, env } from "cloudflare:test";
import { eq, sql } from "drizzle-orm";
import type { AnyD1Database } from "drizzle-orm/d1";
import { drizzle } from "drizzle-orm/d1";
import { expect, it } from "vitest";

import { member, organization, user } from "../auth/auth.database-schema.js";
import { familyRecord } from "./schema.js";

const testEnv = env as unknown as {
  readonly AUTH_TEST_MIGRATIONS: {
    readonly name: string;
    readonly queries: string[];
  }[];
  readonly MealPlannerAuthDatabase: AnyD1Database;
};
it("preserves existing families and stops before deleting an unresolved submitted command", async () => {
  const migrations = testEnv.AUTH_TEST_MIGRATIONS;
  const split = migrations.findIndex((m) =>
    m.name.includes("family_resources")
  );
  expect(split).toBeGreaterThan(0);
  await applyD1Migrations(
    testEnv.MealPlannerAuthDatabase,
    migrations.slice(0, split)
  );
  const database = drizzle(testEnv.MealPlannerAuthDatabase);
  await Promise.all(
    ["complete-owner", "pending-owner", "pending-person"].map((id) =>
      database
        .insert(user)
        .values({ email: `${id}@example.test`, id, name: "Original owner" })
    )
  );
  await Promise.all(
    ["complete", "pending"].map(async (id) => {
      await database.insert(organization).values({
        createdAt: new Date(1000),
        id,
        name: `${id} family`,
        slug: `${id}-slug`,
      });
      await database.insert(member).values({
        createdAt: new Date(1000),
        id: `${id}-member`,
        organizationId: id,
        role: "owner",
        userId: `${id}-owner`,
      });
    })
  );
  const writeOldProgress = (id: string, checkpoint: object) =>
    database.run(
      sql`UPDATE user SET setup_progress = ${JSON.stringify({ checkpoint, status: "active" })} WHERE id = ${id}`
    );
  await writeOldProgress("complete-owner", {
    organizationId: "complete",
    stage: "complete",
  });
  await writeOldProgress("pending-owner", {
    creator: {
      displayName: "Original owner",
      mutationId: "original-create-key",
    },
    name: "pending family",
    slug: "pending-slug",
    stage: "family-create",
  });
  await writeOldProgress("pending-person", {
    command: {
      kind: "managed",
      person: {
        displayName: "Keep this request",
        kind: "dependant",
        mutationId: "unresolved-person",
      },
    },
    organizationId: "complete",
    stage: "person-create",
  });
  await expect(
    applyD1Migrations(testEnv.MealPlannerAuthDatabase, migrations)
  ).rejects.toThrow();
  const [unresolved] = await database.all<{ progress: string }>(
    sql`SELECT setup_progress AS progress FROM user WHERE id = 'pending-person'`
  );
  expect(JSON.parse(unresolved?.progress ?? "null")).toMatchObject({
    checkpoint: { command: { person: { mutationId: "unresolved-person" } } },
  });
  // Simulate finishing that existing request with the previous application.
  await writeOldProgress("pending-person", {
    organizationId: "complete",
    stage: "family-review",
  });
  await applyD1Migrations(testEnv.MealPlannerAuthDatabase, migrations);
  const [complete] = await database
    .select()
    .from(familyRecord)
    .where(eq(familyRecord.organizationId, "complete"));
  expect(complete).toMatchObject({
    completedAt: new Date(1000),
    creatorLinked: true,
    creatorUserId: "complete-owner",
    version: 1,
  });
  const [pending] = await database
    .select()
    .from(familyRecord)
    .where(eq(familyRecord.organizationId, "pending"));
  expect(pending).toMatchObject({
    completedAt: null,
    creationMutationId: "original-create-key",
    creatorDisplayName: "Original owner",
    creatorLinked: false,
    creatorUserId: "pending-owner",
  });
  expect(await database.select().from(organization)).toHaveLength(2);
  expect(await database.select().from(member)).toHaveLength(2);
  const columns = await database.all<{ name: string }>(
    sql`PRAGMA table_info(user)`
  );
  expect(columns.map((c) => c.name)).not.toContain("setup_progress");
  expect(columns.map((c) => c.name)).not.toContain("setup_progress_version");
});
