import {
  ConnectionStatus,
  EmptyInput,
  EnergyFlow,
  OperatingMode,
  Station,
  StationInput,
  failure,
} from "@meal-planner/sigen";
import type { SigenFailure, StationId } from "@meal-planner/sigen";
import { AlarmInput, Alarms } from "@meal-planner/sigen/alarms";
import {
  BackupEvents,
  BackupEventsInput,
  BackupHistory,
  BackupHistoryInput,
} from "@meal-planner/sigen/backup";
import {
  ApprovalGrants,
  ApproveCommandInput,
  Command,
  CommandInput,
  PrepareCommandInput,
  RevokeApprovalInput,
} from "@meal-planner/sigen/controls";
import {
  AioDevices,
  AioPowerStatus,
  DeviceInput,
  DeviceInfo,
  DeviceValues,
  Gateway,
  GridDevices,
  StationStatus,
  Topology,
} from "@meal-planner/sigen/equipment";
import {
  IncomeInput,
  StationIncome,
  EnergyHistory,
  Forecast,
  HistoryInput,
  ForecastInput,
} from "@meal-planner/sigen/history";
import {
  LoadCapabilities,
  SmartLoadInput,
  SmartLoadState,
  SmartLoads,
  SystemCards,
} from "@meal-planner/sigen/loads";
import { PreheatingSettings } from "@meal-planner/sigen/preheating";
import {
  BatteryDischargePriority,
  EnergyCapabilities,
  EnergyProfile,
  EnergyProfileInput,
  ProfileTemplates,
  SolarPriority,
} from "@meal-planner/sigen/profile";
import {
  EnergySavingSettings,
  AutomationSettings,
  BatterySettings,
  GridSettings,
  SolarSettings,
  OperatingModes,
  PeakShavingSchedule,
  ManualOverride,
} from "@meal-planner/sigen/settings";
import { StationCapabilities, Stations } from "@meal-planner/sigen/stations";
import { Tariffs, PredictionPlan } from "@meal-planner/sigen/tariffs";
import { ThirdPartyDevices } from "@meal-planner/sigen/third-party";
import { Context, Effect, Schema, flow } from "effect";

