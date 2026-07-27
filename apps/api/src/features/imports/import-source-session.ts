const MaximumCookieJarBytes = 64 * 1024;
const MaximumCookieCount = 64;
const MaximumCookieNameBytes = 256;
const MaximumCookieValueBytes = 4096;
const MaximumCookieHeaderBytes = 8192;

const AllowedMediaHostnameSuffixes = [
  "akamaized.net",
  "byteoversea.com",
  "ibytedtos.com",
  "muscdn.com",
  "tiktok.com",
  "tiktokcdn-us.com",
  "tiktokcdn.com",
  "tiktokv.com",
] as const;

/** Tests whether a hostname belongs to the bounded TikTok media allowlist. */
export const isAllowedTikTokMediaHostname = (hostname: string) => {
  const normalized = hostname.toLowerCase();
  return AllowedMediaHostnameSuffixes.some(
    (suffix) => normalized === suffix || normalized.endsWith(`.${suffix}`)
  );
};

interface SessionCookie {
  readonly domain: string;
  readonly expiresAtSeconds: number;
  readonly includeSubdomains: boolean;
  readonly name: string;
  readonly path: string;
  readonly secure: boolean;
  readonly value: string;
}

declare const MediaSessionCapabilityBrand: unique symbol;

/** Internal-only capability: never encode, checkpoint, persist, log, or return from RPC. */
export interface MediaSessionCapability {
  readonly [MediaSessionCapabilityBrand]: "MediaSessionCapability";
}

const SessionCookies = new WeakMap<object, readonly SessionCookie[]>();
const invalidSession = () => new Error("invalid ephemeral media session");
const textBytes = (value: string) => new TextEncoder().encode(value).byteLength;

const containsControlCharacter = (value: string) =>
  [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });

const parseBoolean = (value: string) => {
  if (value === "TRUE") {
    return true;
  }
  if (value === "FALSE") {
    return false;
  }
  throw invalidSession();
};

const parseCookie = (line: string): SessionCookie => {
  const fields = line.split("\t");
  if (fields.length !== 7) {
    throw invalidSession();
  }
  const [
    rawDomain,
    rawIncludeSubdomains,
    path,
    rawSecure,
    rawExpiresAt,
    name,
    value,
  ] = fields as [string, string, string, string, string, string, string];
  const domain = rawDomain.replace(/^#HttpOnly_/u, "").replace(/^\./u, "");
  if (
    domain.length === 0 ||
    domain !== domain.toLowerCase() ||
    domain !== new URL(`https://${domain}/`).hostname ||
    !isAllowedTikTokMediaHostname(domain) ||
    path.length === 0 ||
    !path.startsWith("/") ||
    textBytes(path) > 2048 ||
    containsControlCharacter(path) ||
    name.length === 0 ||
    textBytes(name) > MaximumCookieNameBytes ||
    !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u.test(name) ||
    textBytes(value) > MaximumCookieValueBytes ||
    value.includes(";") ||
    containsControlCharacter(value)
  ) {
    throw invalidSession();
  }
  const expiresAtSeconds = Number(rawExpiresAt);
  if (
    !Number.isSafeInteger(expiresAtSeconds) ||
    expiresAtSeconds < 0 ||
    expiresAtSeconds > 99_999_999_999
  ) {
    throw invalidSession();
  }
  return {
    domain,
    expiresAtSeconds,
    includeSubdomains: parseBoolean(rawIncludeSubdomains),
    name,
    path,
    secure: parseBoolean(rawSecure),
    value,
  };
};

/** Decodes a bounded yt-dlp Netscape cookie jar into an in-memory capability. */
export const decodeTikTokMediaSession = (
  input: Uint8Array
): MediaSessionCapability => {
  if (input.byteLength === 0 || input.byteLength > MaximumCookieJarBytes) {
    throw invalidSession();
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(input);
  } catch {
    throw invalidSession();
  }
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  if (
    !["# HTTP Cookie File", "# Netscape HTTP Cookie File"].includes(
      lines[0] ?? ""
    )
  ) {
    throw invalidSession();
  }
  const cookies = lines
    .slice(1)
    .filter(
      (line) =>
        line.length > 0 &&
        (!line.startsWith("#") || line.startsWith("#HttpOnly_"))
    )
    .map(parseCookie);
  if (cookies.length === 0 || cookies.length > MaximumCookieCount) {
    throw invalidSession();
  }
  const capability = Object.freeze({}) as MediaSessionCapability;
  SessionCookies.set(capability, cookies);
  return capability;
};

const domainMatches = (cookie: SessionCookie, hostname: string) =>
  hostname === cookie.domain ||
  (cookie.includeSubdomains && hostname.endsWith(`.${cookie.domain}`));

const pathMatches = (cookiePath: string, requestPath: string) =>
  requestPath === cookiePath ||
  (requestPath.startsWith(cookiePath) &&
    (cookiePath.endsWith("/") ||
      requestPath.charAt(cookiePath.length) === "/"));

/** Selects the session cookies that are valid for one already-validated request. */
export const mediaSessionCookieHeader = (
  session: MediaSessionCapability,
  url: URL,
  nowSeconds = Math.floor(Date.now() / 1000)
): string | undefined => {
  const cookies = SessionCookies.get(session);
  if (cookies === undefined) {
    throw invalidSession();
  }
  const hostname = url.hostname.toLowerCase();
  const header = cookies
    .filter(
      (cookie) =>
        domainMatches(cookie, hostname) &&
        pathMatches(cookie.path, url.pathname) &&
        (!cookie.secure || url.protocol === "https:") &&
        (cookie.expiresAtSeconds === 0 || cookie.expiresAtSeconds > nowSeconds)
    )
    .toSorted((left, right) => right.path.length - left.path.length)
    .map(({ name, value }) => `${name}=${value}`)
    .join("; ");
  if (textBytes(header) > MaximumCookieHeaderBytes) {
    throw invalidSession();
  }
  return header.length === 0 ? undefined : header;
};
