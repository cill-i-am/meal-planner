import type { AnyD1Database } from "drizzle-orm/d1";
import { Data, Effect, Schema } from "effect";

import { ImportEvidenceRoute } from "./import-evidence-event.js";
import type { ImportEvidenceRoute as ImportEvidenceRouteType } from "./import-evidence-event.js";

export class ImportEvidenceRouteRepositoryFailure extends Data.TaggedError(
  "ImportEvidenceRouteRepositoryFailure"
) {}

const failure = () => new ImportEvidenceRouteRepositoryFailure();

/** D1 serializes the immutable insert and winner read as one atomic batch. */
export const makeD1ImportEvidenceRouteRepository = (
  database: AnyD1Database
) => ({
  get: (importId: string) =>
    Effect.tryPromise({
      catch: failure,
      try: () =>
        database
          .prepare(
            `SELECT import_id AS importId,
                    organization_id AS organizationId,
                    route_version AS routeVersion
               FROM import_evidence_routes
              WHERE import_id = ?`
          )
          .bind(importId)
          .first(),
    }).pipe(
      Effect.flatMap((row) =>
        row === null
          ? Effect.succeed(null)
          : Schema.decodeUnknownEffect(ImportEvidenceRoute)(row).pipe(
              Effect.mapError(failure)
            )
      )
    ),
  register: (route: ImportEvidenceRouteType) =>
    Effect.tryPromise({
      catch: failure,
      try: async () => {
        const results = (await database.batch([
          database
            .prepare(
              `INSERT INTO import_evidence_routes (
                 import_id, organization_id, route_version
               ) VALUES (?, ?, ?)
               ON CONFLICT (import_id) DO NOTHING`
            )
            .bind(route.importId, route.organizationId, route.routeVersion),
          database
            .prepare(
              `SELECT import_id AS importId,
                      organization_id AS organizationId,
                      route_version AS routeVersion
                 FROM import_evidence_routes
                WHERE import_id = ?`
            )
            .bind(route.importId),
        ])) as readonly { readonly results: readonly unknown[] }[];
        return results[1]?.results[0] ?? null;
      },
    }).pipe(
      Effect.flatMap((row) =>
        row === null
          ? Effect.fail(failure())
          : Schema.decodeUnknownEffect(ImportEvidenceRoute)(row).pipe(
              Effect.mapError(failure)
            )
      ),
      Effect.map((winner) =>
        winner.organizationId === route.organizationId
          ? ("Registered" as const)
          : ("ConflictRejected" as const)
      )
    ),
});
