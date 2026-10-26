import { SigenFailure, StationId, failure } from "@meal-planner/sigen";
import { makeSigenClient } from "@meal-planner/sigen/client";
import type { RuntimeContext } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { Config, Effect, Layer, Redacted, Schema } from "effect";
import { FetchHttpClient } from "effect/http";

import { SessionRecord, emptySession, makeSession } from "./session.js";
import type { SessionStorage } from "./session.js";
import type { EncryptedSecret } from "./vault.js";
import { makeVault } from "./vault.js";

const runtime = Effect.gen(function* constructAccountObject() {
  const state = yield* Cloudflare.DurableObjectState;
  const encryptionKey = yield* Config.Redacted(
    "SIGEN_SESSION_ENCRYPTION_KEY"
  ).pipe(Effect.orDie);
  const client = yield* makeSigenClient;
  return Effect.gen(function* initializeAccount() {
    const storage: SessionStorage<RuntimeContext> = {
      read: state.storage.get<unknown>("sigen-session-v1").pipe(
        Effect.flatMap((value) =>
          value === undefined
            ? Effect.succeed(emptySession)
            : Schema.decodeUnknownEffect(SessionRecord)(value)
        ),
        Effect.mapError(() => failure("StorageUnavailable"))
      ),
      write: (record, alarmAt) =>
        state.storage
          .transaction(
            Effect.gen(function* writeSession() {
              yield* state.storage.put("sigen-session-v1", record);
              yield* alarmAt === null
                ? state.storage.deleteAlarm()
                : state.storage.setAlarm(alarmAt);
            })
          )
          .pipe(Effect.mapError(() => failure("StorageUnavailable"))),
    };
    const session = yield* makeSession(storage, encryptionKey, client);
    const vault = makeVault(encryptionKey);
    const stationCall = <A>(
      input: StationId,
      call: (id: StationId) => Effect.Effect<A, SigenFailure, RuntimeContext>
    ) =>
      Schema.decodeUnknownEffect(StationId)(input).pipe(
        Effect.mapError(() => failure("InvalidInput")),
        Effect.flatMap(call),
        Effect.scoped
      );
    return {
      alarm: () => session.onAlarm.pipe(Effect.scoped),
      disconnect: () => session.disconnect,
      energyFlow: (id: StationId) => stationCall(id, session.energyFlow),
      enroll: (input: EncryptedSecret) =>
        Effect.gen(function* enrollAccount() {
          const secret = yield* vault.decrypt(input);
          const value = Redacted.value(secret);
          // The discriminant is checked after decryption; plaintext never crosses native RPC.
          if (value.kind !== "enrollment") {
            return yield* failure("InvalidInput");
          }
          return yield* session.enroll(Redacted.make(value.value));
        }).pipe(Effect.scoped),
      health: () => session.health,
      operatingMode: (id: StationId) => stationCall(id, session.operatingMode),
      report: () => session.report,
      station: (id: StationId) => stationCall(id, session.station),
    };
  });
}).pipe(
  Effect.provide(
    FetchHttpClient.layer.pipe(
      Layer.provide(
        Layer.succeed(FetchHttpClient.RequestInit, { redirect: "manual" })
      )
    )
  )
);

type Shape = Effect.Success<Effect.Success<typeof runtime>>;
export class SigenAccountObject extends Cloudflare.DurableObject<
  SigenAccountObject,
  Shape
>()("SigenAccountObject", { errors: [SigenFailure] }) {}
export default SigenAccountObject.make(runtime);
