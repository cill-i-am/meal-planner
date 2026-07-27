import type { AnyD1Database } from "drizzle-orm/d1";
import { Effect, Schema } from "effect";

import type {
  ImportCorrelationId,
  ImportObservabilityTraceStoreShape,
} from "./import-observability.js";
import { ImportObservabilityEvent } from "./import-observability.js";

const PersistedTraceRow = Schema.Struct({
  eventJson: Schema.String,
});

const databaseEffect = <A>(operation: () => PromiseLike<A>) =>
  Effect.tryPromise({
    catch: (cause) =>
      new Error("Durable import observability persistence failed", { cause }),
    try: operation,
  }).pipe(Effect.orDie);

const decodeEvent = Schema.decodeUnknownSync(ImportObservabilityEvent, {
  onExcessProperty: "error",
});

/**
 * Reuse the existing private operational-event table as the app-owned,
 * retrievable trace stream. No URL-bearing request metadata enters this sink.
 */
export const makeD1ImportObservabilityTraceStore = (
  database: AnyD1Database,
  now: () => string
): ImportObservabilityTraceStoreShape => ({
  append: (event) =>
    databaseEffect(() =>
      database
        .prepare(
          `INSERT INTO import_operational_events (
             event_tag, item_id, actor_id, event_json, occurred_at
           ) VALUES ('import_observability', ?, NULL, ?, ?)`
        )
        .bind(event.correlationId, JSON.stringify(event), now())
        .run()
    ).pipe(Effect.asVoid),
  read: (correlationId: ImportCorrelationId) =>
    databaseEffect<{
      readonly results: readonly { readonly eventJson: string }[];
    }>(() =>
      database
        .prepare(
          `SELECT event_json AS eventJson
             FROM import_operational_events
            WHERE event_tag = 'import_observability'
              AND item_id = ?
            ORDER BY id`
        )
        .bind(correlationId)
        .all<{ readonly eventJson: string }>()
    ).pipe(
      Effect.map(({ results }) =>
        results.map((row) => {
          const { eventJson } =
            Schema.decodeUnknownSync(PersistedTraceRow)(row);
          return decodeEvent(JSON.parse(eventJson));
        })
      )
    ),
});
