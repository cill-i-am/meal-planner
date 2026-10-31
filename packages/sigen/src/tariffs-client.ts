import { Clock, DateTime, Effect, Schema } from "effect";
import type { Redacted } from "effect";

import { Percent, failure } from "./model.js";
import type { StationId } from "./model.js";
import { decodeProvider } from "./provider-read.js";
import type { ProviderRead } from "./provider-read.js";
import { PredictionPlan, Tariffs, TaxAndFee } from "./tariffs.js";

const Point = Schema.Struct({
  time: Schema.String.check(
    Schema.isPattern(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/u)
  ),
  timestamp: Schema.Int.check(
    Schema.isBetween({ maximum: 8_640_000_000_000, minimum: 0 })
  ),
  value: Schema.NullOr(Schema.Finite),
});
const Points = Schema.Array(Point).check(Schema.isMaxLength(4096));
const PlanResponse = Schema.Struct({
  actualTotalLoadPowerList: Points,
  aiModeGridBuyPowerList: Points,
  batToNetList: Points,
  buyPrice: Points,
  evacChargeList: Points,
  evdcChargeList: Points,
  loadList: Points,
  maxSelfModeGridBuyPowerList: Points,
  netToBatList: Points,
  nowTime: Schema.String,
  pvList: Points,
  pvToBatList: Points,
  pvToGridList: Points,
  sellPrice: Points,
  socList: Points,
  wholesalePrice: Points,
});

export const makeTariffsClient = (read: ProviderRead) => {
  const metadata = (stationId: StationId, token: Redacted.Redacted<string>) =>
    Effect.gen(function* readCurrencyAndTimezone() {
      const data = yield* read(
        `/device/owner/station/home?stationId=${stationId}`,
        token
      ).pipe(
        Effect.flatMap(
          decodeProvider(
            Schema.Struct({
              currencyCode: Schema.String,
              stationId: Schema.Number,
              timeZoneName: Schema.String,
            })
          )
        )
      );
      if (String(data.stationId) !== stationId) {
        return yield* failure("PermissionDenied");
      }
      yield* DateTime.zoneMakeNamedEffect(data.timeZoneName).pipe(
        Effect.mapError(() => failure("SchemaMismatch"))
      );
      return data;
    });
  return {
    predictionPlan: (stationId: StationId, token: Redacted.Redacted<string>) =>
      Effect.gen(function* readPredictionPlan() {
        const [data, info] = yield* Effect.all(
          [
            read(
              `/prediction/predictData/get/predictData/${stationId}`,
              token
            ).pipe(Effect.flatMap(decodeProvider(PlanResponse))),
            metadata(stationId, token),
          ],
          { concurrency: 2 }
        );
        for (const point of data.socList) {
          if (point.value !== null) {
            yield* decodeProvider(Percent)(point.value);
          }
        }
        const series = (
          name: string,
          points: typeof Points.Type,
          kind: "actual" | "plan" | "price",
          unit: "W" | "%" | "currency/kWh"
        ) => ({
          kind,
          name,
          points: points.map((point) => ({
            localLabel: point.time,
            timestamp: point.timestamp * 1000,
            value:
              point.value === null
                ? null
                : point.value * (unit === "W" ? 1000 : 1),
          })),
          unit,
        });
        return yield* decodeProvider(PredictionPlan)({
          currencySymbol: info.currencyCode,
          fetchedAt: yield* Clock.currentTimeMillis,
          providerNowLocal: data.nowTime,
          series: [
            series("actual_load", data.actualTotalLoadPowerList, "actual", "W"),
            series("ai_grid_import", data.aiModeGridBuyPowerList, "plan", "W"),
            series(
              "self_consumption_grid_import",
              data.maxSelfModeGridBuyPowerList,
              "plan",
              "W"
            ),
            series("battery_to_grid", data.batToNetList, "plan", "W"),
            series("grid_to_battery", data.netToBatList, "plan", "W"),
            series("load", data.loadList, "plan", "W"),
            series("solar", data.pvList, "plan", "W"),
            series("solar_to_battery", data.pvToBatList, "plan", "W"),
            series("solar_to_grid", data.pvToGridList, "plan", "W"),
            series("ac_charging", data.evacChargeList, "plan", "W"),
            series("dc_charging", data.evdcChargeList, "plan", "W"),
            series("battery_soc", data.socList, "plan", "%"),
            series("buy_price", data.buyPrice, "price", "currency/kWh"),
            series("sell_price", data.sellPrice, "price", "currency/kWh"),
            series(
              "wholesale_price",
              data.wholesalePrice,
              "price",
              "currency/kWh"
            ),
          ],
          stationId,
          timezone: info.timeZoneName,
        });
      }),
    tariffs: (stationId: StationId, token: Redacted.Redacted<string>) =>
      Effect.gen(function* readTariffs() {
        const [fees, model, info] = yield* Effect.all(
          [
            read(`/electricity-price/api/tax-and-fee/${stationId}`, token).pipe(
              Effect.flatMap(
                decodeProvider(
                  Schema.Struct({
                    buyTaxAndFee: TaxAndFee,
                    sellTaxAndFee: TaxAndFee,
                  })
                )
              )
            ),
            read(
              `/prediction/aipv/elecPrice/get/priceCost?stationId=${stationId}`,
              token
            ).pipe(
              Effect.flatMap(
                decodeProvider(
                  Schema.Struct({
                    buyElecCost: Schema.Finite,
                    buyPriceCoefficient: Schema.Finite,
                    buyTaxFee: TaxAndFee,
                    sellElecCost: Schema.Finite,
                    sellPriceCoefficient: Schema.Finite,
                    sellTaxFee: TaxAndFee,
                    stationId: Schema.Number,
                  })
                )
              )
            ),
            metadata(stationId, token),
          ],
          { concurrency: 2 }
        );
        if (String(model.stationId) !== stationId) {
          return yield* failure("PermissionDenied");
        }
        return yield* decodeProvider(Tariffs)({
          buy: fees.buyTaxAndFee,
          currencySymbol: info.currencyCode,
          fetchedAt: yield* Clock.currentTimeMillis,
          priceModel: {
            buyCoefficient: model.buyPriceCoefficient,
            buyCost: model.buyElecCost,
            buyTaxAndFee: model.buyTaxFee,
            sellCoefficient: model.sellPriceCoefficient,
            sellCost: model.sellElecCost,
            sellTaxAndFee: model.sellTaxFee,
          },
          providerFeeUnits: "unverified",
          sell: fees.sellTaxAndFee,
          stationId,
        });
      }),
  };
};
