import { Schema } from "effect";

const TrimmedNonEmptyString = Schema.String.pipe(
  Schema.check(Schema.isTrimmed(), Schema.isNonEmpty())
);

export const TescoAuthorization = TrimmedNonEmptyString.pipe(
  Schema.check(Schema.isPattern(/^Bearer \S+$/u)),
  Schema.brand("TescoAuthorization")
);
export type TescoAuthorization = typeof TescoAuthorization.Type;

export const TescoAuthCookieHeader = TrimmedNonEmptyString.pipe(
  Schema.check(Schema.isPattern(/(?:^|;\s*)OAuth\.TokensExpiryTime=/u)),
  Schema.brand("TescoAuthCookieHeader")
);
export type TescoAuthCookieHeader = typeof TescoAuthCookieHeader.Type;

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
