import {
  HouseholdPeopleRoster,
  PersonProfile,
} from "@meal-planner/household-api";
// @vitest-environment jsdom
import { ProfileCard } from "@meal-planner/private-interview-api";
import type {
  AssistantTurn,
  DirectoryCommand,
  DirectoryFrame,
  SessionCommand,
  SessionFrame,
  ProfileCard as ProfileCardType,
} from "@meal-planner/private-interview-api";
import { fetchServerSentEvents, useChat } from "@tanstack/ai-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
  scope: "ProfileEdit" as const,
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
    fetchChat: vi.fn<typeof fetch>(async () =>
      Response.json({ activeRun: null, messages: [] })
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
    generation = "00000000-0000-4000-8000-000000000301",
    assistantTurn: AssistantTurn | null = null
  ) => {
    const socket = latest();
    socket.receive({
      assistantTurn,
      bindingKey: "binding-a",
      generation,
      pendingConfirmation,
      sessionReference: reference,
      state: sessionState,
      type: "SessionReady",
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

it("offers explicit reconnect when a fresh automatic admission fails and retains the same request", async () => {
  const user = userEvent.setup();
  const f = fixture();
  render(<PrivateInterviewsPanel {...context} dependencies={f.dependencies} />);
  act(() => f.list(f.directoryReady(), []));
  await user.click(
    screen.getByRole("button", { name: "Start food discovery" })
  );
  const request = f.latest().last("StartSession");
  act(() => f.latest().lose(1008));
  expect(
    screen.getByText(/Connecting to your private sessions/u)
  ).toBeInTheDocument();
  act(() => f.latest().lose(1008));
  expect(
    screen.getByText(/Reconnect to continue\. If your sign-in has expired/u)
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Reconnect" }));
  act(() => f.list(f.directoryReady(), []));
  await user.click(screen.getByRole("button", { name: "Retry saved request" }));
  expect(f.latest().last("StartSession")).toEqual(request);
});

it("cannot replay or display retained private contents under another account, household, or repaired linkage", () => {
  const f = fixture();
  const first = new PrivateInterviewClient(context, f.dependencies);
  first.connect();
  f.directoryReady();
  first.select(reference);
  f.sessionReady();
  first.complete();
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
  repaired.start("ProfileEdit");
  expect(f.latest().commands.map((command) => command.type)).toEqual([
    "ListSessions",
    "StartSession",
  ]);
  expect(repaired.getSnapshot().pending?.bindingKey).toBe("binding-repaired");
});

it.each(["clear", "changed"] as const)(
  "recovers an unreadable saved start only through an explicit %s action",
  (outcome) => {
    const f = fixture();
    const first = new PrivateInterviewClient(context, f.dependencies);
    first.connect();
    const initialDirectory = f.directoryReady();
    f.list(initialDirectory);
    first.start("ProfileEdit");
    const [entry] = [...f.storage];
    if (entry === undefined) {
      throw new Error("Expected retained request");
    }
    const [key, valid] = entry;
    const decoded = JSON.parse(valid);
    delete decoded.command.scope;
    const unreadable = JSON.stringify(decoded);
    f.storage.set(key, unreadable);
    first.disconnect();
    const resumed = new PrivateInterviewClient(context, f.dependencies);
    resumed.connect();
    const directory = f.directoryReady();
    f.list(directory);
    expect(resumed.getSnapshot().notice).toBe("unreadable_request");
    expect(f.storage.get(key)).toBe(unreadable);
    resumed.start("InitialDiscovery");
    expect(
      directory.commands.filter((command) => command.type === "StartSession")
    ).toEqual([]);
    if (outcome === "changed") {
      f.storage.set(key, valid);
    }
    resumed.discardUnreadableRequest();
    expect(f.storage.get(key)).toBe(outcome === "changed" ? valid : undefined);
    const refreshed = f.directoryReady();
    f.list(refreshed);
    if (outcome === "clear") {
      expect(resumed.getSnapshot().notice).toBeNull();
      resumed.start("InitialDiscovery");
      expect(refreshed.last("StartSession")).toMatchObject({
        scope: "InitialDiscovery",
      });
    } else {
      expect(resumed.getSnapshot().pending?.command).toMatchObject({
        scope: "ProfileEdit",
        type: "StartSession",
      });
      expect(
        refreshed.commands.filter((command) => command.type === "StartSession")
      ).toEqual([]);
    }
  }
);

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
  client.start("ProfileEdit");
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
    assistantTurn: null,
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
  expect(client.getSnapshot().generation).toBeNull();
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

it("preserves an unreadable request through confirmation reconciliation until explicit clearing", async () => {
  const f = fixture();
  const first = new PrivateInterviewClient(context, f.dependencies);
  first.connect();
  f.list(f.directoryReady());
  first.start("ProfileEdit");
  const [entry] = [...f.storage];
  if (entry === undefined) {
    throw new Error("Expected retained request");
  }
  const [key, valid] = entry;
  const decoded = JSON.parse(valid);
  delete decoded.command.scope;
  const unreadable = JSON.stringify(decoded);
  f.storage.set(key, unreadable);
  first.disconnect();

  const client = new PrivateInterviewClient(context, f.dependencies);
  client.connect();
  const directory = f.directoryReady();
  f.list(directory);
  client.select(reference);
  const pendingId = "00000000-0000-4000-8000-000000000601";
  const card = proposal({ status: "pending" });
  const socket = f.sessionReady(
    { status: "open", version: 1 },
    [card],
    pendingId
  );
  expect(client.getSnapshot().notice).toBe("unreadable_request");
  await client.checkConfirmation();
  expect(f.dependencies.continueConfirmation).toHaveBeenCalledOnce();
  const outcome = {
    profileVersion: Schema.decodeUnknownSync(PersonProfile.fields.version)(1),
    type: "committed" as const,
  };
  socket.receive({
    card: { ...card, outcome, status: "confirmed" },
    mutationId: pendingId,
    outcome,
    state: { status: "open", version: 2 },
    type: "ConfirmationSettled",
  });
  expect(client.getSnapshot().pendingConfirmation).toBeNull();
  expect(client.getSnapshot().notice).toBe("unreadable_request");
  client.start("InitialDiscovery");
  client.complete();
  expect(f.storage.get(key)).toBe(unreadable);
  expect(
    directory.commands.filter((command) => command.type === "StartSession")
  ).toEqual([]);
  expect(
    socket.commands.filter((command) => command.type === "CompleteSession")
  ).toEqual([]);

  client.discardUnreadableRequest();
  expect(f.storage.has(key)).toBe(false);
  const refreshed = f.directoryReady();
  f.list(refreshed);
  expect(client.getSnapshot().notice).toBeNull();
  client.start("InitialDiscovery");
  expect(refreshed.last("StartSession")).toMatchObject({
    scope: "InitialDiscovery",
  });
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

it("transparently re-admits an idle directory and reconciles the exact Start request", async () => {
  const f = fixture();
  const user = userEvent.setup();
  render(<PrivateInterviewsPanel {...context} dependencies={f.dependencies} />);
  let original: Socket | undefined;
  act(() => {
    original = f.directoryReady();
    f.list(original, []);
  });
  await user.click(
    screen.getByRole("button", { name: "Start food discovery" })
  );
  const start = f.latest().last("StartSession");
  act(() => original?.lose(1008));
  expect(
    screen.getByText(/Connecting to your private sessions/u)
  ).toBeInTheDocument();
  const fresh = f.latest();
  act(() => {
    f.directoryReady();
    f.list(fresh, []);
  });
  expect(fresh.last("StartSession")).toEqual(start);
  act(() => {
    fresh.receive({
      mutationId: start.mutationId,
      reservation,
      type: "SessionStarted",
    });
    f.sessionReady();
  });
  await waitFor(() =>
    expect(screen.getByLabelText("Your message")).toBeEnabled()
  );
  expect(f.storage.size).toBe(0);
  expect(f.dependencies.continueConfirmation).not.toHaveBeenCalled();
});

const establishedClient = (f: ReturnType<typeof fixture>) => {
  const client = new PrivateInterviewClient(context, f.dependencies);
  client.connect();
  f.list(f.directoryReady());
  client.select(reference);
  const socket = f.sessionReady();
  return { client, socket };
};

it("restores only selection metadata after idle loss and rejects a different participant binding", () => {
  const f = fixture();
  const { client, socket } = establishedClient(f);
  expect(client.getSnapshot().generation).not.toBeNull();
  socket.lose(1008);
  expect(client.getSnapshot().generation).toBeNull();
  expect(client.getSnapshot().sessionReference).toBeNull();
  const count = f.sockets.length;
  const admission = f.latest();
  f.directoryReady("binding-other");
  expect(client.getSnapshot().connection).toBe("authentication_required");
  expect(client.getSnapshot().generation).toBeNull();
  expect(f.sockets.length).toBe(count);
  expect(admission.commands).toEqual([]);
  expect(admission.closed).toBe(true);
});

it.each(["admission", "initial_reads"])(
  "stops automatic recovery after a revoked %s without looping",
  (failurePoint) => {
    const f = fixture();
    const { client, socket } = establishedClient(f);
    socket.lose(1008);
    if (failurePoint === "initial_reads") {
      f.list(f.directoryReady());
      f.latest().receive({
        assistantTurn: null,
        bindingKey: "binding-a",
        generation: "00000000-0000-4000-8000-000000000302",
        pendingConfirmation: null,
        sessionReference: reference,
        state,
        type: "SessionReady",
      });
    }
    const failed = f.latest();
    const count = f.sockets.length;
    failed.lose(1008);
    failed.lose(1008);
    expect(f.sockets.length).toBe(count);
    expect(client.getSnapshot().connection).toBe("authentication_required");
    expect(client.getSnapshot().generation).toBeNull();
    expect(client.getSnapshot().cards).toEqual([]);
  }
);

it("does not let two established tabs endlessly replace one another after repeated authority closes", () => {
  const left = fixture();
  const right = fixture();
  const a = establishedClient(left);
  const b = establishedClient(right);
  a.socket.lose(1008);
  left.list(left.directoryReady());
  left.sessionReady();
  expect(a.client.getSnapshot().sessionReference).toBe(reference);
  b.socket.lose(1008);
  right.list(right.directoryReady());
  right.sessionReady();
  const leftCount = left.sockets.length;
  const rightCount = right.sockets.length;
  left.latest().lose(1008);
  right.latest().lose(1008);
  expect(left.sockets.length).toBe(leftCount);
  expect(right.sockets.length).toBe(rightCount);
  expect(a.client.getSnapshot().connection).toBe("authentication_required");
  expect(b.client.getSnapshot().connection).toBe("authentication_required");
  a.client.connect();
  left.list(left.directoryReady());
  a.client.start("ProfileEdit");
  const exact = left.latest().last("StartSession");
  left.latest().lose(1008);
  const fresh = left.directoryReady();
  expect(fresh.last("StartSession")).toEqual(exact);
  expect(left.sockets.length).toBe(leftCount + 2);
});

it("reconciles recovered confirmation once without automatic household continuation", async () => {
  const f = fixture();
  const client = new PrivateInterviewClient(context, f.dependencies);
  client.connect();
  f.list(f.directoryReady());
  client.select(reference);
  const card = proposal();
  const original = f.sessionReady(state, [card]);
  await Promise.resolve();
  client.confirmCard(card, null);
  const exact = original.last("ConfirmProfileCard");
  original.lose(1008);
  f.list(f.directoryReady());
  const fresh = f.sessionReady(state, [card]);
  expect(fresh.last("ConfirmProfileCard")).toEqual(exact);
  fresh.receive({
    card: { ...card, status: "pending" },
    mutationId: exact.mutationId,
    state: { ...state, version: 1 },
    type: "ConfirmationPending",
  });
  await Promise.resolve();
  expect(
    fresh.commands.filter((command) => command.type === "ConfirmProfileCard")
  ).toHaveLength(1);
  expect(f.dependencies.continueConfirmation).not.toHaveBeenCalled();
  expect(client.getSnapshot().confirmationStatus).toBe("idle");
  expect(client.getSnapshot().pendingConfirmation).toBe(exact.mutationId);
});

const chatHistory = (activeRun: { runId: string } | null = null) =>
  Response.json({
    activeRun,
    messages: [
      {
        id: messageId,
        parts: [{ content: message.text, type: "text" }],
        role: "user",
      },
    ],
  });
const chatEvents = (
  runId: string,
  reply = "What foods do you need to avoid?"
) => [
  { runId, threadId: reference, timestamp: 1, type: "RUN_STARTED" },
  {
    messageId: "accepted-reply",
    role: "assistant",
    type: "TEXT_MESSAGE_START",
  },
  { delta: reply, messageId: "accepted-reply", type: "TEXT_MESSAGE_CONTENT" },
  { messageId: "accepted-reply", type: "TEXT_MESSAGE_END" },
  {
    outcome: { type: "success" },
    runId,
    threadId: reference,
    timestamp: 2,
    type: "RUN_FINISHED",
  },
];
const eventResponse = (events: readonly unknown[], start = 0) =>
  new Response(
    events
      .map(
        (event, index) =>
          `id: ${index + start}\ndata: ${JSON.stringify(event)}\n\n`
      )
      .join(""),
    { headers: { "content-type": "text/event-stream" } }
  );
const openChat = async (f: ReturnType<typeof fixture>) => {
  const user = userEvent.setup();
  const mounted = render(
    <PrivateInterviewsPanel {...context} dependencies={f.dependencies} />
  );
  act(() => f.list(f.directoryReady()));
  await user.click(screen.getByRole("button", { name: /Session 1/u }));
  await act(async () => f.sessionReady());
  await screen.findByText(message.text);
  return { mounted, socket: f.latest(), user };
};
it("hydrates the sole server transcript and sends native chat input using the current domain version", async () => {
  const f = fixture();
  f.dependencies.fetchChat.mockImplementation(async (_input, init) => {
    if (init?.method !== "POST") {
      return chatHistory();
    }
    const body = JSON.parse(String(init.body));
    return eventResponse(chatEvents(body.runId));
  });
  const { user, socket } = await openChat(f);
  expect(screen.getByText(message.text)).toBeInTheDocument();
  expect(socket.commands.map((command) => command.type)).not.toContain(
    "ReadHistory"
  );
  act(() =>
    socket.receive({
      state: { ...state, version: 7 },
      turn: {
        failure: "invalid_output",
        id: "00000000-0000-4000-8000-000000000401",
        sourceMessageId: messageId,
        status: "failed",
      },
      type: "AssistantTurnUpdated",
    })
  );
  await user.type(screen.getByLabelText("Your message"), "I avoid peanuts.");
  await user.click(screen.getByRole("button", { name: "Send message" }));
  expect(
    await screen.findByText("What foods do you need to avoid?")
  ).toBeInTheDocument();
  const posts = f.dependencies.fetchChat.mock.calls.filter(
    ([, init]) => init?.method === "POST"
  );
  expect(posts).toHaveLength(1);
  const [input, init] = posts[0] ?? [];
  expect(input).toBe(`/v1/private-interviews/${reference}/chat`);
  expect(new Headers(init?.headers).get("x-private-output-generation")).toBe(
    "00000000-0000-4000-8000-000000000301"
  );
  const body = JSON.parse(String(init?.body));
  expect(body).toMatchObject({
    data: { expectedVersion: 7 },
    forwardedProps: { expectedVersion: 7 },
    threadId: reference,
    tools: [],
  });
  expect(body.runId).toMatch(/^run-[0-9]+-[a-z0-9]*$/u);
  expect(body.data).not.toHaveProperty("mutationId");
  expect(body.messages.at(-1)).toMatchObject({
    content: "I avoid peanuts.",
    role: "user",
  });
  expect(socket.commands.map((command) => command.type)).not.toContain(
    "AppendParticipantMessage"
  );
  expect([...f.storage.values()].join(",")).not.toContain("I avoid peanuts.");
});
it("reconnects the same native run and deduplicates replay without submitting another intent", async () => {
  const f = fixture();
  let posts = 0;
  f.dependencies.fetchChat.mockImplementation(async (_input, init) => {
    if (init?.method !== "POST") {
      return chatHistory();
    }
    const { runId } = JSON.parse(String(init.body));
    posts += 1;
    return eventResponse(
      posts === 1 ? chatEvents(runId).slice(0, 1) : chatEvents(runId)
    );
  });
  const { user } = await openChat(f);
  await user.type(screen.getByLabelText("Your message"), "No allergies.");
  await user.click(screen.getByRole("button", { name: "Send message" }));
  expect(
    await screen.findByText("What foods do you need to avoid?")
  ).toBeInTheDocument();
  const requests = f.dependencies.fetchChat.mock.calls.filter(
    ([, init]) => init?.method === "POST"
  );
  expect(requests).toHaveLength(2);
  expect(requests[1]?.[1]?.body).toBe(requests[0]?.[1]?.body);
  expect(new Headers(requests[1]?.[1]?.headers).get("Last-Event-ID")).toBe("0");
  expect(screen.getAllByText("What foods do you need to avoid?")).toHaveLength(
    1
  );
});
it("joins the hydrated active run with read-only GET and never launches inference on mount", async () => {
  const f = fixture();
  const runId = "00000000-0000-4000-8000-000000000501";
  f.dependencies.fetchChat.mockImplementation(async (input) =>
    String(input).includes("runId=")
      ? eventResponse(chatEvents(runId))
      : chatHistory({ runId })
  );
  await openChat(f);
  expect(
    await screen.findByText("What foods do you need to avoid?")
  ).toBeInTheDocument();
  expect(
    f.dependencies.fetchChat.mock.calls.every(
      ([, init]) => init?.method === "GET"
    )
  ).toBe(true);
  expect(
    f.dependencies.fetchChat.mock.calls.some(
      ([input]) =>
        String(input).includes(`runId=${runId}`) &&
        String(input).includes("offset=-1")
    )
  ).toBe(true);
});
it("Stop cancels the server run and aborts the local stream", async () => {
  const f = fixture();
  let streamSignal: AbortSignal | null | undefined;
  f.dependencies.fetchChat.mockImplementation(async (_input, init) => {
    if (init?.method === "DELETE") {
      return new Response(null, { status: 204 });
    }
    if (init?.method !== "POST") {
      return chatHistory();
    }
    streamSignal = init.signal;
    const { runId } = JSON.parse(String(init.body));
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              `id: 0\ndata: ${JSON.stringify(chatEvents(runId)[0])}\n\n`
            )
          );
          init.signal?.addEventListener(
            "abort",
            () => controller.error(new DOMException("Stopped", "AbortError")),
            { once: true }
          );
        },
      }),
      { headers: { "content-type": "text/event-stream" } }
    );
  });
  const { user } = await openChat(f);
  await user.type(
    screen.getByLabelText("Your message"),
    "Please help me explore my preferences."
  );
  await user.click(screen.getByRole("button", { name: "Send message" }));
  const stopButton = await screen.findByRole("button", {
    name: "Stop response",
  });
  expect(
    screen.getByRole("button", { name: "Complete session" })
  ).toBeDisabled();
  expect(
    screen.getByRole("group", { name: "Profile proposal review" })
  ).toBeDisabled();
  await user.click(stopButton);
  await waitFor(() =>
    expect(
      f.dependencies.fetchChat.mock.calls.some(
        ([, init]) => init?.method === "DELETE"
      )
    ).toBe(true)
  );
  expect(streamSignal?.aborted).toBe(true);
  const post = f.dependencies.fetchChat.mock.calls.find(
    ([, init]) => init?.method === "POST"
  );
  const cancel = f.dependencies.fetchChat.mock.calls.find(
    ([, init]) => init?.method === "DELETE"
  );
  expect(String(cancel?.[0])).toContain(
    `runId=${JSON.parse(String(post?.[1]?.body)).runId}`
  );
  expect(cancel?.[1]?.body).toBeUndefined();
});
it("clears the transcript immediately on account change", async () => {
  const f = fixture();
  f.dependencies.fetchChat.mockImplementation(async () => chatHistory());
  const { mounted } = await openChat(f);
  expect(screen.getByText(message.text)).toBeInTheDocument();
  mounted.rerender(
    <PrivateInterviewsPanel
      {...context}
      accountId="adult-b"
      dependencies={f.dependencies}
    />
  );
  expect(screen.queryByText(message.text)).not.toBeInTheDocument();
  expect(
    screen.getByText(/Connecting to your private sessions/u)
  ).toBeInTheDocument();
  expect(f.sockets.slice(0, -1).every(({ socket }) => socket.closed)).toBe(
    true
  );
});
it("keeps invalid output out of the conversation and never automatically retries the model", async () => {
  const f = fixture();
  f.dependencies.fetchChat.mockImplementation(async (_input, init) => {
    if (init?.method !== "POST") {
      return chatHistory();
    }
    const { runId } = JSON.parse(String(init.body));
    return eventResponse([
      chatEvents(runId)[0],
      {
        code: "invalid_output",
        error: {
          code: "invalid_output",
          message: "The response failed validation.",
        },
        message: "The response failed validation.",
        runId,
        threadId: reference,
        type: "RUN_ERROR",
      },
    ]);
  });
  const { user } = await openChat(f);
  await user.type(screen.getByLabelText("Your message"), "My latest answer.");
  await user.click(screen.getByRole("button", { name: "Send message" }));
  expect(
    await screen.findByText(/The connection to the response was interrupted/u)
  ).toBeInTheDocument();
  expect(
    f.dependencies.fetchChat.mock.calls.filter(
      ([, init]) => init?.method === "POST"
    )
  ).toHaveLength(1);
  expect(
    screen.queryByText("What foods do you need to avoid?")
  ).not.toBeInTheDocument();
});

