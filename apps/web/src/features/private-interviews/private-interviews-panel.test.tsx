import {
  HouseholdPeopleRoster,
  PersonProfile,
} from "@meal-planner/household-api";
// @vitest-environment jsdom
import { ProfileCard } from "@meal-planner/private-interview-api";
import type {
  DirectoryCommand,
  DirectoryFrame,
  SessionCommand,
  SessionFrame,
  ProfileCard as ProfileCardType,
} from "@meal-planner/private-interview-api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Schema } from "effect";
import { afterEach, expect, it, vi } from "vitest";

import { HouseholdProfilesPanel } from "../household-profiles/household-profiles-panel.js";
import { ProfileOperationError } from "../household-profiles/operations.js";
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
    continueConfirmation: vi.fn(
      async (
        _session: string,
        _mutation: string,
        _generation: string,
        _signal: AbortSignal
      ) => "accepted" as "accepted" | "unavailable" | "authentication_required"
    ),
    makeId: () => {
      ordinal += 1;
      return `00000000-0000-4000-8000-${String(ordinal).padStart(12, "0")}`;
    },
    readCurrentProfile: vi.fn().mockResolvedValue(
      Schema.decodeUnknownSync(PersonProfile)({
        audit: null,
        facts: [],
        personId: "person_00000000-0000-4000-8000-000000000001",
        version: 0,
      })
    ),
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
  const sessionReady = (
    sessionState = state,
    cards: readonly ProfileCardType[] = [],
    pendingConfirmation: string | null = null,
    generation = "00000000-0000-4000-8000-000000000301"
  ) => {
    const socket = latest();
    socket.receive({
      bindingKey: "binding-a",
      generation,
      pendingConfirmation,
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
    socket.receive({
      cards,
      hasMore: false,
      pendingConfirmation,
      requestId: socket.last("ReadCards").requestId,
      state: sessionState,
      type: "CardsRead",
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
      generation: "00000000-0000-4000-8000-000000000301",
      pendingConfirmation: null,
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
        generation: "00000000-0000-4000-8000-000000000301",
        pendingConfirmation: null,
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
      generation: "00000000-0000-4000-8000-000000000301",
      pendingConfirmation: null,
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
    generation: "00000000-0000-4000-8000-000000000301",
    pendingConfirmation: null,
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
    generation: "00000000-0000-4000-8000-000000000301",
    pendingConfirmation: null,
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

const proposal = (patch: Record<string, unknown> = {}) =>
  Schema.decodeUnknownSync(ProfileCard)({
    change: {
      _tag: "AddConfirmedProfileFact",
      fact: {
        _tag: "FoodPreference",
        label: "Peas",
        sentiment: "dislike",
        targetKind: "ingredient",
      },
    },
    expectedProfileVersion: 0,
    id: "00000000-0000-4000-8000-000000000401",
    ordinal: 1,
    outcome: null,
    reviewedFact: null,
    revision: 1,
    status: "proposed",
    ...patch,
  });
const factId = "fact_00000000-0000-4000-8000-000000000501";
const sharedProfile = (
  value: (typeof PersonProfile.Type)["facts"][number]["value"],
  version = 1
) =>
  Schema.decodeUnknownSync(PersonProfile)({
    audit: null,
    facts: [
      {
        createdAtEpochMs: 1,
        createdBy: "a".repeat(64),
        createdInVersion: 1,
        id: factId,
        source: "manual_ui",
        standing: { _tag: "provisional" },
        updatedAtEpochMs: 1,
        updatedBy: "a".repeat(64),
        updatedInVersion: version,
        value,
      },
    ],
    personId: "person_00000000-0000-4000-8000-000000000001",
    version,
  });
const openProposals = async (
  f: ReturnType<typeof fixture>,
  cards: readonly ProfileCardType[],
  pending: string | null = null
) => {
  const user = userEvent.setup();
  const mounted = render(
    <PrivateInterviewsPanel {...context} dependencies={f.dependencies} />
  );
  act(() => f.list(f.directoryReady()));
  await user.click(screen.getByRole("button", { name: /Session 1/u }));
  await act(async () => {
    f.sessionReady(state, cards, pending);
  });
  return { mounted, socket: f.latest(), user };
};

it("revises and rejects private proposals without continuing any household write", async () => {
  const f = fixture();
  const card = proposal();
  const { user, socket } = await openProposals(f, [card]);
  await user.click(screen.getByText("Review or correct proposal"));
  await user.clear(screen.getByLabelText("Food or ingredient"));
  await user.type(screen.getByLabelText("Food or ingredient"), "Carrots");
  await user.click(
    screen.getByRole("button", { name: "Save revised proposal" })
  );
  const revise = socket.last("ReviseProfileCard");
  expect(revise).toMatchObject({
    change: { fact: { label: "Carrots" } },
    expectedProfileVersion: 0,
    reviewedFact: null,
  });
  const revised = proposal({ change: revise.change, revision: 2 });
  act(() =>
    socket.receive({
      card: revised,
      mutationId: revise.mutationId,
      state: { status: "open", version: 1 },
      type: "CardUpdated",
    })
  );
  await user.click(screen.getByRole("button", { name: "Reject proposal" }));
  act(() =>
    socket.receive({
      card: { ...revised, status: "rejected" },
      mutationId: socket.last("RejectProfileCard").mutationId,
      state: { status: "open", version: 2 },
      type: "CardUpdated",
    })
  );
  expect(screen.getByText("Rejected · private history")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Confirm for household" })
  ).not.toBeInTheDocument();
  expect(f.dependencies.continueConfirmation).not.toHaveBeenCalled();
});

it("keeps an ordinary confirmation pending after HTTP acceptance until its socket settlement", async () => {
  const f = fixture();
  const card = proposal();
  const { user, socket } = await openProposals(f, [card]);
  await user.click(
    screen.getByRole("button", { name: "Confirm for household" })
  );
  const command = socket.last("ConfirmProfileCard");
  expect(command.safetyConfirmation).toBeNull();
  expect(f.storage.size).toBe(1);
  expect(f.dependencies.continueConfirmation).not.toHaveBeenCalled();
  await act(async () =>
    socket.receive({
      card: { ...card, status: "pending" },
      mutationId: command.mutationId,
      state: { status: "open", version: 1 },
      type: "ConfirmationPending",
    })
  );
  expect(f.dependencies.continueConfirmation).toHaveBeenCalledWith(
    reference,
    command.mutationId,
    "00000000-0000-4000-8000-000000000301",
    expect.any(AbortSignal)
  );
  expect(
    screen.getByRole("button", { name: "Complete session" })
  ).toBeDisabled();
  expect(screen.queryByText("Confirmed for household")).not.toBeInTheDocument();
  expect(f.storage.size).toBe(1);
  const outcome = {
    profileVersion: Schema.decodeUnknownSync(PersonProfile)({
      audit: null,
      facts: [],
      personId: "person_00000000-0000-4000-8000-000000000001",
      version: 1,
    }).version,
    type: "committed" as const,
  };
  await act(async () =>
    socket.receive({
      card: { ...card, outcome, status: "confirmed" },
      mutationId: command.mutationId,
      outcome,
      state: { status: "open", version: 2 },
      type: "ConfirmationSettled",
    })
  );
  expect(screen.getByText("Confirmed for household")).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Complete session" })
  ).toBeEnabled();
  expect(f.storage.size).toBe(0);
});

it("uses the canonical current safety fact and requires a separate safety confirmation", async () => {
  const f = fixture();
  const current = {
    _tag: "HardConstraint" as const,
    category: "allergen" as const,
    handling: "exclude" as const,
    label: "Peanuts",
  };
  f.dependencies.readCurrentProfile.mockResolvedValue(sharedProfile(current));
  const card = proposal({
    change: {
      _tag: "ConfirmHardConstraintReduction",
      factId,
      replacement: null,
    },
    expectedProfileVersion: 1,
    reviewedFact: current,
  });
  const { user, socket } = await openProposals(f, [card]);
  expect(screen.getByText("Peanuts: exclude (allergen)")).toBeInTheDocument();
  expect(screen.queryByText(/Untrusted old label/u)).not.toBeInTheDocument();
  const confirm = screen.getByRole("button", {
    name: "Confirm safety change for household",
  });
  expect(confirm).toBeDisabled();
  await user.click(
    screen.getByLabelText("I confirm this safety constraint change")
  );
  await user.click(confirm);
  expect(socket.last("ConfirmProfileCard").safetyConfirmation).toBe(
    "I confirm this safety constraint change"
  );
});

it("requires an explicit revised proposal and a new confirmation after a shared version changes", async () => {
  const f = fixture();
  f.dependencies.readCurrentProfile.mockResolvedValue(
    sharedProfile(
      {
        _tag: "FoodPreference",
        label: "Lentils",
        sentiment: "like",
        targetKind: "ingredient",
      },
      2
    )
  );
  const card = proposal({
    change: { _tag: "ConfirmProfileFact", factId },
    expectedProfileVersion: 1,
    status: "conflict",
  });
  const { user, socket } = await openProposals(f, [card]);
  expect(
    screen.getByRole("button", { name: "Confirm for household" })
  ).toBeDisabled();
  await user.click(
    screen.getByRole("button", { name: "Refresh current profile" })
  );
  expect(f.dependencies.continueConfirmation).not.toHaveBeenCalled();
  await user.click(screen.getByText("Review or correct proposal"));
  await user.click(
    screen.getByRole("button", { name: "Save revised proposal" })
  );
  const revise = socket.last("ReviseProfileCard");
  expect(revise).toMatchObject({
    expectedProfileVersion: 2,
    reviewedFact: { label: "Lentils" },
  });
  act(() =>
    socket.receive({
      card: proposal({
        ...card,
        expectedProfileVersion: 2,
        reviewedFact: revise.reviewedFact,
        revision: 2,
        status: "proposed",
      }),
      mutationId: revise.mutationId,
      state: { status: "open", version: 1 },
      type: "CardUpdated",
    })
  );
  expect(f.dependencies.continueConfirmation).not.toHaveBeenCalled();
  await user.click(
    screen.getByRole("button", { name: "Confirm for household" })
  );
  expect(socket.last("ConfirmProfileCard").mutationId).not.toBe(
    revise.mutationId
  );
});

it("discovers another device's pending confirmation and retries the same ID only after fresh admission", async () => {
  const f = fixture();
  f.dependencies.continueConfirmation.mockResolvedValueOnce("unavailable");
  const pendingId = "00000000-0000-4000-8000-000000000601";
  const card = proposal({ status: "pending" });
  const { user, socket } = await openProposals(f, [card], pendingId);
  expect(f.dependencies.continueConfirmation).not.toHaveBeenCalled();
  expect(
    screen.getByRole("button", { name: "Complete session" })
  ).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Check confirmation" }));
  expect(f.dependencies.continueConfirmation).toHaveBeenCalledTimes(1);
  await user.click(
    screen.getByRole("button", { name: "Reconnect to check confirmation" })
  );
  expect(socket.closed).toBe(true);
  await act(async () => {
    f.sessionReady(
      { status: "open", version: 1 },
      [card],
      pendingId,
      "00000000-0000-4000-8000-000000000302"
    );
  });
  expect(f.dependencies.continueConfirmation).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "Check confirmation" }));
  expect(f.dependencies.continueConfirmation).toHaveBeenLastCalledWith(
    reference,
    pendingId,
    "00000000-0000-4000-8000-000000000302",
    expect.any(AbortSignal)
  );
  expect(
    f.latest().commands.some((command) => command.type === "ConfirmProfileCard")
  ).toBe(false);
});

it.each([false, true])(
  "keeps the confirmed historical meaning after the shared fact is changed or removed (%s)",
  async (removed) => {
    const f = fixture();
    const original = {
      _tag: "FoodPreference" as const,
      label: "Lentils",
      sentiment: "like" as const,
      targetKind: "ingredient" as const,
    };
    const profile = sharedProfile({ ...original, sentiment: "dislike" }, 2);
    f.dependencies.readCurrentProfile.mockResolvedValue({
      ...profile,
      facts: removed ? [] : profile.facts,
    });
    const outcome = { profileVersion: 1, type: "committed" };
    await openProposals(f, [
      proposal({
        change: { _tag: "ConfirmProfileFact", factId },
        expectedProfileVersion: 1,
        outcome,
        reviewedFact: original,
        status: "confirmed",
      }),
    ]);
    expect(
      screen.getByText("Lentils: like (ingredient) — confirmed by you")
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Lentils: dislike (ingredient) — confirmed by you")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Confirm for household" })
    ).not.toBeInTheDocument();
  }
);

