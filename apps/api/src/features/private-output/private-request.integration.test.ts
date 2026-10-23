import { PersonProfile } from "@meal-planner/household-api";
import {
  AssistantTurn,
  DirectoryFrame,
  PrivateRequestSessionSnapshot,
  SessionFrame,
} from "@meal-planner/private-interview-api";
import type {
  DirectoryCommand,
  SessionCommand,
} from "@meal-planner/private-interview-api";
import { Schema } from "effect";
import { Response as LocalResponse } from "miniflare";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ReleasedConfirmation } from "./private-confirmation.contract.js";
import { emptyPrivateDiscoveryContinuityUpdates } from "./private-discovery-continuity.js";
import { encodeKimiCompletion } from "./private-discovery-kimi-stream.test-fixtures.js";
import {
  makePrivateOutputHarness,
  syntheticPrivateDiscoveryConfiguration,
} from "./private-output-native.test-fixture.js";
import type { PrivateSessionBinding } from "./private-output.contract.js";

const harness = makePrivateOutputHarness();
interface RequestConnection {
  readonly binding: PrivateSessionBinding;
  readonly generation: string;
}
const participant = (binding: PrivateSessionBinding) => ({
  accountKey: binding.accountKey,
  householdKey: binding.householdKey,
  linkageSubject: binding.linkageSubject,
  personId: binding.personId,
});
const context = (connection: RequestConnection) => ({
  ...connection,
  sessionReference: connection.binding.sessionReference,
});
const profile = (binding: PrivateSessionBinding) =>
  Schema.decodeUnknownSync(PersonProfile)({
    audit: null,
    facts: [],
    personId: binding.personId,
    version: 0,
  });
const modelResponse = () =>
  new LocalResponse(
    encodeKimiCompletion({
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            content: null,
            role: "assistant",
            tool_calls: [
              {
                function: {
                  arguments: JSON.stringify({
                    intent: {
                      _tag: "Continue",
                      proposals: ["tomatoes", "mushrooms"].map((label) => ({
                        _tag: "ProposeProfileCard",
                        change: {
                          _tag: "AddFact",
                          fact: {
                            _tag: "FoodPreference",
                            label,
                            sentiment: "like",
                            targetKind: "ingredient",
                          },
                        },
                      })),
                      updates: emptyPrivateDiscoveryContinuityUpdates(),
                    },
                  }),
                  name: "submitDiscoveryTurn",
                },
                id: "request-tool-call",
                type: "function",
              },
            ],
          },
        },
      ],
      usage: { completion_tokens: 20, prompt_tokens: 100 },
    }),
    { headers: { "content-type": "text/event-stream" } }
  );

beforeAll(async () => {
  await harness.start();
  await harness.setConfiguration(syntheticPrivateDiscoveryConfiguration);
}, 60_000);
afterAll(async () => {
  await harness.stop();
});
beforeEach(() => {
  harness.clearCalls();
  harness.setModelResponse(modelResponse);
});

const openDirectory = async (binding: PrivateSessionBinding) => {
  const input = {
    participant: participant(binding),
    sessionReference: binding.sessionReference,
  };
  await harness.successful({ ...input, action: "directory-initialize" });
  const generation = await harness.successful<string>({
    ...input,
    action: "directory-begin-request",
  });
  await harness.successful({
    ...input,
    action: "directory-authorize-request",
    expiresAt: Date.now() + 60_000,
    generation,
  });
  return { binding, generation };
};
const openSession = async (binding: PrivateSessionBinding) => {
  const input = { binding, sessionReference: binding.sessionReference };
  await harness.successful({ ...input, action: "initialize" });
  const generation = await harness.successful<string>({
    ...input,
    action: "begin-request",
  });
  await harness.successful({
    ...input,
    action: "authorize-request",
    expiresAt: Date.now() + 60_000,
    generation,
  });
  return { binding, generation };
};
const directoryCommand = async (
  connection: RequestConnection,
  command: DirectoryCommand
) =>
  Schema.decodeUnknownSync(DirectoryFrame)(
    await harness.successful({
      action: "directory-execute-request",
      directoryCommand: command,
      generation: connection.generation,
      participant: participant(connection.binding),
      sessionReference: connection.binding.sessionReference,
    })
  );
