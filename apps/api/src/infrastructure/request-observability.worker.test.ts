import type * as NativeCloudflare from "@cloudflare/workers-types";
import { Effect, Logger } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { expect, it } from "vitest";

import { observeHttpRequest } from "./request-observability.js";

declare const Response: typeof NativeCloudflare.Response;
declare const WebSocketPair: typeof NativeCloudflare.WebSocketPair;

it("preserves the native WebSocket upgrade while recording response handoff", async () => {
  const pair = new WebSocketPair();
  pair[1].accept();
  const native = new Response(null, { status: 101, webSocket: pair[0] });
  try {
    const response = await Effect.runPromise(
      observeHttpRequest(
        Effect.succeed(HttpServerResponse.raw(native, { status: 101 }))
      ).pipe(
        Effect.provideService(
          HttpServerRequest.HttpServerRequest,
          HttpServerRequest.fromWeb(
            new Request("https://example.test/v1/private")
          )
        ),
        Effect.provide(Logger.layer([]))
      )
    );
    expect(response.status).toBe(101);
    expect(HttpServerResponse.toWeb(response)).toBe(native);
    expect(native.webSocket).toBe(pair[0]);
    pair[0].accept();
  } finally {
    pair[1].close();
  }
});
