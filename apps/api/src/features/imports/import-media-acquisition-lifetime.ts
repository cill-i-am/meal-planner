import * as Cloudflare from "alchemy/Cloudflare";
import type { RuntimeContext } from "alchemy/RuntimeContext";
import {
  Clock,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Ref,
  Scope,
  Semaphore,
  Stream,
} from "effect";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import { MaximumAcquisitionAttemptSeconds } from "./import-media.model.js";

/** A generation owns the process until its operations and artifact readers close. */
export const makeAcquisitionLifetime = Effect.fn("ImportMedia.makeLifetime")(
  function* makeAcquisitionLifetimeEffect(
    container: Pick<Cloudflare.Containers.Container, "destroy">,
    idleMilliseconds = MaximumAcquisitionAttemptSeconds * 1000
  ) {
    const state = yield* Cloudflare.DurableObjectState;
    const runtimeContext = yield* Effect.context<RuntimeContext>();
    const mutex = yield* Semaphore.make(1);
    const retired = yield* Ref.make(
      (yield* Effect.promise(() =>
        state.raw.storage.get("acquisitionRetired")
      )) === true
    );
    const stopped = yield* Deferred.make<true>();
    const leases = new Set<Deferred.Deferred<true>>();
    const readers = new Map<
      string,
      {
        readonly close: Effect.Effect<void>;
        readonly scope: Scope.Closeable;
        readonly cancelled: Deferred.Deferred<true>;
      }
    >();
    let lastActivity = 0;
    const touch = Effect.gen(function* touch() {
      lastActivity = yield* Clock.currentTimeMillis;
    });
    const arm = Effect.gen(function* arm() {
      yield* touch;
      yield* Effect.promise(() =>
        state.raw.storage.setAlarm(lastActivity + idleMilliseconds)
      );
    });
    const allocate = Effect.gen(function* allocate() {
      if (yield* Ref.get(retired)) {
        return yield* Effect.die("Acquisition generation is retired");
      }
      yield* arm;
      const done = yield* Deferred.make<true>();
      leases.add(done);
      return done;
    });
    const release = (done: Deferred.Deferred<true>) =>
      Effect.gen(function* releaseLease() {
        leases.delete(done);
        yield* touch;
        yield* Deferred.succeed(done, true);
      });
    const cancelled = Deferred.await(stopped).pipe(
      Effect.andThen(Effect.die("Acquisition generation expired"))
    );
    const use = <A, E, R>(operation: Effect.Effect<A, E, R>) =>
      Effect.acquireUseRelease(
        mutex.withPermit(allocate),
        () => Effect.raceFirst(operation, cancelled),
        release
      );
    const closeReader = (readerId: string) =>
      Effect.gen(function* closeArtifactReader() {
        const reader = yield* mutex.withPermit(
          Effect.gen(function* reader() {
            // Persist even an early close: a delayed fetch cannot admit this token later.
            yield* Effect.promise(() =>
              state.raw.storage.put(`closedReader:${readerId}`, true)
            );
            return readers.get(readerId);
          })
        );
        if (reader !== undefined) {
          yield* reader.close;
        }
      });
    const fetch = <E, R>(
      readerId: string,
      operation: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>
    ) =>
      Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* acquireArtifactResponse() {
          const reader = yield* mutex.withPermit(
            Effect.gen(function* reader() {
              if (
                readers.has(readerId) ||
                (yield* Effect.promise(() =>
                  state.raw.storage.get(`closedReader:${readerId}`)
                )) === true
              ) {
                return yield* Effect.die(
                  "Acquisition reader is already admitted or closed"
                );
              }
              const done = yield* allocate;
              const scope = yield* Scope.make();
              const readerCancelled = yield* Deferred.make<true>();
              const setupDone = yield* Deferred.make<true>();
              const pulls = new Set<Deferred.Deferred<true>>();
              let closing = false;
              const trackPull = <A, PullError, PullRequirements>(
                pull: Effect.Effect<A, PullError, PullRequirements>
              ) =>
                Effect.acquireUseRelease(
                  Effect.suspend(() => {
                    if (closing) {
                      return Effect.die("Acquisition reader closed");
                    }
                    const pullDone = Deferred.makeUnsafe<true>();
                    pulls.add(pullDone);
                    return Effect.succeed(pullDone);
                  }),
                  () => pull,
                  (pullDone) =>
                    Effect.sync(() => pulls.delete(pullDone)).pipe(
                      Effect.andThen(Deferred.succeed(pullDone, true))
                    )
                );
              const close = yield* Effect.cached(
                Effect.gen(function* close() {
                  closing = true;
                  yield* Deferred.succeed(readerCancelled, true);
                  yield* Deferred.await(setupDone);
                  yield* Scope.close(scope, Exit.void);
                  // Scope.close can observe a concurrent close without joining it.
                  // Active pulls still own their source cancellation finalizers.
                  yield* Effect.forEach([...pulls], Deferred.await, {
                    concurrency: "unbounded",
                    discard: true,
                  });
                  yield* release(done);
                  readers.delete(readerId);
                })
              );
              const admitted = {
                cancelled: readerCancelled,
                close,
                scope,
                setupDone,
                trackPull,
              };
              readers.set(readerId, admitted);
              return admitted;
            })
          );
          const readerCancelled = Deferred.await(reader.cancelled).pipe(
            Effect.andThen(Effect.die("Acquisition reader closed"))
          );
          return yield* restore(
            Effect.gen(function* initializeArtifactResponse() {
              const response = yield* operation;
              if (response.body._tag !== "Stream") {
                return response;
              }
              // Own the source scope independently of downstream demand. Native DO
              // response cancellation does not reliably close a paused body producer.
              const pull = yield* Stream.toPull(response.body.stream).pipe(
                Effect.provideService(Scope.Scope, reader.scope)
              );
              return HttpServerResponse.stream(
                Stream.fromPull(Effect.succeed(reader.trackPull(pull))).pipe(
                  Stream.tap(() => touch),
                  Stream.interruptWhen(cancelled),
                  Stream.interruptWhen(readerCancelled),
                  Stream.ensuring(closeReader(readerId))
                ),
                {
                  contentLength: response.body.contentLength,
                  cookies: response.cookies,
                  headers: response.headers,
                  status: response.status,
                  statusText: response.statusText,
                }
              );
            }).pipe(
              Effect.raceFirst(cancelled),
              Effect.raceFirst(readerCancelled)
            )
          ).pipe(
            Effect.ensuring(Deferred.succeed(reader.setupDone, true)),
            Effect.tap((response) =>
              response.body._tag === "Stream"
                ? Effect.void
                : closeReader(readerId)
            ),
            Effect.onError(() => closeReader(readerId))
          );
        })
      );
    const retire = mutex.withPermit(
      Effect.gen(function* retire() {
        yield* Ref.set(retired, true);
        yield* Effect.promise(() =>
          state.raw.storage.put("acquisitionRetired", true)
        );
      })
    );
    const drain = Effect.suspend(() =>
      Effect.forEach([...leases], Deferred.await, {
        concurrency: "unbounded",
        discard: true,
      })
    );
    const destroy = container
      .destroy()
      .pipe(
        Effect.provide(runtimeContext),
        Effect.andThen(Effect.promise(() => state.raw.storage.deleteAlarm()))
      );
    const cleanup = Effect.gen(function* cleanup() {
      yield* retire;
      yield* drain;
      yield* destroy;
    });
    const alarm = Effect.gen(function* alarm() {
      const now = yield* Clock.currentTimeMillis;
      if (!(yield* Ref.get(retired)) && lastActivity + idleMilliseconds > now) {
        yield* Effect.promise(() =>
          state.raw.storage.setAlarm(lastActivity + idleMilliseconds)
        );
        return;
      }
      yield* retire;
      yield* Deferred.succeed(stopped, true);
      // Terminal expiry cannot wait forever on a native reader cancellation.
      // Wait on a detached join so timeout does not itself await stuck finalizers.
      const closing = yield* Effect.forEach([...readers.keys()], closeReader, {
        concurrency: "unbounded",
        discard: true,
      }).pipe(Effect.andThen(drain), Effect.forkDetach);
      yield* Fiber.await(closing).pipe(
        Effect.timeout(1000),
        Effect.ignoreCause
      );
      yield* destroy;
    });
    return { alarm, cleanup, closeReader, fetch, use };
  }
);
