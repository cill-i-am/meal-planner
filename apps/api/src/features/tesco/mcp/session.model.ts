import { Data, Schema } from "effect";
import { parseSetCookie } from "set-cookie-parser";

import {
  OAuthTokensExpiryTime,
  TescoAuthorizationValue,
} from "../auth/auth.model.js";

const HeaderSafe = Schema.String.check(Schema.isPattern(/^[^\r\n]*$/u));
const EpochMs = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/** Browser cookie attributes are retained because account-path cookies are required for renewal. */
export const TescoBrowserCookie = Schema.Struct({
  domain: Schema.String.check(Schema.isPattern(/^\.?[a-z0-9.-]+$/u)),
  expires: Schema.Number,
  hostOnly: Schema.optionalKey(Schema.Boolean),
  name: Schema.String.check(Schema.isPattern(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u)),
  path: Schema.String.check(Schema.isPattern(/^\/[^\r\n]*$/u)),
  secure: Schema.Boolean,
  value: HeaderSafe,
});
export type TescoBrowserCookie = typeof TescoBrowserCookie.Type;

/** Secret input accepted only by the separately authenticated operator endpoint. */
export const TescoSessionCredentials = Schema.Struct({
  authorization: TescoAuthorizationValue,
  cookies: Schema.Array(TescoBrowserCookie).check(Schema.isMaxLength(256)),
  mangoApiKey: HeaderSafe.check(Schema.isMinLength(1)),
  mangoUrl: Schema.Literal("https://xapi.tesco.com/"),
  userAgent: HeaderSafe.check(Schema.isMinLength(1), Schema.isMaxLength(512)),
});
export type TescoSessionCredentials = typeof TescoSessionCredentials.Type;

export const EncryptedTescoSession = Schema.Struct({
  cipher: Schema.String,
  iv: Schema.String,
  version: Schema.Literal(1),
});

export const TescoConnectionHealth = Schema.Struct({
  accessTokenExpiresAt: Schema.NullOr(EpochMs),
  lastRefreshedAt: Schema.NullOr(EpochMs),
  nextRefreshAt: Schema.NullOr(EpochMs),
  state: Schema.Literals([
    "connected",
    "not_connected",
    "reauthentication_required",
  ]),
});
export type TescoConnectionHealth = typeof TescoConnectionHealth.Type;

export const StoredTescoSession = Schema.Struct({
  accessTokenExpiresAt: EpochMs,
  credentials: EncryptedTescoSession,
  lastRefreshedAt: Schema.NullOr(EpochMs),
  phase: Schema.Literals(["ready", "refreshing"]),
  refreshTokenExpiresAt: EpochMs,
});
export type StoredTescoSession = typeof StoredTescoSession.Type;

/** Bounded operator evidence contains no cookie names, values, headers or response bodies. */
export const TescoRenewalStep = Schema.Struct({
  receivedCookies: Schema.Int,
  repeatedNames: Schema.Boolean,
  stage: Schema.Literals(["login", "refresh", "other"]),
  status: Schema.Int,
});
export type TescoRenewalStep = typeof TescoRenewalStep.Type;

export const TescoRenewalAttempt = Schema.Struct({
  accessTokenExpiresAt: Schema.NullOr(EpochMs),
  failure: Schema.NullOr(
    Schema.Literals(["transport", "redirect", "rejected", "tokens", "response"])
  ),
  finishedAt: EpochMs,
  previousAccessTokenExpiresAt: EpochMs,
  refreshCookieChanged: Schema.Boolean,
  result: Schema.Literals(["renewed", "failed"]),
  startedAt: EpochMs,
  steps: Schema.Array(TescoRenewalStep).check(Schema.isMaxLength(11)),
  tokenChanged: Schema.Boolean,
});
export type TescoRenewalAttempt = typeof TescoRenewalAttempt.Type;

export const TescoSessionReport = Schema.Struct({
  alarmAt: Schema.NullOr(EpochMs),
  hasEncryptedSession: Schema.Boolean,
  health: TescoConnectionHealth,
  renewals: Schema.Array(TescoRenewalAttempt).check(Schema.isMaxLength(5)),
});
export type TescoSessionReport = typeof TescoSessionReport.Type;