export class SigenCapabilities extends Context.Service<
  SigenCapabilities,
  {
    readonly stations: (
      id: StationId
    ) => Effect.Effect<typeof Stations.Type, SigenFailure>;
    readonly stationCapabilities: (
      id: StationId
    ) => Effect.Effect<typeof StationCapabilities.Type, SigenFailure>;
    readonly profileTemplates: (
      id: StationId
    ) => Effect.Effect<typeof ProfileTemplates.Type, SigenFailure>;
    readonly energyProfile: (
      input: typeof EnergyProfileInput.Type
    ) => Effect.Effect<typeof EnergyProfile.Type, SigenFailure>;
    readonly solarPriority: (
      id: StationId
    ) => Effect.Effect<typeof SolarPriority.Type, SigenFailure>;
    readonly smartLoads: (
      id: StationId
    ) => Effect.Effect<typeof SmartLoads.Type, SigenFailure>;
    readonly smartLoad: (
      input: typeof SmartLoadInput.Type
    ) => Effect.Effect<typeof SmartLoadState.Type, SigenFailure>;
    readonly loadCapabilities: (
      id: StationId
    ) => Effect.Effect<typeof LoadCapabilities.Type, SigenFailure>;
    readonly systemCards: (
      id: StationId
    ) => Effect.Effect<typeof SystemCards.Type, SigenFailure>;
    readonly preheatingSettings: (
      id: StationId
    ) => Effect.Effect<typeof PreheatingSettings.Type, SigenFailure>;
    readonly thirdPartyDevices: (
      id: StationId
    ) => Effect.Effect<typeof ThirdPartyDevices.Type, SigenFailure>;
    readonly backupEvents: (
      input: typeof BackupEventsInput.Type
    ) => Effect.Effect<typeof BackupEvents.Type, SigenFailure>;
    readonly batteryDischargePriority: (
      id: StationId
    ) => Effect.Effect<typeof BatteryDischargePriority.Type, SigenFailure>;
    readonly energyCapabilities: (
      id: StationId
    ) => Effect.Effect<typeof EnergyCapabilities.Type, SigenFailure>;
    readonly backupHistory: (
      input: typeof BackupHistoryInput.Type
    ) => Effect.Effect<typeof BackupHistory.Type, SigenFailure>;
    readonly energySavingSettings: (
      id: StationId
    ) => Effect.Effect<typeof EnergySavingSettings.Type, SigenFailure>;
    readonly aioDevices: (
      id: StationId
    ) => Effect.Effect<typeof AioDevices.Type, SigenFailure>;
    readonly aioPowerStatus: (
      input: typeof DeviceInput.Type
    ) => Effect.Effect<typeof AioPowerStatus.Type, SigenFailure>;
    readonly tariffs: (
      id: StationId
    ) => Effect.Effect<typeof Tariffs.Type, SigenFailure>;
    readonly predictionPlan: (
      id: StationId
    ) => Effect.Effect<typeof PredictionPlan.Type, SigenFailure>;
    readonly prepareCommand: (
      input: typeof PrepareCommandInput.Type
    ) => Effect.Effect<typeof Command.Type, SigenFailure>;
    readonly approveCommand: (
      input: typeof ApproveCommandInput.Type
    ) => Effect.Effect<typeof Command.Type, SigenFailure>;
    readonly executeCommand: (
      input: typeof CommandInput.Type
    ) => Effect.Effect<typeof Command.Type, SigenFailure>;
    readonly getCommand: (
      input: typeof CommandInput.Type
    ) => Effect.Effect<typeof Command.Type, SigenFailure>;
    readonly approvalGrants: (
      id: StationId
    ) => Effect.Effect<typeof ApprovalGrants.Type, SigenFailure>;
    readonly revokeApproval: (
      input: typeof RevokeApprovalInput.Type
    ) => Effect.Effect<typeof ApprovalGrants.Type, SigenFailure>;
    readonly automationSettings: (
      id: StationId
    ) => Effect.Effect<typeof AutomationSettings.Type, SigenFailure>;
    readonly batterySettings: (
      id: StationId
    ) => Effect.Effect<typeof BatterySettings.Type, SigenFailure>;
    readonly gridSettings: (
      id: StationId
    ) => Effect.Effect<typeof GridSettings.Type, SigenFailure>;
    readonly solarSettings: (
      id: StationId
    ) => Effect.Effect<typeof SolarSettings.Type, SigenFailure>;
    readonly operatingModes: (
      id: StationId
    ) => Effect.Effect<typeof OperatingModes.Type, SigenFailure>;
    readonly peakShavingSchedule: (
      id: StationId
    ) => Effect.Effect<typeof PeakShavingSchedule.Type, SigenFailure>;
    readonly manualOverride: (
      id: StationId
    ) => Effect.Effect<typeof ManualOverride.Type, SigenFailure>;
    readonly topology: (
      input: StationId
    ) => Effect.Effect<typeof Topology.Type, SigenFailure>;
    readonly stationStatus: (
      input: StationId
    ) => Effect.Effect<typeof StationStatus.Type, SigenFailure>;
    readonly gateway: (
      input: StationId
    ) => Effect.Effect<typeof Gateway.Type, SigenFailure>;
    readonly gridDevices: (
      input: StationId
    ) => Effect.Effect<typeof GridDevices.Type, SigenFailure>;
    readonly deviceInfo: (
      input: typeof DeviceInput.Type
    ) => Effect.Effect<typeof DeviceInfo.Type, SigenFailure>;
    readonly deviceValues: (
      input: typeof DeviceInput.Type
    ) => Effect.Effect<typeof DeviceValues.Type, SigenFailure>;
    readonly alarms: (
      input: typeof AlarmInput.Type
    ) => Effect.Effect<typeof Alarms.Type, SigenFailure>;
    readonly stationIncome: (
      input: typeof IncomeInput.Type
    ) => Effect.Effect<typeof StationIncome.Type, SigenFailure>;
    readonly energyHistory: (
      input: typeof HistoryInput.Type
    ) => Effect.Effect<typeof EnergyHistory.Type, SigenFailure>;
    readonly forecast: (
      input: typeof ForecastInput.Type
    ) => Effect.Effect<typeof Forecast.Type, SigenFailure>;
    readonly health: Effect.Effect<typeof ConnectionStatus.Type, SigenFailure>;
    readonly station: (
      id: StationId
    ) => Effect.Effect<typeof Station.Type, SigenFailure>;
    readonly energyFlow: (
      id: StationId
    ) => Effect.Effect<typeof EnergyFlow.Type, SigenFailure>;
    readonly operatingMode: (
      id: StationId
    ) => Effect.Effect<typeof OperatingMode.Type, SigenFailure>;
  }
