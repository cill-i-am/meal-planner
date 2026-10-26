import { SigenFailure, StationId, failure } from "@meal-planner/sigen";
import { AlarmInput } from "@meal-planner/sigen/alarms";
import { makeSigenClient } from "@meal-planner/sigen/client";
import { DeviceInput } from "@meal-planner/sigen/equipment";
import { HistoryInput, ForecastInput } from "@meal-planner/sigen/history";
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
    const inputCall = <S extends Schema.Top, A>(
      schema: S,
      input: S["Type"],
      call: (id: S["Type"]) => Effect.Effect<A, SigenFailure, RuntimeContext>
    ) =>
      Schema.decodeUnknownEffect(schema)(input).pipe(
        Effect.mapError(() => failure("InvalidInput")),
        Effect.flatMap(call),
        Effect.scoped
      );
    return {
      alarm: () => session.onAlarm.pipe(Effect.scoped),
      alarms: (input: typeof AlarmInput.Type) =>
        inputCall(AlarmInput, input, session.alarms),
      batterySettings: (id: StationId) =>
        inputCall(StationId, id, session.batterySettings),
      deviceInfo: (input: typeof DeviceInput.Type) =>
        inputCall(DeviceInput, input, session.deviceInfo),
      deviceValues: (input: typeof DeviceInput.Type) =>
        inputCall(DeviceInput, input, session.deviceValues),
      disconnect: () => session.disconnect,
      energyFlow: (id: StationId) =>
        inputCall(StationId, id, session.energyFlow),
      energyHistory: (input: typeof HistoryInput.Type) =>
        inputCall(HistoryInput, input, session.energyHistory),
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
      forecast: (input: typeof ForecastInput.Type) =>
        inputCall(ForecastInput, input, session.forecast),
      gateway: (input: StationId) =>
        inputCall(StationId, input, session.gateway),
      gridDevices: (input: StationId) =>
        inputCall(StationId, input, session.gridDevices),
      gridSettings: (id: StationId) =>
        inputCall(StationId, id, session.gridSettings),
      health: () => session.health,
      manualOverride: (id: StationId) =>
        inputCall(StationId, id, session.manualOverride),
      operatingMode: (id: StationId) =>
        inputCall(StationId, id, session.operatingMode),
      operatingModes: (id: StationId) =>
        inputCall(StationId, id, session.operatingModes),
      peakShavingSchedule: (id: StationId) =>
        inputCall(StationId, id, session.peakShavingSchedule),
      report: () => session.report,
      solarSettings: (id: StationId) =>
        inputCall(StationId, id, session.solarSettings),
      station: (id: StationId) => inputCall(StationId, id, session.station),
      stationStatus: (input: StationId) =>
        inputCall(StationId, input, session.stationStatus),
      topology: (input: StationId) =>
        inputCall(StationId, input, session.topology),
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
