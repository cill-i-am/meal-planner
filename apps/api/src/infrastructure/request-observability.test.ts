import { Cause, Effect, Exit, Logger, Option } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { describe, expect, it } from "vitest";

import { HttpRequestId, observeHttpRequest } from "./request-observability.js";

const request = (path: string) =>
  HttpServerRequest.fromWeb(new Request(`https://example.test${path}`));

describe("request completion events", () => {
  it("isolates concurrent requests and correlates each response with one event", async () => {
    const events: unknown[] = [];
    const logger = Logger.make((options) => events.push(options.message));
    const responses = await Effect.runPromise(
      Effect.all(
        [
          observeHttpRequest(
            HttpRequestId.pipe(
              Effect.map((id) =>
                HttpServerResponse.text("first", {
                  headers: { "x-operation-id": id },
                  status: 201,
                })
              )
            )
          ).pipe(
            Effect.provideService(
              HttpServerRequest.HttpServerRequest,
              request("/v1/first?token=secret")
            ),
            Effect.withSpan("first")
          ),
          observeHttpRequest(
            Effect.succeed(HttpServerResponse.text("second"))
          ).pipe(
            Effect.provideService(
              HttpServerRequest.HttpServerRequest,
              request("/v1/second")
            ),
            Effect.withSpan("second")
          ),
        ],
        { concurrency: "unbounded" }
      ).pipe(Effect.provide(Logger.layer([logger])))
    );
    const [first, second] = responses;
    expect(first.headers["x-operation-id"]).toBe(first.headers["x-request-id"]);
    expect(first.headers["x-request-id"]).not.toBe(
      second.headers["x-request-id"]
    );
    expect(events).toHaveLength(2);
    expect(events).toContainEqual([
      expect.objectContaining({
        event: "http.request.completed",
        path: "/v1/first",
        requestId: first.headers["x-request-id"],
        status: 201,
        traceId: expect.any(String),
      }),
    ]);
    expect(events).toContainEqual([
      expect.objectContaining({
        path: "/v1/second",
        requestId: second.headers["x-request-id"],
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain("secret");
  });

  it("preserves native raw responses without changing their headers or identity", async () => {
    const native = new Response("streamed body", {
      headers: { "x-native": "unchanged" },
    });
    const response = await Effect.runPromise(
      observeHttpRequest(Effect.succeed(HttpServerResponse.raw(native))).pipe(
        Effect.provideService(
          HttpServerRequest.HttpServerRequest,
          request("/v1/private")
        ),
        Effect.provide(Logger.layer([]))
      )
    );
    expect(HttpServerResponse.toWeb(response)).toBe(native);
    expect(native.headers.get("x-request-id")).toBeNull();
    expect(await native.text()).toBe("streamed body");
  });

  it("preserves failures and emits only their category, with auth tokens removed", async () => {
    const events: unknown[] = [];
    const failure = {
      _tag: "DependencyUnavailable",
      message: "secret-credential",
    };
    const exit = await Effect.runPromiseExit(
      observeHttpRequest(Effect.fail(failure)).pipe(
        Effect.provideService(
          HttpServerRequest.HttpServerRequest,
          request("/api/auth/reset-password/private-token?token=private-query")
        ),
        Effect.provide(
          Logger.layer([Logger.make((options) => events.push(options.message))])
        )
      )
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Option.getOrThrow(Cause.findErrorOption(exit.cause))).toBe(
        failure
      );
    }
    expect(events).toEqual([
      [
        expect.objectContaining({
          errorTags: ["DependencyUnavailable"],
          path: "/api/auth/reset-password",
          status: 500,
        }),
      ],
    ]);
    expect(JSON.stringify(events)).not.toMatch(
      /secret-credential|private-token|private-query/u
    );
  });

  it("emits a cancellation event and preserves interruption", async () => {
    const events: unknown[] = [];
    const exit = await Effect.runPromiseExit(
      observeHttpRequest(Effect.interrupt).pipe(
        Effect.provideService(
          HttpServerRequest.HttpServerRequest,
          request("/v1/cancel")
        ),
        Effect.provide(
          Logger.layer([Logger.make((options) => events.push(options.message))])
        )
      )
    );
    expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(
      true
    );
    expect(events).toEqual([
      [expect.objectContaining({ errorTags: ["Interrupted"], status: 499 })],
    ]);
  });
});
