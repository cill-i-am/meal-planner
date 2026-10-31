import { Effect, Redacted, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { makeHistoryClient } from "./history-client.js";
import { IncomeInput } from "./history.js";

const input = Schema.decodeUnknownSync(IncomeInput)({
  date: "2026-10-25",
  stationId: "12345",
});
const token = Redacted.make("synthetic");
const income = {
  avgIncome: 0.07,
  incomeList: [
    { calculateIncome: null, income: -0.19, time: "20261025 01:30" },
    { calculateIncome: 0.2, income: null, time: "20261025 02:30" },
  ],
  stationId: 12_345,
  theLeast: -0.19,
  theMost: 0.19,
  totalIncome: 0.07,
};
const home = {
  currencyCode: "€",
  stationId: 12_345,
  timeZoneName: "Europe/Dublin",
};
type ProviderFixture = Readonly<Record<string, unknown>>;
const fixture = (
  response: ProviderFixture = income,
  station: ProviderFixture = home
) => {
  const paths: string[] = [];
  const client = makeHistoryClient((path) => {
    paths.push(path);
    return Effect.succeed(
      path.includes("/owner/station/home") ? station : response
    );
  });
  return { client, paths };
};

describe("station daily income", () => {
  it("preserves signed, missing and calculated values, provider totals and ambiguous local times", async () => {
    const { client, paths } = fixture();
    const result = await Effect.runPromise(client.stationIncome(input, token));
    expect(result).toMatchObject({
      currencySymbol: "€",
      date: "2026-10-25",
      providerAverage: 0.07,
      providerMaximum: 0.19,
      providerMinimum: -0.19,
      providerTotal: 0.07,
      samples: [
        {
          calculatedIncome: null,
          income: -0.19,
          localTime: "2026-10-25T01:30",
        },
        { calculatedIncome: 0.2, income: null, localTime: "2026-10-25T02:30" },
      ],
      timezone: "Europe/Dublin",
    });
    expect(result.samples).toHaveLength(2);
    expect(result.samples[0]?.utcCandidates).toHaveLength(2);
    const url = new URL(paths[0] ?? "", "https://fixture.invalid");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      dateFlag: "1",
      endDate: "20261025",
      fulfill: "false",
      startDate: "20261025",
      stationId: "12345",
    });
  });
  it("rejects other stations, wrong-day samples, malformed values and invalid timezones", async () => {
    await Promise.all(
      (
        [
          [{ ...income, stationId: 54_321 }, home, "PermissionDenied"],
          [income, { ...home, stationId: 54_321 }, "PermissionDenied"],
          [
            {
              ...income,
              incomeList: [
                { calculateIncome: null, income: 1, time: "20261026 00:00" },
              ],
            },
            home,
            "SchemaMismatch",
          ],
          [{ ...income, totalIncome: "0.07" }, home, "SchemaMismatch"],
          [income, { ...home, timeZoneName: "invalid" }, "SchemaMismatch"],
        ] as const
      ).map(async ([response, station, reason]) => {
        const result = await Effect.runPromise(
          fixture(response, station)
            .client.stationIncome(input, token)
            .pipe(Effect.result)
        );
        expect(result).toMatchObject({ _tag: "Failure", failure: { reason } });
      })
    );
  });
});
