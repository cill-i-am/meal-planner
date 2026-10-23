import { ConversationAction } from "@meal-planner/agent-conversations-api";
import type { ConversationActionState } from "@meal-planner/agent-conversations-api";
import { Deferred, Effect, Schema } from "effect";
import { afterEach, expect, it } from "vitest";
import { createActor, waitFor } from "xstate";

import {
  createConversationActionMachine,
  dispatchConversationAction,
  sessionConversationActions,
} from "./conversation-action-machine.js";
import type {
  ConversationActions,
  ConversationActionActor,
} from "./conversation-action-machine.js";

const actors: ConversationActionActor[] = [];
const start = (api: ConversationActions) => {
  const actor = createActor(createConversationActionMachine(api)).start();
  actors.push(actor);
  return actor;
};
afterEach(() => {
  for (const actor of actors.splice(0)) {
    actor.stop();
  }
});

const request = (suffix = "001") =>
  Schema.decodeUnknownSync(ConversationAction)({
    actionId: `00000000-0000-4000-8000-000000000${suffix}`,
    blockId: "00000000-0000-4000-8000-000000000010",
    decision: "dismiss",
    expectedRevision: 1,
  });
const committed = (action: ConversationAction): ConversationActionState => ({
  _tag: "Committed",
  actionId: action.actionId,
  familyId: null,
});
class BrowserStorage implements Storage {
  readonly data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  clear() {
    this.data.clear();
  }
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
}
const storageKey = "conversation-action";

it("serializes concurrent submissions and retains the exact confirmed request until its receipt", async () => {
  const storage = new BrowserStorage();
  const sent: ConversationAction[] = [];
  const response = Deferred.makeUnsafe<ConversationActionState>();
  const actor = start(
    sessionConversationActions(
      storageKey,
      () => storage,
      (action) => {
        sent.push(action);
        return Deferred.await(response);
      }
    )
  );
  await waitFor(actor, (state) => state.matches("ready"));
  const first = dispatchConversationAction(actor, request());
  expect(await dispatchConversationAction(actor, request("002"))).toEqual({
    _tag: "NotAdmitted",
  });
  await waitFor(actor, (state) => state.matches("sending"));
  await Effect.runPromise(Deferred.succeed(response, committed(request())));
  expect(await first).toEqual({ _tag: "Settled", state: committed(request()) });
  expect(sent).toEqual([request()]);
  expect(storage.getItem(storageKey)).toBe(JSON.stringify(request()));
  expect(actor.getSnapshot().matches("awaitingReceipt")).toBe(true);
  actor.send({
    receipts: [{ action: request("002"), state: committed(request("002")) }],
    type: "RECEIPTS",
  });
  expect(storage.getItem(storageKey)).toBe(JSON.stringify(request()));
  actor.send({
    receipts: [{ action: request(), state: committed(request()) }],
    type: "RECEIPTS",
  });
  await waitFor(actor, (state) => state.matches("ready"));
  expect(actor.getSnapshot().context.request).toBeNull();
  expect(storage.getItem(storageKey)).toBeNull();
});

it("recovers a lost response and retries the same bytes only after an explicit retry", async () => {
  const storage = new BrowserStorage();
  const sent: ConversationAction[] = [];
  const action = request();
  const service = sessionConversationActions(
    storageKey,
    () => storage,
    (submitted) => {
      sent.push(submitted);
      return sent.length === 1
        ? Effect.fail(new Error("response lost"))
        : Effect.succeed(committed(submitted));
    }
  );
  const first = start(service);
  await waitFor(first, (state) => state.matches("ready"));
  const outcome = await dispatchConversationAction(first, action);
  expect(outcome).toMatchObject({
    _tag: "Settled",
    state: { _tag: "Unknown" },
  });
  expect(first.getSnapshot().matches("retained")).toBe(true);
  expect(storage.getItem(storageKey)).toBe(JSON.stringify(action));
  first.stop();
  const resumed = start(service);
  await waitFor(resumed, (state) => state.matches("retained"));
  expect(sent).toEqual([action]);
  expect(
    await dispatchConversationAction(resumed, request("002"), true)
  ).toEqual({
    _tag: "Settled",
    state: committed(action),
  });
  expect(sent).toEqual([action, action]);
});

it("clears a recovered request when its receipt arrives without resubmitting it", async () => {
  const storage = new BrowserStorage();
  const action = request();
  storage.setItem(storageKey, JSON.stringify(action));
  const actor = start(
    sessionConversationActions(
      storageKey,
      () => storage,
      () => Effect.die("must not resubmit")
    )
  );
  actor.send({
    receipts: [{ action, state: committed(action) }],
    type: "RECEIPTS",
  });
  await waitFor(actor, (state) => state.matches("ready"));
  expect(storage.getItem(storageKey)).toBeNull();
  expect(actor.getSnapshot().context.result).toEqual(committed(action));
});

it("interrupts an unmounted request while preserving evidence for recovery", async () => {
  const storage = new BrowserStorage();
  const started = Deferred.makeUnsafe<boolean>();
  const released = Deferred.makeUnsafe<boolean>();
  const actor = start(
    sessionConversationActions(
      storageKey,
      () => storage,
      () =>
        Effect.gen(function* requestResource() {
          yield* Effect.addFinalizer(() => Deferred.succeed(released, true));
          yield* Deferred.succeed(started, true);
          return yield* Effect.never;
        })
    )
  );
  await waitFor(actor, (state) => state.matches("ready"));
  const outcome = dispatchConversationAction(actor, request());
  await Effect.runPromise(Deferred.await(started));
  actor.stop();
  // stop requests interruption; the invocation's Effect scope owns finalization.
  expect(await Effect.runPromise(Deferred.await(released))).toBe(true);
  expect(await outcome).toEqual({ _tag: "Cancelled" });
  expect(await dispatchConversationAction(actor, request("002"))).toEqual({
    _tag: "Cancelled",
  });
  expect(storage.getItem(storageKey)).toBe(JSON.stringify(request()));
});

it("blocks corrupt saved requests and failed storage before sending anything", async () => {
  const storage = new BrowserStorage();
  storage.setItem(storageKey, "not json");
  const corrupt = start(
    sessionConversationActions(
      storageKey,
      () => storage,
      () => Effect.die("must not submit")
    )
  );
  await waitFor(corrupt, (state) => state.matches("blocked"));
  expect(storage.getItem(storageKey)).toBe("not json");
  const unavailable = start({
    clear: () => Effect.void,
    read: Effect.succeed(null),
    retain: () => Effect.fail(new Error("storage disabled")),
    submit: () => Effect.die("must not submit"),
  });
  await waitFor(unavailable, (state) => state.matches("ready"));
  expect(await dispatchConversationAction(unavailable, request())).toEqual({
    _tag: "Blocked",
  });
  expect(unavailable.getSnapshot().context.error).toContain("not sent");
  expect(await dispatchConversationAction(unavailable, request("002"))).toEqual(
    { _tag: "Blocked" }
  );
  expect(unavailable.getSnapshot().context.request).toEqual(request());
  expect(unavailable.getSnapshot().matches("blocked")).toBe(true);
});

it("blocks a browser whose session storage getter is unavailable", async () => {
  const actor = start(
    sessionConversationActions(
      storageKey,
      () => {
        throw new Error("storage forbidden");
      },
      () => Effect.die("must not submit")
    )
  );
  await waitFor(actor, (state) => state.matches("blocked"));
  expect(actor.getSnapshot().context.error).toContain("cannot be read");
});
