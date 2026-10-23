# Local conversation action state and Effect 4

Checked on 23 October 2026 against the published registry tarballs.

The browser conversation action lifecycle uses stable `xstate@5.33.3` and
`effect@4.0.5`. The native `fromPromise` callback passes its `AbortSignal` to
`Effect.runPromise`; the submission runs inside `Effect.scoped`. XState owns local
event admission and cancellation, Effect owns request resources, session storage
retains the exact uncertain command, and server receipts determine completion.
Stopping the browser actor requests cancellation. It does not promise to await
all asynchronous cleanup. No server persistence, Cloudflare Workflow, retry
schedule, or durable authority moves into this local machine.

## Why the Effect adapter is deferred

`@xstate/effect@1.0.0-alpha.9` declares peers `effect:^4.0.0` and
`xstate:^6.0.0-alpha.70`. Those exact versions compile with TypeScript 7.0.2.
Independent runtime probes passed for services and trace context, ordinary
invocation cancellation, asynchronous scope cleanup, Effect TestClock timers and
sleeps, and typed failures. They also confirmed that background Effect actions
survive state exit and that their late failures reach the current state's error
handler. Local requests therefore require invoked work rather than background
actions.

A minimized regression disproved the stronger disposal guarantee: an invoked
Effect can signal readiness synchronously before the adapter registers its fiber
with the owner. Immediate `Scope.close` then returns while the invocation's
finalizer has not run. The finalizer runs a scheduler turn later. The published
adapter starts `Effect.runForkWith(...)(traced)` before calling `Fiber.runIn` and
adding the fiber to its tracked set (`dist/state-a2e5cb31.js`, line 336).

The latest registry version was still `1.0.0-alpha.9` when checked again. Its
`alpha` dist tag pointed to the older `0.1.0-alpha.4`; use exact versions for
reproduction. The application does not install the adapter or XState 6 alpha.

## Reproduce the unsupported disposal guarantee

In an empty temporary directory, install:

```sh
npm init -y
npm install --save-exact @xstate/effect@1.0.0-alpha.9 xstate@6.0.0-alpha.70 effect@4.0.5 tsx@4.23.15
```

Save the following as `scope-close.mts` and run `npx tsx scope-close.mts`:

```ts
import { Deferred, Effect, Exit, Scope } from "effect";
import { createEffectActor, createEffectLogic, setupEffect } from "@xstate/effect";

await Effect.runPromise(Effect.scoped(Effect.gen(function* reproduce() {
  const owner = yield* Scope.make();
  const started = yield* Deferred.make<boolean>();
  let finalized = false;
  const worker = createEffectLogic(Effect.gen(function* work() {
    yield* Effect.addFinalizer(() => Effect.sync(() => { finalized = true; }));
    yield* Deferred.succeed(started, true);
    return yield* Effect.never;
  }));
  const machine = setupEffect({ actors: { worker } }).createMachine({
    initial: "working", states: { working: { invoke: { src: "worker" } } }
  });
  const actor = yield* Scope.provide(createEffectActor(machine), owner);
  yield* Deferred.await(started);
  yield* Scope.close(owner, Exit.void);
  const finalizedAtClose = finalized;
  console.log({ point: "close_returned", status: actor.getSnapshot().status, finalized });
  yield* Effect.yieldNow;
  console.log({ point: "one_turn_later", finalized });
  if (!finalizedAtClose) throw new Error("Scope.close returned before finalization");
})));
```

Observed: `close_returned` has `status: "stopped", finalized: false`;
`one_turn_later` has `finalized: true`; the assertion fails. The yield only
observes the failure after it occurred. It must not be inserted before disposal
as a workaround.

## Application behavior checks

`conversation-action-machine.test.ts` checks concurrent admission, exact retries
after a lost response and remount, receipt reconciliation without resubmission,
invocation finalization after cancellation, unreadable saved requests, and
unavailable browser storage. `conversation-controller.test.tsx` checks one POST
for two synchronous confirmations, a confirmed outcome surviving a failed view
refresh, a later receipt clearing storage without another POST, and an unmount
aborting the actual HTTP transport while retaining the command.

Primary package sources:
[adapter tarball](https://registry.npmjs.org/@xstate/effect/-/effect-1.0.0-alpha.9.tgz),
[tested alpha core](https://registry.npmjs.org/xstate/-/xstate-6.0.0-alpha.70.tgz),
[adopted stable core](https://registry.npmjs.org/xstate/-/xstate-5.33.3.tgz).
