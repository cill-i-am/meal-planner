import { applyD1Migrations, env } from "cloudflare:test";
import type { AnyD1Database } from "drizzle-orm/d1";
import { Effect, Schema } from "effect";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { makeD1ImportObservabilityTraceStore } from "./import-observability.d1.js";
import {
  ImportCorrelationId,
  ImportObservabilityTraceStore,
  emitImportObservabilityEvent,
} from "./import-observability.js";

const testEnv = env as unknown as {
  readonly MealPlannerDatabase: AnyD1Database;
  readonly TEST_MIGRATIONS: {
    readonly name: string;
    readonly queries: string[];
  }[];
};

const correlationId = Schema.decodeUnknownSync(ImportCorrelationId)(
  "019b37f2-1a6e-7f3a-8a5a-7f0d8f6c2b1a"
);

beforeAll(async () => {
  await applyD1Migrations(
    testEnv.MealPlannerDatabase,
    [...testEnv.TEST_MIGRATIONS],
    "d1_migrations"
  );
});

describe("durable private import trace stream", () => {
  it("persists and retrieves only closed URL-safe events by opaque correlation", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(vi.fn());
    const traceStore = makeD1ImportObservabilityTraceStore(
      testEnv.MealPlannerDatabase,
      () => "2026-07-27T20:00:00.000Z"
    );

    await Effect.runPromise(
      Effect.gen(function* appendClosedEventsInOrder() {
        yield* emitImportObservabilityEvent({
          correlationId,
          event: "queue.received",
          outcome: "received",
        });
        yield* emitImportObservabilityEvent({
          correlationId,
          event: "provider.response",
          outcome: "received",
          providerStage: "speech",
        });
      }).pipe(Effect.provideService(ImportObservabilityTraceStore, traceStore))
    );

    const events = await Effect.runPromise(traceStore.read(correlationId));
    expect(events).toEqual([
      {
        correlationId,
        event: "queue.received",
        outcome: "received",
      },
      {
        correlationId,
        event: "provider.response",
        outcome: "received",
        providerStage: "speech",
      },
    ]);

    const rows = await testEnv.MealPlannerDatabase.prepare(
      `SELECT actor_id AS actorId,
              event_json AS eventJson,
              event_tag AS eventTag,
              item_id AS itemId
         FROM import_operational_events
        WHERE event_tag = 'import_observability'
          AND item_id = ?
        ORDER BY id`
    )
      .bind(correlationId)
      .all<{
        readonly actorId: string | null;
        readonly eventJson: string;
        readonly eventTag: string;
        readonly itemId: string;
      }>();
    expect(rows.results).toHaveLength(2);
    expect(
      rows.results.every(
        (row: { readonly actorId: string | null }) => row.actorId === null
      )
    ).toBe(true);
    expect(
      rows.results.every(
        (row: { readonly itemId: string }) => row.itemId === correlationId
      )
    ).toBe(true);
    expect(JSON.stringify(rows.results)).not.toMatch(
      /https?:|prompt|transcript|cookie|authorization|credential|media|payload/iu
    );
    log.mockRestore();
  });
});
