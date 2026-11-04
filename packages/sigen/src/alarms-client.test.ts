import { Effect, Redacted, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { makeAlarmsClient } from "./alarms-client.js";
import { AlarmInput } from "./alarms.js";

const token = Redacted.make("fixture");
const input = Schema.decodeUnknownSync(AlarmInput)({
  endAt: Date.parse("2026-10-26T23:59:59Z"),
  page: 2,
  pageSize: 10,
  startAt: Date.parse("2026-10-19T23:00:00Z"),
  state: "history",
  stationId: "12345",
});
const record = {
  aioSnCode: "AIO-1",
  alarmCode: "1021",
  alarmLevel: 987,
  alarmName: "Fixture alarm",
  alarmReasonIdName: "Fixture reason",
  alarmRemoveTime: 1_792_912_277,
  alarmTime: 1_792_912_272,
  chlidAlarmCode: 4,
  deviceSnCode: "INV-1",
  deviceType: 1,
  stationId: 12_345,
};
describe("paginated alarms", () => {
  it("returns an empty page without I/O for a range containing no provider-second instant", async () => {
    const client = makeAlarmsClient(() => {
      throw new Error("Unexpected provider call");
    });
    const tiny = Schema.decodeUnknownSync(AlarmInput)({
      ...input,
      endAt: 1999,
      startAt: 1001,
    });
    expect(await Effect.runPromise(client.alarms(tiny, token))).toMatchObject({
      pages: 0,
      records: [],
      total: 0,
    });
  });
  it("keeps inclusive UTC seconds across Dublin DST and strips account metadata", async () => {
    const client = makeAlarmsClient((path) => {
      const url = new URL(path, "https://fixture.invalid");
      expect(url.pathname).toBe("/alarm/history/page");
      expect(url.searchParams.get("startTimestamp")).toBe(
        String(Date.parse("2026-10-19T23:00:00Z") / 1000)
      );
      expect(url.searchParams.get("endTimestamp")).toBe(
        String(Date.parse("2026-10-26T23:59:59Z") / 1000)
      );
      expect(url.searchParams.get("current")).toBe("2");
      return Effect.succeed({
        current: 2,
        pages: 3,
        records: [
          { ...record, id: 1.166756e18, ownerVO: { ownerUserName: "SECRET" } },
        ],
        size: 10,
        total: 29,
      });
    });
    const result = await Effect.runPromise(client.alarms(input, token));
    expect(result).toMatchObject({
      page: 2,
      pages: 3,
      records: [
        {
          occurredAt: 1_792_912_272_000,
          providerSeverity: 987,
          resolvedAt: 1_792_912_277_000,
        },
      ],
      total: 29,
    });
    expect(JSON.stringify(result)).not.toContain("SECRET");
    expect(result.records[0]).not.toHaveProperty("id");
  });
  it("uses the active endpoint without time filters", async () => {
    const active = Schema.decodeUnknownSync(AlarmInput)({
      page: 1,
      pageSize: 10,
      state: "active",
      stationId: "12345",
    });
    const client = makeAlarmsClient((path) => {
      expect(path).toBe("/device/alarm/page?current=1&size=10&stationId=12345");
      return Effect.succeed({
        current: 1,
        pages: 0,
        records: [],
        size: 10,
        total: 0,
      });
    });
    expect(await Effect.runPromise(client.alarms(active, token))).toMatchObject(
      { records: [], state: "active", total: 0 }
    );
  });
  it.each([
    { endAt: 0, startAt: 1000 },
    { endAt: 32 * 86_400_000, startAt: 0 },
    { page: 0 },
    { pageSize: 101 },
  ])("rejects invalid ranges and unbounded pagination", (overrides) => {
    expect(Schema.is(AlarmInput)({ ...input, ...overrides })).toBe(false);
  });
  it("fails on returned pagination or station mismatches", async () => {
    const client = makeAlarmsClient(() =>
      Effect.succeed({
        current: 2,
        pages: 3,
        records: [{ ...record, stationId: 54_321 }],
        size: 10,
        total: 29,
      })
    );
    expect(
      await Effect.runPromise(client.alarms(input, token).pipe(Effect.result))
    ).toMatchObject({
      _tag: "Failure",
      failure: { reason: "PermissionDenied" },
    });
    const wrongPage = makeAlarmsClient(() =>
      Effect.succeed({ current: 1, pages: 3, records: [], size: 10, total: 29 })
    );
    expect(
      await Effect.runPromise(
        wrongPage.alarms(input, token).pipe(Effect.result)
      )
    ).toMatchObject({ _tag: "Failure", failure: { reason: "SchemaMismatch" } });
  });
});
