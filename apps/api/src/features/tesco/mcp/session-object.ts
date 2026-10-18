import { RuntimeContext } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import {
  ByteSize,
  Clock,
  Config,
  Effect,
  Layer,
  Redacted,
  Schema,
  Semaphore,
} from "effect";
import { FetchHttpClient, HttpClient, HttpIncomingMessage } from "effect/http";

import { TescoAuthSession } from "../auth/auth-session.port.js";
import { TescoCredentialsRejected } from "../auth/auth.errors.js";
import { makeTescoAuthenticatedGraphQlTransportLive } from "../catalogue/authenticated-graphql-transport.js";
import type { TescoCatalogueError } from "../catalogue/catalogue.errors.js";
import { TescoCatalogue } from "../catalogue/catalogue.port.js";
import { makeTescoXapiCatalogueLive } from "../catalogue/xapi-catalogue.js";
import { TescoApiKeyValue, TescoLocale, TescoRegion } from "../tesco.config.js";
import type { TescoCatalogueConfig } from "../tesco.config.js";
import {
  TescoMcpCategory,
  TescoMcpSearch,
  TescoMcpSuggestions,
} from "./mcp.contract.js";
import { EncryptedTescoSession, TescoSessionFailure } from "./session.model.js";
import {
  makeSessionEncryption,
  makeTescoSessionService,
  TescoSessionRecord,
} from "./session.service.js";
import type { TescoSessionStorage } from "./session.service.js";

const invalidInput = () => new TescoSessionFailure({ reason: "invalid_input" });
const storageFailure = () => new TescoSessionFailure({ reason: "storage" });
const catalogueFailure = (failure: TescoCatalogueError) =>
  new TescoSessionFailure({
    reason:
      failure._tag === "TescoCatalogueAuthenticationUnavailable"
        ? "authentication"
        : "upstream",
  });

