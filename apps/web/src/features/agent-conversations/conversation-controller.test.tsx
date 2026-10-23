import {
  ConversationAction,
  ConversationView,
} from "@meal-planner/agent-conversations-api";
import type { ConversationActionState } from "@meal-planner/agent-conversations-api";
import { UserId } from "@meal-planner/household-api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Schema } from "effect";
import { afterEach, expect, it } from "vitest";

import { ApiRuntimeContext } from "../api-client/index.js";
import {
  AgentConversationProvider,
  ConversationActionDispatchError,
  useAgentConversation,
} from "./conversation-controller.js";
import { conversationKey } from "./conversation-operations.js";

const accountId = Schema.decodeUnknownSync(UserId)("conversation-test-account");
const view = Schema.decodeUnknownSync(ConversationView)({
  actions: [],
  blocks: [
    {
      _tag: "Question",
      foodTopic: "pasta",
      id: "00000000-0000-4000-8000-000000000010",
      prompt: "Would pasta suit you?",
      revision: 1,
      status: "proposed",
      targetPersonId: null,
      turnId: "00000000-0000-4000-8000-000000000011",
    },
  ],
  id: "00000000-0000-4000-8000-000000000012",
  messages: [],
  scope: { _tag: "AccountPrivateSetup" },
  turns: [],
  version: 0,
});
const storageKey = `meal-planner:conversation-action:${accountId}:AccountPrivateSetup:setup`;

const setupView = Schema.decodeUnknownSync(ConversationView)({
  ...view,
  blocks: [
    {
      _tag: "RosterProposal",
      creatorName: "Alex",
      familyName: "Alex's table",
      id: "00000000-0000-4000-8000-000000000010",
      people: [],
      revision: 1,
      status: "proposed",
      turnId: "00000000-0000-4000-8000-000000000011",
    },
  ],
  turns: [
    {
      failure: null,
      id: "00000000-0000-4000-8000-000000000011",
      setupConfirmation: {
        _tag: "ConfirmDisplayedRoster",
        actionId: "00000000-0000-4000-8000-000000000020",
        blockId: "00000000-0000-4000-8000-000000000010",
        revision: 1,
      },
      status: "succeeded",
    },
  ],
});

const Controls = ({
  onActions,
  onConfirmed,
  onRetried,
}: {
  readonly onActions: (
    results: PromiseSettledResult<ConversationActionState>[]
  ) => void;
  readonly onConfirmed: (state: ConversationActionState | null) => void;
  readonly onRetried: (state: ConversationActionState | null) => void;
}) => {
  const conversation = useAgentConversation();
  const [block] = conversation.view?.blocks ?? [];
  if (!block) {
    throw new Error("Missing test block");
  }
  return (
    <>
      <div data-testid="status">{conversation.status}</div>
      <div data-testid="error">{conversation.error ?? "none"}</div>
      <div data-testid="result">{conversation.actionState?._tag ?? "none"}</div>
      <div data-testid="request">
        {conversation.pendingAction === null ? "clear" : "retained"}
      </div>
      <button
        disabled={conversation.status !== "ready"}
        onClick={() => {
          void Promise.allSettled([
            conversation.act(block, "dismiss"),
            conversation.act(block, "dismiss"),
          ]).then(onActions);
        }}
      >
        Confirm twice
      </button>
      <button
        onClick={() => {
          void conversation.retryAction().then(onRetried);
        }}
      >
        Retry
      </button>
      <button
        onClick={() => {
          sessionStorage.setItem(storageKey, "unreadable saved action");
          void conversation.confirmSetup().then(onConfirmed);
        }}
      >
        Block setup confirmation
      </button>
    </>
  );
};

const mount = (transport: typeof fetch, initialView = view) => {
  const actions: PromiseSettledResult<ConversationActionState>[] = [];
  const confirmed: (ConversationActionState | null)[] = [];
  const retried: (ConversationActionState | null)[] = [];
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(
    conversationKey(accountId, initialView.scope),
    initialView
  );
  const rendered = render(
    <QueryClientProvider client={client}>
      <ApiRuntimeContext
        value={{ baseUrl: window.location.origin, fetch: transport }}
      >
        <AgentConversationProvider accountId={accountId} scope={view.scope}>
          <Controls
            onActions={(results) => {
              actions.push(...results);
            }}
            onConfirmed={(state) => {
              confirmed.push(state);
            }}
            onRetried={(state) => {
              retried.push(state);
            }}
          />
        </AgentConversationProvider>
      </ApiRuntimeContext>
    </QueryClientProvider>
  );
  return { ...rendered, actions, client, confirmed, retried };
};