it("shows a failed hydration honestly and prevents sending before server history is available", async () => {
  const f = fixture();
  f.dependencies.fetchChat.mockResolvedValue(
    new Response(null, { status: 503 })
  );
  const user = userEvent.setup();
  render(<PrivateInterviewsPanel {...context} dependencies={f.dependencies} />);
  act(() => f.list(f.directoryReady()));
  await user.click(screen.getByRole("button", { name: /Session 1/u }));
  await act(async () => f.sessionReady());
  expect(
    await screen.findByText("Your private history could not be loaded.")
  ).toBeInTheDocument();
  expect(screen.getByLabelText("Your message")).toBeDisabled();
  expect(f.dependencies.fetchChat.mock.calls).toHaveLength(1);
  expect(f.dependencies.fetchChat.mock.calls[0]?.[1]?.method).toBe("GET");
});

it("ignores a late authentication failure belonging to the previous mounted account", async () => {
  const f = fixture();
  let resolveOld: ((response: Response) => void) | undefined;
  f.dependencies.fetchChat
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveOld = resolve;
        })
    )
    .mockImplementation(async () => chatHistory());
  const user = userEvent.setup();
  const mounted = render(
    <PrivateInterviewsPanel {...context} dependencies={f.dependencies} />
  );
  act(() => f.list(f.directoryReady()));
  await user.click(screen.getByRole("button", { name: /Session 1/u }));
  await act(async () => f.sessionReady());
  mounted.rerender(
    <PrivateInterviewsPanel
      {...context}
      accountId="adult-b"
      dependencies={f.dependencies}
    />
  );
  act(() => f.list(f.directoryReady()));
  await user.click(screen.getByRole("button", { name: /Session 1/u }));
  await act(async () =>
    f.sessionReady(state, [], null, "00000000-0000-4000-8000-000000000302")
  );
  expect(await screen.findByText(message.text)).toBeInTheDocument();
  const count = f.sockets.length;
  await act(async () => resolveOld?.(new Response(null, { status: 401 })));
  expect(screen.getByText(message.text)).toBeInTheDocument();
  expect(f.sockets).toHaveLength(count);
  expect(f.latest().closed).toBe(false);
});

