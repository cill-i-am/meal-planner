import { Schema } from "effect";

import { HistoryInput } from "./history.js";
import { SmartLoadInput, SmartLoad } from "./loads.js";
import { Timestamp } from "./model.js";

// Read unknown provider codes and numeric/string representations without treating them as write permissions.
export const LoadSettingValue = Schema.NullOr(
  Schema.Union([Schema.Finite, Schema.String.check(Schema.isMaxLength(64))])
);
const Days = Schema.NullOr(
  Schema.Array(Schema.Int).check(Schema.isMaxLength(7))
);
export const LoadTouWindow = Schema.Struct({
  autoCharge: LoadSettingValue,
  consumptionMode: LoadSettingValue,
  duration: LoadSettingValue,
  periodConfig: Days,
  socMode: Schema.NullOr(
    Schema.Struct({
      socLowerLimit: LoadSettingValue,
      socUpperLimit: LoadSettingValue,
    })
  ),
  startTime: LoadSettingValue,
  touEnable: LoadSettingValue,
});
export const LoadReadyWindow = Schema.Struct({
  duration: LoadSettingValue,
  endTime: LoadSettingValue,
  periodConfig: Days,
  smartSaveEnable: LoadSettingValue,
});
export const LoadAutoSettings = Schema.Struct({
  pvExcessParams: Schema.NullOr(
    Schema.Struct({
      minRunTime: LoadSettingValue,
      ratePower: LoadSettingValue,
      startPower: LoadSettingValue,
    })
  ),
  smartSavePointParamsList: Schema.NullOr(
    Schema.Array(LoadReadyWindow).check(Schema.isMaxLength(64))
  ),
  touPointParamsList: Schema.NullOr(
    Schema.Array(LoadTouWindow).check(Schema.isMaxLength(64))
  ),
});
export const LoadControlSettings = Schema.Struct({
  autoModeParams: Schema.NullOr(LoadAutoSettings),
  controlMode: Schema.NullOr(Schema.Int),
  manualModeSwitch: Schema.NullOr(Schema.Int),
});
export const LoadOffGridSettings = Schema.Struct({
  backupSoc: LoadSettingValue,
  chargeStopSoc: LoadSettingValue,
  loadOffGridSocEnable: Schema.NullOr(Schema.Int),
  loadPath: SmartLoadInput.fields.loadPath,
  offGridControlMode: Schema.NullOr(Schema.Int),
  socInThreshold: LoadSettingValue,
  socOutThreshold: LoadSettingValue,
});
export const SmartLoadControlSettings = Schema.Struct({
  load: SmartLoad,
  ...SmartLoadInput.fields,
  fetchedAt: Timestamp,
  offGrid: LoadOffGridSettings,
  onGrid: LoadControlSettings,
  timezone: Schema.String,
});
export const SmartLoadHistoryInput = Schema.Struct({
  ...HistoryInput.fields,
  loadPath: SmartLoadInput.fields.loadPath,
});
export type SmartLoadHistoryInput = typeof SmartLoadHistoryInput.Type;
export const SmartLoadConsumption = Schema.Struct({
  ...SmartLoadHistoryInput.fields,
  endDate: HistoryInput.fields.date,
  fetchedAt: Timestamp,
  lifetime: Schema.NullOr(Schema.Finite),
  month: Schema.NullOr(Schema.Finite),
  periodTotal: Schema.NullOr(Schema.Finite),
  samples: Schema.NullOr(
    Schema.Array(
      Schema.Struct({
        providerTime: Schema.NullOr(
          Schema.String.check(Schema.isMaxLength(64))
        ),
        value: Schema.NullOr(Schema.Finite),
      })
    ).check(Schema.isMaxLength(2000))
  ),
  startDate: HistoryInput.fields.date,
  timezone: Schema.String,
  today: Schema.NullOr(Schema.Finite),
  unit: Schema.Literal("provider_unit_unverified"),
});