it("requires a revised canonical review when a proposed fact is incorrect at the same profile version", async () => {
  const f = fixture();
  const current = {
    _tag: "FoodPreference" as const,
    label: "Lentils",
    sentiment: "like" as const,
    targetKind: "ingredient" as const,
  };
  f.dependencies.readCurrentProfile.mockResolvedValue(sharedProfile(current));
  const card = proposal({
    change: { _tag: "ConfirmProfileFact", factId },
    expectedProfileVersion: 1,
    reviewedFact: { ...current, label: "Incorrect proposal label" },
  });
  const { user, socket } = await openProposals(f, [card]);
  expect(
    screen.getByRole("button", { name: "Confirm for household" })
  ).toBeDisabled();
  expect(
    screen.getByText(/saved review does not match the current shared fact/u)
  ).toBeInTheDocument();
  expect(
    screen.queryByText(/Incorrect proposal label/u)
  ).not.toBeInTheDocument();
  await user.click(screen.getByText("Review or correct proposal"));
  await user.click(
    screen.getByRole("button", { name: "Save revised proposal" })
  );
  const revise = socket.last("ReviseProfileCard");
  expect(revise.reviewedFact).toEqual(current);
  expect(revise.change).toEqual(card.change);
  expect(revise.expectedProfileVersion).toBe(1);
  expect(
    socket.commands.some((command) => command.type === "ConfirmProfileCard")
  ).toBe(false);
  const revised = proposal({
    ...card,
    reviewedFact: revise.reviewedFact,
    revision: 2,
  });
  act(() =>
    socket.receive({
      card: revised,
      mutationId: revise.mutationId,
      state: { status: "open", version: 1 },
      type: "CardUpdated",
    })
  );
  await user.click(
    screen.getByRole("button", { name: "Confirm for household" })
  );
  const confirm = socket.last("ConfirmProfileCard");
  expect(confirm.mutationId).not.toBe(revise.mutationId);
  expect(confirm.cardRevision).toBe(2);
  const confirmed = proposal({
    ...revised,
    outcome: { profileVersion: 2, type: "committed" },
    status: "confirmed",
  });
  const { outcome } = confirmed;
  if (outcome === null) {
    throw new Error("Expected terminal outcome");
  }
  await act(async () =>
    socket.receive({
      card: confirmed,
      mutationId: confirm.mutationId,
      outcome,
      state: { status: "open", version: 2 },
      type: "ConfirmationSettled",
    })
  );
  expect(
    screen.getByText("Lentils: like (ingredient) — confirmed by you")
  ).toBeInTheDocument();
  expect(
    screen.queryByText(/Incorrect proposal label/u)
  ).not.toBeInTheDocument();
});

