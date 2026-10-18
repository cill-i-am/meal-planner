import { RuntimeContext } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { Config, Effect } from "effect";
import { HttpServerRequest } from "effect/http";

import { fromNativeWebResponse } from "../../../infrastructure/native-http-response.js";
import { makeTescoMcpHttpHandler } from "./mcp.http.js";
import TescoSessionObjectLive, {
  TescoSessionObject,
} from "./session-object.js";
import { makeSessionEncryption } from "./session.service.js";

export default class TescoMcp extends Cloudflare.Worker<TescoMcp>()(
  "TescoMcp",
  {
    compatibility: { date: "2026-10-18", flags: ["nodejs_compat"] },
    main: import.meta.url,
    name: "tesco-mcp",
    observability: { enabled: false },
    workersDev: true,
  },
  Effect.gen(function* TescoMcpRuntime() {
    const objects = yield* TescoSessionObject;
    const executorTokenHash = yield* Config.Redacted(
      "TESCO_EXECUTOR_TOKEN_SHA256"
    );
    const operatorTokenHash = yield* Config.Redacted(
      "TESCO_OPERATOR_TOKEN_SHA256"
    );
    const encryptionSecret = yield* Config.Redacted(
      "TESCO_SESSION_ENCRYPTION_KEY"
    );
    const encryption = makeSessionEncryption(encryptionSecret);
    const rateLimiter = yield* Cloudflare.Workers.RateLimit("TESCO_MCP_LIMIT", {
      namespaceId: 61_803,
      simple: { limit: 60, period: 60 },
    });
    return {
      fetch: Effect.gen(function* fetch() {
        const request = yield* HttpServerRequest.HttpServerRequest;
        if (!(request.source instanceof Request)) {
          return yield* Effect.die("Expected Web Request");
        }
        const runtimeContext = yield* RuntimeContext;
        const object = objects.getByName("executor-owner");
        const bound = <A, E>(program: Effect.Effect<A, E, RuntimeContext>) =>
          program.pipe(Effect.provideService(RuntimeContext, runtimeContext));
        const handler = makeTescoMcpHttpHandler({
          capabilities: {
            categoryProducts: (input) => bound(object.categoryProducts(input)),
            connectionHealth: bound(object.connectionHealth()),
            search: (input) => bound(object.search(input)),
            suggestions: (input) => bound(object.suggestions(input)),
          },
          disconnect: bound(object.disconnect()),
          enroll: (credentials) =>
            encryption
              .encrypt(credentials)
              .pipe(Effect.flatMap((value) => bound(object.enroll(value)))),
          executorTokenHash,
          operatorTokenHash,
          rateLimit: bound(
            rateLimiter.limit({ key: "executor-owner" }).pipe(
              Effect.map((result) => result.success),
              Effect.orElseSucceed(() => false)
            )
          ),
        });
        const response = yield* handler(request.source);
        return fromNativeWebResponse(response);
      }),
    };
  }).pipe(
    Effect.provide(Cloudflare.Workers.RateLimitBinding),
    Effect.provide(TescoSessionObjectLive)
  )
) {}