const DefaultDiagnosticChat = () => {
  useChat({
    connection: fetchServerSentEvents("/diagnostic-control", {
      fetchClient: async () => Response.json({ activeRun: null, messages: [] }),
    }),
    initialMessages: [
      {
        id: "diagnostic-control-message",
        parts: [{ content: "diagnostic-default-control", type: "text" }],
        role: "user",
      },
    ],
    threadId: "diagnostic-control",
  });
  return null;
};

it("disables private transcript diagnostics during hydration, send, response and unmount", async () => {
  const eventClient = Reflect.get(
    globalThis,
    Symbol.for("tanstack.ai.devtools.eventClient")
  );
  const emitted = vi.spyOn(eventClient, "emit");
  try {
    const control = render(<DefaultDiagnosticChat />);
    await waitFor(() =>
      expect(JSON.stringify(emitted.mock.calls)).toContain(
        "diagnostic-default-control"
      )
    );
    control.unmount();
    emitted.mockClear();
    const f = fixture();
    f.dependencies.fetchChat.mockImplementation(async (_input, init) => {
      if (init?.method !== "POST") {
        return chatHistory();
      }
      const { runId } = JSON.parse(String(init.body));
      return eventResponse(chatEvents(runId, "private-diagnostics-reply"));
    });
    const { mounted, user } = await openChat(f);
    await user.type(
      screen.getByLabelText("Your message"),
      "private-diagnostics-sentinel"
    );
    await user.click(screen.getByRole("button", { name: "Send message" }));
    expect(
      await screen.findByText("private-diagnostics-reply")
    ).toBeInTheDocument();
    mounted.unmount();
    await act(async () => {});
    expect(JSON.stringify(emitted.mock.calls)).not.toContain(message.text);
    expect(JSON.stringify(emitted.mock.calls)).not.toContain(
      "private-diagnostics-sentinel"
    );
    expect(JSON.stringify(emitted.mock.calls)).not.toContain(
      "private-diagnostics-reply"
    );
  } finally {
    emitted.mockRestore();
  }
});

