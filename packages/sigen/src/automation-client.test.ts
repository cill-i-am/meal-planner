import { Effect, Redacted, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { StationId } from "./model.js";
import { makeSettingsClient } from "./settings-client.js";

const id = Schema.decodeUnknownSync(StationId)("12345");
const token = Redacted.make("synthetic");
const group = {
  activeStatus: 987,
  itemVOList: [{ endTime: "05:00", startTime: "23:00", whichDay: "1,7" }],
  name: "Night",
  priorityList: ["pv", "future-source"],
  winMode: 987,
};
const battery = {
  ...group,
  b2GMaxDischargePower: "",
  chargeCutOffSoc: "100.0",
  dischargeCutOffSoc: "20.0",
  g2BMaxChargePower: "0",
  maxChargePower: "4294967.295",
  maxDischargePower: "2.5",
};
const profile = {
  activeStatus: 0,
  batteryAutomationGroupVOList: [battery],
  batteryGlobalActive: false,
  gridAutomationGroupVOList: [
    { ...group, maxBuyPower: "6.5", maxSellPower: "4294967.295" },
  ],
  gridGlobalActive: false,
  name: "sigen AI",
  profileId: null,
};
type ProviderFixture = Readonly<Record<string, unknown>>;
const fixture = (response: ProviderFixture = profile) =>
  makeSettingsClient((path) =>
    Effect.succeed(
      path.includes("/owner/station/home")
        ? { stationId: 12_345, timeZoneName: "Europe/London" }
        : response
    )
  );

describe("current profile automation settings", () => {
  it("preserves inactive groups, unfamiliar codes and cross-midnight windows while normalizing power limits", async () => {
    const result = await Effect.runPromise(
      fixture().automationSettings(id, token)
    );
    expect(result).toMatchObject({
      batteryEnabled: false,
      batteryGroups: [
        {
          chargeCutoffPercent: 100,
          chargeLimit: { kind: "unlimited" },
          dischargeCutoffPercent: 20,
          dischargeLimit: { kind: "limited", watts: 2500 },
          gridChargeLimit: { kind: "limited", watts: 0 },
          gridExportLimit: { kind: "unset" },
          providerActiveStatus: 987,
          providerMode: 987,
          sourcePriority: ["pv", "future-source"],
          windows: [
            { endTime: "05:00", providerDays: "1,7", startTime: "23:00" },
          ],
        },
      ],
      gridEnabled: false,
      gridGroups: [
        {
          exportLimit: { kind: "unlimited" },
          importLimit: { kind: "limited", watts: 6500 },
        },
      ],
      providerProfileId: null,
      timezone: "Europe/London",
    });
  });
  it.each([
    { batteryGlobalActive: "false" },
    { batteryAutomationGroupVOList: [{ ...battery, chargeCutOffSoc: "101" }] },
    { batteryAutomationGroupVOList: [{ ...battery, maxChargePower: "0x10" }] },
    {
      batteryAutomationGroupVOList: [
        {
          ...battery,
          itemVOList: [{ endTime: "24:00", startTime: "25:00", whichDay: "1" }],
        },
      ],
    },
    { batteryAutomationGroupVOList: Array.from({ length: 65 }, () => battery) },
  ])(
    "rejects malformed or unbounded provider automation data",
    async (patch) => {
      const result = await Effect.runPromise(
        fixture({ ...profile, ...patch })
          .automationSettings(id, token)
          .pipe(Effect.result)
      );
      expect(result).toMatchObject({
        _tag: "Failure",
        failure: { reason: "SchemaMismatch" },
      });
    }
  );
});