const sessionCommand = async (
  connection: RequestConnection,
  command: SessionCommand
) =>
  Schema.decodeUnknownSync(SessionFrame)(
    await harness.successful({
      ...context(connection),
      action: "execute-request",
      sessionCommand: command,
    })
  );
const read = async (
  connection: RequestConnection,
  page: {
    afterCardOrdinal?: number;
    afterMessageOrdinal?: number;
    limit?: number;
  } = {}
) =>
  Schema.decodeUnknownSync(PrivateRequestSessionSnapshot)(
    await harness.successful({
      ...context(connection),
      ...page,
      action: "read-request",
    })
  );
const turnInput = (
  connection: RequestConnection,
  turnId = `run-${crypto.randomUUID()}`,
  expectedVersion = 0
) => ({
  ...context(connection),
  action: "start-request-turn",
  expectedVersion,
  profile: profile(connection.binding),
  text: "I like tomatoes and mushrooms.",
  turnId,
});
const startTurn = async (input: ReturnType<typeof turnInput>) =>
  Schema.decodeUnknownSync(AssistantTurn)(await harness.successful(input));
const turnStatus = async (connection: RequestConnection) => {
  const snapshot = await read(connection);
  return snapshot.assistantTurn?.status;
};
const expectDenied = async (input: Parameters<typeof harness.command>[0]) => {
  const response = await harness.command(input);
  expect(response.status, await response.text()).toBe(409);
};
const expectNoSockets = async (
  session: RequestConnection,
  directory?: RequestConnection
) => {
  expect(
    await harness.successful({ ...context(session), action: "socket-count" })
  ).toBe(0);
  if (directory) {
    expect(
      await harness.successful({
        action: "directory-socket-count",
        participant: participant(directory.binding),
        sessionReference: directory.binding.sessionReference,
      })
    ).toBe(0);
  }
};

