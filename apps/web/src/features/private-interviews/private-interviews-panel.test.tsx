// @vitest-environment jsdom
import type {
  DirectoryCommand,
  DirectoryFrame,
  SessionCommand,
  SessionFrame,
} from "@meal-planner/private-interview-api";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";

import { PrivateInterviewClient } from "./private-interview-client.js";
import type { PrivateInterviewSocket } from "./private-interview-client.js";
import { PrivateInterviewsPanel } from "./private-interviews-panel.js";

const reference = "00000000-0000-4000-8000-000000000101";
const messageId = "00000000-0000-4000-8000-000000000201";
const reservation = {
  createdAt: 1_788_691_200_000,
  ordinal: 1,
  sessionReference: reference,
};
const state = { status: "open" as const, version: 0 };
const message = {
  createdAt: reservation.createdAt,
  id: messageId,
  ordinal: 1,
  role: "participant" as const,
  text: "I prefer mild dinners.",
};
const context = { accountId: "adult-a", householdId: "household-a" };

class Socket implements PrivateInterviewSocket {
  onFrame: PrivateInterviewSocket["onFrame"] = null;
  onDisconnect: PrivateInterviewSocket["onDisconnect"] = null;
  onFailure: PrivateInterviewSocket["onFailure"] = null;
  readonly commands: (DirectoryCommand | SessionCommand)[] = [];
  closed = false;
  send = (data: string) => {
    this.commands.push(JSON.parse(data) as DirectoryCommand | SessionCommand);
  };
  close = () => {
    this.closed = true;
  };
  receive(frame: DirectoryFrame | SessionFrame) {
    this.onFrame?.({ data: JSON.stringify(frame) });
  }
  lose(code = 1006) {
    this.onDisconnect?.({ code });
  }
  last<T extends (DirectoryCommand | SessionCommand)["type"]>(type: T) {
    const command = this.commands.findLast((item) => item.type === type);
    if (command?.type !== type) {
      throw new Error(`Expected ${type}`);
    }
    return command as Extract<DirectoryCommand | SessionCommand, { type: T }>;
  }
}

const list = (socket: Socket, reservations = [reservation]) =>
  socket.receive({
    hasMore: false,
    requestId: socket.last("ListSessions").requestId,
    reservations,
    type: "SessionsListed",
  });

const fixture = () => {
  const sockets: { readonly path: string; readonly socket: Socket }[] = [];
  const storage = new Map<string, string>();
  let ordinal = 1;
  const dependencies = {
    connect: (path: string) => {
      const socket = new Socket();
      sockets.push({ path, socket });
      return socket;
    },
    makeId: () => {
      ordinal += 1;
      return `00000000-0000-4000-8000-${String(ordinal).padStart(12, "0")}`;
    },
    storage: {
      getItem: (key: string) => storage.get(key) ?? null,
      removeItem: (key: string) => {
        storage.delete(key);
      },
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    },
  };
  const latest = () => {
    const socket = sockets.at(-1)?.socket;
    if (socket === undefined) {
      throw new Error("Expected connection");
    }
    return socket;
  };
  const directoryReady = (bindingKey = "binding-a") => {
    const socket = latest();
    socket.receive({ bindingKey, type: "DirectoryReady" });
    return socket;
  };
  const sessionReady = (sessionState = state) => {
    const socket = latest();
    socket.receive({
      bindingKey: "binding-a",
      sessionReference: reference,
      state: sessionState,
      type: "SessionReady",
    });
    socket.receive({
      hasMore: false,
      messages: [],
      requestId: socket.last("ReadHistory").requestId,
      state: sessionState,
      type: "HistoryRead",
    });
    return socket;
  };
  return {
    dependencies,
    directoryReady,
    latest,
    list,
    sessionReady,
    sockets,
    storage,
  };
};

afterEach(cleanup);

