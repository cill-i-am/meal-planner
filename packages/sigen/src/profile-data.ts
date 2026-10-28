import { Schema } from "effect";

import type { PowerLimit } from "./settings.js";

// Empty decimal settings are unset, never zero. This boundary rejects coercions such as hexadecimal and Infinity.
export const DecimalSetting = Schema.String.check(
  Schema.isPattern(/^(?:\d+(?:\.\d+)?)?$/u)
);
const AutomationGroupResponse = {
  activeStatus: Schema.Int,
  itemVOList: Schema.Array(
    Schema.Struct({
      endTime: Schema.String,
      startTime: Schema.String,
      whichDay: Schema.String,
    })
  ).check(Schema.isMaxLength(64)),
  name: Schema.String,
  priorityList: Schema.Array(Schema.String).check(Schema.isMaxLength(32)),
  winMode: Schema.Int,
};
export const AutomationResponse = Schema.Struct({
  activeStatus: Schema.Int,
  batteryAutomationGroupVOList: Schema.Array(
    Schema.Struct({
      ...AutomationGroupResponse,
      b2GMaxDischargePower: DecimalSetting,
      chargeCutOffSoc: DecimalSetting,
      dischargeCutOffSoc: DecimalSetting,
      g2BMaxChargePower: DecimalSetting,
      maxChargePower: DecimalSetting,
      maxDischargePower: DecimalSetting,
    })
  ).check(Schema.isMaxLength(64)),
  batteryGlobalActive: Schema.Boolean,
  gridAutomationGroupVOList: Schema.Array(
    Schema.Struct({
      ...AutomationGroupResponse,
      maxBuyPower: DecimalSetting,
      maxSellPower: DecimalSetting,
    })
  ).check(Schema.isMaxLength(64)),
  gridGlobalActive: Schema.Boolean,
  name: Schema.String,
  profileId: Schema.NullOr(Schema.Int),
});
type ProviderAutomationGroup = Schema.Struct.Type<
  typeof AutomationGroupResponse
>;
export const automationGroup = (group: ProviderAutomationGroup) => ({
  name: group.name,
  providerActiveStatus: group.activeStatus,
  providerMode: group.winMode,
  sourcePriority: group.priorityList,
  windows: group.itemVOList.map((window) => ({
    endTime: window.endTime,
    providerDays: window.whichDay,
    startTime: window.startTime,
  })),
});
export const decimal = (value: string) => (value === "" ? null : Number(value));
export const powerLimit = (value: string): PowerLimit => {
  const number = decimal(value);
  if (number === null) {
    return { kind: "unset" };
  }
  if (number === 4_294_967.295) {
    return { kind: "unlimited" };
  }
  return { kind: "limited", watts: number * 1000 };
};

export const automationValues = (data: typeof AutomationResponse.Type) => ({
  batteryEnabled: data.batteryGlobalActive,
  batteryGroups: data.batteryAutomationGroupVOList.map((group) => ({
    ...automationGroup(group),
    chargeCutoffPercent: decimal(group.chargeCutOffSoc),
    chargeLimit: powerLimit(group.maxChargePower),
    dischargeCutoffPercent: decimal(group.dischargeCutOffSoc),
    dischargeLimit: powerLimit(group.maxDischargePower),
    gridChargeLimit: powerLimit(group.g2BMaxChargePower),
    gridExportLimit: powerLimit(group.b2GMaxDischargePower),
  })),
  gridEnabled: data.gridGlobalActive,
  gridGroups: data.gridAutomationGroupVOList.map((group) => ({
    ...automationGroup(group),
    exportLimit: powerLimit(group.maxSellPower),
    importLimit: powerLimit(group.maxBuyPower),
  })),
  profileName: data.name,
  providerActiveStatus: data.activeStatus,
  providerProfileId: data.profileId,
});