>()("SigenCapabilities") {}

const operation = <
  I extends Schema.Codec<unknown, unknown>,
  O extends Schema.Codec<unknown, Readonly<Record<string, Schema.Json>>>,
>(
  name: string,
  description: string,
  input: I,
  output: O,
  run: (
    value: I["Type"]
  ) => Effect.Effect<O["Type"], SigenFailure, SigenCapabilities>,
  readOnly = true
) => ({
  description,
  execute: flow(
    Schema.decodeUnknownEffect(input, { onExcessProperty: "error" }),
    Effect.mapError(() => failure("InvalidInput")),
    Effect.flatMap(
      (
        value
      ): Effect.Effect<
        Readonly<Record<string, Schema.Json>>,
        SigenFailure,
        SigenCapabilities
      > =>
        run(value).pipe(
          Effect.flatMap((result) =>
            Schema.encodeUnknownEffect(output)(result).pipe(
              Effect.mapError(() => failure("SchemaMismatch"))
            )
          )
        )
    )
  ),
  input,
  name,
  output,
  readOnly,
});

export const operations = [
  operation(
    "list_third_party_devices",
    "Read third-party device cards with explicit placeholders and missing telemetry. A generator placeholder is not installed equipment. Account/contact fields and serials are omitted.",
    StationInput,
    ThirdPartyDevices,
    (input) =>
      SigenCapabilities.use((service) =>
        service.thirdPartyDevices(input.stationId)
      )
  ),
  operation(
    "get_preheating_settings",
    "Read battery preheating configuration, preserving provider values and null capability fields. Schedule units and day codes remain unverified; this does not change preheating.",
    StationInput,
    PreheatingSettings,
    (input) =>
      SigenCapabilities.use((service) =>
        service.preheatingSettings(input.stationId)
      )
  ),
  operation(
    "get_system_cards",
    "Read app system-device cards, preserving display values and provider codes without inferring metric units.",
    StationInput,
    SystemCards,
    (input) =>
      SigenCapabilities.use((service) => service.systemCards(input.stationId))
  ),
  operation(
    "get_load_capabilities",
    "Read smart-load and generator-port capabilities, distinguishing a supported port from installed equipment.",
    StationInput,
    LoadCapabilities,
    (input) =>
      SigenCapabilities.use((service) =>
        service.loadCapabilities(input.stationId)
      )
  ),
  operation(
    "get_smart_load",
    "Read smart-load identity, manual switch and run mode after verifying station membership. This summary does not expose schedules. Unknown provider codes remain explicit.",
    SmartLoadInput,
    SmartLoadState,
    (input) => SigenCapabilities.use((service) => service.smartLoad(input))
  ),
  operation(
    "list_smart_loads",
    "List smart loads belonging to the enrolled station. An empty list means no configured loads, not proof of working smart-load controls.",
    StationInput,
    SmartLoads,
    (input) =>
      SigenCapabilities.use((service) => service.smartLoads(input.stationId))
  ),
  operation(
    "get_solar_priority",
    "Read solar priorities from the current profile. Preserve group nesting, provider order and unknown status/type codes.",
    StationInput,
    SolarPriority,
    (input) =>
      SigenCapabilities.use((service) => service.solarPriority(input.stationId))
  ),
  operation(
    "get_energy_profile",
    "Read the current profile or a membership-verified custom profile/template, with automation groups, limits and priority order. No settings are changed.",
    EnergyProfileInput,
    EnergyProfile,
    (input) => SigenCapabilities.use((service) => service.energyProfile(input))
  ),
  operation(
    "list_profile_templates",
    "List provider energy profile templates and their mode/profile identifiers without creating or activating them.",
    StationInput,
    ProfileTemplates,
    (input) =>
      SigenCapabilities.use((service) =>
        service.profileTemplates(input.stationId)
      )
  ),
  operation(
    "get_station_capabilities",
    "Read owner station capability flags and backup support. The provider EV flag is preserved without inferring a DC charger; get_station reports DC serial availability.",
    StationInput,
    StationCapabilities,
    (input) =>
      SigenCapabilities.use((service) =>
        service.stationCapabilities(input.stationId)
      )
  ),
  operation(
    "list_stations",
    "List accessible owner stations and mark the enrolled station. Enumeration does not enroll or authorize another station.",
    StationInput,
    Stations,
    (input) =>
      SigenCapabilities.use((service) => service.stations(input.stationId))
  ),
  operation(
    "list_backup_events",
    "Read one ten-event page from the Backup Event Center using inclusive station-local dates spanning at most 31 days. Preserves duplicate events, provider type/reason codes and original measurement labels/values without inferring outage causes. Second-precision timestamps retain all DST candidates. Unverified multi-phase or extra-device details return UnsupportedCapability.",
    BackupEventsInput,
    BackupEvents,
    (input) => SigenCapabilities.use((service) => service.backupEvents(input))
  ),
  operation(
    "get_energy_capabilities",
    "Read the app-reported energy-profile feature flags, battery/grid source options and EMS upgrade support. Availability flags do not authorize changes or imply configured automations are active; false stays false.",
    StationInput,
    EnergyCapabilities,
    (input) =>
      SigenCapabilities.use((service) =>
        service.energyCapabilities(input.stationId)
      )
  ),
  operation(
    "get_battery_discharge_priority",
    "Read the provider's battery-discharge priority list in its original order. Source codes are preserved, including unfamiliar values; this does not change priorities or infer the current power flow.",
    StationInput,
    BatteryDischargePriority,
    (input) =>
      SigenCapabilities.use((service) =>
        service.batteryDischargePriority(input.stationId)
      )
  ),
  operation(
    "get_backup_history",
    "Read paginated off-grid operation history with durations and the current page duration in seconds. The total event count spans all pages. Event times retain the station timezone and all possible UTC instants across DST. These events do not by themselves prove a mains outage.",
    BackupHistoryInput,
    BackupHistory,
    (input) => SigenCapabilities.use((service) => service.backupHistory(input))
  ),
  operation(
    "get_energy_saving_settings",
    "Read station energy-saving settings, preserving on-grid/off-grid provider mode codes and the provider value without guessing their meaning. This does not change battery dormancy.",
    StationInput,
    EnergySavingSettings,
    (input) =>
      SigenCapabilities.use((service) =>
        service.energySavingSettings(input.stationId)
      )
  ),
  operation(
    "get_automation_settings",
    "Read the current station profile battery/grid automation groups, watt limits, SOC cutoffs and local-time windows. Preserve provider mode/status/day/source codes; configured inactive groups are not active policies. This does not enumerate or edit custom profiles.",
    StationInput,
    AutomationSettings,
    (input) =>
      SigenCapabilities.use((service) =>
        service.automationSettings(input.stationId)
      )
  ),
  operation(
    "get_station_income",
    "Read provider-reported daily energy value in the station currency. Retains signed income, calculated income and provider totals separately; these are not verified bill settlements. Dates use the station timezone, missing samples stay missing and repeated DST minutes retain both UTC candidates.",
    IncomeInput,
    StationIncome,
    (input) => SigenCapabilities.use((service) => service.stationIncome(input))
  ),
  operation(
    "list_aio_devices",
    "List SigenStor AIO serials verified against the enrolled station topology.",
    StationInput,
    AioDevices,
    (input) =>
      SigenCapabilities.use((service) => service.aioDevices(input.stationId))
  ),
  operation(
    "get_aio_power_status",
    "Read both AIO power-status observations for a topology-verified serial. Disagreement remains explicit; this does not switch or restart equipment.",
    DeviceInput,
    AioPowerStatus,
    (input) => SigenCapabilities.use((service) => service.aioPowerStatus(input))
  ),
  operation(
    "get_tariffs",
    "Read buy/sell tax and fee settings and derived price coefficients. Provider fee units remain unverified; do not treat them as major currency amounts.",
    StationInput,
    Tariffs,
    (input) =>
      SigenCapabilities.use((service) => service.tariffs(input.stationId))
  ),
  operation(
    "get_prediction_plan",
    "Read mixed actual load, AI plan and price series. Power is watts, SOC percent, prices major currency per kWh. UTC timestamps are authoritative; local labels and timezone are preserved. This is not wholly measured telemetry or wholly a forecast.",
    StationInput,
    PredictionPlan,
    (input) =>
      SigenCapabilities.use((service) =>
        service.predictionPlan(input.stationId)
      )
  ),
  operation(
    "prepare_command",
    "Prepare an immutable five-minute review without changing equipment. Use a fresh UUID commandId; repeated IDs return the saved command, altered inputs conflict. An existing always-approve grant authorizes this operation and station/device.",
    PrepareCommandInput,
    Command,
    (input) =>
      SigenCapabilities.use((service) => service.prepareCommand(input)),
    false
  ),
  operation(
    "approve_command",
    "Approve the exact saved review: once for this command, or always for this operation and station/device until revoked. Copy change, current and reviewFingerprint exactly from prepare_command. Always approval permits future parameters within the same validated operation; it is not limited to today's values. Smart-load grants bind both load key and path. Does not dispatch equipment changes.",
    ApproveCommandInput,
    Command,
    (input) =>
      SigenCapabilities.use((service) => service.approveCommand(input)),
    false
  ),
  operation(
    "execute_command",
    "Execute a saved approved command once, after rechecking configuration. A repeated call only returns or reconciles the existing outcome; it never resends a mutation. Verified means desired settings were observed. Requires controls enabled.",
    CommandInput,
    Command,
    (input) =>
      SigenCapabilities.use((service) => service.executeCommand(input)),
    false
  ),
  operation(
    "get_command",
    "Inspect a saved command review and receipt without dispatching it.",
    CommandInput,
    Command,
    (input) => SigenCapabilities.use((service) => service.getCommand(input))
  ),
  operation(
    "list_approval_grants",
    "List revocable always-approve permissions for this station. Each permission covers one operation, including future validated values.",
    StationInput,
    ApprovalGrants,
    (input) =>
      SigenCapabilities.use((service) =>
        service.approvalGrants(input.stationId)
      )
  ),
  operation(
    "revoke_approval_grant",
    "Revoke a remembered operation approval. Previously prepared commands using this grant can no longer dispatch; one-time approvals are unaffected.",
    RevokeApprovalInput,
    ApprovalGrants,
    (input) =>
      SigenCapabilities.use((service) => service.revokeApproval(input)),
    false
  ),
  operation(
    "connection_status",
    "Inspect connection health and renewal count. Credentials are never returned.",
    EmptyInput,
    ConnectionStatus,
    () => SigenCapabilities.use((service) => service.health)
  ),
  operation(
    "get_station",
    "Read the explicitly enrolled station and its equipment capabilities.",
    StationInput,
    Station,
    (input) =>
      SigenCapabilities.use((service) => service.station(input.stationId))
  ),
  operation(
    "get_energy_flow",
    "Read power in watts and battery SOC. Empty provider timestamps mean unknown freshness; fetch time does not prove device freshness.",
    StationInput,
    EnergyFlow,
    (input) =>
      SigenCapabilities.use((service) => service.energyFlow(input.stationId))
  ),
  operation(
    "get_operating_mode",
    "Read the provider mode and profile IDs, preserving unfamiliar modes.",
    StationInput,
    OperatingMode,
    (input) =>
      SigenCapabilities.use((service) => service.operatingMode(input.stationId))
  ),
  operation(
    "get_battery_settings",
    "Read battery reserves, SOC thresholds, power limits and export permission. Unset and unlimited limits are distinct.",
    StationInput,
    BatterySettings,
    (input) =>
      SigenCapabilities.use((service) =>
        service.batterySettings(input.stationId)
      )
  ),
  operation(
    "get_grid_settings",
    "Read import/export power limits in watts and grid connection limits in amperes.",
    StationInput,
    GridSettings,
    (input) =>
      SigenCapabilities.use((service) => service.gridSettings(input.stationId))
  ),
  operation(
    "get_solar_settings",
    "Read the solar power limit, including unset and unlimited states.",
    StationInput,
    SolarSettings,
    (input) =>
      SigenCapabilities.use((service) => service.solarSettings(input.stationId))
  ),
  operation(
    "list_operating_modes",
    "List provider operating modes and custom profile identifiers, preserving unfamiliar values.",
    StationInput,
    OperatingModes,
    (input) =>
      SigenCapabilities.use((service) =>
        service.operatingModes(input.stationId)
      )
  ),
  operation(
    "get_peak_shaving_schedule",
    "Read peak-shaving slots in provider local time, retaining provider day codes and cross-midnight intervals.",
    StationInput,
    PeakShavingSchedule,
    (input) =>
      SigenCapabilities.use((service) =>
        service.peakShavingSchedule(input.stationId)
      )
  ),
  operation(
    "get_manual_override",
    "Read temporary manual-control state and battery display. The enabled flag determines whether the override is active.",
    StationInput,
    ManualOverride,
    (input) =>
      SigenCapabilities.use((service) =>
        service.manualOverride(input.stationId)
      )
  ),
  operation(
    "get_topology",
    "Read the enrolled station equipment tree, preserving unknown device and status codes.",
    StationInput,
    Topology,
    (input) =>
      SigenCapabilities.use((service) => service.topology(input.stationId))
  ),
  operation(
    "get_station_status",
    "Read station and device communication status.",
    StationInput,
    StationStatus,
    (input) =>
      SigenCapabilities.use((service) => service.stationStatus(input.stationId))
  ),
  operation(
    "get_gateway",
    "Read gateway electrical display parameters and units. Requires gateway hardware.",
    StationInput,
    Gateway,
    (input) =>
      SigenCapabilities.use((service) => service.gateway(input.stationId))
  ),
  operation(
    "list_grid_devices",
    "List the station grid connection point devices.",
    StationInput,
    GridDevices,
    (input) =>
      SigenCapabilities.use((service) => service.gridDevices(input.stationId))
  ),
  operation(
    "get_device_info",
    "Read static and real-time display parameters for a serial verified against station topology. Provider display labels are not stable metric identifiers.",
    DeviceInput,
    DeviceInfo,
    (input) => SigenCapabilities.use((service) => service.deviceInfo(input))
  ),
  operation(
    "get_device_values",
    "Read AIO child-device values. Inverter power is watts, battery state is percent; unknown device types remain uninterpreted.",
    DeviceInput,
    DeviceValues,
    (input) => SigenCapabilities.use((service) => service.deviceValues(input))
  ),
  operation(
    "list_alarms",
    "Read one page of active or historical alarms. Historical ranges use inclusive UTC milliseconds and span at most 31 days. Severity codes are preserved.",
    AlarmInput,
    Alarms,
    (input) => SigenCapabilities.use((service) => service.alarms(input))
  ),
  operation(
    "get_energy_history",
    "Read power samples for a day or energy by day/month for a week, month or year. Dates use the station timezone. UTC candidate lists preserve DST ambiguity; missing samples are not filled.",
    HistoryInput,
    EnergyHistory,
    (input) => SigenCapabilities.use((service) => service.energyHistory(input))
  ),
  operation(
    "get_forecast",
    "Read provider forecast series for a day, week or month. Keep SOC percentages, power and energy units distinct; unknown series remain uninterpreted.",
    ForecastInput,
    Forecast,
    (input) => SigenCapabilities.use((service) => service.forecast(input))
  ),
];

export const jsonSchema = (schema: Schema.Top) => {
  const doc = Schema.toJsonSchemaDocument(schema);
  return { ...doc.schema, $defs: doc.definitions };
};
export const openApi = {
  components: {
    securitySchemes: { owner: { scheme: "bearer", type: "http" } },
  },
  info: { title: "Private mySigen API", version: "0.1.0" },
  openapi: "3.1.0",
  paths: Object.fromEntries(
    operations.map((op) => [
      `/v1/${op.name}`,
      {
        post: {
          description: op.description,
          operationId: op.name,
          requestBody: {
            content: { "application/json": { schema: jsonSchema(op.input) } },
            required: true,
          },
          responses: {
            "200": {
              content: {
                "application/json": { schema: jsonSchema(op.output) },
              },
              description: "Verified response contract",
            },
            "400": { description: "Invalid input" },
            "401": { description: "Client authentication required" },
            "403": {
              description: "Permission denied or browser origin refused",
            },
            "409": {
              description: "Approval required or saved command conflict",
            },
            "429": { description: "Rate limited" },
            "503": {
              description: "Provider failure or reauthentication required",
            },
          },
        },
      },
    ])
  ),
  security: [{ owner: [] }],
};