it("offers a fresh connection after an authority close and retries the same request without a new login", async () => {
  const user = userEvent.setup();
  const f = fixture();
  render(<PrivateInterviewsPanel {...context} dependencies={f.dependencies} />);
  act(() => f.list(f.directoryReady(), []));
  await user.click(
    screen.getByRole("button", { name: "Start private session" })
  );
  const request = f.latest().last("StartSession");
  act(() => f.latest().lose(1008));
  expect(
    screen.getByText(/Reconnect to continue\. If your sign-in has expired/u)
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Reconnect" }));
  act(() => f.list(f.directoryReady(), []));
  await user.click(screen.getByRole("button", { name: "Retry saved request" }));
  expect(f.latest().last("StartSession")).toEqual(request);
});

it("starts, saves an acknowledged message, completes, and rediscovers history after refresh", async () => {
  const user = userEvent.setup();
  const f = fixture();
  const view = () => (
    <PrivateInterviewsPanel {...context} dependencies={f.dependencies} />
  );
  const first = render(view());
  expect(
    screen.getByText(/Assistant replies are not available yet/u)
  ).toBeInTheDocument();
  act(() => {
    f.list(f.directoryReady(), []);
  });
  await user.click(
    screen.getByRole("button", { name: "Start private session" })
  );
  const directory = f.latest();
  const start = directory.last("StartSession");
  expect(f.storage.size).toBe(1);
  act(() => {
    directory.receive({
      mutationId: start.mutationId,
      reservation,
      type: "SessionStarted",
    });
    f.sessionReady();
  });
  await user.type(screen.getByLabelText("Your message"), message.text);
  await user.click(screen.getByRole("button", { name: "Save message" }));
  const session = f.latest();
  const append = session.last("AppendParticipantMessage");
  expect(screen.getByRole("button", { name: "Save message" })).toBeDisabled();
  expect(
    screen.queryByText(message.text, { selector: "p" })
  ).not.toBeInTheDocument();
  act(() =>
    session.receive({
      message,
      mutationId: append.mutationId,
      state: { status: "open", version: 1 },
      type: "MessageAppended",
    })
  );
  expect(screen.getByText(message.text, { selector: "p" })).toBeInTheDocument();
  expect(screen.getByLabelText("Your message")).toHaveValue("");
  await user.click(screen.getByRole("button", { name: "Complete session" }));
  act(() =>
    session.receive({
      mutationId: session.last("CompleteSession").mutationId,
      state: { status: "completed", version: 2 },
      type: "SessionCompleted",
    })
  );
  expect(screen.queryByLabelText("Your message")).not.toBeInTheDocument();
  expect(f.storage.size).toBe(0);
  first.unmount();
  render(view());
  act(() => f.list(f.directoryReady()));
  await user.click(screen.getByRole("button", { name: /Session 1/u }));
  act(() => {
    const socket = f.latest();
    socket.receive({
      bindingKey: "binding-a",
      sessionReference: reference,
      state: { status: "completed", version: 2 },
      type: "SessionReady",
    });
    socket.receive({
      hasMore: false,
      messages: [message],
      requestId: socket.last("ReadHistory").requestId,
      state: { status: "completed", version: 2 },
      type: "HistoryRead",
    });
  });
  expect(screen.getByText("Completed · history only")).toBeInTheDocument();
  expect(screen.getByText(message.text)).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Complete session" })
  ).not.toBeInTheDocument();
});

it.each([
  "StartSession",
  "AppendParticipantMessage",
  "CompleteSession",
] as const)(
  "retains the exact %s command through lost response, remount, and reauthentication",
  (type) => {
    const f = fixture();
    const first = new PrivateInterviewClient(context, f.dependencies);
    first.connect();
    const directory = f.directoryReady();
    f.list(directory);
    if (type === "StartSession") {
      first.start();
    } else {
      first.select(reference);
      f.sessionReady();
      if (type === "AppendParticipantMessage") {
        first.append(message.text);
      } else {
        first.complete();
      }
    }
    const command = f.latest().last(type);
    f.latest().lose(1008);
    expect(first.getSnapshot().connection).toBe("authentication_required");
    expect(first.getSnapshot().messages).toEqual([]);
    first.disconnect();
    const second = new PrivateInterviewClient(context, f.dependencies);
    second.connect();
    const nextDirectory = f.directoryReady();
    f.list(nextDirectory);
    if (type !== "StartSession") {
      const socket = f.latest();
      const recoveredState = { status: "completed" as const, version: 2 };
      socket.receive({
        bindingKey: "binding-a",
        sessionReference: reference,
        state: recoveredState,
        type: "SessionReady",
      });
      socket.receive({
        hasMore: false,
        messages: [message],
        requestId: socket.last("ReadHistory").requestId,
        state: recoveredState,
        type: "HistoryRead",
      });
    }
    expect(f.latest().commands.filter((item) => item.type === type)).toEqual(
      []
    );
    second.retry();
    expect(f.latest().last(type)).toEqual(command);
    expect(f.storage.size).toBe(1);
  }
);

