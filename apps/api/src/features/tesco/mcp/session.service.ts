import { Buffer } from "node:buffer";

import { Clock, Effect, Redacted, Schema, Stream } from "effect";
import { Cookies, HttpBody, HttpClient } from "effect/http";

import { TescoAuthorizationValue } from "../auth/auth.model.js";
import type {
  EncryptedTescoSession,
  TescoConnectionHealth,
} from "./session.model.js";
import {
  cookieHeaderFor,
  mergeSessionCookies,
  sessionCookie,
  StoredTescoSession,
  TescoRefreshSkewMs,
  TescoSessionCredentials,
  TescoSessionFailure,
  tokenExpiry,
} from "./session.model.js";

export const TescoSessionRecord = Schema.Struct({
  needsReauthentication: Schema.Boolean,
  session: Schema.NullOr(StoredTescoSession),
});
export type TescoSessionRecord = typeof TescoSessionRecord.Type;

/** The persistence seam commits the encrypted record and next alarm together. */
export interface TescoSessionStorage<R = never> {
  readonly read: Effect.Effect<TescoSessionRecord, TescoSessionFailure, R>;
  readonly write: (
    record: TescoSessionRecord,
    alarmAt: number | null
  ) => Effect.Effect<void, TescoSessionFailure, R>;
}

const encoder = new TextEncoder();
const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const unbase64 = (value: string) =>
  Uint8Array.from(Buffer.from(value, "base64"));
const storageFailure = () => new TescoSessionFailure({ reason: "storage" });
const authenticationFailure = () =>
  new TescoSessionFailure({ reason: "authentication" });
const invalidInput = () => new TescoSessionFailure({ reason: "invalid_input" });

export const makeSessionEncryption = (secret: Redacted.Redacted<string>) => {
  const key = Effect.tryPromise({
    catch: storageFailure,
    try: () => {
      const value = Redacted.value(secret);
      if (!/^[a-f0-9]{64}$/u.test(value)) {
        throw storageFailure();
      }
      const bytes = Uint8Array.from(value.match(/../gu) ?? [], (pair) =>
        Number.parseInt(pair, 16)
      );
      return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [
        "encrypt",
        "decrypt",
      ]);
    },
  });
  return {
    decrypt: (encrypted: typeof EncryptedTescoSession.Type) =>
      Effect.gen(function* decrypt() {
        const cryptoKey = yield* key;
        const clear = yield* Effect.tryPromise({
          catch: storageFailure,
          try: () =>
            crypto.subtle.decrypt(
              { iv: unbase64(encrypted.iv), name: "AES-GCM" },
              cryptoKey,
              unbase64(encrypted.cipher)
            ),
        });
        return yield* Schema.decodeUnknownEffect(
          Schema.fromJsonString(TescoSessionCredentials)
        )(new TextDecoder().decode(clear)).pipe(
          Effect.map(Redacted.make),
          Effect.mapError(storageFailure)
        );
      }),
    encrypt: (credentials: Redacted.Redacted<TescoSessionCredentials>) =>
      Effect.gen(function* encrypt() {
        const cryptoKey = yield* key;
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const cipher = yield* Effect.tryPromise({
          catch: storageFailure,
          try: () =>
            crypto.subtle.encrypt(
              { iv, name: "AES-GCM" },
              cryptoKey,
              encoder.encode(JSON.stringify(Redacted.value(credentials)))
            ),
        });
        return {
          cipher: base64(new Uint8Array(cipher)),
          iv: base64(iv),
          version: 1 as const,
        };
      }),
  };
};

