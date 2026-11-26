import * as Cloudflare from "@alchemy.run/cloudflare";
import {
  EnabledActiveProfileLimits,
  EnabledOperations,
  SigenFailure,
  StationId,
  failure,
} from "@meal-planner/sigen";
import { AlarmInput } from "@meal-planner/sigen/alarms";
import {
  BackupEventsInput,
  BackupHistoryInput,
} from "@meal-planner/sigen/backup";
import { ChargerInput } from "@meal-planner/sigen/charging";
import { makeSigenClientWithBudget } from "@meal-planner/sigen/client";
import {
  ApproveCommandInput,
  CommandInput,
  PrepareCommandInput,
  RevokeApprovalInput,
} from "@meal-planner/sigen/controls";
import { DeviceInput } from "@meal-planner/sigen/equipment";
import {
  HistoryInput,
  ForecastInput,
  IncomeInput,
} from "@meal-planner/sigen/history";
import { SmartLoadHistoryInput } from "@meal-planner/sigen/load-settings";
import { SmartLoadInput } from "@meal-planner/sigen/loads";
import { EnergyProfileInput } from "@meal-planner/sigen/profile";
import {
  RequestBudgetState,
  emptyRequestBudget,
  makeRequestBudget,
} from "@meal-planner/sigen/request-budget";
import type { RuntimeContext } from "alchemy";
import { Config, Effect, Layer, Redacted, Schema } from "effect";
import { FetchHttpClient, HttpClient } from "effect/http";

import { CommandBook, makeCommands } from "./commands.js";
import { SessionRecord, emptySession, makeSession } from "./session.js";
import type { SessionStorage } from "./session.js";
import type { EncryptedSecret } from "./vault.js";
import { makeVault } from "./vault.js";

