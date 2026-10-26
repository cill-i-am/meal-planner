import { Effect, Redacted, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { StationId } from "./model.js";
import { makeTariffsClient } from "./tariffs-client.js";

const id = Schema.decodeUnknownSync(StationId)("12345");
const token = Redacted.make("synthetic");
const tax = {
  additionalFeeList: [{ fixedValue: 5, mode: 0 }],
  taxSettings: {
    enableNegativePriceTax: true,
    fixedTaxRate: 0,
    negativePriceTaxRate: null,
    taxMode: 99,
    touSchedule: [],
  },
};
const point = {
  time: "2026-10-25 01:30",
  timestamp: 1_792_888_200,
  value: 1.25,
};
const plan = {
  actualTotalLoadPowerList: [
    point,
    { ...point, timestamp: point.timestamp + 3600, value: null },
  ],
  aiModeGridBuyPowerList: [],
  batToNetList: [],
  buyPrice: [{ ...point, value: -0.15 }],
  evacChargeList: [],
  evdcChargeList: [],
  loadList: [],
  maxSelfModeGridBuyPowerList: [],
  netToBatList: [],
  nowTime: "2026-10-25 12:00",
  pvList: [],
  pvToBatList: [],
  pvToGridList: [],
  sellPrice: [],
  socList: [{ ...point, value: 45 }],
  wholesalePrice: [],
};
// This fixture deliberately supplies malformed provider data to the adapter boundary.
const fixture = (data: Schema.Json = plan, stationId = 12_345) =>
  makeTariffsClient((path) => {
    if (path.includes("/home?")) {
      return Effect.succeed({
        currencyCode: "€",
        stationId,
        timeZoneName: "Europe/Dublin",
      });
    }
    if (path.includes("/tax-and-fee/")) {
      return Effect.succeed({ buyTaxAndFee: tax, sellTaxAndFee: tax });
    }
    if (path.includes("/priceCost?")) {
      return Effect.succeed({
        buyElecCost: 0,
        buyPriceCoefficient: 1,
        buyTaxFee: tax,
        sellElecCost: 0,
        sellPriceCoefficient: 1,
        sellTaxFee: tax,
        stationId,
      });
    }
    return Effect.succeed(data);
  });

describe("tariff and mixed AI-plan reads", () => {
  it("preserves provider tax enums and fee amounts without guessing their units", async () => {
    const value = await Effect.runPromise(fixture().tariffs(id, token));
    expect(value).toMatchObject({
      buy: tax,
      currencySymbol: "€",
      priceModel: { buyCoefficient: 1, buyCost: 0 },
      providerFeeUnits: "unverified",
    });
  });
  it("keeps actual and plan series distinct, converts kW, preserves null/negative prices and DST timestamps", async () => {
    const value = await Effect.runPromise(fixture().predictionPlan(id, token));
    expect(
      value.series.find((series) => series.name === "actual_load")
    ).toMatchObject({
      kind: "actual",
      points: [
        { timestamp: point.timestamp * 1000, value: 1250 },
        { timestamp: (point.timestamp + 3600) * 1000, value: null },
      ],
      unit: "W",
    });
    expect(
      value.series.find((series) => series.name === "buy_price")
    ).toMatchObject({ points: [{ value: -0.15 }], unit: "currency/kWh" });
    expect(
      value.series.find((series) => series.name === "battery_soc")
    ).toMatchObject({ kind: "plan", points: [{ value: 45 }], unit: "%" });
  });
  it("rejects cross-station data, schema drift and invalid SOC", async () => {
    expect(
      await Effect.runPromise(
        fixture(plan, 999).tariffs(id, token).pipe(Effect.result)
      )
    ).toMatchObject({ failure: { reason: "PermissionDenied" } });
    expect(
      await Effect.runPromise(
        fixture({ ...plan, socList: [{ ...point, value: 101 }] })
          .predictionPlan(id, token)
          .pipe(Effect.result)
      )
    ).toMatchObject({ failure: { reason: "SchemaMismatch" } });
    expect(
      await Effect.runPromise(
        fixture({ ...plan, buyPrice: null })
          .predictionPlan(id, token)
          .pipe(Effect.result)
      )
    ).toMatchObject({ failure: { reason: "SchemaMismatch" } });
  });
});
