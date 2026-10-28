import { Buffer } from "node:buffer";

import { ByteSize, Clock, Effect, Redacted, Schema, flow } from "effect";
import {
  HttpBody,
  HttpClient,
  HttpClientRequest,
  HttpIncomingMessage,
} from "effect/http";

import { makeAlarmsClient } from "./alarms-client.js";
import { makeBackupClient } from "./backup-client.js";
import { makeBackupEventsClient } from "./backup-events-client.js";
import { makeControlsClient } from "./controls-client.js";
import { makeEnergyProfileClient } from "./energy-profile-client.js";
import { makeEquipmentClient } from "./equipment-client.js";
import { makeHistoryClient } from "./history-client.js";
import { makeLoadsClient } from "./loads-client.js";
import type { Enrollment, StationId } from "./model.js";
import {
  EnergyFlow,
  OperatingMode,
  Percent,
  Station,
  SigenFailure,
  TokenBundle,
  failure,
} from "./model.js";
import { makePreheatingClient } from "./preheating-client.js";
import { makeProfileClient } from "./profile-client.js";
import type { ProviderRead } from "./provider-read.js";
import type { RequestBudget } from "./request-budget.js";
import { emptyRequestBudget, makeRequestBudget } from "./request-budget.js";
import { makeSettingsClient } from "./settings-client.js";
import { makeStationsClient } from "./stations-client.js";
import { makeTariffsClient } from "./tariffs-client.js";
import { makeThirdPartyClient } from "./third-party-client.js";

// Protocol constants from solidfox/sigenergy-cloud (MIT). See THIRD_PARTY_NOTICES.md.
const Origin = "https://api-eu.sigencloud.com";
const PasswordKey = new TextEncoder().encode("sigensigensigenp");
const Envelope = Schema.Struct({
  code: Schema.Union([Schema.Number, Schema.String]),
  data: Schema.optionalKey(Schema.Unknown),
});
const TokenResponse = Schema.Struct({
  access_token: TokenBundle.fields.accessToken,
  expires_in: Schema.Number.check(
    Schema.isInt(),
    Schema.isBetween({ maximum: 31_536_000, minimum: 61 })
  ),
  refresh_token: TokenBundle.fields.refreshToken,
});
const OAuthResponse = Schema.Struct({
  access_token: Schema.optionalKey(TokenBundle.fields.accessToken),
  code: Schema.optionalKey(Schema.Union([Schema.Number, Schema.String])),
  data: Schema.optionalKey(Schema.Unknown),
  expires_in: Schema.optionalKey(Schema.Number),
  refresh_token: Schema.optionalKey(TokenBundle.fields.refreshToken),
});
const StationResponse = Schema.Struct({
  batteryCapacity: Schema.NullOr(Schema.Finite),
  dcSnList: Schema.NullOr(Schema.Array(Schema.String)),
  hasAcCharger: Schema.Boolean,
  hasGateway: Schema.Boolean,
  hasSolar: Schema.Boolean,
  onGrid: Schema.Boolean,
  pvCapacity: Schema.NullOr(Schema.Finite),
  stationId: Schema.Number.check(
    Schema.isInt(),
    Schema.isBetween({ maximum: Number.MAX_SAFE_INTEGER, minimum: 1 })
  ),
  stationName: Schema.String,
  status: Schema.Number,
  timeZoneName: Schema.String,
});
const FlowResponse = Schema.Struct({
  batteryPower: Schema.NullOr(Schema.Finite),
  batterySoc: Schema.NullOr(Percent),
  buySellPower: Schema.NullOr(Schema.Finite),
  dateCurrTimeStamp: Schema.Union([Schema.String, Schema.Number, Schema.Null]),
  loadPower: Schema.NullOr(Schema.Finite),
  onGrid: Schema.Boolean,
  pvPower: Schema.NullOr(Schema.Finite),
  stationStatus: Schema.Number,
});
const ModeResponse = Schema.Struct({
  currentMode: Schema.Number,
  currentProfileId: Schema.Number,
});
const parse = <S extends Schema.Top>(schema: S) =>
  flow(
    Schema.decodeUnknownEffect(schema),
    Effect.mapError(() => failure("SchemaMismatch"))
  );
const dcCapability = (serials: readonly string[] | null) => {
  if (serials === null) {
    return "unknown";
  }
  return serials.length > 0 ? "available" : "unavailable";
};

