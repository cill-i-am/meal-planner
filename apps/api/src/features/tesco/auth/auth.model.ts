import { Schema } from "effect";
import type { Redacted } from "effect";

const TrimmedNonEmptyString = Schema.String.pipe(
  Schema.check(Schema.isTrimmed(), Schema.isNonEmpty())
);

export const TescoAuthorizationValue = TrimmedNonEmptyString.pipe(
  Schema.check(Schema.isPattern(/^Bearer \S+$/u)),
  Schema.brand("TescoAuthorization")
);
export type TescoAuthorizationValue = typeof TescoAuthorizationValue.Type;
export type TescoAuthorization = Redacted.Redacted<TescoAuthorizationValue>;

export const TescoAuthCookieHeaderValue = TrimmedNonEmptyString.pipe(
  Schema.check(Schema.isPattern(/(?:^|;\s*)OAuth\.TokensExpiryTime=/u)),
  Schema.brand("TescoAuthCookieHeader")
);
export type TescoAuthCookieHeaderValue = typeof TescoAuthCookieHeaderValue.Type;
export type TescoAuthCookieHeader =
  Redacted.Redacted<TescoAuthCookieHeaderValue>;

export const OAuthTokenExpiryEpochMs = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(0)),
  Schema.brand("OAuthTokenExpiryEpochMs")
);
export type OAuthTokenExpiryEpochMs = typeof OAuthTokenExpiryEpochMs.Type;

export const OAuthTokensExpiryTime = Schema.Struct({
  AccessToken: OAuthTokenExpiryEpochMs,
  RefreshToken: OAuthTokenExpiryEpochMs,
});
export type OAuthTokensExpiryTime = typeof OAuthTokensExpiryTime.Type;

export interface TescoAuthSnapshot {
  readonly authorization: TescoAuthorization;
  readonly cookieHeader: TescoAuthCookieHeader;
  readonly accessTokenExpiresAt: OAuthTokenExpiryEpochMs;
  readonly refreshTokenExpiresAt: OAuthTokenExpiryEpochMs;
}

export const OAuthTokensExpiryTimeCookieName = "OAuth.TokensExpiryTime";