it.each([
  "ConfirmProfileFact",
  "ReplaceOrdinaryProfileFact",
  "RemoveOrdinaryProfileFact",
  "ConfirmHardConstraintReduction",
] as const)(
  "blocks direct %s confirmation when its same-version review disagrees with the canonical fact",
  async (tag) => {
    const f = fixture();
    const fact = {
      _tag: "FoodPreference" as const,
      label: "Peas",
      sentiment: "like" as const,
      targetKind: "ingredient" as const,
    };
    const profile = sharedProfile(fact);
    f.dependencies.readCurrentProfile.mockResolvedValue(profile);
    const change: {
      _tag: typeof tag;
      factId: string;
      fact?: typeof fact;
      replacement?: null;
    } = { _tag: tag, factId };
    if (tag === "ReplaceOrdinaryProfileFact") {
      change.fact = fact;
    }
    if (tag === "ConfirmHardConstraintReduction") {
      change.replacement = null;
    }
    const card = proposal({
      change,
      expectedProfileVersion: 1,
      reviewedFact: { ...fact, label: "Incorrect label" },
    });
    const client = new PrivateInterviewClient(context, f.dependencies);
    client.connect();
    f.directoryReady();
    client.select(reference);
    f.sessionReady(state, [card]);
    await Promise.resolve();
    client.confirmCard(
      card,
      tag === "ConfirmHardConstraintReduction"
        ? "I confirm this safety constraint change"
        : null
    );
    expect(
      f
        .latest()
        .commands.some((command) => command.type === "ConfirmProfileCard")
    ).toBe(false);
    expect(f.dependencies.continueConfirmation).not.toHaveBeenCalled();
  }
);