afterEach(() => {
  cleanup();
  sessionStorage.removeItem(storageKey);
});

it("keeps a confirmed action through a failed refresh and reconciles without another POST", async () => {
  const sent: ConversationAction[] = [];
  let readFails = true;
  const transport: typeof fetch = async (input, init) => {
    const incoming = new Request(input, init);
    if (incoming.method === "POST") {
      const action = Schema.decodeUnknownSync(ConversationAction)(
        await incoming.json()
      );
      sent.push(action);
      return Response.json({
        _tag: "Committed",
        actionId: action.actionId,
        familyId: null,
      });
    }
    if (readFails) {
      throw new Error("view unavailable");
    }
    return Response.json({
      ...view,
      actions: sent.map((action) => ({
        action,
        state: { _tag: "Committed", actionId: action.actionId, familyId: null },
      })),
    });
  };
  const user = userEvent.setup();
  const mounted = mount(transport);
  await waitFor(() =>
    expect(screen.getByTestId("status")).toHaveTextContent("ready")
  );
  await user.click(screen.getByRole("button", { name: "Confirm twice" }));
  await waitFor(() =>
    expect(screen.getByTestId("result")).toHaveTextContent("Committed")
  );
  expect(sent).toHaveLength(1);
  await waitFor(() => expect(mounted.actions).toHaveLength(2));
  expect(mounted.actions).toContainEqual({
    reason: expect.objectContaining({
      _tag: "ConversationActionDispatchError",
      reason: "NotAdmitted",
    }),
    status: "rejected",
  });
  expect(mounted.actions).toContainEqual({
    status: "fulfilled",
    value: expect.objectContaining({ _tag: "Committed" }),
  });
  expect(screen.getByTestId("request")).toHaveTextContent("retained");
  expect(sessionStorage.getItem(storageKey)).toBe(JSON.stringify(sent[0]));
  readFails = false;
  await user.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() =>
    expect(screen.getByTestId("request")).toHaveTextContent("clear")
  );
  expect(sent).toHaveLength(1);
  expect(sessionStorage.getItem(storageKey)).toBeNull();
  mounted.client.clear();
});

it("aborts the browser request on unmount and keeps its exact saved command", async () => {
  let aborted = false;
  const sent: ConversationAction[] = [];
  const transport: typeof fetch = async (input, init) => {
    const incoming = new Request(input, init);
    sent.push(
      Schema.decodeUnknownSync(ConversationAction)(await incoming.json())
    );
    return new Promise((_resolve, reject) => {
      incoming.signal.addEventListener(
        "abort",
        () => {
          aborted = true;
          reject(new DOMException("Stopped", "AbortError"));
        },
        { once: true }
      );
    });
  };
  const mounted = mount(transport);
  await waitFor(() =>
    expect(screen.getByTestId("status")).toHaveTextContent("ready")
  );
  await userEvent.click(screen.getByRole("button", { name: "Confirm twice" }));
  await waitFor(() => expect(sent).toHaveLength(1));
  mounted.unmount();
  await waitFor(() => expect(aborted).toBe(true));
  await waitFor(() => expect(mounted.actions).toHaveLength(2));
  const cancelled = mounted.actions.find(
    (result) =>
      result.status === "rejected" &&
      result.reason instanceof ConversationActionDispatchError &&
      result.reason.reason === "Cancelled"
  );
  expect(cancelled).toBeDefined();
  expect(sessionStorage.getItem(storageKey)).toBe(JSON.stringify(sent[0]));
  mounted.client.clear();
});

it("returns a blocked setup confirmation and retry without hiding the machine's retention error", async () => {
  let sent = 0;
  const mounted = mount(() => {
    sent += 1;
    return Promise.reject(new Error("A blocked action must not be sent"));
  }, setupView);
  await waitFor(() =>
    expect(screen.getByTestId("status")).toHaveTextContent("ready")
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Block setup confirmation" })
  );
  await waitFor(() => expect(mounted.confirmed).toEqual([null]));
  expect(screen.getByTestId("error")).toHaveTextContent(
    "This browser cannot safely retain the action. The change was not sent."
  );
  expect(screen.getByTestId("request")).toHaveTextContent("retained");
  expect(sessionStorage.getItem(storageKey)).toBe("unreadable saved action");
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(mounted.retried).toEqual([null]));
  expect(screen.getByTestId("error")).toHaveTextContent(
    "This browser cannot safely retain the action. The change was not sent."
  );
  expect(sent).toBe(0);
  mounted.client.clear();
});
