import { Schema } from "effect";

import { StationId, Timestamp } from "./model.js";

export const TaxAndFee = Schema.Struct({
  additionalFeeList: Schema.optionalKey(
    Schema.Array(Schema.Json).check(Schema.isMaxLength(64))
  ),
  taxSettings: Schema.Struct({
    enableNegativePriceTax: Schema.Boolean,
    fixedTaxRate: Schema.Finite,
    negativePriceTaxRate: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
    taxMode: Schema.Int,
    touSchedule: Schema.optionalKey(
      Schema.Array(Schema.Json).check(Schema.isMaxLength(168))
    ),
  }),
});
export const Tariffs = Schema.Struct({
  buy: TaxAndFee,
  currencySymbol: Schema.String,
  fetchedAt: Timestamp,
  priceModel: Schema.Struct({
    buyCoefficient: Schema.Finite,
    buyCost: Schema.Finite,
    buyTaxAndFee: TaxAndFee,
    sellCoefficient: Schema.Finite,
    sellCost: Schema.Finite,
    sellTaxAndFee: TaxAndFee,
  }),
  providerFeeUnits: Schema.Literal("unverified"),
  sell: TaxAndFee,
  stationId: StationId,
});
export const PredictionPlan = Schema.Struct({
  currencySymbol: Schema.String,
  fetchedAt: Timestamp,
  providerNowLocal: Schema.String,
  series: Schema.Array(
    Schema.Struct({
      kind: Schema.Literals(["actual", "plan", "price"]),
      name: Schema.String,
      points: Schema.Array(
        Schema.Struct({
          localLabel: Schema.String,
          timestamp: Timestamp,
          value: Schema.NullOr(Schema.Finite),
        })
      ).check(Schema.isMaxLength(4096)),
      unit: Schema.Literals(["W", "%", "currency/kWh"]),
    })
  ).check(Schema.isMaxLength(16)),
  stationId: StationId,
  timezone: Schema.String,
});
