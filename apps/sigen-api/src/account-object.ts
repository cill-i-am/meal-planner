import {
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
import { SmartLoadInput } from "@meal-planner/sigen/loads";
import { EnergyProfileInput } from "@meal-planner/sigen/profile";
import {
  RequestBudgetState,
  emptyRequestBudget,
  makeRequestBudget,
} from "@meal-planner/sigen/request-budget";
import type { RuntimeContext } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
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
  const enabledOperations = controlsEnabled ? configuredOperations : [];
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
      enabledOperations
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
      enabledOperations
    );
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
      aioDevices: (id: StationId) =>
        inputCall(StationId, id, session.aioDevices),
      aioPowerStatus: (input: typeof DeviceInput.Type) =>
        inputCall(DeviceInput, input, session.aioPowerStatus),
      alarm: () => session.onAlarm.pipe(Effect.scoped),
      alarms: (input: typeof AlarmInput.Type) =>
        inputCall(AlarmInput, input, session.alarms),
      approvalGrants: (id: StationId) =>
        inputCall(StationId, id, commands.approvalGrants),
      approveCommand: (input: typeof ApproveCommandInput.Type) =>
        inputCall(ApproveCommandInput, input, commands.approveCommand),
      automationSettings: (id: StationId) =>
        inputCall(StationId, id, session.automationSettings),
      backupEvents: (input: typeof BackupEventsInput.Type) =>
        inputCall(BackupEventsInput, input, session.backupEvents),
      backupHistory: (input: typeof BackupHistoryInput.Type) =>
        inputCall(BackupHistoryInput, input, session.backupHistory),
      batteryDischargePriority: (id: StationId) =>
        inputCall(StationId, id, session.batteryDischargePriority),
      batterySettings: (id: StationId) =>
        inputCall(StationId, id, session.batterySettings),
      deviceInfo: (input: typeof DeviceInput.Type) =>
        inputCall(DeviceInput, input, session.deviceInfo),
      deviceValues: (input: typeof DeviceInput.Type) =>
        inputCall(DeviceInput, input, session.deviceValues),
      disconnect: () => session.disconnect,
      energyCapabilities: (id: StationId) =>
        inputCall(StationId, id, session.energyCapabilities),
      energyFlow: (id: StationId) =>
        inputCall(StationId, id, session.energyFlow),
      energyHistory: (input: typeof HistoryInput.Type) =>
        inputCall(HistoryInput, input, session.energyHistory),
      energyProfile: (input: typeof EnergyProfileInput.Type) =>
        inputCall(EnergyProfileInput, input, session.energyProfile),
      energySavingSettings: (id: StationId) =>
        inputCall(StationId, id, session.energySavingSettings),
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
      executeCommand: (input: typeof CommandInput.Type) =>
        inputCall(CommandInput, input, commands.executeCommand),
      forecast: (input: typeof ForecastInput.Type) =>
        inputCall(ForecastInput, input, session.forecast),
      gateway: (input: StationId) =>
        inputCall(StationId, input, session.gateway),
      getCommand: (input: typeof CommandInput.Type) =>
        inputCall(CommandInput, input, commands.getCommand),
      gridDevices: (input: StationId) =>
        inputCall(StationId, input, session.gridDevices),
      gridSettings: (id: StationId) =>
        inputCall(StationId, id, session.gridSettings),
      health: () => session.health,
      loadCapabilities: (id: StationId) =>
        inputCall(StationId, id, session.loadCapabilities),
      manualOverride: (id: StationId) =>
        inputCall(StationId, id, session.manualOverride),
      operatingMode: (id: StationId) =>
        inputCall(StationId, id, session.operatingMode),
      operatingModes: (id: StationId) =>
        inputCall(StationId, id, session.operatingModes),
      peakShavingSchedule: (id: StationId) =>
        inputCall(StationId, id, session.peakShavingSchedule),
      predictionPlan: (id: StationId) =>
        inputCall(StationId, id, session.predictionPlan),
      preheatingSettings: (id: StationId) =>
        inputCall(StationId, id, session.preheatingSettings),
      prepareCommand: (input: typeof PrepareCommandInput.Type) =>
        inputCall(PrepareCommandInput, input, commands.prepareCommand),
      profileTemplates: (id: StationId) =>
        inputCall(StationId, id, session.profileTemplates),
      report: () => session.report,
      revokeApproval: (input: typeof RevokeApprovalInput.Type) =>
        inputCall(RevokeApprovalInput, input, commands.revokeApproval),
      smartLoad: (input: typeof SmartLoadInput.Type) =>
        inputCall(SmartLoadInput, input, session.smartLoad),
      smartLoads: (id: StationId) =>
        inputCall(StationId, id, session.smartLoads),
      solarPriority: (id: StationId) =>
        inputCall(StationId, id, session.solarPriority),
      solarSettings: (id: StationId) =>
        inputCall(StationId, id, session.solarSettings),
      station: (id: StationId) => inputCall(StationId, id, session.station),
      stationCapabilities: (id: StationId) =>
        inputCall(StationId, id, session.stationCapabilities),
      stationIncome: (input: typeof IncomeInput.Type) =>
        inputCall(IncomeInput, input, session.stationIncome),
      stationStatus: (input: StationId) =>
        inputCall(StationId, input, session.stationStatus),
      stations: (id: StationId) => inputCall(StationId, id, session.stations),
      systemCards: (id: StationId) =>
        inputCall(StationId, id, session.systemCards),
      tariffs: (id: StationId) => inputCall(StationId, id, session.tariffs),
      thirdPartyDevices: (id: StationId) =>
        inputCall(StationId, id, session.thirdPartyDevices),
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