describe("native private requests without WebSocket connections", () => {
  it("lists stable private reservations and replays start and completion receipts", async () => {
    const directory = await openDirectory(await harness.binding());
    const start = {
      mutationId: crypto.randomUUID(),
      scope: "ProfileEdit",
      type: "StartSession",
    } as const;
    const started = await directoryCommand(directory, start);
    expect(started.type).toBe("SessionStarted");
    if (started.type !== "SessionStarted") {
      throw new Error("Expected a private reservation");
    }
    expect(await directoryCommand(directory, start)).toEqual(started);
    expect(
      await directoryCommand(directory, { ...start, scope: "InitialDiscovery" })
    ).toMatchObject({ reason: "mutation_collision", type: "Rejected" });
    await directoryCommand(directory, {
      ...start,
      mutationId: crypto.randomUUID(),
    });
    const page = await directoryCommand(directory, {
      afterOrdinal: 0,
      limit: 1,
      requestId: crypto.randomUUID(),
      type: "ListSessions",
    });
    expect(page).toMatchObject({
      hasMore: true,
      reservations: [started.reservation],
      type: "SessionsListed",
    });
    expect(
      await directoryCommand(directory, {
        afterOrdinal: started.reservation.ordinal,
        limit: 1,
        requestId: crypto.randomUUID(),
        type: "ListSessions",
      })
    ).toMatchObject({ hasMore: false, reservations: [expect.anything()] });
    const session = await openSession({
      ...directory.binding,
      sessionReference: started.reservation.sessionReference,
    });
    expect(await read(session)).toMatchObject({
      assistantTurn: null,
      cards: [],
      messages: [],
      pendingConfirmation: null,
      state: { status: "open", version: 0 },
    });
    const complete = {
      expectedVersion: 0,
      mutationId: crypto.randomUUID(),
      type: "CompleteSession",
    } as const;
    const receipt = await sessionCommand(session, complete);
    expect(receipt).toMatchObject({
      state: { status: "completed", version: 1 },
      type: "SessionCompleted",
    });
    expect(await sessionCommand(session, complete)).toEqual(receipt);
    expect(await read(session)).toMatchObject({
      state: { status: "completed", version: 1 },
    });
    await expectNoSockets(session, directory);
  });

  it("polls one request generation during a native model turn and replays its run ID exactly once", async () => {
    const release = Promise.withResolvers<LocalResponse>();
    harness.setModelResponse(() => release.promise);
    const session = await openSession(await harness.binding());
    const input = turnInput(session);
    const first = await startTurn(input);
    await expect.poll(() => harness.calls.length).toBe(1);
    const duplicate = await startTurn(input);
    expect(duplicate).toMatchObject({
      id: first.id,
      sourceMessageId: first.sourceMessageId,
    });
    for (let poll = 0; poll < 3; poll += 1) {
      // Each poll goes through admission again, as independent HTTP requests do.
      // eslint-disable-next-line no-await-in-loop
      const generation = await harness.successful<string>({
        ...context(session),
        action: "begin-request",
      });
      expect(generation).toBe(session.generation);
      // eslint-disable-next-line no-await-in-loop
      await harness.successful({
        ...context(session),
        action: "authorize-request",
        expiresAt: Date.now() + 60_000,
      });
      // eslint-disable-next-line no-await-in-loop
      expect(await read(session)).toMatchObject({
        assistantTurn: { id: first.id, status: "running" },
        cards: [],
        messages: [{ role: "participant", text: input.text }],
        state: { version: 1 },
      });
    }
    release.resolve(modelResponse());
    await expect.poll(() => turnStatus(session)).toBe("succeeded");
    expect(await startTurn(input)).toMatchObject({
      id: first.id,
      sourceMessageId: first.sourceMessageId,
      status: "succeeded",
    });
    expect(harness.calls).toHaveLength(1);
    const firstPage = await read(session, { limit: 1 });
    expect(firstPage).toMatchObject({
      cards: [expect.anything()],
      hasMoreCards: true,
      hasMoreMessages: true,
      messages: [{ id: first.sourceMessageId, role: "participant" }],
      state: { version: 2 },
    });
    const [card] = firstPage.cards;
    const [message] = firstPage.messages;
    if (!card || !message) {
      throw new Error("Expected persisted proposal and participant message");
    }
    const secondPage = await read(session, {
      afterCardOrdinal: card.ordinal,
      afterMessageOrdinal: message.ordinal,
      limit: 1,
    });
    expect(secondPage).toMatchObject({
      cards: [expect.anything()],
      hasMoreCards: false,
      hasMoreMessages: false,
      messages: [{ role: "assistant" }],
    });
    const reject = {
      cardId: card.id,
      cardRevision: card.revision,
      expectedVersion: 2,
      mutationId: crypto.randomUUID(),
      type: "RejectProfileCard",
    } as const;
    const rejected = await sessionCommand(session, reject);
    expect(rejected).toMatchObject({
      card: { status: "rejected" },
      state: { version: 3 },
      type: "CardUpdated",
    });
    expect(await sessionCommand(session, reject)).toEqual(rejected);
    await expectNoSockets(session);
  });

  it("rejects missing authorization, a foreign profile, and a changed replay before model dispatch", async () => {
    const binding = await harness.binding();
    await harness.successful({
      action: "initialize",
      binding,
      sessionReference: binding.sessionReference,
    });
    const generation = await harness.successful<string>({
      action: "begin-request",
      binding,
      sessionReference: binding.sessionReference,
    });
    const session = { binding, generation };
    await expectDenied({ ...context(session), action: "read-request" });
    await expectDenied(turnInput(session));
    await harness.successful({
      ...context(session),
      action: "authorize-request",
      expiresAt: Date.now() + 60_000,
    });
    const input = turnInput(session);
    await expectDenied({ ...input, profile: profile(await harness.binding()) });
    expect(harness.calls).toHaveLength(0);
    expect(await read(session)).toMatchObject({
      messages: [],
      state: { version: 0 },
    });
    await startTurn(input);
    await expect.poll(() => turnStatus(session)).toBe("succeeded");
    await expectDenied({ ...input, text: "Different replay intent." });
    await expectDenied({
      ...context(session),
      action: "read-request",
      generation: crypto.randomUUID(),
    });
    expect(harness.calls).toHaveLength(1);
    const snapshot = await read(session);
    expect(snapshot.messages).toHaveLength(2);
  });

  it("releases the confirmed proposal and retains its canonical settlement receipt under a request grant", async () => {
    const session = await openSession(await harness.binding());
    await startTurn(turnInput(session));
    await expect.poll(() => turnStatus(session)).toBe("succeeded");
    const proposed = await read(session);
    const [card] = proposed.cards;
    if (!card) {
      throw new Error("Expected a generated proposal");
    }
    const confirm = {
      cardId: card.id,
      cardRevision: card.revision,
      expectedVersion: proposed.state.version,
      mutationId: crypto.randomUUID(),
      safetyConfirmation: null,
      type: "ConfirmProfileCard",
    } as const;
    const confirmation = {
      ...context(session),
      mutationId: confirm.mutationId,
    };
    await expectDenied({ ...confirmation, action: "release-confirmation" });
    expect(await sessionCommand(session, confirm)).toMatchObject({
      card: { id: card.id, status: "pending" },
      state: { version: 3 },
      type: "ConfirmationPending",
    });
    expect(await read(session)).toMatchObject({
      pendingConfirmation: confirm.mutationId,
    });
    const released = Schema.decodeUnknownSync(ReleasedConfirmation)(
      await harness.successful({
        ...confirmation,
        action: "release-confirmation",
      })
    );
    expect(released).toEqual({
      generation: session.generation,
      payload: {
        command: {
          _tag: "AddProfileFact",
          fact: {
            _tag: "FoodPreference",
            label: "tomatoes",
            sentiment: "like",
            targetKind: "ingredient",
          },
        },
        expectedProfileVersion: 0,
        mutationId: confirm.mutationId,
      },
      type: "pending",
    });
    expect(
      await harness.successful({
        ...confirmation,
        action: "release-confirmation",
      })
    ).toEqual(released);
    const settle = {
      ...confirmation,
      action: "settle-confirmation",
      outcome: { profileVersion: 1, type: "committed" },
    };
    await harness.successful(settle);
    await harness.successful(settle);
    expect(
      await harness.successful({
        ...confirmation,
        action: "release-confirmation",
      })
    ).toEqual({ type: "settled" });
    expect(await sessionCommand(session, confirm)).toMatchObject({
      card: { id: card.id, outcome: settle.outcome, status: "confirmed" },
      mutationId: confirm.mutationId,
      state: { version: 4 },
      type: "ConfirmationSettled",
    });
    await expectDenied({
      ...settle,
      outcome: { reason: "stale_version", type: "rejected" },
    });
    expect(await read(session)).toMatchObject({
      pendingConfirmation: null,
      state: { version: 4 },
    });
    expect(harness.calls).toHaveLength(1);
    await expectNoSockets(session);
  });

  it("cancels a request turn and denies its late provider output", async () => {
    const release = Promise.withResolvers<LocalResponse>();
    harness.setModelResponse(() => release.promise);
    const session = await openSession(await harness.binding());
    const input = turnInput(session);
    await startTurn(input);
    await expect.poll(() => harness.calls.length).toBe(1);
    expect(
      await harness.successful({
        ...context(session),
        action: "cancel-request-turn",
        turnId: input.turnId,
      })
    ).toMatchObject({ id: input.turnId, status: "cancelled" });
    release.resolve(modelResponse());
    harness.setModelResponse(modelResponse);
    await startTurn(turnInput(session, `run-${crypto.randomUUID()}`, 1));
    await expect.poll(() => turnStatus(session)).toBe("succeeded");
    const snapshot = await read(session);
    expect(snapshot.messages.map((message) => message.role)).toEqual([
      "participant",
      "participant",
      "assistant",
    ]);
    expect(snapshot.cards).toHaveLength(2);
    expect(await harness.turns(session.binding)).toMatchObject([
      { id: input.turnId, status: "cancelled", summary: null },
      { status: "succeeded" },
    ]);
    expect(harness.calls).toHaveLength(2);
    await expectNoSockets(session);
  });

  it.each(["account", "household"] as const)(
    "fences directory, polling, and late turn output during %s revocation",
    async (scope) => {
      const release = Promise.withResolvers<LocalResponse>();
      harness.setModelResponse(() => release.promise);
      const binding = await harness.binding();
      const directory = await openDirectory(binding);
      const session = await openSession(binding);
      const input = turnInput(session);
      await startTurn(input);
      await expect.poll(() => harness.calls.length).toBe(1);
      const mutation = {
        intentKey: "c".repeat(64),
        key: scope === "account" ? binding.accountKey : binding.householdKey,
        scope,
        sessionReference: binding.sessionReference,
      };
      const { operationId } = await harness.successful<{ operationId: string }>(
        { ...mutation, action: "mutation-begin" }
      );
      await harness.successful({
        ...mutation,
        action: "mutation-prepare",
        operationId,
      });
      await expectDenied({ ...context(session), action: "read-request" });
      await expectDenied({
        ...context(session),
        action: "authorize-request",
        expiresAt: Date.now() + 60_000,
      });
      await expectDenied({ ...context(session), action: "begin-request" });
      await expectDenied({
        action: "directory-execute-request",
        directoryCommand: {
          afterOrdinal: 0,
          limit: 25,
          requestId: crypto.randomUUID(),
          type: "ListSessions",
        },
        generation: directory.generation,
        participant: participant(binding),
        sessionReference: binding.sessionReference,
      });
      await expectDenied({
        action: "directory-begin-request",
        participant: participant(binding),
        sessionReference: binding.sessionReference,
      });
      release.resolve(modelResponse());
      await harness.successful({
        ...mutation,
        action: "mutation-dispatch",
        operationId,
      });
      await harness.successful({
        ...mutation,
        action: "mutation-complete",
        operationId,
      });
      const resumed = await openSession(binding);
      expect(resumed.generation).not.toBe(session.generation);
      expect(await read(resumed)).toMatchObject({
        assistantTurn: { failure: "connection_lost", status: "interrupted" },
        cards: [],
        messages: [{ role: "participant" }],
        state: { version: 1 },
      });
      expect(await harness.turns(binding)).toMatchObject([
        { id: input.turnId, status: "interrupted", summary: null },
      ]);
      expect(harness.calls).toHaveLength(1);
      await expectNoSockets(resumed, directory);
    }
  );

  it("fails old grants closed after restart and retains the interrupted native run without redispatch", async () => {
    const release = Promise.withResolvers<LocalResponse>();
    harness.setModelResponse(() => release.promise);
    const binding = await harness.binding();
    const directory = await openDirectory(binding);
    const session = await openSession(binding);
    const input = turnInput(session);
    await startTurn(input);
    await expect.poll(() => harness.calls.length).toBe(1);
    await harness.restart();
    release.resolve(modelResponse());
    await expectDenied({ ...context(session), action: "read-request" });
    await expectDenied({
      ...context(session),
      action: "authorize-request",
      expiresAt: Date.now() + 60_000,
    });
    await expectDenied({
      action: "directory-execute-request",
      directoryCommand: {
        afterOrdinal: 0,
        limit: 25,
        requestId: crypto.randomUUID(),
        type: "ListSessions",
      },
      generation: directory.generation,
      participant: participant(binding),
      sessionReference: binding.sessionReference,
    });
    const resumed = await openSession(binding);
    expect(resumed.generation).not.toBe(session.generation);
    expect(await read(resumed)).toMatchObject({
      assistantTurn: {
        failure: "runtime_restarted",
        id: input.turnId,
        status: "interrupted",
      },
      cards: [],
      messages: [{ role: "participant" }],
      state: { version: 1 },
    });
    expect(await startTurn({ ...input, ...context(resumed) })).toMatchObject({
      id: input.turnId,
      status: "interrupted",
    });
    expect(harness.calls).toHaveLength(1);
    await expectNoSockets(resumed, directory);
  });
});
