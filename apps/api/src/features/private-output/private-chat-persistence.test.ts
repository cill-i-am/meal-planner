import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import type * as NativeCloudflare from "@cloudflare/workers-types";
import {
  chat,
  EventType,
  maxIterations,
  RUN_CANCEL_REASON,
  resumeServerSentEventsResponse,
  toolDefinition,
  toServerSentEventsResponse,
} from "@tanstack/ai";
import type { ModelMessage, StreamChunk } from "@tanstack/ai";
import { createCloudflareText } from "@tanstack/ai-cloudflare";
import { reconstructChat, withPersistence } from "@tanstack/ai-persistence";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PrivateChatPersistence } from "./private-chat-persistence.js";
import { encodeKimiCompletion } from "./private-discovery-kimi-stream.test-fixtures.js";
import {
  privateAssistantTurns,
  privateChatEvents,
  privateMessages,
  privateProfileCards,
  privateSessionBinding,
} from "./private-output.database-schema.js";

const collect = async <T>(source: AsyncIterable<T>): Promise<T[]> => {
  const values: T[] = [];
  for await (const value of source) {
    values.push(value);
  }
  return values;
};
const data = (value: string) =>
  value
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line): unknown => JSON.parse(line.slice(6)));
const cursors = (value: string) =>
  value.split("\n").filter((line) => line.startsWith("id: "));

const threadId = "00000000-0000-4000-8000-000000000001";
const userId = "00000000-0000-4000-8000-000000000002";
const assistantId = "00000000-0000-4000-8000-000000000003";
const otherId = "00000000-0000-4000-8000-000000000004";
const runId = "run-fixture-1";
const migrations = readdirSync(
  new URL("../../../private-output-migrations/", import.meta.url)
)
  .filter((name) => /^\d+_/u.test(name))
  .toSorted()
  .map((name) =>
    readFileSync(
      new URL(
        `../../../private-output-migrations/${name}/migration.sql`,
        import.meta.url
      ),
      "utf-8"
    )
  );
const connections: DatabaseSync[] = [];
afterEach(() => {
  for (const connection of connections.splice(0)) {
    connection.close();
  }
});
const setup = (apply = migrations.length) => {
  const sqlite = new DatabaseSync(":memory:");
  connections.push(sqlite);
  for (const migration of migrations.slice(0, apply)) {
    sqlite.exec(migration);
  }
  const database = drizzle({ client: sqlite });
  database
    .insert(privateSessionBinding)
    .values({
      accountKey: "fixture-account",
      householdKey: "fixture-household",
      linkageSubject: "fixture-person",
      personId: "fixture-person",
      sessionReference: threadId,
      status: "open",
      version: 0,
    })
    .run();
  const storage = new PrivateChatPersistence(database);
  const admit = (id = runId) =>
    database
      .insert(privateAssistantTurns)
      .values({
        createdAt: 100,
        expectedSessionVersion: 1,
        generation: "fixture-generation",
        id,
        sourceMessageId: userId,
        status: "running",
      })
      .run();
  return { admit, database, sqlite, storage };
};
const participant = {
  createdAt: 100,
  id: userId,
  text: "Synthetic participant input",
};
const reply = {
  createdAt: 200,
  id: assistantId,
  text: "Synthetic accepted question",
};
const userMessage: ModelMessage = {
  content: participant.text,
  createdAt: new Date(participant.createdAt),
  id: participant.id,
  role: "user",
};
const toolMessages = (): ModelMessage[] => [
  userMessage,
  {
    content: "Synthetic unaccepted model prose",
    id: otherId,
    role: "assistant",
    thinking: [{ content: "Synthetic hidden reasoning" }],
    toolCalls: [
      {
        function: {
          arguments: '{"private":"Synthetic raw intent"}',
          name: "submitDiscoveryTurn",
        },
        id: "fixture-tool",
        type: "function",
      },
    ],
  },
  {
    content: JSON.stringify({
      createdAt: reply.createdAt,
      messageId: reply.id,
      text: reply.text,
      type: "PrivateDiscoveryReply",
    }),
    role: "tool",
    toolCallId: "fixture-tool",
  },
];
const start: StreamChunk = { runId, threadId, type: EventType.RUN_STARTED };
const terminal: StreamChunk = {
  outcome: { type: "success" },
  runId,
  threadId,
  type: EventType.RUN_FINISHED,
};