it("refreshes the sibling shared profile and history on canonical settlement while retaining a pending manual command", async () => {
  const user = userEvent.setup();
  const f = fixture();
  const personId = "person_00000000-0000-4000-8000-000000000001";
  const initialProfile = Schema.decodeUnknownSync(PersonProfile)({
    audit: null,
    facts: [],
    personId,
    version: 0,
  });
  const fact = {
    createdAtEpochMs: 1,
    createdBy: "a".repeat(64),
    createdInVersion: 1,
    id: factId,
    source: "interview",
    standing: { _tag: "confirmed", basis: "self" },
    updatedAtEpochMs: 1,
    updatedBy: "a".repeat(64),
    updatedInVersion: 1,
    value: {
      _tag: "FoodPreference",
      label: "Peas",
      sentiment: "dislike",
      targetKind: "ingredient",
    },
  };
  const confirmedProfile = Schema.decodeUnknownSync(PersonProfile)({
    ...initialProfile,
    audit: {
      actorId: "a".repeat(64),
      actorPersonId: personId,
      after: fact,
      atEpochMs: 1,
      before: null,
      command: {
        _tag: "AddConfirmedProfileFact",
        basis: "self",
        fact: fact.value,
      },
      nextVersion: 1,
      previousVersion: 0,
      source: "interview",
    },
    facts: [fact],
    version: 1,
  });
  const roster = Schema.decodeUnknownSync(HouseholdPeopleRoster)({
    creatorSlot: "occupied",
    currentPersonId: personId,
    people: [
      {
        associationState: "linked",
        associationVersion: 1,
        createdAtEpochMs: 1,
        displayName: "Cook",
        id: personId,
        isCurrentAdult: true,
        kind: "adult",
        lifecycle: "active",
        updatedAtEpochMs: 1,
        version: 1,
      },
    ],
  });
  const operations = {
    get: vi.fn().mockResolvedValue(initialProfile),
    mutate: vi.fn().mockRejectedValue(new ProfileOperationError("ambiguous")),
    versions: vi
      .fn()
      .mockResolvedValue({ nextBeforeVersion: null, versions: [] }),
  };
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <PrivateInterviewsPanel
        {...context}
        dependencies={f.dependencies}
        onConfirmationSettled={() => {
          void queryClient.invalidateQueries({
            queryKey: ["household-profile", context.householdId],
          });
        }}
      />
      <HouseholdProfilesPanel
        operations={operations}
        organizationId={context.householdId}
        peopleOperations={{ list: vi.fn().mockResolvedValue(roster) }}
      />
    </QueryClientProvider>
  );
  const shared = within(screen.getByRole("region", { name: "Food profiles" }));
  await user.type(
    await shared.findByLabelText("Food or ingredient"),
    "Broccoli"
  );
  await user.click(shared.getByRole("button", { name: "Add fact" }));
  await shared.findByText(/last change’s outcome is not known/u);
  const pendingKey = ["household-profile-unresolved", context.householdId];
  const retainedManualCommand = queryClient.getQueryData(pendingKey);
  act(() => f.list(f.directoryReady()));
  await user.click(screen.getByRole("button", { name: /Session 1/u }));
  const card = proposal();
  await act(async () => {
    f.sessionReady(state, [card]);
  });
  await user.click(
    screen.getByRole("button", { name: "Confirm for household" })
  );
  const socket = f.latest();
  const confirm = socket.last("ConfirmProfileCard");
  await act(async () =>
    socket.receive({
      card: { ...card, status: "pending" },
      mutationId: confirm.mutationId,
      state: { status: "open", version: 1 },
      type: "ConfirmationPending",
    })
  );
  expect(shared.getByText(/Profile version 0/u)).toBeInTheDocument();
  expect(operations.get).toHaveBeenCalledTimes(1);
  const stalledPrivateRead = Promise.withResolvers<PersonProfile>();
  f.dependencies.readCurrentProfile.mockReturnValueOnce(
    stalledPrivateRead.promise
  );
  await user.click(
    screen.getByRole("button", { name: "Refresh current profile" })
  );
  operations.get.mockResolvedValue(confirmedProfile);
  operations.versions.mockResolvedValue({
    nextBeforeVersion: null,
    versions: [confirmedProfile],
  });
  const outcome = {
    profileVersion: confirmedProfile.version,
    type: "committed" as const,
  };
  await act(async () =>
    socket.receive({
      card: { ...card, outcome, status: "confirmed" },
      mutationId: confirm.mutationId,
      outcome,
      state: { status: "open", version: 2 },
      type: "ConfirmationSettled",
    })
  );
  expect(await shared.findByText(/Profile version 1/u)).toBeInTheDocument();
  expect(shared.getByText("Peas: dislike (ingredient)")).toBeInTheDocument();
  expect(await shared.findAllByText(/Interview confirmation/u)).toHaveLength(2);
  expect(operations.get).toHaveBeenCalledTimes(2);
  expect(operations.versions).toHaveBeenCalledTimes(2);
  expect(queryClient.getQueryData(pendingKey)).toEqual(retainedManualCommand);
  expect(
    shared.getByRole("button", { name: "Retry saved change" })
  ).toBeEnabled();
  expect(operations.mutate).toHaveBeenCalledTimes(1);
  await act(async () => {
    socket.lose(1008);
    socket.receive({
      card: { ...card, outcome, status: "confirmed" },
      mutationId: confirm.mutationId,
      outcome,
      state: { status: "open", version: 2 },
      type: "ConfirmationSettled",
    });
    stalledPrivateRead.resolve(confirmedProfile);
  });
  expect(operations.get).toHaveBeenCalledTimes(2);
  expect(operations.versions).toHaveBeenCalledTimes(2);
});
