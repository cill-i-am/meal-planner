import { Effect, Redacted, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { StationId } from "./model.js";
import { makeProfileClient } from "./profile-client.js";

const id = Schema.decodeUnknownSync(StationId)("12345");
const token = Redacted.make("fixture");
const support = {
  batteryPriorityItem: ["pv", "grid"],
  gridPriorityItem: ["pv", "battery"],
  hasBackupSetting: true,
  hasBatteryAutomation: false,
  hasBatteryPriority: false,
  hasBatterySetting: true,
  hasEVACSetting: false,
  hasEVDCSetting: false,
  hasGridAutomation: false,
  hasGridPriority: false,
  hasPVPriority: true,
  isIndustry: false,
  support: true,
  supportFreePowerOptimization: false,
  supportZeroFeedInControl: false,
};
type ResponseFixture = Readonly<Record<string, unknown>>;
const fixture = (
  data: ResponseFixture = support,
  ems: boolean | string = true
) => {
  const paths: string[] = [];
  return {
    client: makeProfileClient((path, access) => {
      expect(Redacted.value(access)).toBe("fixture");
      paths.push(path);
      return Effect.succeed(path.includes("upgradeEms") ? ems : data);
    }),
    paths,
  };
};
describe("energy profile capabilities and source priority", () => {
  it("preserves unavailable feature flags and does not treat available EMS upgrades as an action", async () => {
    const f = fixture();
    expect(
      await Effect.runPromise(f.client.energyCapabilities(id, token))
    ).toMatchObject({
      batterySourceOptions: ["pv", "grid"],
      emsUpgradeSupported: true,
      gridSourceOptions: ["pv", "battery"],
      providerFeatures: {
        hasBatteryAutomation: false,
        hasBatterySetting: true,
        hasEVACSetting: false,
        hasEVDCSetting: false,
        hasPVPriority: true,
        support: true,
      },
    });
    expect(f.paths.toSorted()).toEqual([
      "/device/energy-profile/support/12345",
      "/device/energy-profile/support/upgradeEms/12345",
    ]);
    expect(
      await Effect.runPromise(
        fixture(support, false).client.energyCapabilities(id, token)
      )
    ).toMatchObject({ emsUpgradeSupported: false });
  });
  it("preserves source order and unfamiliar codes without interpreting power flow", async () => {
    const f = fixture({ priority: ["grid", "future-source", "pv", "pv"] });
    expect(
      await Effect.runPromise(f.client.batteryDischargePriority(id, token))
    ).toMatchObject({ providerSources: ["grid", "future-source", "pv", "pv"] });
    expect(f.paths).toEqual([
      "/device/energy-profile/battery/discharge/priority/12345",
    ]);
  });
  it.each([
    { ...support, hasBatterySetting: "true" },
    { ...support, hasGridPriority: 0 },
    { ...support, hasPVPriority: undefined },
    { ...support, batteryPriorityItem: [null] },
    { ...support, gridPriorityItem: Array.from({ length: 33 }, () => "pv") },
  ])("rejects malformed feature flags and options", async (data) => {
    expect(
      await Effect.runPromise(
        fixture(data).client.energyCapabilities(id, token).pipe(Effect.result)
      )
    ).toMatchObject({ _tag: "Failure", failure: { reason: "SchemaMismatch" } });
  });
  it("rejects a non-boolean EMS response", async () => {
    expect(
      await Effect.runPromise(
        fixture(support, "true")
          .client.energyCapabilities(id, token)
          .pipe(Effect.result)
      )
    ).toMatchObject({ _tag: "Failure", failure: { reason: "SchemaMismatch" } });
  });
  it.each([
    null,
    [null],
    [""],
    ["x".repeat(65)],
    Array.from({ length: 33 }, () => "pv"),
  ])("rejects invalid priority lists", async (priority) => {
    expect(
      await Effect.runPromise(
        fixture({ priority })
          .client.batteryDischargePriority(id, token)
          .pipe(Effect.result)
      )
    ).toMatchObject({ _tag: "Failure", failure: { reason: "SchemaMismatch" } });
  });
});
