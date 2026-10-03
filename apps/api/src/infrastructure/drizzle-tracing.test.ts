import { DatabaseSync } from "node:sqlite";

import { instrumentDrizzle } from "cloudflare-drizzle-tracing";
import { drizzle } from "drizzle-orm/node-sqlite";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { expect, it } from "vitest";

import { RecordingDrizzleTracer } from "./drizzle-tracing.test-fixture.js";

const rows = sqliteTable("tracing_probe", {
  id: integer().primaryKey(),
  value: text().notNull(),
});

it("traces synchronous SQL and nested transactions without changing commit or rollback", () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(
      "CREATE TABLE tracing_probe(id INTEGER PRIMARY KEY, value TEXT NOT NULL)"
    );
    const tracer = new RecordingDrizzleTracer();
    const db = instrumentDrizzle(drizzle({ client: database }), { tracer });
    db.transaction((tx) => {
      tx.insert(rows).values({ id: 1, value: "private-value" }).run();
      tx.transaction((nested) =>
        nested.insert(rows).values({ id: 2, value: "other-value" }).run()
      );
    });
    expect(() =>
      db.transaction((tx) => {
        tx.insert(rows).values({ id: 3, value: "rolled-back" }).run();
        tx.insert(rows).values({ id: 1, value: "duplicate" }).run();
      })
    ).toThrow();
    expect(
      db
        .select()
        .from(rows)
        .all()
        .map((row) => row.id)
    ).toEqual([1, 2]);
    expect(
      tracer.spans.filter((span) => span.name === "drizzle.transaction")
    ).toHaveLength(3);
    expect(
      tracer.spans.some(
        (span) => span.attributes["db.operation.name"] === "SAVEPOINT"
      )
    ).toBe(true);
    expect(tracer.spans.some((span) => span.errors.length > 0)).toBe(true);
    expect(tracer.spans.every((span) => span.finished)).toBe(true);
    expect(JSON.stringify(tracer.spans)).not.toContain("private-value");
  } finally {
    database.close();
  }
});