export class TescoSessionFailure extends Data.TaggedError(
  "TescoSessionFailure"
)<{
  readonly reason: "authentication" | "invalid_input" | "storage" | "upstream";
}> {}

export const TescoRefreshSkewMs = 120_000;

const cookieMatches = (cookie: TescoBrowserCookie, url: URL, now: number) => {
  const domain = cookie.domain.replace(/^\./u, "");
  const hostMatches = cookie.hostOnly
    ? url.hostname === domain
    : url.hostname === domain || url.hostname.endsWith(`.${domain}`);
  const { path } = cookie;
  return (
    hostMatches &&
    (url.pathname === path ||
      url.pathname.startsWith(path.endsWith("/") ? path : `${path}/`)) &&
    (!cookie.secure || url.protocol === "https:") &&
    (cookie.expires <= 0 || cookie.expires * 1000 > now)
  );
};

export const cookieHeaderFor = (
  cookies: readonly TescoBrowserCookie[],
  url: URL,
  now: number
) =>
  cookies
    .filter((cookie) => cookieMatches(cookie, url, now))
    .toSorted((a, b) => b.path.length - a.path.length)
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");

export const sessionCookie = (
  cookies: readonly TescoBrowserCookie[],
  name: string
) =>
  cookies.findLast(
    (cookie) =>
      cookie.name === name &&
      cookieMatches(
        cookie,
        new URL("https://www.tesco.ie/account/auth/en-IE/refresh-token"),
        Date.now()
      )
  );

export const tokenExpiry = (cookies: readonly TescoBrowserCookie[]) => {
  const cookie = sessionCookie(cookies, "OAuth.TokensExpiryTime");
  if (cookie === undefined) {
    throw new TescoSessionFailure({ reason: "invalid_input" });
  }
  return Schema.decodeUnknownSync(Schema.fromJsonString(OAuthTokensExpiryTime))(
    decodeURIComponent(cookie.value)
  );
};

const cookieExpiresAt = (
  maxAge: number | undefined,
  expires: number,
  now: number
) =>
  maxAge !== undefined && Number.isFinite(maxAge)
    ? now / 1000 + maxAge
    : expires;

/** Apply every Set-Cookie field; cookie identity includes name, domain and path. */
export const mergeSessionCookies = (
  current: readonly TescoBrowserCookie[],
  headers: readonly string[] | string,
  url: URL,
  now: number
): readonly TescoBrowserCookie[] => {
  let cookies = [...current];
  // Effect's Cookies collection is keyed only by name and cannot represent a browser jar.
  // Parse the original headers without decoding signed/encoded cookie values.
  for (const parsed of parseSetCookie(headers, {
    decodeValues: false,
    split: true,
  })) {
    const domain = parsed.domain?.toLowerCase() ?? url.hostname;
    const normalizedDomain = domain.replace(/^\./u, "");
    if (
      url.hostname !== normalizedDomain &&
      !url.hostname.endsWith(`.${normalizedDomain}`)
    ) {
      continue;
    }
    const defaultPath =
      url.pathname.slice(0, url.pathname.lastIndexOf("/")) || "/";
    const path = parsed.path?.startsWith("/") ? parsed.path : defaultPath;
    const expires = cookieExpiresAt(
      parsed.maxAge,
      parsed.expires === undefined ? -1 : parsed.expires.getTime() / 1000,
      now
    );
    const cookie = {
      domain,
      expires,
      hostOnly: parsed.domain === undefined,
      name: parsed.name,
      path,
      secure: parsed.secure === true,
      value: parsed.value,
    };
    if (!Schema.is(TescoBrowserCookie)(cookie)) {
      continue;
    }
    cookies = cookies.filter(
      (stored) =>
        !(
          stored.name === cookie.name &&
          stored.domain.replace(/^\./u, "") === normalizedDomain &&
          stored.path === path
        )
    );
    if (cookie.value !== "" && !(expires >= 0 && expires * 1000 <= now)) {
      cookies.push(cookie);
    }
  }
  return cookies;
};