const runtime = Effect.gen(function* constructAccountObject() {
  const state = yield* Cloudflare.DurableObjectState;
  const encryptionKey = yield* Config.Redacted(
    "SIGEN_SESSION_ENCRYPTION_KEY"
  ).pipe(Effect.orDie);
  const http = yield* HttpClient.HttpClient;
  const controlsEnabled = yield* Config.Boolean("SIGEN_CONTROLS_ENABLED").pipe(
    Config.withDefault(false),
    Effect.orDie
  );
  const configuredOperations = yield* Config.String(
    "SIGEN_ENABLED_OPERATIONS"
  ).pipe(
    Config.withDefault(""),
    Effect.flatMap((value) =>
      Schema.decodeUnknownEffect(EnabledOperations)(
        value === ""
          ? []
          : value.split(",").map((operation) => operation.trim())
      )
    ),
    Effect.orDie
  );
  const configuredActiveProfileLimits = yield* Config.String(
    "SIGEN_ENABLED_ACTIVE_PROFILE_LIMITS"
  ).pipe(
    Config.withDefault(""),
    Effect.flatMap((value) =>
      Schema.decodeUnknownEffect(EnabledActiveProfileLimits)(
        value === "" ? [] : value.split(",").map((scope) => scope.trim())
      )
    ),
    Effect.orDie
  );
  const enabledActiveProfileLimits =
    controlsEnabled &&
    configuredOperations.includes("set_active_energy_profile_limits")
      ? configuredActiveProfileLimits
      : [];
  const enabledOperations = controlsEnabled
    ? configuredOperations.filter(
        (operation) =>
          operation !== "set_active_energy_profile_limits" ||
          enabledActiveProfileLimits.length > 0
      )
    : [];
  return Effect.gen(function* initializeAccount() {
    const context = yield* Effect.context<RuntimeContext>();
    const budget = yield* makeRequestBudget({
      read: state.storage.get<unknown>("sigen-request-budget-v1").pipe(
        Effect.flatMap((value) =>
          value === undefined
            ? Effect.succeed(emptyRequestBudget)
            : Schema.decodeUnknownEffect(RequestBudgetState)(value)
        ),
        Effect.mapError(() => failure("StorageUnavailable")),
        Effect.provide(context)
      ),
      write: (value) =>
        state.storage.put("sigen-request-budget-v1", value).pipe(
          Effect.mapError(() => failure("StorageUnavailable")),
          Effect.provide(context)
        ),
    });
    const client = yield* makeSigenClientWithBudget(budget).pipe(
      Effect.provideService(HttpClient.HttpClient, http)
    );

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
    const session = yield* makeSession(
      storage,
      encryptionKey,
      client,
      enabledOperations,
      enabledActiveProfileLimits
    );
    const commands = makeCommands<RuntimeContext>(
      {
        read: state.storage.get<unknown>("sigen-commands-v1").pipe(
          Effect.flatMap((value) =>
            value === undefined
              ? Effect.succeed(null)
              : Schema.decodeUnknownEffect(CommandBook)(value)
          ),
          Effect.mapError(() => failure("StorageUnavailable"))
        ),
        write: (book) =>
          state.storage
            .put("sigen-commands-v1", book)
            .pipe(Effect.mapError(() => failure("StorageUnavailable"))),
      },
      { run: session.withConnection },
      client,
      enabledOperations,
      enabledActiveProfileLimits
    );
    const vault = makeVault(encryptionKey);
    const validatedRpc =
      <S extends Schema.Top, A>(
        schema: S,
        call: (id: S["Type"]) => Effect.Effect<A, SigenFailure, RuntimeContext>
      ) =>
      (input: S["Type"]) =>
        Schema.decodeUnknownEffect(schema)(input).pipe(
          Effect.mapError(() => failure("InvalidInput")),
          Effect.flatMap(call),
          Effect.scoped
        );
    const controlRpc = {
      prepareCommand: validatedRpc(
        PrepareCommandInput,
        commands.prepareCommand
      ),
      approveCommand: validatedRpc(
        ApproveCommandInput,
        commands.approveCommand
      ),
      executeCommand: validatedRpc(CommandInput, commands.executeCommand),
      getCommand: validatedRpc(CommandInput, commands.getCommand),
      approvalGrants: validatedRpc(StationId, commands.approvalGrants),
      revokeApproval: validatedRpc(
        RevokeApprovalInput,
        commands.revokeApproval
      ),
    };
    return {
      ...controlRpc,
      acChargerCurrent: validatedRpc(ChargerInput, session.acChargerCurrent),
      acChargerSettings: validatedRpc(ChargerInput, session.acChargerSettings),
      aioDevices: validatedRpc(StationId, session.aioDevices),
      aioPowerStatus: validatedRpc(DeviceInput, session.aioPowerStatus),
      alarm: () => session.onAlarm.pipe(Effect.scoped),
      alarms: validatedRpc(AlarmInput, session.alarms),
      automationSettings: validatedRpc(StationId, session.automationSettings),
      backupEvents: validatedRpc(BackupEventsInput, session.backupEvents),
      backupHistory: validatedRpc(BackupHistoryInput, session.backupHistory),
      batteryDischargePriority: validatedRpc(
        StationId,
        session.batteryDischargePriority
      ),
      batterySettings: validatedRpc(StationId, session.batterySettings),
      chargerSchedules: validatedRpc(ChargerInput, session.chargerSchedules),
      chargerStatus: validatedRpc(ChargerInput, session.chargerStatus),
      chargers: validatedRpc(StationId, session.chargers),
      dcChargerSettings: validatedRpc(ChargerInput, session.dcChargerSettings),
      deviceInfo: validatedRpc(DeviceInput, session.deviceInfo),
      deviceValues: validatedRpc(DeviceInput, session.deviceValues),
      disconnect: () => session.disconnect,
      energyCapabilities: validatedRpc(StationId, session.energyCapabilities),
      energyFlow: validatedRpc(StationId, session.energyFlow),
      energyHistory: validatedRpc(HistoryInput, session.energyHistory),
      energyProfile: validatedRpc(EnergyProfileInput, session.energyProfile),
      energySavingSettings: validatedRpc(
        StationId,
        session.energySavingSettings
      ),
      enroll: (input: EncryptedSecret) =>
        Effect.gen(function* enrollAccount() {
          const secret = yield* vault.decrypt(input);
          const value = Redacted.value(secret);

          if (value.kind !== "enrollment") {
            return yield* failure("InvalidInput");
          }
          return yield* session.enroll(Redacted.make(value.value));
        }).pipe(Effect.scoped),
      forecast: validatedRpc(ForecastInput, session.forecast),
      gateway: validatedRpc(StationId, session.gateway),
      gridDevices: validatedRpc(StationId, session.gridDevices),
      gridSettings: validatedRpc(StationId, session.gridSettings),
      health: () => session.health,
      loadCapabilities: validatedRpc(StationId, session.loadCapabilities),
      manualOverride: validatedRpc(StationId, session.manualOverride),
      operatingMode: validatedRpc(StationId, session.operatingMode),
      operatingModes: validatedRpc(StationId, session.operatingModes),
      peakShavingSchedule: validatedRpc(StationId, session.peakShavingSchedule),
      predictionPlan: validatedRpc(StationId, session.predictionPlan),
      preheatingSettings: validatedRpc(StationId, session.preheatingSettings),
      profileTemplates: validatedRpc(StationId, session.profileTemplates),
      report: () => session.report,
      smartLoad: validatedRpc(SmartLoadInput, session.smartLoad),
      smartLoadConsumption: validatedRpc(
        SmartLoadHistoryInput,
        session.smartLoadConsumption
      ),
      smartLoadControlSettings: validatedRpc(
        SmartLoadInput,
        session.smartLoadControlSettings
      ),
      smartLoads: validatedRpc(StationId, session.smartLoads),
      solarPriority: validatedRpc(StationId, session.solarPriority),
      solarSettings: validatedRpc(StationId, session.solarSettings),
      station: validatedRpc(StationId, session.station),
      stationCapabilities: validatedRpc(StationId, session.stationCapabilities),
      stationConsumption: validatedRpc(
        HistoryInput,
        session.stationConsumption
      ),
      stationIncome: validatedRpc(IncomeInput, session.stationIncome),
      stationStatus: validatedRpc(StationId, session.stationStatus),
      stations: validatedRpc(StationId, session.stations),
      systemCards: validatedRpc(StationId, session.systemCards),
      tariffs: validatedRpc(StationId, session.tariffs),
      thirdPartyDevices: validatedRpc(StationId, session.thirdPartyDevices),
      timeOfUseSettings: validatedRpc(StationId, session.timeOfUseSettings),
      topology: validatedRpc(StationId, session.topology),
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