it("cannot replay or display retained private contents under another account, household, or repaired linkage", () => {
  const f = fixture();
  const first = new PrivateInterviewClient(context, f.dependencies);
  first.connect();
  f.directoryReady();
  first.select(reference);
  f.sessionReady();
  first.append(message.text);
  first.disconnect();
  for (const nextContext of [
    { ...context, accountId: "adult-b" },
    { ...context, householdId: "household-b" },
  ]) {
    const other = new PrivateInterviewClient(nextContext, f.dependencies);
    other.connect();
    f.directoryReady("binding-other");
    other.retry();
    expect(other.getSnapshot().pending).toBeNull();
    expect(f.latest().commands.map((command) => command.type)).toEqual([
      "ListSessions",
    ]);
    other.disconnect();
  }
  const repaired = new PrivateInterviewClient(context, f.dependencies);
  repaired.connect();
  f.directoryReady("binding-repaired");
  repaired.retry();
  expect(repaired.getSnapshot().notice).toBe("binding_changed");
  expect(repaired.getSnapshot().pending).toBeNull();
  expect(JSON.stringify(repaired.getSnapshot())).not.toContain(message.text);
  expect(f.latest().commands.map((command) => command.type)).toEqual([
    "ListSessions",
  ]);
  repaired.discardPreviousRequest();
  repaired.start();
  expect(f.latest().commands.map((command) => command.type)).toEqual([
    "ListSessions",
    "StartSession",
  ]);
  expect(repaired.getSnapshot().pending?.bindingKey).toBe("binding-repaired");
});

it("keeps old receipts from clearing a newer unresolved mutation", () => {
  const f = fixture();
  const client = new PrivateInterviewClient(context, f.dependencies);
  client.connect();
  f.directoryReady();
  client.select(reference);
  const socket = f.sessionReady();
  client.append(message.text);
  const first = socket.last("AppendParticipantMessage");
  const receipt: SessionFrame = {
    message,
    mutationId: first.mutationId,
    state: { status: "open", version: 1 },
    type: "MessageAppended",
  };
  socket.receive(receipt);
  client.append("Another message");
  const second = socket.last("AppendParticipantMessage");
  socket.receive(receipt);
  expect(client.getSnapshot().pending?.command).toEqual(second);
  socket.lose();
  client.connect();
  f.directoryReady();
  f.sessionReady();
  client.retry();
  expect(f.latest().last("AppendParticipantMessage")).toEqual(second);
});

it("allows a new session after a definitive completed-session rejection", () => {
  const f = fixture();
  const client = new PrivateInterviewClient(context, f.dependencies);
  client.connect();
  const directory = f.directoryReady();
  client.select(reference);
  const socket = f.sessionReady();
  client.append(message.text);
  socket.receive({
    commandId: socket.last("AppendParticipantMessage").mutationId,
    reason: "session_completed",
    state: { status: "completed", version: 1 },
    type: "Rejected",
  });
  expect(client.getSnapshot().notice).toBe("session_completed");
  client.start();
  expect(directory.last("StartSession").type).toBe("StartSession");
});

it("hides content immediately on account change and ignores late frames from the old socket", async () => {
  const user = userEvent.setup();
  const f = fixture();
  const mounted = render(
    <PrivateInterviewsPanel {...context} dependencies={f.dependencies} />
  );
  act(() => f.list(f.directoryReady()));
  await user.click(screen.getByRole("button", { name: /Session 1/u }));
  const old = f.latest();
  act(() => {
    old.receive({
      bindingKey: "binding-a",
      sessionReference: reference,
      state,
      type: "SessionReady",
    });
    old.receive({
      hasMore: false,
      messages: [message],
      requestId: old.last("ReadHistory").requestId,
      state,
      type: "HistoryRead",
    });
  });
  expect(screen.getByText(message.text)).toBeInTheDocument();
  mounted.rerender(
    <PrivateInterviewsPanel
      {...context}
      accountId="adult-b"
      dependencies={f.dependencies}
    />
  );
  expect(screen.queryByText(message.text)).not.toBeInTheDocument();
  expect(old.closed).toBe(true);
  act(() =>
    old.receive({
      hasMore: false,
      messages: [message],
      requestId: old.last("ReadHistory").requestId,
      state,
      type: "HistoryRead",
    })
  );
  expect(screen.queryByText(message.text)).not.toBeInTheDocument();
});

