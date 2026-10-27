import { Effect, Redacted, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { makeBackupClient } from "./backup-client.js";
import { BackupHistoryInput } from "./backup.js";

const token = Redacted.make("fixture");
const input = Schema.decodeUnknownSync(BackupHistoryInput)({
  page: 1,
  pageSize: 10,
  stationId: "12345",
});
const page = {
  current: 1,
  pages: 1,
  records: [
    { offGridDuration: 18, offGridTime: "2026-10-25 01:30:13" },
    { offGridDuration: 0, offGridTime: "2026-03-29 01:30:13" },
    { offGridDuration: 79, offGridTime: "2026-07-23 15:27:32" },
  ],
  size: 10,
  total: 3,
};
const response = {
  backupDetailNum: 3,
  backupHistoryDetailVOIpage: page,
  totalTime: 97,
};
const home = { stationId: 12_345, timeZoneName: "Europe/Dublin" };
type ProviderFixture = Readonly<Record<string, unknown>>;
const fixture = (
  data: ProviderFixture = response,
  station: ProviderFixture = home
) => {
  const requests: string[] = [];
  return {
    client: makeBackupClient((path, access) => {
      expect(Redacted.value(access)).toBe("fixture");
      requests.push(path);
      return Effect.succeed(
        path.includes("/owner/station/home") ? station : data
      );
    }),
    requests,
  };
};

describe("backup history", () => {
  it("preserves second precision, zero durations and DST ambiguity without inventing an instant", async () => {
    const f = fixture();
    const result = await Effect.runPromise(
      f.client.backupHistory(input, token)
    );
    expect(result).toMatchObject({
      page: 1,
      pageSize: 10,
      pages: 1,
      records: [
        {
          durationSeconds: 18,
          offGridLocalTime: "2026-10-25T01:30:13",
          offGridUtcCandidates: [
            Date.parse("2026-10-25T00:30:13Z"),
            Date.parse("2026-10-25T01:30:13Z"),
          ],
        },
        {
          durationSeconds: 0,
          offGridLocalTime: "2026-03-29T01:30:13",
          offGridUtcCandidates: [],
        },
        {
          durationSeconds: 79,
          offGridLocalTime: "2026-07-23T15:27:32",
          offGridUtcCandidates: [Date.parse("2026-07-23T14:27:32Z")],
        },
      ],
      reportedEventCount: 3,
      timezone: "Europe/Dublin",
      total: 3,
      totalDurationSeconds: 97,
    });
    expect(f.requests.toSorted()).toEqual([
      "/data-process/station/backup-history?current=1&size=10&stationId=12345",
      "/device/owner/station/home?stationId=12345",
    ]);
  });
  it("accepts empty later pages and preserves provider totals", async () => {
    const f = fixture({
      ...response,
      backupHistoryDetailVOIpage: { ...page, current: 2, records: [] },
    });
    expect(
      await Effect.runPromise(
        f.client.backupHistory({ ...input, page: 2 }, token)
      )
    ).toMatchObject({
      page: 2,
      records: [],
      total: 3,
      totalDurationSeconds: 97,
    });
  });
  it("accepts an empty history", async () => {
    const f = fixture({
      backupDetailNum: 0,
      backupHistoryDetailVOIpage: { ...page, pages: 0, records: [], total: 0 },
      totalTime: 0,
    });
    expect(
      await Effect.runPromise(f.client.backupHistory(input, token))
    ).toMatchObject({ records: [], total: 0, totalDurationSeconds: 0 });
  });
  it.each([
    { ...page, current: 2 },
    { ...page, size: 20 },
    { ...page, pages: 2 },
    { ...page, total: 2 },
    { ...page, records: Array.from({ length: 11 }, () => page.records[0]) },
    { ...page, total: -1 },
  ])("rejects inconsistent pagination", async (invalid) => {
    expect(
      await Effect.runPromise(
        fixture({ ...response, backupHistoryDetailVOIpage: invalid })
          .client.backupHistory(input, token)
          .pipe(Effect.result)
      )
    ).toMatchObject({ _tag: "Failure", failure: { reason: "SchemaMismatch" } });
  });
  it.each([
    "2026-02-30 12:00:00",
    "2026-01-01 24:00:00",
    "2026-01-01 29:00:00",
    "2026-01-01 00:00:60",
    "2026-10-25 01:30",
    "2026-10-25T01:30:13Z",
  ])("rejects malformed local timestamp %s", async (offGridTime) => {
    const f = fixture({
      ...response,
      backupHistoryDetailVOIpage: {
        ...page,
        records: [{ offGridDuration: 1, offGridTime }],
      },
    });
    expect(
      await Effect.runPromise(
        f.client.backupHistory(input, token).pipe(Effect.result)
      )
    ).toMatchObject({ _tag: "Failure", failure: { reason: "SchemaMismatch" } });
  });
  it.each([-1, 0.5, Infinity, "18"])(
    "rejects invalid duration %s",
    async (offGridDuration) => {
      const f = fixture({
        ...response,
        backupHistoryDetailVOIpage: {
          ...page,
          records: [{ offGridDuration, offGridTime: "2026-10-25 01:30:13" }],
        },
      });
      expect(
        await Effect.runPromise(
          f.client.backupHistory(input, token).pipe(Effect.result)
        )
      ).toMatchObject({
        _tag: "Failure",
        failure: { reason: "SchemaMismatch" },
      });
    }
  );
  it("rejects mismatched station identity and invalid station timezone", async () => {
    expect(
      await Effect.runPromise(
        fixture(response, { ...home, stationId: 67_890 })
          .client.backupHistory(input, token)
          .pipe(Effect.result)
      )
    ).toMatchObject({
      _tag: "Failure",
      failure: { reason: "PermissionDenied" },
    });
    expect(
      await Effect.runPromise(
        fixture(response, { ...home, timeZoneName: "invalid" })
          .client.backupHistory(input, token)
          .pipe(Effect.result)
      )
    ).toMatchObject({ _tag: "Failure", failure: { reason: "SchemaMismatch" } });
  });
  it.each([
    { page: 0 },
    { page: 1001 },
    { page: 1.5 },
    { pageSize: 0 },
    { pageSize: 101 },
  ])("bounds pagination inputs", (invalid) => {
    expect(Schema.is(BackupHistoryInput)({ ...input, ...invalid })).toBe(false);
  });
});
