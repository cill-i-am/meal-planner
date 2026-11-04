import { Effect, Schema } from "effect";
import type { Redacted } from "effect";

import { Percent, failure } from "./model.js";
import { makeProfileClient } from "./profile-client.js";
import type { ProfileConfiguration } from "./profile-controls.js";
import { decodeProvider } from "./provider-read.js";
import type { ProviderRead } from "./provider-read.js";
import { makeSettingsClient } from "./settings-client.js";
import { WritablePowerLimit } from "./settings.js";
import type { PowerLimit } from "./settings.js";

const WholePercent = Percent.check(Schema.isInt());
const GridLimit = Schema.Struct({
  enabled: Schema.Boolean,
  limit: WritablePowerLimit,
});
export const ProfileParameters = Schema.Struct({
  batteryPower: Schema.optionalKey(
    Schema.Struct({ charge: WritablePowerLimit, discharge: WritablePowerLimit })
  ),
  batterySoc: Schema.optionalKey(
    Schema.Struct({
      backupSocPercent: WholePercent,
      chargeSocPercent: WholePercent,
      dischargeSocPercent: WholePercent,
    }).check(
      Schema.makeFilter(
        (soc) =>
          soc.dischargeSocPercent <= soc.chargeSocPercent &&
          soc.backupSocPercent <= soc.chargeSocPercent
      )
    )
  ),
  gridExport: Schema.optionalKey(GridLimit),
  gridImport: Schema.optionalKey(GridLimit),
  solarLimit: Schema.optionalKey(WritablePowerLimit),
}).check(Schema.makeFilter((parameters) => Object.keys(parameters).length > 0));
export type ProfileParameters = typeof ProfileParameters.Type;

export const applyProfileParameters = (
  profile: ProfileConfiguration,
  parameters: ProfileParameters
): ProfileConfiguration => ({
  ...profile,
  ...parameters.batterySoc,
  batteryChargeLimit:
    parameters.batteryPower?.charge ?? profile.batteryChargeLimit,
  batteryDischargeLimit:
    parameters.batteryPower?.discharge ?? profile.batteryDischargeLimit,
  gridExportEnabled:
    parameters.gridExport?.enabled ?? profile.gridExportEnabled,
  gridExportLimit: parameters.gridExport?.limit ?? profile.gridExportLimit,
  gridImportEnabled:
    parameters.gridImport?.enabled ?? profile.gridImportEnabled,
  gridImportLimit: parameters.gridImport?.limit ?? profile.gridImportLimit,
  solarLimit: parameters.solarLimit ?? profile.solarLimit,
});

const validateCeiling = (
  limit: typeof WritablePowerLimit.Type,
  ceiling: typeof PowerLimit.Type
) => {
  if (ceiling.kind === "unset") {
    return failure("UnsupportedCapability");
  }
  if (
    ceiling.kind === "limited" &&
    // Whole-watt requests can meet ceilings with sub-microwatt kW conversion noise.
    (limit.kind === "unlimited" || limit.watts - ceiling.watts > 1e-6)
  ) {
    return failure("InvalidInput");
  }
  return Effect.void;
};

/** Validate both during preparation and against fresh capabilities immediately before dispatch. */
export const validateProfileParameters = (
  read: ProviderRead,
  parameters: ProfileParameters,
  profile: ProfileConfiguration,
  token: Redacted.Redacted<string>
) =>
  Effect.gen(function* validateSavedParameters() {
    const capabilities = yield* makeProfileClient(read).energyCapabilities(
      profile.stationId,
      token
    );
    const features = capabilities.providerFeatures;
    if (
      !features.support ||
      features.isIndustry ||
      ((parameters.batterySoc !== undefined ||
        parameters.batteryPower !== undefined) &&
        !features.hasBatterySetting) ||
      (parameters.batterySoc !== undefined && !features.hasBackupSetting)
    ) {
      return yield* failure("UnsupportedCapability");
    }
    const soc = parameters.batterySoc;
    if (
      soc !== undefined &&
      profile.peakShaving.providerControlMode === 1 &&
      (profile.peakShaving.reserveSocPercent > soc.chargeSocPercent ||
        profile.peakShaving.reserveSocPercent <
          Math.max(soc.backupSocPercent, soc.dischargeSocPercent))
    ) {
      return yield* failure("InvalidInput");
    }
    if (parameters.solarLimit !== undefined) {
      const station = yield* read(
        `/device/owner/station/home?stationId=${profile.stationId}`,
        token
      ).pipe(
        Effect.flatMap(
          decodeProvider(
            Schema.Struct({
              hasSolar: Schema.Boolean,
              stationId: Schema.Number,
            })
          )
        )
      );
      if (String(station.stationId) !== profile.stationId) {
        return yield* failure("PermissionDenied");
      }
      if (!station.hasSolar) {
        return yield* failure("UnsupportedCapability");
      }
    }
    if (
      parameters.gridExport !== undefined ||
      parameters.gridImport !== undefined
    ) {
      const grid = yield* makeSettingsClient(read).gridSettings(
        profile.stationId,
        token
      );
      if (parameters.gridExport !== undefined) {
        yield* validateCeiling(
          parameters.gridExport.limit,
          grid.exportPower.installer
        );
      }
      if (parameters.gridImport !== undefined) {
        yield* validateCeiling(
          parameters.gridImport.limit,
          grid.importPower.installer
        );
      }
    }
  });
