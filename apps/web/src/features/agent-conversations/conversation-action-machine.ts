import { ConversationAction } from "@meal-planner/agent-conversations-api";
import type {
  ConversationActionState,
  ConversationActionView,
} from "@meal-planner/agent-conversations-api";
import { Effect, Schema } from "effect";
import type { Scope } from "effect";
import { assign, fromPromise, setup, waitFor } from "xstate";
import type { ActorRefFrom } from "xstate";

/** Browser request effects; the server remains the owner of action receipts. */
export interface ConversationActions {
  readonly read: Effect.Effect<ConversationAction | null, Error>;
  readonly retain: (action: ConversationAction) => Effect.Effect<void, Error>;
  readonly clear: (action: ConversationAction) => Effect.Effect<void, Error>;
  readonly submit: (
    action: ConversationAction
  ) => Effect.Effect<ConversationActionState, unknown, Scope.Scope>;
}
interface ActionContext {
  readonly error: string | null;
  readonly receipts: readonly ConversationActionView[];
  readonly request: ConversationAction | null;
  readonly result: ConversationActionState | null;
}
type ActionEvent =
  | { readonly type: "CLEAR_ERROR" }
  | {
      readonly type: "RECEIPTS";
      readonly receipts: readonly ConversationActionView[];
    }
  | { readonly type: "RETRY" }
  | { readonly type: "SUBMIT"; readonly action: ConversationAction };
const definite = (state: ConversationActionState) =>
  state._tag === "Committed" || state._tag === "Rejected";
const receipt = (context: ActionContext) =>
  context.receipts.find(
    (entry) =>
      entry.state.actionId === context.request?.actionId &&
      definite(entry.state)
  )?.state;
const request = (context: ActionContext) => {
  if (context.request === null) {
    throw new Error("The action state requires a retained request.");
  }
  return context.request;
};

