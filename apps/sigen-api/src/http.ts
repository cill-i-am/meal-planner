import { createHash, timingSafeEqual } from "node:crypto";

import { Enrollment, failure } from "@meal-planner/sigen";
import type { ConnectionStatus, SigenFailure } from "@meal-planner/sigen";
import { Effect, Redacted, Schema, Stream } from "effect";

import { SigenCapabilities, openApi, operations } from "./contracts.js";
import { handleMcp } from "./mcp.js";
import type { SessionReport } from "./session.js";

export const authorized = (
  request: Request,
  verifier: Redacted.Redacted<string>
) => {
  const value = request.headers.get("authorization") ?? "";
  const hash = Redacted.value(verifier);
  return (
    /^Bearer [a-f0-9]{64}$/u.test(value) &&
    /^[a-f0-9]{64}$/u.test(hash) &&
    timingSafeEqual(
      createHash("sha256").update(value.slice(7)).digest(),
      Buffer.from(hash, "hex")
    )
  );
};
const json = (value: object, status = 200) =>
  Response.json(value, {
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
    status,
  });
export const readJson = (request: Request) =>
  Effect.gen(function* readBoundedJson() {
    const { body } = request;
    if (body === null) {
      return yield* failure("InvalidInput");
    }
    let length = 0;
    const chunks = yield* Stream.fromReadableStream({
      evaluate: () => body,
      onError: () => failure("InvalidInput"),
    }).pipe(
      Stream.mapEffect((chunk) => {
        length += chunk.byteLength;
        return length > 65_536
          ? Effect.fail(failure("InvalidInput"))
          : Effect.succeed(chunk);
      }),
      Stream.runCollect
    );
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return yield* Effect.try({
      catch: () => failure("InvalidInput"),
      try: (): unknown => JSON.parse(new TextDecoder().decode(bytes)),
    });
  });
export interface HttpOptions {
  readonly ownerHash: Redacted.Redacted<string>;
  readonly operatorHash: Redacted.Redacted<string>;
  readonly capabilities: SigenCapabilities["Service"];
  readonly enroll: (
    input: Redacted.Redacted<Enrollment>
  ) => Effect.Effect<typeof ConnectionStatus.Type, SigenFailure>;
  readonly report: Effect.Effect<typeof SessionReport.Type, SigenFailure>;
  readonly disconnect: Effect.Effect<void, SigenFailure>;
  readonly rateLimit: Effect.Effect<boolean>;
}
const errorStatus = (reason: SigenFailure["reason"]) => {
  switch (reason) {
    case "InvalidInput": {
      return 400;
    }
    case "PermissionDenied": {
      return 403;
    }
    case "RateLimited": {
      return 429;
    }
    default: {
      return 503;
    }
  }
};
const jsonError = (error: SigenFailure) =>
  Effect.succeed(json({ error: error.reason }, errorStatus(error.reason)));

const whenAborted = (signal: AbortSignal) =>
  Effect.callback<never>((resume) => {
    if (signal.aborted) {
      resume(Effect.interrupt);
      return;
    }
    const abort = () => resume(Effect.interrupt);
    signal.addEventListener("abort", abort, { once: true });
    return Effect.sync(() => signal.removeEventListener("abort", abort));
  });

export const makeHttpHandler = (options: HttpOptions) => (request: Request) =>
  Effect.suspend(() =>
    request.signal.aborted
      ? Effect.interrupt
      : Effect.gen(function* serveHttp() {
          const path = new URL(request.url).pathname;
          const admin = path === "/admin/session";
          if (
            !authorized(
              request,
              admin ? options.operatorHash : options.ownerHash
            )
          ) {
            return new Response(null, {
              headers: {
                "cache-control": "no-store",
                "www-authenticate": "Bearer",
              },
              status: 401,
            });
          }
          if (request.headers.has("origin")) {
            return json({ error: "BrowserOriginRefused" }, 403);
          }
          if (!(yield* options.rateLimit)) {
            return new Response(null, {
              headers: { "cache-control": "no-store", "retry-after": "60" },
              status: 429,
            });
          }
          if (admin && request.method === "GET") {
            return json(yield* options.report);
          }
          if (admin && request.method === "DELETE") {
            yield* options.disconnect;
            return new Response(null, {
              headers: { "cache-control": "no-store" },
              status: 204,
            });
          }
          if (path === "/openapi.json" && request.method === "GET") {
            return json(openApi);
          }
          if (request.method !== "POST") {
            return json({ error: "MethodNotAllowed" }, 405);
          }
          if (
            request.headers.get("content-type")?.split(";")[0]?.trim() !==
            "application/json"
          ) {
            return json({ error: "JsonRequired" }, 415);
          }
          if (admin) {
            const input = yield* readJson(request).pipe(
              Effect.flatMap((value) =>
                Schema.decodeUnknownEffect(Enrollment)(value, {
                  onExcessProperty: "error",
                })
              ),
              Effect.mapError(() => failure("InvalidInput"))
            );
            return json(yield* options.enroll(Redacted.make(input)));
          }
          if (path === "/mcp") {
            return yield* handleMcp(request).pipe(
              Effect.provideService(SigenCapabilities, options.capabilities)
            );
          }
          const operation = operations.find((op) => path === `/v1/${op.name}`);
          if (operation === undefined) {
            return json({ error: "NotFound" }, 404);
          }
          return json(
            yield* readJson(request).pipe(
              Effect.flatMap(operation.execute),
              Effect.provideService(SigenCapabilities, options.capabilities)
            )
          );
        })
  ).pipe(
    Effect.raceFirst(whenAborted(request.signal)),
    Effect.catchTag("SigenFailure", jsonError),
    Effect.scoped
  );