/** All calls are serialized by the owning Durable Object, including operator enrollment. */
export const makeTescoSessionService = <R>(
  storage: TescoSessionStorage<R>,
  encryptionSecret: Redacted.Redacted<string>
) =>
  Effect.gen(function* constructSessionService() {
    const client = yield* HttpClient.HttpClient;
    const encryption = makeSessionEncryption(encryptionSecret);
    const disconnect = (needsReauthentication: boolean) =>
      storage.write({ needsReauthentication, session: null }, null);
    const persist = (
      credentials: Redacted.Redacted<TescoSessionCredentials>,
      phase: StoredTescoSession["phase"],
      lastRefreshedAt: number | null
    ) =>
      Effect.gen(function* persistSessionState() {
        const expiry = yield* Effect.try({
          catch: invalidInput,
          try: () => tokenExpiry(Redacted.value(credentials).cookies),
        });
        const encrypted = yield* encryption.encrypt(credentials);
        const now = yield* Clock.currentTimeMillis;
        const session: StoredTescoSession = {
          accessTokenExpiresAt: expiry.AccessToken,
          credentials: encrypted,
          lastRefreshedAt,
          phase,
          refreshTokenExpiresAt: expiry.RefreshToken,
        };
        // A crash while rotating is ambiguous. The watchdog clears it instead of replaying a refresh token.
        yield* storage.write(
          { needsReauthentication: false, session },
          phase === "refreshing"
            ? now + 300_000
            : Math.max(now + 1000, expiry.AccessToken - TescoRefreshSkewMs)
        );
        return session;
      });

    const refresh = (initial: StoredTescoSession) =>
      Effect.gen(function* renewSessionCredentials() {
        const startedAt = yield* Clock.currentTimeMillis;
        if (
          initial.phase !== "ready" ||
          initial.refreshTokenExpiresAt <= startedAt
        ) {
          yield* disconnect(true);
          return yield* authenticationFailure();
        }
        const secret = yield* encryption.decrypt(initial.credentials);
        const initialCredentials = Redacted.value(secret);
        let { cookies } = initialCredentials;
        const previousRefresh = sessionCookie(
          cookies,
          "OAuth.RefreshToken"
        )?.value;
        yield* persist(secret, "refreshing", initial.lastRefreshedAt);
        const rotate = Effect.gen(function* rotate() {
          let url = new URL(
            "https://www.tesco.ie/account/login/en-IE?from=https%3A%2F%2Fwww.tesco.ie%2Fshop%2Fen-IE&prompt=none"
          );
          for (let hop = 0; hop <= 10; hop += 1) {
            if (url.origin !== "https://www.tesco.ie") {
              return yield* authenticationFailure();
            }
            const now = yield* Clock.currentTimeMillis;
            const response = yield* client
              .get(url, {
                headers: {
                  accept:
                    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                  "accept-language": "en-IE",
                  cookie: cookieHeaderFor(cookies, url, now),
                },
              })
              .pipe(
                Effect.timeout("15 seconds"),
                Effect.mapError(authenticationFailure)
              );
            const setCookies = Cookies.toSetCookieHeaders(response.cookies);
            // Renewal uses headers only. Empty redirect bodies are valid; release any body reader promptly.
            yield* response.stream.pipe(
              Stream.take(1),
              Stream.runDrain,
              Effect.timeout("2 seconds"),
              Effect.ignore
            );
            cookies = mergeSessionCookies(cookies, setCookies, url, now);
            const authorizationCookie = sessionCookie(
              cookies,
              "OAuth.AccessToken"
            );
            const authorization =
              authorizationCookie === undefined
                ? initialCredentials.authorization
                : yield* Schema.decodeUnknownEffect(TescoAuthorizationValue)(
                    authorizationCookie.value.startsWith("Bearer ")
                      ? authorizationCookie.value
                      : `Bearer ${authorizationCookie.value}`
                  ).pipe(Effect.mapError(authenticationFailure));
            const updated = Redacted.make({
              ...initialCredentials,
              authorization,
              cookies,
            });
            const issued =
              setCookies.some((cookie) =>
                cookie.startsWith("OAuth.AccessToken=")
              ) && authorizationCookie !== undefined;
            if (response.status >= 200 && response.status < 400 && issued) {
              const issuedCookies = cookies;
              const expiry = yield* Effect.try({
                catch: authenticationFailure,
                try: () => tokenExpiry(issuedCookies),
              });
              const refreshedAt = yield* Clock.currentTimeMillis;
              if (
                authorization === initialCredentials.authorization ||
                sessionCookie(cookies, "OAuth.RefreshToken")?.value ===
                  previousRefresh ||
                expiry.AccessToken <= refreshedAt + TescoRefreshSkewMs ||
                expiry.AccessToken <= initial.accessTokenExpiresAt
              ) {
                return yield* authenticationFailure();
              }
              const session = yield* persist(updated, "ready", refreshedAt);
              return { credentials: updated, session };
            }
            // Cookie updates are committed before another redirect can consume the rotated state.
            yield* persist(updated, "refreshing", initial.lastRefreshedAt);
            if (response.status < 300 || response.status >= 400) {
              return yield* authenticationFailure();
            }
            const { location } = response.headers;
            if (location === undefined) {
              return yield* authenticationFailure();
            }
            const redirectFrom = url;
            url = yield* Effect.try({
              catch: authenticationFailure,
              try: () => new URL(location, redirectFrom),
            });
          }
          return yield* authenticationFailure();
        });
        return yield* rotate.pipe(
          Effect.timeout("45 seconds"),
          Effect.onError(() => disconnect(true).pipe(Effect.orDie)),
          Effect.mapError(authenticationFailure)
        );
      });

    const ready = Effect.gen(function* ready() {
      const record = yield* storage.read;
      if (record.session === null) {
        return yield* authenticationFailure();
      }
      const now = yield* Clock.currentTimeMillis;
      if (
        record.session.phase === "refreshing" ||
        record.session.refreshTokenExpiresAt <= now
      ) {
        yield* disconnect(true);
        return yield* authenticationFailure();
      }
      if (record.session.accessTokenExpiresAt <= now + TescoRefreshSkewMs) {
        return yield* refresh(record.session);
      }
      return {
        credentials: yield* encryption.decrypt(record.session.credentials),
        session: record.session,
      };
    });

    return {
      credentials: ready.pipe(Effect.map((value) => value.credentials)),
      disconnect: disconnect(false),
      enroll: (input: TescoSessionCredentials) =>
        Effect.gen(function* enroll() {
          const decoded = yield* Schema.decodeUnknownEffect(
            TescoSessionCredentials
          )(input).pipe(
            Effect.map(Redacted.make),
            Effect.mapError(invalidInput)
          );
          const credentials = Redacted.value(decoded);
          const expiry = yield* Effect.try({
            catch: invalidInput,
            try: () => tokenExpiry(credentials.cookies),
          });
          const now = yield* Clock.currentTimeMillis;
          if (
            expiry.AccessToken <= now + TescoRefreshSkewMs ||
            expiry.RefreshToken <= now
          ) {
            return yield* invalidInput();
          }
          const accessCookie = sessionCookie(
            credentials.cookies,
            "OAuth.AccessToken"
          );
          if (
            accessCookie === undefined ||
            `Bearer ${accessCookie.value.replace(/^Bearer /u, "")}` !==
              credentials.authorization ||
            sessionCookie(credentials.cookies, "OAuth.RefreshToken") ===
              undefined
          ) {
            return yield* invalidInput();
          }
          // Verify the bearer, without refreshing it, before replacing any working connection.
          const response = yield* client
            .post("https://xapi.tesco.com/", {
              body: HttpBody.jsonUnsafe({
                operationName: "Search",
                query:
                  "query Search($query: String!, $page: Int!, $count: Int!, $sortBy: String!) { search(query: $query, page: $page, count: $count, sortBy: $sortBy) { info { total } } }",
                variables: {
                  count: 1,
                  page: 1,
                  query: "milk",
                  sortBy: "relevance",
                },
              }),
              headers: {
                authorization: credentials.authorization,
                "content-type": "application/json",
                language: "en-IE",
                region: "IE",
                "x-apikey": credentials.mangoApiKey,
              },
            })
            .pipe(
              Effect.timeout("15 seconds"),
              Effect.mapError(
                () => new TescoSessionFailure({ reason: "upstream" })
              )
            );
          if (response.status !== 200) {
            return yield* authenticationFailure();
          }
          const body = yield* response.json.pipe(
            Effect.timeout("10 seconds"),
            Effect.mapError(authenticationFailure)
          );
          yield* Schema.decodeUnknownEffect(
            Schema.Struct({
              data: Schema.Struct({
                search: Schema.Struct({
                  info: Schema.Struct({ total: Schema.Number }),
                }),
              }),
            })
          )(body).pipe(Effect.mapError(authenticationFailure));
          yield* persist(decoded, "ready", null);
        }),
      forceRefresh: (failedAuthorization: string) =>
        Effect.gen(function* forceRefresh() {
          const record = yield* storage.read;
          if (record.session === null) {
            return yield* authenticationFailure();
          }
          const credentials = yield* encryption.decrypt(
            record.session.credentials
          );
          if (
            Redacted.value(credentials).authorization !== failedAuthorization
          ) {
            return credentials;
          }
          return (yield* refresh(record.session)).credentials;
        }),
      health: Effect.gen(function* health(): Effect.fn.Return<
        TescoConnectionHealth,
        TescoSessionFailure,
        R
      > {
        const record = yield* storage.read;
        const { session } = record;
        const now = yield* Clock.currentTimeMillis;
        const needsReauthentication =
          record.needsReauthentication ||
          session?.phase === "refreshing" ||
          (session !== null && session.refreshTokenExpiresAt <= now);
        let connectionState: TescoConnectionHealth["state"] = "connected";
        if (needsReauthentication) {
          connectionState = "reauthentication_required";
        } else if (session === null) {
          connectionState = "not_connected";
        }
        return {
          accessTokenExpiresAt: session?.accessTokenExpiresAt ?? null,
          lastRefreshedAt: session?.lastRefreshedAt ?? null,
          nextRefreshAt:
            session?.phase === "ready" && !needsReauthentication
              ? Math.max(now, session.accessTokenExpiresAt - TescoRefreshSkewMs)
              : null,
          state: connectionState,
        };
      }),
      onAlarm: Effect.gen(function* onAlarm() {
        const record = yield* storage.read;
        if (record.session === null) {
          return;
        }
        const now = yield* Clock.currentTimeMillis;
        if (record.session.phase === "refreshing") {
          yield* disconnect(true);
          return;
        }
        if (record.session.accessTokenExpiresAt > now + TescoRefreshSkewMs) {
          yield* storage.write(
            record,
            record.session.accessTokenExpiresAt - TescoRefreshSkewMs
          );
          return;
        }
        yield* refresh(record.session);
      }),
    };
  });