export const transformPassword = (password: Redacted.Redacted<string>) =>
  Effect.tryPromise({
    catch: () => failure("InvalidInput"),
    try: async () => {
      const key = await crypto.subtle.importKey(
        "raw",
        PasswordKey,
        "AES-CBC",
        false,
        ["encrypt"]
      );
      const cipher = await crypto.subtle.encrypt(
        { iv: PasswordKey, name: "AES-CBC" },
        key,
        new TextEncoder().encode(Redacted.value(password))
      );
      return Redacted.make(Buffer.from(cipher).toString("base64"));
    },
  });

/** No dynamic host/path escape hatch, provider messages, response bodies or credentials leave this adapter. */
export const makeSigenClientWithBudget = (budget: RequestBudget) =>
  Effect.gen(function* makeSigenClient() {
    const http = yield* HttpClient.HttpClient;
    const request = (
      method: "GET" | "POST" | "PUT" | "PATCH",
      path: string,
      headers: Readonly<Record<string, string>>,
      body?: HttpBody.HttpBody
    ) =>
      budget.beforeRequest.pipe(
        Effect.timeout("15 seconds"),
        Effect.catchTag("TimeoutError", () => failure("UpstreamUnavailable")),
        Effect.mapError(
          (rejected) => new SigenFailure({ ...rejected, requestNotSent: true })
        ),
        Effect.andThen(
          Effect.gen(function* sendRequest() {
            const response = yield* http
              .execute(
                HttpClientRequest.make(method)(`${Origin}${path}`, {
                  body,
                  headers: {
                    ...headers,
                    lang: "en_US",
                    "sg-pkg": "sigen_app",
                    "user-agent": "meal-planner-sigen/0.1.0",
                  },
                })
              )
              .pipe(Effect.mapError(() => failure("UpstreamUnavailable")));
            if (response.status === 401) {
              return yield* failure("AuthenticationRequired", response.status);
            }
            if (response.status === 403) {
              return yield* failure("PermissionDenied", response.status);
            }
            if (response.status === 429) {
              yield* budget.rateLimited(response.headers["retry-after"]);
              return yield* failure("RateLimited", response.status);
            }
            if (response.status < 200 || response.status >= 300) {
              return yield* failure("UpstreamUnavailable", response.status);
            }
            const payload = yield* response.json.pipe(
              Effect.mapError(() => failure("SchemaMismatch"))
            );
            return payload;
          }).pipe(
            Effect.provideService(
              HttpIncomingMessage.MaxBodySize,
              ByteSize.kibibytes(512)
            ),
            Effect.timeout("15 seconds"),
            Effect.catchTag("TimeoutError", () =>
              failure("UpstreamUnavailable")
            )
          )
        )
      );

    const unwrap = flow(
      parse(Envelope),
      Effect.flatMap((envelope) =>
        Effect.gen(function* unwrapEnvelope() {
          const code = String(envelope.code);
          if (code === "401") {
            return yield* failure("AuthenticationRequired");
          }
          if (code === "403") {
            return yield* failure("PermissionDenied");
          }
          if (code === "429") {
            yield* budget.rateLimited();
            return yield* failure("RateLimited");
          }
          if (code !== "0") {
            return yield* failure("UpstreamUnavailable");
          }
          return envelope.data;
        })
      )
    );

    const token = (form: Readonly<Record<string, string>>) =>
      Effect.gen(function* requestToken() {
        const startedAt = yield* Clock.currentTimeMillis;
        const data = yield* request(
          "POST",
          "/auth/oauth/token",
          { authorization: "Basic c2lnZW46c2lnZW4=" },
          HttpBody.urlParams(form)
        );
        const response = yield* parse(OAuthResponse)(data);
        const payload =
          response.code === undefined ? response : yield* unwrap(response);
        const parsed = yield* parse(TokenResponse)(payload);
        return Redacted.make({
          accessToken: parsed.access_token,
          expiresAt: startedAt + parsed.expires_in * 1000,
          refreshToken: parsed.refresh_token,
        });
      });
    const read: ProviderRead = (path, accessToken, appVersion) => {
      const headers: Record<string, string> = {
        authorization: `Bearer ${Redacted.value(accessToken)}`,
        "content-type": "application/json",
      };
      if (appVersion !== undefined) {
        headers["sg-app-version"] = appVersion;
        headers["sg-v"] = appVersion;
      }
      return request("GET", path, headers).pipe(Effect.flatMap(unwrap));
    };

    return {
      ...makeControlsClient(read, (method, path, body, accessToken) =>
        request(
          method,
          path,
          {
            authorization: `Bearer ${Redacted.value(accessToken)}`,
          },
          body === null
            ? undefined
            : HttpBody.text(JSON.stringify(body), "application/json")
        ).pipe(Effect.flatMap(unwrap), Effect.asVoid)
      ),
      ...makeSettingsClient(read),
      ...makeTariffsClient(read),
      ...makeEquipmentClient(read),
      ...makeAlarmsClient(read),
      ...makeBackupClient(read),
      ...makeBackupEventsClient(read),
      ...makeProfileClient(read),
      ...makeThirdPartyClient(read),
      ...makePreheatingClient(read),
      ...makeLoadsClient(read),
      ...makeStationsClient(read),
      ...makeEnergyProfileClient(read),
      ...makeHistoryClient(read),
      energyFlow: (id: StationId, accessToken: Redacted.Redacted<string>) =>
        Effect.gen(function* energyFlow() {
          const data = yield* read(
            `/device/sigen/station/energyflow?id=${encodeURIComponent(id)}`,
            accessToken
          ).pipe(Effect.flatMap((value) => parse(FlowResponse)(value)));
          const timestamp =
            data.dateCurrTimeStamp === "" || data.dateCurrTimeStamp === null
              ? null
              : Number(data.dateCurrTimeStamp);
          const watts = (kw: number | null) => (kw === null ? null : kw * 1000);
          return yield* parse(EnergyFlow)({
            batteryPowerConvention: "positive_charge_negative_discharge",
            batteryPowerW: watts(data.batteryPower),
            batterySocPercent: data.batterySoc,
            fetchedAt: yield* Clock.currentTimeMillis,
            freshness: timestamp === null ? "unknown" : "provider_timestamp",
            gridPowerConvention: "provider_sign_unverified",
            gridPowerW: watts(data.buySellPower),
            loadPowerW: watts(data.loadPower),
            onGrid: data.onGrid,
            providerStatus: data.stationStatus,
            providerTimestamp: timestamp,
            solarPowerW: watts(data.pvPower),
            stationId: id,
          });
        }),
      login: (input: Redacted.Redacted<Enrollment>) =>
        Effect.gen(function* login() {
          const credentials = Redacted.value(input);
          const password = yield* transformPassword(
            Redacted.make(credentials.password)
          );
          return yield* token({
            grant_type: "password",
            password: Redacted.value(password),
            username: credentials.username,
          });
        }),
      operatingMode: (id: StationId, accessToken: Redacted.Redacted<string>) =>
        Effect.gen(function* operatingMode() {
          const data = yield* read(
            `/device/energy-profile/mode/current/${encodeURIComponent(id)}`,
            accessToken
          ).pipe(Effect.flatMap((value) => parse(ModeResponse)(value)));
          return yield* parse(OperatingMode)({
            fetchedAt: yield* Clock.currentTimeMillis,
            profileId: data.currentProfileId,
            providerMode: data.currentMode,
            stationId: id,
          });
        }),
      refresh: (refreshToken: Redacted.Redacted<string>) =>
        token({
          grant_type: "refresh_token",
          refresh_token: Redacted.value(refreshToken),
        }),
      station: (id: StationId, accessToken: Redacted.Redacted<string>) =>
        Effect.gen(function* station() {
          const data = yield* read(
            `/device/owner/station/home?stationId=${encodeURIComponent(id)}`,
            accessToken
          ).pipe(Effect.flatMap((value) => parse(StationResponse)(value)));
          if (String(data.stationId) !== id) {
            return yield* failure("PermissionDenied");
          }
          return yield* parse(Station)({
            batteryCapacityKwh: data.batteryCapacity,
            capabilities: {
              acCharger: data.hasAcCharger ? "available" : "unavailable",
              dcCharger: dcCapability(data.dcSnList),
              gateway: data.hasGateway ? "available" : "unavailable",
              solar: data.hasSolar ? "available" : "unavailable",
            },
            fetchedAt: yield* Clock.currentTimeMillis,
            name: data.stationName,
            onGrid: data.onGrid,
            providerStatus: data.status,
            solarCapacityKw: data.pvCapacity,
            stationId: id,
            timezone: data.timeZoneName,
          });
        }),
    };
  });
export const makeSigenClient = Effect.gen(function* ephemeralClient() {
  let state = emptyRequestBudget;
  const budget = yield* makeRequestBudget({
    read: Effect.sync(() => state),
    write: (next) =>
      Effect.sync(() => {
        state = next;
      }),
  });
  return yield* makeSigenClientWithBudget(budget);
});

export type SigenClient = Effect.Success<typeof makeSigenClient>;