describe("private chat canonical SQLite persistence", () => {
  it("upgrades existing text history in place with stable identity and ordinal", () => {
    const { sqlite, storage } = setup(migrations.length - 1);
    sqlite
      .prepare(
        "INSERT INTO private_messages (id, ordinal, created_at, role, text) VALUES (?, 7, 100, 'participant', ?)"
      )
      .run(userId, participant.text);
    const migration = migrations.at(-1);
    expect(migration).toBeDefined();
    sqlite.exec(migration ?? "");
    expect(storage.history()).toEqual([
      { ...participant, ordinal: 7, role: "participant" },
    ]);
    expect(storage.appendAssistant(reply).ordinal).toBe(8);
    const columns = sqlite
      .prepare("PRAGMA table_info(private_messages)")
      .all()
      .map((row) => row["name"]);
    expect(columns).toEqual(["created_at", "id", "message_json", "ordinal"]);
  });

  it("keeps only the accepted canonical reply live in storage and hydration", async () => {
    const { database, storage } = setup();
    storage.appendParticipant(participant);
    storage.appendAssistant(reply);
    const persistence = storage.forThread(threadId);
    await persistence.stores.messages.saveThread(threadId, toolMessages());
    expect(await persistence.stores.messages.loadThread(threadId)).toEqual([
      userMessage,
      {
        content: reply.text,
        createdAt: new Date(reply.createdAt),
        id: reply.id,
        role: "assistant",
      },
    ]);
    const hydrated = await reconstructChat(
      persistence,
      new Request(`https://fixture.invalid/chat?threadId=${threadId}`),
      { authorize: () => true }
    );
    const historyJson = JSON.stringify(
      database.select().from(privateMessages).all()
    );
    const hydrationJson = await hydrated.text();
    for (const value of [historyJson, hydrationJson]) {
      expect(value).toContain(reply.text);
      expect(value).not.toContain("hidden reasoning");
      expect(value).not.toContain("raw intent");
      expect(value).not.toContain("unaccepted model prose");
    }
  });

  it("rejects an uncommitted tool reply without changing participant history", async () => {
    const { storage } = setup();
    storage.appendParticipant(participant);
    await expect(
      storage
        .forThread(threadId)
        .stores.messages.saveThread(threadId, toolMessages())
    ).rejects.toMatchObject({ reason: "run_not_accepted" });
    expect(storage.history()).toEqual([
      { ...participant, ordinal: 1, role: "participant" },
    ]);
  });

  it("rejects stale omission without removing later committed messages", async () => {
    const { storage } = setup();
    storage.appendParticipant(participant);
    storage.appendAssistant(reply);
    const { messages } = storage.forThread(threadId).stores;
    const oldSnapshot = await messages.loadThread(threadId);
    storage.appendParticipant({
      ...participant,
      createdAt: 300,
      id: otherId,
      text: "Synthetic next input",
    });
    storage.appendAssistant({
      ...reply,
      createdAt: 400,
      id: "00000000-0000-4000-8000-000000000005",
      text: "Synthetic next accepted reply",
    });
    const committed = storage.history();
    await expect(
      messages.saveThread(threadId, oldSnapshot)
    ).rejects.toMatchObject({ reason: "stale_snapshot" });
    expect(storage.history()).toEqual(committed);
  });

  it("rejects changed participant content and reordered snapshots", async () => {
    const { storage } = setup();
    storage.appendParticipant(participant);
    storage.appendAssistant(reply);
    const { messages } = storage.forThread(threadId).stores;
    const snapshot = await messages.loadThread(threadId);
    const committed = storage.history();
    const changed = snapshot.map((message) =>
      message.role === "user"
        ? { ...message, content: "Synthetic overwritten input" }
        : message
    );
    await expect(messages.saveThread(threadId, changed)).rejects.toMatchObject({
      reason: "invalid_message",
    });
    await expect(
      messages.saveThread(threadId, snapshot.toReversed())
    ).rejects.toMatchObject({ reason: "stale_snapshot" });
    expect(storage.history()).toEqual(committed);
  });

  it("supports native SDK start and finish snapshots with database-enforced append-only history", async () => {
    const { admit, database, sqlite, storage } = setup();
    storage.appendParticipant(participant);
    admit();
    sqlite.exec(
      "CREATE TRIGGER forbid_chat_delete BEFORE DELETE ON private_messages BEGIN SELECT RAISE(FAIL, 'History is append-only'); END"
    );
    sqlite.exec(
      "CREATE TRIGGER forbid_chat_update BEFORE UPDATE ON private_messages BEGIN SELECT RAISE(FAIL, 'History is append-only'); END"
    );
    const body = encodeKimiCompletion({
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            content: null,
            role: "assistant",
            tool_calls: [
              {
                function: { arguments: "{}", name: "submitDiscoveryTurn" },
                id: "fixture-tool",
                type: "function",
              },
            ],
          },
        },
      ],
    });
    const run = () =>
      Promise.resolve(
        new Response(body, { headers: { "content-type": "text/event-stream" } })
      );
    const persistence = storage.forThread(threadId);
    const saves = vi.spyOn(persistence.stores.messages, "saveThread");
    const accepted = {
      createdAt: reply.createdAt,
      messageId: reply.id,
      text: reply.text,
      type: "PrivateDiscoveryReply",
    };
    const submit = toolDefinition({
      description: "Synthetic accepted reply fixture",
      inputSchema: {
        additionalProperties: false,
        properties: {},
        type: "object",
      },
      name: "submitDiscoveryTurn",
    }).server(() =>
      database.transaction(() => {
        storage.appendAssistant(reply);
        database
          .update(privateAssistantTurns)
          .set({ completedAt: 200, status: "succeeded" })
          .where(eq(privateAssistantTurns.id, runId))
          .run();
        return accepted;
      })
    );
    const streamed = chat({
      adapter: createCloudflareText("@cf/moonshotai/kimi-k2.6", {
        binding: {
          // SAFETY: The inert binding implements only the native raw-response overload used by this maintained adapter.
          run: run as unknown as NativeCloudflare.Ai["run"],
        },
        maxRetries: 0,
      }),
      agentLoopStrategy: maxIterations(1),
      debug: false,
      devtools: false,
      messages: await persistence.stores.messages.loadThread(threadId),
      middleware: [withPersistence(persistence)],
      runId,
      threadId,
      tools: [submit],
    });
    await expect(collect(streamed)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: EventType.RUN_FINISHED }),
      ])
    );
    expect(storage.history()).toEqual([
      { ...participant, ordinal: 1, role: "participant" },
      { ...reply, ordinal: 2, role: "assistant" },
    ]);
    expect(await persistence.stores.runs.get(runId)).toMatchObject({
      status: "completed",
    });
    expect(saves).toHaveBeenCalledTimes(2);
    expect(saves.mock.calls[0]?.[1]).toEqual([userMessage]);
    saves.mockRestore();
  });

  it("rejects malformed snapshots without changing accepted history", async () => {
    const { storage } = setup();
    storage.appendParticipant(participant);
    storage.appendAssistant(reply);
    const before = storage.history();
    const malformed = toolMessages();
    const tool = malformed.at(-1);
    if (tool) {
      tool.content = '{"type":"PrivateDiscoveryReply"}';
    }
    await expect(
      storage
        .forThread(threadId)
        .stores.messages.saveThread(threadId, malformed)
    ).rejects.toBeDefined();
    expect(storage.history()).toEqual(before);
  });

  it("does not allow direct model prose to become an accepted assistant message", async () => {
    const { storage } = setup();
    storage.appendParticipant(participant);
    await expect(
      storage.forThread(threadId).stores.messages.saveThread(threadId, [
        userMessage,
        {
          content: reply.text,
          createdAt: new Date(200),
          id: assistantId,
          role: "assistant",
        },
      ])
    ).rejects.toMatchObject({ reason: "run_not_accepted" });
    expect(storage.history()).toHaveLength(1);
  });

  it("joins domain changes and canonical transcript in the same transaction", () => {
    const { database, storage } = setup();
    storage.appendParticipant(participant);
    expect(() =>
      database.transaction(() => {
        storage.appendAssistant(reply);
        database
          .insert(privateProfileCards)
          .values({ cardJson: "synthetic-card", id: otherId })
          .run();
        throw new Error("synthetic rejected domain transition");
      })
    ).toThrow("synthetic rejected domain transition");
    expect(storage.history()).toHaveLength(1);
    expect(database.select().from(privateProfileCards).all()).toEqual([]);
  });

  it("makes repeated identical admission stable and rejects identity collision", () => {
    const { storage } = setup();
    expect(storage.appendParticipant(participant)).toEqual(
      storage.appendParticipant(participant)
    );
    expect(() =>
      storage.appendParticipant({
        ...participant,
        text: "Different synthetic input",
      })
    ).toThrow();
    expect(storage.history()).toHaveLength(1);
    expect(storage.participant(assistantId)).toBeUndefined();
  });

  it("refuses another private thread before reading its history", async () => {
    const { storage } = setup();
    const persistence = storage.forThread(threadId);
    await expect(
      persistence.stores.messages.loadThread(otherId)
    ).rejects.toMatchObject({ reason: "binding_conflict" });
    await expect(
      persistence.stores.messages.saveThread(otherId, [])
    ).rejects.toMatchObject({ reason: "binding_conflict" });
  });

  it("maps the preadmitted native run without creating or prematurely settling one", async () => {
    const { admit, database, storage } = setup();
    const { runs } = storage.forThread(threadId).stores;
    await expect(
      runs.createOrResume({ runId, startedAt: 0, threadId })
    ).rejects.toMatchObject({ reason: "run_not_admitted" });
    admit();
    const first = await runs.createOrResume({ runId, startedAt: 0, threadId });
    expect(
      await runs.createOrResume({ runId, startedAt: 999, threadId })
    ).toEqual(first);
    await expect(
      runs.update(runId, { status: "completed" })
    ).rejects.toMatchObject({ reason: "run_not_accepted" });
    await runs.update(runId, {
      error: { message: "Synthetic raw provider error" },
      status: "failed",
    });
    const running = await runs.get(runId);
    expect(running?.status).toBe("running");
    await runs.update(runId, { cancelRequested: true });
    const cancellation = await runs.get(runId);
    expect(cancellation?.cancelRequested).toBe(true);
    database
      .update(privateAssistantTurns)
      .set({
        completedAt: 200,
        status: "succeeded",
        usageJson:
          '{"estimatedCostUsd":null,"inputTokens":null,"outputTokens":null}',
      })
      .where(eq(privateAssistantTurns.id, runId))
      .run();
    await runs.update(runId, {
      finishedAt: 500,
      status: "completed",
      usage: { completionTokens: 100, promptTokens: 100, totalTokens: 200 },
    });
    expect(await runs.get(runId)).toMatchObject({
      finishedAt: 200,
      status: "completed",
    });
    const completed = await runs.get(runId);
    expect(completed?.usage).toBeUndefined();
    expect(database.select().from(privateAssistantTurns).all()).toHaveLength(1);
  });
});