export const createConversationActionMachine = (api: ConversationActions) => {
  // XState owns the callback and abort signal; Effect owns each request scope.
  const actors = {
    clear: fromPromise(
      ({ input, signal }: { input: ConversationAction; signal: AbortSignal }) =>
        Effect.runPromise(api.clear(input), { signal })
    ),
    read: fromPromise<ConversationAction | null>(({ signal }) =>
      Effect.runPromise(api.read, { signal })
    ),
    retain: fromPromise(
      ({ input, signal }: { input: ConversationAction; signal: AbortSignal }) =>
        Effect.runPromise(api.retain(input), { signal })
    ),
    submit: fromPromise<ConversationActionState, ConversationAction>(
      ({ input, signal }) =>
        Effect.runPromise(Effect.scoped(api.submit(input)), { signal })
    ),
  };
  return setup<ActionContext, ActionEvent, typeof actors>({
    actors,
  }).createMachine({
    context: { error: null, receipts: [], request: null, result: null },
    initial: "reading",
    on: {
      RECEIPTS: {
        actions: assign({ receipts: ({ event }) => event.receipts }),
      },
    },
    states: {
      awaitingReceipt: {
        always: {
          actions: assign({
            result: ({ context }) => receipt(context) ?? context.result,
          }),
          guard: ({ context }) => receipt(context) !== undefined,
          target: "clearing",
        },
      },
      blocked: {},
      clearing: {
        invoke: {
          input: ({ context }) => request(context),
          onDone: {
            actions: assign({ error: null, request: null }),
            target: "ready",
          },
          onError: {
            actions: assign({
              error:
                "The confirmed action could not be cleared from this browser session. Reload before making another change.",
            }),
            target: "blocked",
          },
          src: "clear",
        },
      },
      reading: {
        invoke: {
          onDone: [
            { guard: ({ event }) => event.output === null, target: "ready" },
            {
              actions: assign({
                request: ({ event }) => event.output,
                result: ({ event }) =>
                  event.output === null
                    ? null
                    : {
                        _tag: "Unknown",
                        actionId: event.output.actionId,
                        familyId: null,
                      },
              }),
              target: "retained",
            },
          ],
          onError: {
            actions: assign({
              error:
                "A saved conversation action cannot be read. Review the conversation before making another change.",
            }),
            target: "blocked",
          },
          src: "read",
        },
      },
      ready: {
        on: {
          CLEAR_ERROR: {
            actions: assign({
              error: null,
              result: ({ context }) =>
                context.result?._tag === "Rejected" ? null : context.result,
            }),
          },
          SUBMIT: {
            actions: assign({
              error: null,
              request: ({ event }) => event.action,
              result: ({ event }) => ({
                _tag: "Pending",
                actionId: event.action.actionId,
              }),
            }),
            target: "retaining",
          },
        },
      },
      retained: {
        always: {
          actions: assign({
            result: ({ context }) => receipt(context) ?? context.result,
          }),
          guard: ({ context }) => receipt(context) !== undefined,
          target: "clearing",
        },
        on: {
          RETRY: {
            actions: assign({
              error: null,
              result: ({ context }) => ({
                _tag: "Pending",
                actionId: request(context).actionId,
              }),
            }),
            target: "sending",
          },
        },
      },
      retaining: {
        invoke: {
          input: ({ context }) => request(context),
          onDone: { target: "sending" },
          onError: {
            actions: assign({
              error:
                "This browser cannot safely retain the action. The change was not sent. Reload before confirming.",
            }),
            target: "blocked",
          },
          src: "retain",
        },
        tags: "busy",
      },
      sending: {
        invoke: {
          input: ({ context }) => request(context),
          onDone: [
            {
              actions: assign({ result: ({ event }) => event.output }),
              guard: ({ event }) => definite(event.output),
              target: "awaitingReceipt",
            },
            {
              actions: assign({ result: ({ event }) => event.output }),
              target: "retained",
            },
          ],
          onError: {
            actions: assign({
              error:
                "The action may have saved. Retry the exact saved action before making another change.",
              result: ({ context }) => ({
                _tag: "Unknown",
                actionId: request(context).actionId,
                familyId: null,
              }),
            }),
            target: "retained",
          },
          src: "submit",
        },
        tags: "busy",
      },
    },
  });
};

export type ConversationActionActor = ActorRefFrom<
  ReturnType<typeof createConversationActionMachine>
>;

/** XState admits the event synchronously, before a second browser click can enter. */
export const dispatchConversationAction = async (
  actor: ConversationActionActor,
  action: ConversationAction,
  retry = false
): Promise<ConversationActionState> => {
  const before = actor.getSnapshot();
  if (!(retry ? before.matches("retained") : before.matches("ready"))) {
    throw new Error("Resolve the saved action before making another change.");
  }
  actor.send(retry ? { type: "RETRY" } : { action, type: "SUBMIT" });
  const settled = await waitFor(
    actor,
    (state) => !state.matches("retaining") && !state.matches("sending")
  );
  if (settled.matches("blocked") || settled.context.result === null) {
    throw new Error(settled.context.error ?? "The action could not be sent.");
  }
  return settled.context.result;
};

export const sessionConversationActions = (
  key: string,
  storage: () => Pick<Storage, "getItem" | "setItem" | "removeItem">,
  submit: ConversationActions["submit"]
): ConversationActions => {
  const read = () => {
    const raw = storage().getItem(key);
    return raw === null
      ? null
      : Schema.decodeUnknownSync(ConversationAction)(JSON.parse(raw));
  };
  return {
    clear: (action) =>
      Effect.try(() => {
        const latest = read();
        if (latest !== null && latest.actionId !== action.actionId) {
          throw new Error("A different action is awaiting confirmation.");
        }
        storage().removeItem(key);
      }),
    read: Effect.try(read),
    retain: (action) =>
      Effect.try(() => {
        if (read() !== null) {
          throw new Error("A saved action already exists.");
        }
        storage().setItem(key, JSON.stringify(action));
      }),
    submit,
  };
};
