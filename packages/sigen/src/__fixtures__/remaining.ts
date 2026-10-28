/** Synthetic fixtures shaped from app 4.1.0; populated smart loads/preheating are not live acceptance. */
export const preheating = {
  isAutoModeValid: null,
  isIndustry: false,
  packPreheatingSwitch: 0,
  packPreheatingVOList: [],
  preHeatingEnablesSwitch: null,
  preheatingMode: null,
};
export const priority = {
  isGroup: false,
  loadsType: 1,
  priority: 1,
  priorityGroupList: [],
  sgDeviceType: 4,
  smartLoadsKey: null,
  smartLoadsName: "",
  smartLoadsPath: null,
  smartLoadsStatus: null,
  status: 0,
};
export const profile = {
  activeStatus: 0,
  backupSOC: "20.0",
  batteryAutomationGroupVOList: [],
  batteryDischargePriority: ["pv", "grid"],
  batteryGlobalActive: false,
  batteryMaxChargingPower: "4294967.295",
  batteryMaxDischargingPower: "3.5",
  chargeSOC: "100.0",
  dischargeSOC: "20.0",
  exportLimitation: false,
  gridAutomationGroupVOList: [],
  gridGlobalActive: false,
  importLimitation: true,
  isIndustry: false,
  maxExportLimitation: "",
  maxImportLimitation: "5.0",
  name: "Fixture profile",
  note: "Fixture description",
  packPreheatingInfoVO: preheating,
  peakShavingVO: { controlMode: 0, settingList: [], shavingSOC: 0 },
  powerLimit: "4294967.295",
  profileId: 200,
  pvPriority: [priority],
};
export const smartLoad = {
  deviceCommunicationStatus: 1,
  isControllable: true,
  loadKey: "synthetic-load",
  loadName: "Fixture load",
  loadPath: 1,
  manualSwitch: 0,
  runMode: 1,
  stationId: 12_345,
};
export const stationCapabilities = {
  hasAcCharger: false,
  hasEv: false,
  hasGateway: true,
  hasInnerGateway: false,
  hasInstantSetting: true,
  hasMeter: true,
  hasSolar: true,
  hasThirdInverter: false,
  hasVirtualBatteryFunction: false,
  stationId: 12_345,
};
export const stationList = {
  stationCount: 1,
  stationList: [
    {
      batteryCapacity: 8.1,
      pvCapacity: 5.7,
      stationId: 12_345,
      stationShowName: "Fixture station",
      stationType: 1,
      status: 2,
    },
  ],
};
export const conditions = {
  controllableLoadPath: 1,
  controllableLoadPortSupport: true,
  generatorExist: false,
  generatorPortSupport: true,
  loadHubInverterSupport: true,
};
export const templates = [
  {
    description: "Synthetic template",
    label: "Fixture template",
    mode: 9,
    profileId: 200,
  },
];
export const thirdPartyStatic = [
  {
    deviceBelongType: 1,
    deviceCommunicationStatus: null,
    hasSwitch: null,
    id: -1,
    isControllable: null,
    loadPath: null,
    name: null,
    stationId: 12_345,
    title: "GENERATOR",
    type: 1,
  },
];
export const thirdPartyDynamic = [
  {
    id: -1,
    manualSwitch: 0,
    operationMode: 1,
    startControlType: 0,
    stationId: 12_345,
    valueWithUnit: "",
  },
];
export const remainingResponses: Readonly<Record<string, unknown>> = {
  "/device/dischargesetting/packPreheating/new/12345": preheating,
  "/device/energy-profile/mode/all/12345": {
    defaultWorkingModes: [
      { label: "Time of use", value: "2" },
      { label: "Remote EMS", value: "7" },
    ],
    energyProfileItems: [{ name: "Custom", profileId: 200 }],
  },
  "/device/energy-profile/mode/all/template/12345": templates,
  "/device/energy-profile/setting/12345": profile,
  "/device/energy-profile/setting/info/12345": profile,
  "/device/owner/station/home": {
    batteryCapacity: 8.1,
    hasSolar: true,
    stationId: 12_345,
    timeZoneName: "Europe/London",
  },
  "/device/owner/station/list": stationList,
  "/device/sigen/station/baseInfoByUser": stationCapabilities,
  "/device/station/backup/12345": true,
  "/device/station/backup/power-shed/12345": false,
  "/device/system/device/condition/12345": conditions,
  "/device/system/device/home/card": [],
  "/device/tp-device/manage/card/dynamic-info": thirdPartyDynamic,
  "/device/tp-device/manage/card/static-info": thirdPartyStatic,
  "/device/tp-device/smart-loads": smartLoad,
  "/device/tp-device/smart-loads/list": [smartLoad],
};