it("requires refreshed review after version conflict and preserves the text for explicit resubmission", async () => {
  const user = userEvent.setup();
  const f = fixture();
  render(<PrivateInterviewsPanel {...context} dependencies={f.dependencies} />);
  act(() => f.list(f.directoryReady()));
  await user.click(screen.getByRole("button", { name: /Session 1/u }));
  act(() => {
    f.sessionReady();
  });
  await user.type(screen.getByLabelText("Your message"), message.text);
  await user.click(screen.getByRole("button", { name: "Save message" }));
  const socket = f.latest();
  const original = socket.last("AppendParticipantMessage");
  act(() =>
    socket.receive({
      commandId: original.mutationId,
      reason: "version_conflict",
      state: { status: "open", version: 2 },
      type: "Rejected",
    })
  );
  expect(screen.getByRole("button", { name: "Save message" })).toBeDisabled();
  expect(
    screen.queryByRole("button", { name: "Retry saved request" })
  ).not.toBeInTheDocument();
  await user.click(
    screen.getByRole("button", { name: "Review updated history" })
  );
  expect(screen.getByRole("button", { name: "Save message" })).toBeDisabled();
  act(() =>
    socket.receive({
      hasMore: false,
      messages: [],
      requestId: socket.last("ReadHistory").requestId,
      state: { status: "open", version: 2 },
      type: "HistoryRead",
    })
  );
  expect(
    socket.commands.filter(
      (command) => command.type === "AppendParticipantMessage"
    )
  ).toHaveLength(1);
  expect(screen.getByLabelText("Your message")).toHaveValue(message.text);
  await user.click(screen.getByRole("button", { name: "Save message" }));
  expect(socket.last("AppendParticipantMessage")).toMatchObject({
    expectedVersion: 2,
    text: original.text,
  });
  expect(socket.last("AppendParticipantMessage").mutationId).not.toBe(
    original.mutationId
  );
});

it("deduplicates replayed history and does not skip unread pages when an append receipt arrives", () => {
  const f = fixture();
  const client = new PrivateInterviewClient(context, f.dependencies);
  client.connect();
  f.directoryReady();
  client.select(reference);
  const socket = f.latest();
  socket.receive({
    bindingKey: "binding-a",
    sessionReference: reference,
    state,
    type: "SessionReady",
  });
  socket.receive({
    hasMore: true,
    messages: [message],
    requestId: socket.last("ReadHistory").requestId,
    state: { status: "open", version: 3 },
    type: "HistoryRead",
  });
  client.append("New message");
  socket.receive({
    message: {
      ...message,
      id: "00000000-0000-4000-8000-000000000204",
      ordinal: 4,
      text: "New message",
    },
    mutationId: socket.last("AppendParticipantMessage").mutationId,
    state: { status: "open", version: 4 },
    type: "MessageAppended",
  });
  client.loadHistory();
  expect(socket.last("ReadHistory").afterOrdinal).toBe(1);
  socket.receive({
    hasMore: false,
    messages: [
      message,
      { ...message, id: "00000000-0000-4000-8000-000000000202", ordinal: 2 },
    ],
    requestId: socket.last("ReadHistory").requestId,
    state: { status: "open", version: 3 },
    type: "HistoryRead",
  });
  expect(client.getSnapshot().messages.map((item) => item.ordinal)).toEqual([
    1, 2, 4,
  ]);
  expect(client.getSnapshot().sessionState?.version).toBe(4);
});

it("does not send a mutation when browser storage fails", () => {
  const f = fixture();
  const client = new PrivateInterviewClient(context, {
    ...f.dependencies,
    storage: {
      ...f.dependencies.storage,
      setItem: () => {
        throw new Error("Quota exceeded");
      },
    },
  });
  client.connect();
  f.directoryReady();
  client.start();
  expect(f.latest().commands.map((command) => command.type)).toEqual([
    "ListSessions",
  ]);
  expect(client.getSnapshot().notice).toBe("storage_unavailable");
});

it("rejects oversized or unbound frames without rendering private content", () => {
  const f = fixture();
  const client = new PrivateInterviewClient(context, f.dependencies);
  client.connect();
  f.directoryReady();
  client.select(reference);
  f.latest().receive({
    bindingKey: "binding-other",
    sessionReference: reference,
    state,
    type: "SessionReady",
  });
  expect(client.getSnapshot().connection).toBe("unavailable");
  client.connect();
  f.latest().onFrame?.({ data: " ".repeat(32_769) });
  expect(client.getSnapshot().connection).toBe("unavailable");
  expect(client.getSnapshot().messages).toEqual([]);
});
