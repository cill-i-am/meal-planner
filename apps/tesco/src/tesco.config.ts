import { Schema } from "effect";
import type { Redacted } from "effect";

const ConfigText = Schema.String.pipe(
  Schema.check(Schema.isTrimmed(), Schema.isNonEmpty())
);

export const TescoLocale = ConfigText.pipe(
  Schema.check(Schema.isPattern(/^[a-z]{2}-[A-Z]{2}$/u)),
  Schema.brand("TescoLocale")
);
export type TescoLocale = typeof TescoLocale.Type;

export const TescoRegion = ConfigText.pipe(
  Schema.check(Schema.isPattern(/^[A-Z]{2}$/u)),
  Schema.brand("TescoRegion")
);
export type TescoRegion = typeof TescoRegion.Type;

export const TescoApiKeyValue = ConfigText.pipe(
  Schema.brand("TescoApiKeyValue")
);
export type TescoApiKeyValue = typeof TescoApiKeyValue.Type;
export type TescoApiKey = Redacted.Redacted<TescoApiKeyValue>;

export interface TescoCatalogueConfig {
  readonly mangoUrl: URL;
  readonly suggestionUrl: URL;
  readonly locale: TescoLocale;
  readonly region: TescoRegion;
  readonly mangoApiKey: TescoApiKey;
}