/** Alchemy owns the Effect runtime; this object alone owns session persistence, serialization and alarms. */
const TescoSessionRuntime = Effect.gen(function* constructSessionObject() {
  const state = yield* Cloudflare.DurableObjectState;
  const encryptionSecret = yield* Config.Redacted(
    "TESCO_SESSION_ENCRYPTION_KEY"
  ).pipe(Effect.orDie);
  const client = yield* HttpClient.HttpClient;
  return Effect.gen(function* initializeSessionStorage() {
    const lock = yield* Semaphore.make(1);
    const storage: TescoSessionStorage<RuntimeContext> = {
      read: state.storage.get<unknown>("tesco-session-v1").pipe(
        Effect.flatMap((value) =>
          value === undefined
            ? Effect.succeed({ needsReauthentication: false, session: null })
            : Schema.decodeUnknownEffect(TescoSessionRecord)(value)
        ),
        Effect.mapError(storageFailure)
      ),
      write: (record, alarmAt) =>
        state.storage
          .transaction(
            Effect.gen(function* write() {
              yield* state.storage.put("tesco-session-v1", record);
              yield* alarmAt === null
                ? state.storage.deleteAlarm()
                : state.storage.setAlarm(alarmAt);
            })
          )
          .pipe(Effect.mapError(storageFailure)),
    };
    const sessions = yield* makeTescoSessionService(
      storage,
      encryptionSecret
    ).pipe(Effect.provideService(HttpClient.HttpClient, client));
    const encryption = makeSessionEncryption(encryptionSecret);

    const catalogue = <A>(
      call: (service: TescoCatalogue) => Effect.Effect<A, TescoCatalogueError>
    ) =>
      lock.withPermits(1)(
        Effect.gen(function* invokeCatalogue() {
          const runtimeContext = yield* RuntimeContext;
          const atBoundary = <Value, Error>(
            program: Effect.Effect<Value, Error, RuntimeContext>
          ) =>
            program.pipe(Effect.provideService(RuntimeContext, runtimeContext));
          const credentials = Redacted.value(yield* sessions.credentials);
          const config: TescoCatalogueConfig = {
            locale: Schema.decodeUnknownSync(TescoLocale)("en-IE"),
            mangoApiKey: Redacted.make(
              yield* Schema.decodeUnknownEffect(TescoApiKeyValue)(
                credentials.mangoApiKey
              ).pipe(Effect.mapError(invalidInput))
            ),
            mangoUrl: new URL(credentials.mangoUrl),
            region: Schema.decodeUnknownSync(TescoRegion)("IE"),
            releaseBranch: null,
            suggestionUrl: new URL(
              "https://search.api.tesco.com/search/suggestion/"
            ),
            transactionPurpose: null,
          };
          const auth = Layer.succeed(
            TescoAuthSession,
            TescoAuthSession.of({
              authorization: atBoundary(sessions.credentials).pipe(
                Effect.map((value) =>
                  Redacted.make(Redacted.value(value).authorization)
                ),
                Effect.mapError(() => new TescoCredentialsRejected())
              ),
              refreshAfterUnauthorized: (failed) =>
                atBoundary(sessions.forceRefresh(Redacted.value(failed))).pipe(
                  Effect.map((value) =>
                    Redacted.make(Redacted.value(value).authorization)
                  ),
                  Effect.mapError(() => new TescoCredentialsRejected())
                ),
            })
          );
          const live = makeTescoXapiCatalogueLive(config).pipe(
            Layer.provide(
              makeTescoAuthenticatedGraphQlTransportLive(config).pipe(
                Layer.provide(auth)
              )
            ),
            Layer.provide(Layer.succeed(HttpClient.HttpClient, client))
          );
          return yield* TescoCatalogue.use(call).pipe(
            Effect.provide(live),
            Effect.mapError(catalogueFailure)
          );
        }).pipe(
          Effect.timeout("70 seconds"),
          Effect.mapError((failure) =>
            failure._tag === "TimeoutError"
              ? new TescoSessionFailure({ reason: "upstream" })
              : failure
          )
        )
      );
    const boundary = <A, E, R>(program: Effect.Effect<A, E, R>) =>
      program.pipe(
        Effect.provideService(
          HttpIncomingMessage.MaxBodySize,
          ByteSize.kibibytes(512)
        ),
        Effect.scoped
      );

    return {
      alarm: () =>
        boundary(lock.withPermits(1)(sessions.onAlarm)).pipe(
          Effect.catchTag("TescoSessionFailure", (failure) =>
            failure.reason === "storage"
              ? Clock.currentTimeMillis.pipe(
                  Effect.flatMap((now) => state.storage.setAlarm(now + 300_000))
                )
              : Effect.void
          )
        ),
      categoryProducts: (input: typeof TescoMcpCategory.Type) =>
        boundary(
          Schema.decodeUnknownEffect(TescoMcpCategory)(input).pipe(
            Effect.mapError(invalidInput),
            Effect.flatMap((value) =>
              catalogue((service) => service.categoryProducts(value))
            )
          )
        ),
      connectionHealth: () => boundary(lock.withPermits(1)(sessions.health)),
      disconnect: () => boundary(lock.withPermits(1)(sessions.disconnect)),
      enroll: (input: typeof EncryptedTescoSession.Type) =>
        boundary(
          lock.withPermits(1)(
            Effect.gen(function* enroll() {
              const encrypted = yield* Schema.decodeUnknownEffect(
                EncryptedTescoSession
              )(input).pipe(Effect.mapError(invalidInput));
              const credentials = yield* encryption.decrypt(encrypted);
              yield* sessions.enroll(Redacted.value(credentials));
              return yield* sessions.health;
            })
          )
        ),
      search: (input: typeof TescoMcpSearch.Type) =>
        boundary(
          Schema.decodeUnknownEffect(TescoMcpSearch)(input).pipe(
            Effect.mapError(invalidInput),
            Effect.flatMap((value) =>
              catalogue((service) => service.search(value))
            )
          )
        ),
      suggestions: (input: typeof TescoMcpSuggestions.Type) =>
        boundary(
          Schema.decodeUnknownEffect(TescoMcpSuggestions)(input).pipe(
            Effect.mapError(invalidInput),
            Effect.flatMap((value) =>
              catalogue((service) => service.suggestions(value))
            )
          )
        ),
    };
  });
}).pipe(
  Effect.provide(FetchHttpClient.layer),
  Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" })
);

type TescoSessionObjectShape = Effect.Success<
  Effect.Success<typeof TescoSessionRuntime>
>;
export class TescoSessionObject extends Cloudflare.DurableObject<
  TescoSessionObject,
  TescoSessionObjectShape
>()("TescoSessionObject", { errors: [TescoSessionFailure] }) {}

export default TescoSessionObject.make(TescoSessionRuntime);
