import { RecipeImportIntentId } from "@meal-planner/recipe-import-api";
import * as Cloudflare from "alchemy/Cloudflare";
import { Cause, Effect, Exit, Logger, Option, Schema } from "effect";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { describe, expect, it } from "vitest";

import { OperatorCarouselBundle } from "../features/imports/import-carousel-operator.js";
import { makeOperatorCarouselImportService } from "../features/imports/import-carousel-operator.service.js";
import { makeImportIntentApplication } from "../features/imports/import-intent.js";
import { makeImportTraceContext } from "../features/imports/import-observability.js";
import { IdempotencyKey } from "../features/imports/import.contracts.js";
import { sourceIdentityUnavailable } from "../features/imports/import.errors.js";
import type { ImportIntentRepositoryShape } from "../features/imports/import.repository.js";
import { makeTestImportAuthorizer } from "../features/imports/import.test-fixtures.js";
import type { CanonicalSourceIdentityResolverShape } from "../features/imports/source-identity.js";
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

  it("aborts current source resolution before durable admission or workflow start", async () => {
    const controller = new AbortController();
    const providerStarted = Promise.withResolvers<boolean>();
    const logs: unknown[] = [];
    let providerAborted = false;
    let admissionRequests = 0;
    let pipelineStarts = 0;
    let workflowStarts = 0;
    const repository: ImportIntentRepositoryShape = {
      admitIntent: () => {
        admissionRequests += 1;
        return Effect.die("durable admission must not start");
      },
      cancelIntent: () => Effect.die("cancellation must not start"),
      findIntent: () => Effect.die("intent lookup must not start"),
      isIntentExecutionCurrent: () =>
        Effect.die("generation lookup must not start"),
      listStalledIntentStarts: () =>
        Effect.die("stalled-start lookup must not start"),
      readIntentTimeline: () => Effect.die("timeline lookup must not start"),
      requireMutableIntent: () =>
        Effect.die("mutable-intent lookup must not start"),
      resolveIntentSource: () =>
        Effect.die("source resolution persistence must not start"),
      transitionIntent: () => Effect.die("transition must not start"),
    };
    const identityResolver: CanonicalSourceIdentityResolverShape = {
      resolve: () =>
        Effect.tryPromise({
          catch: sourceIdentityUnavailable,
          try: (signal) => {
            const pending = Promise.withResolvers<never>();
            providerStarted.resolve(true);
            signal.addEventListener(
              "abort",
              () => {
                providerAborted = true;
                pending.reject(
                  new DOMException("private provider abort", "AbortError")
                );
              },
              { once: true }
            );
            return pending.promise;
          },
        }),
    };
    const workflowStarter = {
      ensureStarted: () => {
        workflowStarts += 1;
        return Effect.die("workflow must not start");
      },
    };
    const service = makeOperatorCarouselImportService({
      application: makeImportIntentApplication(
        repository,
        workflowStarter,
        makeImportTraceContext()
      ),
      identityResolver,
      newIntentId: () =>
        Schema.decodeUnknownSync(RecipeImportIntentId)(
          "018f47ad-91aa-7c35-b6fe-000000000001"
        ),
      now: () => "2026-07-20T10:00:00.000Z",
      pipeline: {
        stage: () => {
          pipelineStarts += 1;
          return Effect.die("pipeline must not start");
        },
      },
    });
    const bundle = Schema.decodeUnknownSync(OperatorCarouselBundle)({
      declaredPageCount: 1,
      images: [
        {
          height: 3,
          jpegBase64:
            "/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAADAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABgj/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABykX//Z",
          orderIndex: 0,
          sha256:
            "7f593180ed96b891629067143da2fb44eb996b1a45e7561870a5754d5bba506e",
          width: 2,
        },
      ],
      source: {
        kind: "tiktok",
        url: "https://www.tiktok.com/@cook/photo/7520000000000000001",
      },
    });
    const authorizer = await Effect.runPromise(
      makeTestImportAuthorizer("request-cancellation-token")
    );
    const request = new Request(
      "https://meal-planner.test/imports/operator-carousel",
      {
        body: JSON.stringify(bundle),
        headers: {
          authorization: "Bearer request-cancellation-token",
          "content-type": "application/json",
          "idempotency-key": "K1",
        },
        method: "POST",
        signal: controller.signal,
      }
    );
    const recordingLogger = Logger.make<unknown, number>((event) =>
      logs.push(event.message)
    );
    const responsePromise = Effect.runPromise(
      Cloudflare.makeRequestEffect(
        asAlchemyRequest(request),
        withCurrentRequestCancellation(
          Effect.gen(function* importRequest() {
            const originalRequest = yield* Cloudflare.Request;
            const principal = yield* authorizer.authorize(
              originalRequest.headers.get("authorization") ?? undefined
            );
            yield* service.admit(
              principal,
              bundle,
              Schema.decodeUnknownSync(IdempotencyKey)("K1")
            );
            return HttpServerResponse.text("unexpected success");
          }).pipe(Effect.orDie)
        )
      ).pipe(Effect.provide(Logger.layer([recordingLogger])))
    );

    await providerStarted.promise;
    controller.abort();
    const response = (await responsePromise) as Response;

    expect(response.status).toBe(499);
    expect(providerAborted).toBe(true);
    expect(admissionRequests).toBe(0);
    expect(pipelineStarts).toBe(0);
    expect(workflowStarts).toBe(0);
    expect(logs).toEqual([]);
  });
});
