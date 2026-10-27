import { RuntimeContext } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { Config, Effect, Redacted } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";

import SigenAccountObjectLive, {
  SigenAccountObject,
} from "./account-object.js";
import { makeHttpHandler } from "./http.js";
import { makeVault } from "./vault.js";

export default class SigenApi extends Cloudflare.Worker<SigenApi>()(
  "SigenApi",
  {
    compatibility: { date: "2026-10-19", flags: ["nodejs_compat"] },
    main: import.meta.url,
    name: "sigen-api",
    // Automatic request logging could retain credentials. Add only sanitized operation metrics after acceptance.
    observability: { enabled: false },
    workersDev: true,
  },
  Effect.gen(function* constructSigenWorker() {
    const accounts = yield* SigenAccountObject;
    const ownerHash = yield* Config.Redacted("SIGEN_OWNER_TOKEN_SHA256");
    const operatorHash = yield* Config.Redacted("SIGEN_OPERATOR_TOKEN_SHA256");
    const encryptionKey = yield* Config.Redacted(
      "SIGEN_SESSION_ENCRYPTION_KEY"
    );
    for (const value of [ownerHash, operatorHash, encryptionKey]) {
      if (!/^[a-f0-9]{64}$/u.test(Redacted.value(value))) {
        return yield* Effect.die("Invalid Sigen secret configuration");
      }
    }
    if (Redacted.value(ownerHash) === Redacted.value(operatorHash)) {
      return yield* Effect.die(
        "Sigen owner and operator credentials must differ"
      );
    }
    const vault = makeVault(encryptionKey);
    const limiter = yield* Cloudflare.Workers.RateLimit("SIGEN_OWNER_LIMIT", {
      namespaceId: 61_804,
      simple: { limit: 30, period: 60 },
    });
    return {
      fetch: Effect.gen(function* handleSigenRequest() {
        const request = yield* HttpServerRequest.HttpServerRequest;
        if (!(request.source instanceof Request)) {
          return yield* Effect.die("Expected a native Request");
        }
        const context = yield* RuntimeContext;
        const bind = <A, E>(program: Effect.Effect<A, E, RuntimeContext>) =>
          program.pipe(Effect.provideService(RuntimeContext, context));
        const account = accounts.getByName("private-owner");
        const handler = makeHttpHandler({
          capabilities: {
            aioDevices: (id) => bind(account.aioDevices(id)),
            aioPowerStatus: (input) => bind(account.aioPowerStatus(input)),
            alarms: (input) => bind(account.alarms(input)),
            approvalGrants: (id) => bind(account.approvalGrants(id)),
            approveCommand: (input) => bind(account.approveCommand(input)),
            automationSettings: (id) => bind(account.automationSettings(id)),
            batterySettings: (id) => bind(account.batterySettings(id)),
            deviceInfo: (input) => bind(account.deviceInfo(input)),
            deviceValues: (input) => bind(account.deviceValues(input)),
            energyFlow: (id) => bind(account.energyFlow(id)),
            energyHistory: (input) => bind(account.energyHistory(input)),
            executeCommand: (input) => bind(account.executeCommand(input)),
            forecast: (input) => bind(account.forecast(input)),
            gateway: (input) => bind(account.gateway(input)),
            getCommand: (input) => bind(account.getCommand(input)),
            gridDevices: (input) => bind(account.gridDevices(input)),
            gridSettings: (id) => bind(account.gridSettings(id)),
            health: bind(account.health()),
            manualOverride: (id) => bind(account.manualOverride(id)),
            operatingMode: (id) => bind(account.operatingMode(id)),
            operatingModes: (id) => bind(account.operatingModes(id)),
            peakShavingSchedule: (id) => bind(account.peakShavingSchedule(id)),
            predictionPlan: (id) => bind(account.predictionPlan(id)),
            prepareCommand: (input) => bind(account.prepareCommand(input)),
            revokeApproval: (input) => bind(account.revokeApproval(input)),
            solarSettings: (id) => bind(account.solarSettings(id)),
            station: (id) => bind(account.station(id)),
            stationIncome: (input) => bind(account.stationIncome(input)),
            stationStatus: (input) => bind(account.stationStatus(input)),
            tariffs: (id) => bind(account.tariffs(id)),
            topology: (input) => bind(account.topology(input)),
          },
          disconnect: bind(account.disconnect()),
          enroll: (input) =>
            vault
              .encrypt(
                Redacted.make({
                  kind: "enrollment",
                  value: Redacted.value(input),
                })
              )
              .pipe(Effect.flatMap((secret) => bind(account.enroll(secret)))),
          operatorHash,
          ownerHash,
          rateLimit: bind(limiter.limit({ key: "private-owner" })).pipe(
            Effect.map((result) => result.success),
            Effect.orElseSucceed(() => false)
          ),
          report: bind(account.report()),
        });
        return HttpServerResponse.fromWeb(yield* handler(request.source));
      }),
    };
  }).pipe(
    Effect.provide(Cloudflare.Workers.RateLimitBinding),
    Effect.provide(SigenAccountObjectLive)
  )
) {}
