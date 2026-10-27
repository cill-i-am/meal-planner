import type { Redacted } from "effect";
import { DateTime, Effect, Option, Schema, flow } from "effect";

import { failure } from "./model.js";
import type { SigenFailure, StationId } from "./model.js";

/** Shared by the app's backup duration history and diagnostic event feed. */
export const ProviderLocalTimestamp = Schema.String.check(
  Schema.isPattern(/^20\d{2}-\d{2}-\d{2} [0-2]\d:[0-5]\d:[0-5]\d$/u),
  Schema.makeFilter((value) => {
    const local = value.replace(" ", "T");
    const parsed = DateTime.make(`${local}Z`);
    return (
      Option.isSome(parsed) &&
      DateTime.formatIso(parsed.value).slice(0, 19) === local
    );
  })
);

/** Internal adapter port; it is never exposed through HTTP or MCP. */
export type ProviderRead = (
  path: string,
  token: Redacted.Redacted<string>
) => Effect.Effect<unknown, SigenFailure>;
export const decodeProvider = <S extends Schema.Top>(schema: S) =>
  flow(
    Schema.decodeUnknownEffect(schema),
    Effect.mapError(() => failure("SchemaMismatch"))
  );

export const readStationTimezone = (
  read: ProviderRead,
  id: StationId,
  token: Redacted.Redacted<string>
) =>
  Effect.gen(function* stationTimezone() {
    const data = yield* read(
      `/device/owner/station/home?stationId=${id}`,
      token
    ).pipe(
      Effect.flatMap(
        decodeProvider(
          Schema.Struct({
            stationId: Schema.Number,
            timeZoneName: Schema.String,
          })
        )
      )
    );
    if (String(data.stationId) !== id) {
      return yield* failure("PermissionDenied");
    }
    return yield* DateTime.zoneMakeNamedEffect(data.timeZoneName).pipe(
      Effect.mapError(() => failure("SchemaMismatch"))
    );
  });