it("renders accepted text arriving after the native run-finished event and restores it from server history", async () => {
  const f = fixture();
  const reply = "Do you have any foods you need to avoid for safety?";
  let accepted = false;
  f.dependencies.fetchChat.mockImplementation(async (_input, init) => {
    if (init?.method !== "POST") {
      return accepted
        ? Response.json({
            activeRun: null,
            messages: [
              {
                id: messageId,
                parts: [{ content: message.text, type: "text" }],
                role: "user",
              },
              {
                id: "accepted-reply",
                parts: [{ content: reply, type: "text" }],
                role: "assistant",
              },
            ],
          })
        : chatHistory();
    }
    const { runId } = JSON.parse(String(init.body));
    accepted = true;
    f.latest().receive({
      state: { ...state, version: 2 },
      turn: {
        failure: null,
        id: runId,
        sourceMessageId: messageId,
        status: "succeeded",
      },
      type: "AssistantTurnUpdated",
    });
    const [started, textStart, content, textEnd, finished] = chatEvents(
      runId,
      reply
    );
    return eventResponse([started, finished, textStart, content, textEnd]);
  });
  const { mounted, socket, user } = await openChat(f);
  await user.type(
    screen.getByLabelText("Your message"),
    "Help me explore my food preferences."
  );
  await user.click(screen.getByRole("button", { name: "Send message" }));
  expect(await screen.findByText(reply)).toBeInTheDocument();
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Stop response" })
    ).not.toBeInTheDocument()
  );
  act(() =>
    socket.receive({
      cards: [],
      hasMore: false,
      pendingConfirmation: null,
      requestId: socket.last("ReadCards").requestId,
      state: { ...state, version: 2 },
      type: "CardsRead",
    })
  );
  await waitFor(() =>
    expect(screen.getByLabelText("Your message")).toBeEnabled()
  );
  expect(
    screen.queryByRole("button", { name: "Stop response" })
  ).not.toBeInTheDocument();
  expect(
    f.dependencies.fetchChat.mock.calls.filter(
      ([, init]) => init?.method === "POST"
    )
  ).toHaveLength(1);
  mounted.unmount();
  await openChat(f);
  expect(screen.getAllByText(reply)).toHaveLength(1);
  expect(screen.getByLabelText("Your message")).toBeEnabled();
  expect(
    f.dependencies.fetchChat.mock.calls.filter(
      ([, init]) => init?.method === "POST"
    )
  ).toHaveLength(1);
});
