import type { Redacted } from "effect";

import type { ProviderWrite } from "./controls-client.js";
import type { StationId } from "./model.js";
import type { WritablePowerLimit } from "./settings.js";

type Token = Redacted.Redacted<string>;
type Limit = typeof WritablePowerLimit.Type;

export const powerString = (limit: Limit) =>
  limit.kind === "unlimited" ? "4294967.295" : String(limit.watts / 1000);

export const writeBatteryPower = (
  write: ProviderWrite,
  stationId: StationId,
  settings: { readonly charge: Limit; readonly discharge: Limit },
  token: Token
) =>
  write(
    "PUT",
    "/device/energy-profile/battery/limit",
    {
      batteryMaxChargingPower: powerString(settings.charge),
      batteryMaxDischargingPower: powerString(settings.discharge),
      stationId: Number(stationId),
    },
    token
  );

export const writeBatteryThresholds = (
  write: ProviderWrite,
  stationId: StationId,
  settings: {
    readonly backupSocPercent: number;
    readonly chargeSocPercent: number;
    readonly dischargeSocPercent: number;
    readonly peakShavingSocPercent: number | null;
  },
  token: Token
) =>
  write(
    "PUT",
    "/device/energy-profile/battery/level",
    {
      backupSOC: String(settings.backupSocPercent),
      chargeSOC: String(settings.chargeSocPercent),
      dischargeSOC: String(settings.dischargeSocPercent),
      peakShavingSOC:
        settings.peakShavingSocPercent === null
          ? null
          : String(settings.peakShavingSocPercent),
      stationId: Number(stationId),
    },
    token
  );

export const writeSolarPower = (
  write: ProviderWrite,
  stationId: StationId,
  limit: Limit,
  token: Token
) =>
  write(
    "PUT",
    "/device/energy-profile/solar/limit",
    { powerLimit: powerString(limit), stationId: Number(stationId) },
    token
  );

export const writeGridPower = (
  write: ProviderWrite,
  stationId: StationId,
  direction: "import" | "export",
  watts: number,
  token: Token
) =>
  write(
    "PUT",
    `/device/energy-profile/grid/limitation/${direction}`,
    {
      enable: true,
      maxLimitationInstaller: null,
      maxLimitationOwner: String(watts / 1000),
      stationId: Number(stationId),
    },
    token
  );
