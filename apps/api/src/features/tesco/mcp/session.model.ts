import { Data, Schema } from "effect";

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

/** Apply redirects' Set-Cookie values without losing cookie domain, path or expiry. */
export const mergeSessionCookies = (
  current: readonly TescoBrowserCookie[],
  headers: readonly string[],
  url: URL,
  now: number
): readonly TescoBrowserCookie[] => {
  let cookies = [...current];
  for (const header of headers) {
    const [pair, ...attributes] = header.split(";");
    const equals = pair?.indexOf("=") ?? -1;
    if (pair === undefined || equals <= 0) {
      continue;
    }
    let domain = url.hostname;
    let hostOnly = true;
    let path = url.pathname.slice(0, url.pathname.lastIndexOf("/")) || "/";
    let secure = false;
    let expires = -1;
    let maxAge: number | undefined;
    for (const attribute of attributes) {
      const [key, ...rest] = attribute.trim().split("=");
      const value = rest.join("=");
      switch (key?.toLowerCase()) {
        case "domain": {
          domain = value.toLowerCase();
          hostOnly = false;
          break;
        }
        case "path": {
          path = value.startsWith("/") ? value : path;
          break;
        }
        case "secure": {
          secure = true;
          break;
        }
        case "expires": {
          expires = Date.parse(value) / 1000;
          break;
        }
        case "max-age": {
          maxAge = Number(value);
          break;
        }
        default: {
          break;
        }
      }
    }
    const normalizedDomain = domain.replace(/^\./u, "");
    if (
      url.hostname !== normalizedDomain &&
      !url.hostname.endsWith(`.${normalizedDomain}`)
    ) {
      continue;
    }
    expires = cookieExpiresAt(maxAge, expires, now);
    const name = pair.slice(0, equals).trim();
    const value = pair.slice(equals + 1).trim();
    cookies = cookies.filter(
      (cookie) =>
        !(
          cookie.name === name &&
          cookie.domain.replace(/^\./u, "") === normalizedDomain &&
          cookie.path === path
        )
    );
    if (value !== "" && !(expires >= 0 && expires * 1000 <= now)) {
      cookies.push({ domain, expires, hostOnly, name, path, secure, value });
    }
  }
  return cookies;
};
