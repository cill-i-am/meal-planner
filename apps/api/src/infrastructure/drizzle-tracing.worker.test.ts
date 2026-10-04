import { instrumentDrizzle } from "cloudflare-drizzle-tracing";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import type { AnyD1Database } from "drizzle-orm/d1";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { expect, it } from "vitest";

import { RecordingDrizzleTracer } from "./drizzle-tracing.test-fixture.js";

const bindings = env as unknown as {
  readonly ProviderAccountingDatabase: AnyD1Database;
};
const rows = sqliteTable("tracing_probe", {
  id: integer().primaryKey(),
  value: text().notNull(),
});

it("keeps D1 query spans open until completion and captures batch results and errors", async () => {
  await bindings.ProviderAccountingDatabase.prepare(
    "CREATE TABLE tracing_probe(id INTEGER PRIMARY KEY, value TEXT NOT NULL)"
  ).run();
  const tracer = new RecordingDrizzleTracer();
  const db = instrumentDrizzle(drizzle(bindings.ProviderAccountingDatabase), {
    tracer,
  });
  const pending = db
    .insert(rows)
    .values({ id: 1, value: "private-value" })
    .run();
  expect(tracer.spans.at(-1)?.finished).toBe(false);
  await pending;
  expect(tracer.spans.at(-1)?.finished).toBe(true);
  const [result] = await db.batch([db.select().from(rows)]);
  expect(result).toEqual([{ id: 1, value: "private-value" }]);
  await expect(
    db.insert(rows).values({ id: 1, value: "duplicate" }).run()
  ).rejects.toThrow();
  expect(tracer.spans.some((span) => span.name === "drizzle.batch")).toBe(true);
  expect(tracer.spans.some((span) => span.errors.length > 0)).toBe(true);
  expect(tracer.spans.every((span) => span.finished)).toBe(true);
  expect(JSON.stringify(tracer.spans)).not.toContain("private-value");
});
