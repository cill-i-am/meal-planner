import { Effect, Redacted, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { makeBackupEventsClient } from "./backup-events-client.js";
import { BackupEventsInput } from "./backup.js";

const token = Redacted.make("fixture");
const input = Schema.decodeUnknownSync(BackupEventsInput)({
  endDate: "2026-10-31",
  page: 1,
  startDate: "2026-10-01",
  stationId: "12345",
});
const event = {
  backupType: 987,
  extraDeviceInfoList: [],
  phaseInfoVOList: [],
  reasonType: 17,
  signalPhaseInfoVOList: [
    { paramKey: "Phase A Reactive Power", paramValue: "-0.58 kVar" },
  ],
  time: "2026-10-25 01:30:13",
};
const page = {
  current: 1,
  pages: 1,
  records: [event, event],
  size: 10,
  total: 2,
};
const response = {
  backupHistoryDetailVOIpage: page,
  endTime: input.endDate,
  filterItems: [],
  modelTypeCode: 123,
  startTime: input.startDate,
};
const home = { stationId: 12_345, timeZoneName: "Europe/Dublin" };
type ProviderFixture = Readonly<Record<string, unknown>>;
const fixture = (
  data: ProviderFixture = response,
  station: ProviderFixture = home
) => {
  const paths: string[] = [];
  return {
    client: makeBackupEventsClient((path, access) => {
      expect(Redacted.value(access)).toBe("fixture");
      paths.push(path);
      return Effect.succeed(
        path.includes("/owner/station/home") ? station : data
      );
    }),
    paths,
  };
};
describe("backup event diagnostics", () => {
  it("preserves duplicate diagnostic records, display units and ambiguous local seconds", async () => {
    const f = fixture();
    const result = await Effect.runPromise(f.client.backupEvents(input, token));
    expect(result).toMatchObject({
      page: 1,
      pageSize: 10,
      pages: 1,
      providerModelType: 123,
      timezone: "Europe/Dublin",
      total: 2,
    });
    expect(result.records).toEqual(
      Array.from({ length: 2 }, () => ({
        localTime: "2026-10-25T01:30:13",
        measurements: [
          { label: "Phase A Reactive Power", value: "-0.58 kVar" },
        ],
        providerBackupType: 987,
        providerReasonType: 17,
        utcCandidates: [
          Date.parse("2026-10-25T00:30:13Z"),
          Date.parse("2026-10-25T01:30:13Z"),
        ],
      }))
    );
    expect(f.paths.toSorted()).toEqual([
      "/data-process/station/backup-event?current=1&endTime=2026-10-31&filterItems=&startTime=2026-10-01&stationId=12345",
      "/device/owner/station/home?stationId=12345",
    ]);
  });
  it("keeps a valid DST gap without inventing a UTC instant", async () => {
    const request = Schema.decodeUnknownSync(BackupEventsInput)({
      ...input,
      endDate: "2026-03-29",
      startDate: "2026-03-29",
    });
    const data = {
      ...response,
      backupHistoryDetailVOIpage: {
        ...page,
        records: [{ ...event, time: "2026-03-29 01:30:13" }],
      },
      endTime: request.endDate,
      startTime: request.startDate,
    };
    expect(
      await Effect.runPromise(fixture(data).client.backupEvents(request, token))
    ).toMatchObject({ records: [{ utcCandidates: [] }] });
  });
  it("retains empty pages and the provider total", async () => {
    const data = {
      ...response,
      backupHistoryDetailVOIpage: { ...page, current: 2, records: [] },
    };
    expect(
      await Effect.runPromise(
        fixture(data).client.backupEvents({ ...input, page: 2 }, token)
      )
    ).toMatchObject({ page: 2, records: [], total: 2 });
  });
  it.each([
    { ...response, startTime: "2026-09-30" },
    { ...response, endTime: "2026-11-01" },
    { ...response, filterItems: [17] },
    { ...response, backupHistoryDetailVOIpage: { ...page, size: 20 } },
    { ...response, backupHistoryDetailVOIpage: { ...page, pages: 2 } },
    { ...response, backupHistoryDetailVOIpage: { ...page, current: 2 } },
    { ...response, backupHistoryDetailVOIpage: { ...page, total: 1 } },
  ])("rejects response range and pagination mismatches", async (data) => {
    expect(
      await Effect.runPromise(
        fixture(data).client.backupEvents(input, token).pipe(Effect.result)
      )
    ).toMatchObject({ _tag: "Failure", failure: { reason: "SchemaMismatch" } });
  });
  it.each([
    "2026-09-30 23:59:59",
    "2026-11-01 00:00:00",
    "2026-10-32 00:00:00",
    "2026-10-01 24:00:00",
  ])("rejects invalid or out-of-range event time %s", async (time) => {
    const data = {
      ...response,
      backupHistoryDetailVOIpage: { ...page, records: [{ ...event, time }] },
    };
    expect(
      await Effect.runPromise(
        fixture(data).client.backupEvents(input, token).pipe(Effect.result)
      )
    ).toMatchObject({ _tag: "Failure", failure: { reason: "SchemaMismatch" } });
  });
  it.each([
    { paramKey: "Voltage", paramValue: 235 },
    { paramKey: "", paramValue: "0" },
    { paramKey: "Voltage", paramValue: "v".repeat(1025) },
  ])("rejects malformed display measurements", async (param) => {
    const data = {
      ...response,
      backupHistoryDetailVOIpage: {
        ...page,
        records: [{ ...event, signalPhaseInfoVOList: [param] }],
      },
    };
    expect(
      await Effect.runPromise(
        fixture(data).client.backupEvents(input, token).pipe(Effect.result)
      )
    ).toMatchObject({ _tag: "Failure", failure: { reason: "SchemaMismatch" } });
  });
  it.each(["phaseInfoVOList", "extraDeviceInfoList"])(
    "refuses unverified populated %s without dropping detail",
    async (key) => {
      const data = {
        ...response,
        backupHistoryDetailVOIpage: {
          ...page,
          records: [{ ...event, [key]: [{ unverified: "private details" }] }],
        },
      };
      expect(
        await Effect.runPromise(
          fixture(data).client.backupEvents(input, token).pipe(Effect.result)
        )
      ).toMatchObject({
        _tag: "Failure",
        failure: { reason: "UnsupportedCapability" },
      });
    }
  );
  it("rejects nonempty pages past the reported total and cross-station metadata", async () => {
    const data = {
      ...response,
      backupHistoryDetailVOIpage: { ...page, current: 2 },
    };
    expect(
      await Effect.runPromise(
        fixture(data)
          .client.backupEvents({ ...input, page: 2 }, token)
          .pipe(Effect.result)
      )
    ).toMatchObject({ _tag: "Failure", failure: { reason: "SchemaMismatch" } });
    expect(
      await Effect.runPromise(
        fixture(response, { ...home, stationId: 67_890 })
          .client.backupEvents(input, token)
          .pipe(Effect.result)
      )
    ).toMatchObject({
      _tag: "Failure",
      failure: { reason: "PermissionDenied" },
    });
  });
  it.each([
    { endDate: "2026-09-30" },
    { endDate: "2026-11-02" },
    { startDate: "2026-02-30" },
    { page: 0 },
    { page: 1001 },
  ])("bounds dates and pages before provider access", (invalid) => {
    expect(Schema.is(BackupEventsInput)({ ...input, ...invalid })).toBe(false);
  });
});
