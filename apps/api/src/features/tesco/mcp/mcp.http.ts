import { createHash, timingSafeEqual } from "node:crypto";

import { Effect, Redacted, Schema, Stream } from "effect";

import { tescoPrivateOpenApi } from "./http.contract.js";
import { TescoMcpCapabilities, TescoMcpTools } from "./mcp.contract.js";
import { handleTescoMcp } from "./mcp.protocol.js";
import { TescoSessionCredentials } from "./session.model.js";
import type {
  TescoConnectionHealth,
  TescoSessionFailure,
  TescoSessionReport,
} from "./session.model.js";

const authorized = (
  request: Request,
  expectedHash: Redacted.Redacted<string>
) => {
  const header = request.headers.get("authorization") ?? "";
  if (
    !/^Bearer [a-f0-9]{64}$/u.test(header) ||
    !/^[a-f0-9]{64}$/u.test(Redacted.value(expectedHash))
  ) {
    return false;
  }
  return timingSafeEqual(
    createHash("sha256").update(header.slice(7)).digest(),
    Buffer.from(Redacted.value(expectedHash), "hex")
  );
};

const response = (status: number, error: string) =>
  Response.json(
    { error },
    { headers: { "cache-control": "no-store" }, status }
  );

const readJson = (request: Request) =>
  Effect.gen(function* decodeBoundedJson() {
    const { body } = request;
    const invalid = () => ({ _tag: "InvalidTescoRequest" as const });
    if (body === null) {
      return yield* Effect.fail(invalid());
    }
    let length = 0;
    const chunks = yield* Stream.fromReadableStream({
      evaluate: () => body,
      onError: invalid,
    }).pipe(
      Stream.mapEffect((chunk) => {
        length += chunk.byteLength;
        return length > 65_536 ? Effect.fail(invalid()) : Effect.succeed(chunk);
      }),
      Stream.runCollect
    );
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const json = yield* Effect.try({
      catch: invalid,
      try: () => JSON.parse(new TextDecoder().decode(bytes)) as unknown,
    });
    return json;
  });

export interface TescoMcpHttpOptions {
  readonly capabilities: TescoMcpCapabilities;
  readonly disconnect: Effect.Effect<void, TescoSessionFailure>;
  readonly enroll: (
    credentials: Redacted.Redacted<TescoSessionCredentials>
  ) => Effect.Effect<TescoConnectionHealth, TescoSessionFailure>;
  readonly executorTokenHash: Redacted.Redacted<string>;
  readonly operatorTokenHash: Redacted.Redacted<string>;
  readonly rateLimit: Effect.Effect<boolean>;
  readonly sessionReport: Effect.Effect<
    TescoSessionReport,
    TescoSessionFailure
  >;
}

const requestAborted = (request: Request) =>
  Effect.callback<never>((resume) => {
    const abort = () => resume(Effect.interrupt);
    request.signal.addEventListener("abort", abort, { once: true });
    if (request.signal.aborted) {
      abort();
    }
    return Effect.sync(() =>
      request.signal.removeEventListener("abort", abort)
    );
  });

/** Every path is authenticated before request bodies, MCP initialization or tools/list are processed. */
export const makeTescoMcpHttpHandler =
  (options: TescoMcpHttpOptions) => (request: Request) =>
    Effect.gen(function* serveAuthenticatedRequest() {
      if (request.signal.aborted) {
        return yield* Effect.interrupt;
      }
      const url = new URL(request.url);
      const operator = url.pathname === "/admin/session";
      if (
        !authorized(
          request,
          operator ? options.operatorTokenHash : options.executorTokenHash
        )
      ) {
        return new Response(null, {
          headers: {
            "cache-control": "no-store",
            "www-authenticate": 'Bearer realm="Private Tesco MCP"',
          },
          status: 401,
        });
      }
      // Both principals are machine clients. Browser origins cannot use either credential.
      if (request.headers.has("origin")) {
        return response(403, "browser_origin_not_allowed");
      }
      if (!(yield* options.rateLimit)) {
        return new Response(null, {
          headers: { "cache-control": "no-store", "retry-after": "60" },
          status: 429,
        });
      }
      if (operator) {
        if (request.method === "GET") {
          return Response.json(yield* options.sessionReport, {
            headers: { "cache-control": "no-store" },
          });
        }
        if (request.method === "DELETE") {
          yield* options.disconnect;
          return new Response(null, { status: 204 });
        }
        if (request.method !== "POST") {
          return new Response(null, {
            headers: { allow: "GET, POST, DELETE" },
            status: 405,
          });
        }
        if (
          !request.headers.get("content-type")?.startsWith("application/json")
        ) {
          return response(415, "json_required");
        }
        const credentials = yield* readJson(request).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(TescoSessionCredentials)),
          Effect.map(Redacted.make)
        );
        return Response.json(yield* options.enroll(credentials), {
          headers: { "cache-control": "no-store" },
        });
      }
      if (url.pathname === "/openapi.json") {
        return request.method === "GET"
          ? Response.json(tescoPrivateOpenApi(url.origin), {
              headers: { "cache-control": "no-store" },
            })
          : new Response(null, { headers: { allow: "GET" }, status: 405 });
      }
      const tool = TescoMcpTools.find(
        ({ name }) => url.pathname === `/v1/${name}`
      );
      if (tool !== undefined) {
        if (request.method !== "POST") {
          return new Response(null, {
            headers: { allow: "POST" },
            status: 405,
          });
        }
        if (
          !request.headers.get("content-type")?.startsWith("application/json")
        ) {
          return response(415, "json_required");
        }
        const result = yield* readJson(request).pipe(
          Effect.flatMap(tool.execute),
          Effect.provideService(TescoMcpCapabilities, options.capabilities)
        );
        return Response.json(result, {
          headers: { "cache-control": "no-store" },
        });
      }
      if (url.pathname !== "/mcp") {
        return response(404, "not_found");
      }
      if (request.method !== "POST") {
        return new Response(null, { headers: { allow: "POST" }, status: 405 });
      }
      const mcpResponse = yield* handleTescoMcp(request).pipe(
        Effect.provideService(TescoMcpCapabilities, options.capabilities)
      );
      mcpResponse.headers.set("cache-control", "no-store");
      return mcpResponse;
    }).pipe(
      Effect.raceFirst(requestAborted(request)),
      Effect.scoped,
      Effect.orElseSucceed((failure) => {
        let status = 400;
        if (failure._tag === "TescoSessionFailure") {
          status = failure.reason === "invalid_input" ? 400 : 503;
        } else if (failure._tag === "TescoMcpTransportFailure") {
          status = 500;
        }
        return response(
          status,
          failure._tag === "TescoSessionFailure" &&
            failure.reason === "authentication"
            ? "tesco_reauthentication_required"
            : "request_failed"
        );
      })
    );
