import * as Cloudflare from "alchemy/Cloudflare";
import { Cause, Effect, Exit, Option } from "effect";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { describe, expect, it } from "vitest";

import {
  raceWithRequestSignal,
  withCurrentRequestCancellation,
} from "./request-cancellation.js";

type RequestCancellationSignal = Parameters<typeof raceWithRequestSignal>[0];
type AlchemyRequest = Parameters<typeof Cloudflare.makeRequestEffect>[0];

const asAlchemyRequest = (request: Request): AlchemyRequest =>
  request as unknown as AlchemyRequest;

class RecordingSignal implements RequestCancellationSignal {
  readonly registered = Promise.withResolvers<boolean>();
  aborted: boolean;
  additions = 0;
  removals = 0;
  private listener: (() => void) | undefined;

  constructor(aborted = false) {
    this.aborted = aborted;
  }

  addEventListener(
    type: "abort",
    listener: () => void,
    options: { readonly once: true }
  ) {
    expect(type).toBe("abort");
    expect(options).toEqual({ once: true });
    this.additions += 1;
    this.listener = listener;
    this.registered.resolve(true);
  }

  removeEventListener(type: "abort", listener: () => void) {
    expect(type).toBe("abort");
    expect(listener).toBe(this.listener);
    this.removals += 1;
    this.listener = undefined;
  }

  abort() {
    this.aborted = true;
    this.listener?.();
  }
}

describe("request cancellation", () => {
  it("interrupts before starting work when the request is already aborted", async () => {
    const signal = new RecordingSignal(true);
    let starts = 0;
    const exit = await Effect.runPromiseExit(
      raceWithRequestSignal(
        signal,
        Effect.sync(() => {
          starts += 1;
        })
      )
    );

    expect(Exit.hasInterrupts(exit)).toBe(true);
    expect(starts).toBe(0);
    expect(signal.additions).toBe(0);
    expect(signal.removals).toBe(0);
  });

  it("interrupts without registering when abort wins during callback setup", async () => {
    let abortedReads = 0;
    let additions = 0;
    let removals = 0;
    const signal: RequestCancellationSignal = {
      get aborted() {
        abortedReads += 1;
        return abortedReads > 1;
      },
      addEventListener: () => {
        additions += 1;
      },
      removeEventListener: () => {
        removals += 1;
      },
    };
    const exit = await Effect.runPromiseExit(
      raceWithRequestSignal(signal, Effect.never)
    );

    expect(Exit.hasInterrupts(exit)).toBe(true);
    expect(abortedReads).toBe(2);
    expect(additions).toBe(0);
    expect(removals).toBe(0);
  });

  it("removes its one-shot listener exactly once when work wins", async () => {
    const signal = new RecordingSignal();
    const result = await Effect.runPromise(
      raceWithRequestSignal(
        signal,
        Effect.promise(() => signal.registered.promise).pipe(
          Effect.as("completed")
        )
      )
    );

    expect(result).toBe("completed");
    expect(signal.additions).toBe(1);
    expect(signal.removals).toBe(1);
  });

  it("interrupts work and removes its listener exactly once when abort wins", async () => {
    const signal = new RecordingSignal();
    let finalized = false;
    const completed = Effect.runPromiseExit(
      raceWithRequestSignal(
        signal,
        Effect.never.pipe(
          Effect.ensuring(
            Effect.sync(() => {
              finalized = true;
            })
          )
        )
      )
    );

    await signal.registered.promise;
    signal.abort();
    const exit = await completed;

    expect(Exit.hasInterrupts(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      throw new Error("Expected request interruption");
    }
    expect(Option.isNone(Cause.findErrorOption(exit.cause))).toBe(true);
    expect(finalized).toBe(true);
    expect(signal.additions).toBe(1);
    expect(signal.removals).toBe(1);
  });

  it("propagates the original Alchemy Request signal as interrupt-only 499", async () => {
    const controller = new AbortController();
    const request = new Request("https://meal-planner.test/imports", {
      signal: controller.signal,
    });
    const providerStarted = Promise.withResolvers<boolean>();
    let providerAborted = false;
    let providerFinalized = false;
    const provider = Effect.tryPromise({
      catch: () => new Error("provider failure must remain private"),
      try: (signal) => {
        const pending = Promise.withResolvers<never>();
        providerStarted.resolve(true);
        signal.addEventListener(
          "abort",
          () => {
            providerAborted = true;
            pending.reject(new DOMException("aborted", "AbortError"));
          },
          { once: true }
        );
        return pending.promise;
      },
    }).pipe(
      Effect.as(HttpServerResponse.text("unexpected success")),
      Effect.ensuring(
        Effect.sync(() => {
          providerFinalized = true;
        })
      ),
      Effect.orDie
    );
    const handler = withCurrentRequestCancellation(provider);
    const responsePromise = Effect.runPromise(
      Cloudflare.makeRequestEffect(asAlchemyRequest(request), handler)
    );

    await providerStarted.promise;
    controller.abort();
    const response = (await responsePromise) as Response;

    expect(response.status).toBe(499);
    expect(providerAborted).toBe(true);
    expect(providerFinalized).toBe(true);
  });
});
