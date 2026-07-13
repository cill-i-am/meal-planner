import { Config, Option, Schema } from "effect";

import {
  TescoAuthCookieHeader,
  TescoAuthorization,
} from "./auth/auth.model.js";

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

export const TescoApiKey = ConfigText.pipe(Schema.brand("TescoApiKey"));
export type TescoApiKey = typeof TescoApiKey.Type;

export const TescoHeaderValue = ConfigText.pipe(
  Schema.brand("TescoHeaderValue")
);
export type TescoHeaderValue = typeof TescoHeaderValue.Type;

export interface TescoConfig {
  readonly mangoUrl: URL;
  readonly suggestionUrl: URL;
  readonly locale: TescoLocale;
  readonly region: TescoRegion;
  readonly mangoApiKey: TescoApiKey;
  readonly authorization: TescoAuthorization;
  readonly authCookieHeader: TescoAuthCookieHeader;
  readonly softRefreshSignInUrl: URL;
  readonly authRefreshFromUrl: URL;
  readonly transactionPurpose: TescoHeaderValue | null;
  readonly releaseBranch: TescoHeaderValue | null;
}

const optionalSchemaConfig = <A, I>(
  schema: Schema.Codec<A, I>,
  name: string
): Config.Config<A | null> =>
  Config.option(Config.schema(schema, name)).pipe(Config.map(Option.getOrNull));

export const TescoConfigDefinition: Config.Config<TescoConfig> = Config.all({
  authCookieHeader: Config.schema(
    TescoAuthCookieHeader,
    "TESCO_AUTH_COOKIE_HEADER"
  ),
  authRefreshFromUrl: Config.url("TESCO_AUTH_REFRESH_FROM_URL"),
  authorization: Config.schema(TescoAuthorization, "TESCO_AUTHORIZATION"),
  locale: Config.schema(TescoLocale, "TESCO_LOCALE"),
  mangoApiKey: Config.schema(TescoApiKey, "TESCO_MANGO_API_KEY"),
  mangoUrl: Config.url("TESCO_MANGO_URL"),
  region: Config.schema(TescoRegion, "TESCO_REGION"),
  releaseBranch: optionalSchemaConfig(TescoHeaderValue, "TESCO_RELEASE_BRANCH"),
  softRefreshSignInUrl: Config.url("TESCO_SOFT_REFRESH_SIGN_IN_URL"),
  suggestionUrl: Config.url("TESCO_SUGGESTION_URL"),
  transactionPurpose: optionalSchemaConfig(
    TescoHeaderValue,
    "TESCO_TRANSACTION_PURPOSE"
  ),
});