describe("private chat SQLite native replay", () => {
  it("persists native events before replay and binds every cursor to its run", async () => {
    const { admit, storage } = setup();
    admit();
    admit("run-fixture-2");
    const stream = storage.stream({ offset: null, runId, threadId });
    const offsets = await stream.append([start, terminal]);
    await stream.close();
    expect(await collect(stream.read(offsets[0] ?? ""))).toEqual([
      { chunk: terminal, offset: offsets[1] },
    ]);
    const other = storage.stream({
      offset: null,
      runId: "run-fixture-2",
      threadId,
    });
    await expect(collect(other.read(offsets[0] ?? ""))).rejects.toMatchObject({
      reason: "invalid_cursor",
    });
    await expect(
      collect(stream.read(`private-chat:v1:${threadId}:${runId}:999`))
    ).rejects.toMatchObject({ reason: "invalid_cursor" });
  });

  it("rejects raw reasoning and rolls back the complete append batch", async () => {
    const { admit, database, storage } = setup();
    admit();
    const stream = storage.stream({ offset: null, runId, threadId });
    await expect(
      stream.append([
        start,
        {
          delta: "Synthetic reasoning",
          messageId: assistantId,
          type: EventType.REASONING_MESSAGE_CONTENT,
        },
      ])
    ).rejects.toMatchObject({ reason: "invalid_event" });
    expect(database.select().from(privateChatEvents).all()).toEqual([]);
    await expect(
      stream.append([
        { ...start, metadata: { private: "Synthetic reasoning" } },
      ])
    ).rejects.toMatchObject({ reason: "invalid_event" });
  });

  it("rejects an oversized replay batch without storing a prefix", async () => {
    const { admit, storage } = setup();
    admit();
    const stream = storage.stream({ offset: null, runId, threadId });
    const chunks: StreamChunk[] = Array.from({ length: 70 }, () => ({
      delta: "x".repeat(4000),
      messageId: assistantId,
      type: EventType.TEXT_MESSAGE_CONTENT,
    }));
    await expect(stream.append(chunks)).rejects.toMatchObject({
      reason: "replay_limit",
    });
    expect(await stream.snapshot()).toEqual([]);
  });

  it("wakes a live reader for new events and closes waiting readers", async () => {
    const { admit, storage } = setup();
    admit();
    const stream = storage.stream({ offset: null, runId, threadId });
    const reader = stream.read("-1")[Symbol.asyncIterator]();
    const pending = reader.next();
    await stream.append([start]);
    const next = await pending;
    expect(next.value?.chunk).toEqual(start);
    const ending = reader.next();
    await stream.close();
    expect(await ending).toEqual({ done: true, value: undefined });
    await stream.close();
    await expect(stream.append([terminal])).rejects.toMatchObject({
      reason: "stream_closed",
    });
  });

  it("cancels a parked replay read without cancelling its producer", async () => {
    const { admit, storage } = setup();
    admit();
    const stream = storage.stream({ offset: null, runId, threadId });
    const controller = new AbortController();
    const read = collect(stream.read("-1", controller.signal));
    controller.abort();
    expect(await read).toEqual([]);
    await expect(stream.append([start])).resolves.toHaveLength(1);
  });

  it("restores saved events through a fresh adapter without another producer", async () => {
    const { admit, database, storage } = setup();
    admit();
    let invocations = 0;
    const generate = async function* generate(): AsyncGenerator<StreamChunk> {
      invocations += 1;
      yield start;
      yield terminal;
    };
    const response = toServerSentEventsResponse(generate(), {
      durability: {
        adapter: storage.stream({ offset: null, runId, threadId }),
        batch: 1,
      },
    });
    const original = await response.text();
    expect(original).toContain("RUN_FINISHED");
    const restored = new PrivateChatPersistence(database);
    const replay = resumeServerSentEventsResponse({
      adapter: restored.stream({ offset: "-1", runId, threadId }),
    });
    const replayed = await replay.text();
    expect(data(replayed)).toEqual(data(original));
    expect(cursors(replayed)).toEqual(cursors(original));
    expect(invocations).toBe(1);
  });

  it("returns a bounded current snapshot of an open log without waiting", async () => {
    const { admit, storage } = setup();
    admit();
    const stream = storage.stream({ offset: null, runId, threadId });
    expect(await stream.snapshot()).toEqual([]);
    await stream.append([start]);
    const snapshot = await stream.snapshot();
    snapshot.splice(0);
    expect(await stream.snapshot()).toHaveLength(1);
  });

  it("does not miss events appended while a slow consumer holds a yielded event", async () => {
    const { admit, storage } = setup();
    admit();
    const stream = storage.stream({ offset: null, runId, threadId });
    await stream.append([start]);
    const reader = stream.read("-1")[Symbol.asyncIterator]();
    const first = await reader.next();
    expect(first.value?.chunk).toEqual(start);
    await stream.append([terminal]);
    await stream.close();
    const last = await reader.next();
    expect(last.value?.chunk).toEqual(terminal);
    const closed = await reader.next();
    expect(closed.done).toBe(true);
  });

  it("retains the library's failure terminal and closes the failed replay log", async () => {
    const { admit, storage } = setup();
    admit();
    const stream = storage.stream({ offset: null, runId, threadId });
    const failure = async function* failure(): AsyncGenerator<StreamChunk> {
      yield start;
      throw new Error("Synthetic safe failure");
    };
    const response = toServerSentEventsResponse(failure(), {
      durability: { adapter: stream, batch: 1 },
    });
    expect(await response.text()).toContain("RUN_ERROR");
    const snapshot = await stream.snapshot();
    expect(snapshot.at(-1)?.chunk).toMatchObject({
      message: "Synthetic safe failure",
      type: EventType.RUN_ERROR,
    });
    const failedReplay = await collect(stream.read("-1"));
    expect(failedReplay.at(-1)?.chunk.type).toBe(EventType.RUN_ERROR);
  });

  it("seals interrupted logs on restart without modifying successful or active attempts", async () => {
    const { admit, database, storage } = setup();
    admit();
    admit("run-active");
    admit("run-succeeded");
    const interrupted = storage.stream({ offset: null, runId, threadId });
    const active = storage.stream({
      offset: null,
      runId: "run-active",
      threadId,
    });
    await interrupted.append([start]);
    await active.append([{ ...start, runId: "run-active" }]);
    const succeeded = storage.stream({
      offset: null,
      runId: "run-succeeded",
      threadId,
    });
    await succeeded.append([
      { ...terminal, runId: "run-succeeded" },
      {
        delta: reply.text,
        messageId: assistantId,
        type: EventType.TEXT_MESSAGE_CONTENT,
      },
      { messageId: assistantId, type: EventType.TEXT_MESSAGE_END },
    ]);
    database
      .update(privateAssistantTurns)
      .set({ completedAt: 200, status: "succeeded" })
      .where(eq(privateAssistantTurns.id, "run-succeeded"))
      .run();
    database
      .update(privateAssistantTurns)
      .set({
        completedAt: 200,
        failure: "runtime_restarted",
        status: "interrupted",
      })
      .where(eq(privateAssistantTurns.id, runId))
      .run();
    const restored = new PrivateChatPersistence(database);
    restored.closeInterruptedStreams();
    restored.closeInterruptedStreams();
    const replay = restored.stream({ offset: "-1", runId, threadId });
    const events = await collect(replay.read("-1"));
    expect(events.map((event) => event.chunk.type)).toEqual([
      EventType.RUN_STARTED,
      EventType.RUN_ERROR,
    ]);
    expect(events.at(-1)?.chunk).toMatchObject({ code: "interrupted" });
    await expect(
      active.append([{ ...terminal, runId: "run-active" }])
    ).resolves.toHaveLength(1);
    const successEvents = await collect(succeeded.read("-1"));
    expect(successEvents).toHaveLength(3);
    expect(
      successEvents.some((event) => event.chunk.type === EventType.RUN_ERROR)
    ).toBe(false);
    expect(database.select().from(privateAssistantTurns).all()).toHaveLength(3);
  });

  it("seals an explicit native producer cancellation with a replayable abort terminal", async () => {
    const { admit, storage } = setup();
    admit();
    const stream = storage.stream({ offset: null, runId, threadId });
    const controller = new AbortController();
    const waiting = Promise.withResolvers<null>();
    const cancelled = Promise.withResolvers<null>();
    controller.signal.addEventListener("abort", () => cancelled.resolve(null), {
      once: true,
    });
    const source = async function* source(): AsyncGenerator<StreamChunk> {
      yield start;
      waiting.resolve(null);
      await cancelled.promise;
    };
    const response = toServerSentEventsResponse(source(), {
      abortController: controller,
      durability: { adapter: stream, batch: 1 },
    });
    await waiting.promise;
    controller.abort(RUN_CANCEL_REASON);
    await response.text();
    const events = await collect(stream.read("-1"));
    expect(events.at(-1)?.chunk).toMatchObject({
      code: "aborted",
      type: EventType.RUN_ERROR,
    });
  });
});
