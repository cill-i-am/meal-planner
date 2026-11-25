/* eslint-disable require-await -- TanStack requires Promise store methods; async also converts synchronous SQLite failures to rejected promises. */
/* eslint-disable anti-slop/no-unknown-parameters -- These concrete persistence parsers decode unknown input and discard private parser diagnostics. */
import type { Message } from "@meal-planner/private-interview-api";
import { AssistantTurnId } from "@meal-planner/private-interview-api";
import { EventType } from "@tanstack/ai";
import type {
  ModelMessage,
  RunRecord,
  RunStore,
  StreamChunk,
  StreamDurability,
} from "@tanstack/ai";
import { defineAIPersistence } from "@tanstack/ai-persistence";
import { and, asc, desc, eq, gt, inArray } from "drizzle-orm";
import type { SQLiteAsyncDatabase } from "drizzle-orm/sqlite-core";
import { Option, Schema } from "effect";

import { PrivateChatReply } from "./private-chat-reply.js";
import { PrivateChatStorageFailure } from "./private-chat-storage-failure.js";
import {
  privateAssistantTurns,
  privateChatEvents,
  privateChatStreams,
  privateMessages,
  privateSessionBinding,
} from "./private-output.database-schema.js";

const Id = Schema.String.pipe(Schema.check(Schema.isUUID()));
const Count = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)));
const Text = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1), Schema.isMaxLength(4000))
);
const CanonicalMessage = Schema.Struct({
  content: Text,
  createdAt: Count,
  id: Id,
  role: Schema.Literals(["user", "assistant"]),
});
type CanonicalMessage = typeof CanonicalMessage.Type;
type HistoryMessage = typeof Message.Type;
const MessageInput = Schema.Struct({ createdAt: Count, id: Id, text: Text });
type MessageInput = typeof MessageInput.Type;
const Timestamp = { timestamp: Schema.optionalKey(Count) };

const PrivateChatEvent = Schema.Union([
  Schema.Struct({
    ...Timestamp,
    runId: AssistantTurnId,
    threadId: Id,
    type: Schema.Literal(EventType.RUN_STARTED),
  }),
  Schema.Struct({
    ...Timestamp,
    messageId: Id,
    role: Schema.Literal("assistant"),
    type: Schema.Literal(EventType.TEXT_MESSAGE_START),
  }),
  Schema.Struct({
    ...Timestamp,
    delta: Text,
    messageId: Id,
    type: Schema.Literal(EventType.TEXT_MESSAGE_CONTENT),
  }),
  Schema.Struct({
    ...Timestamp,
    messageId: Id,
    type: Schema.Literal(EventType.TEXT_MESSAGE_END),
  }),
  Schema.Struct({
    ...Timestamp,
    outcome: Schema.Struct({ type: Schema.Literal("success") }),
    runId: AssistantTurnId,
    threadId: Id,
    type: Schema.Literal(EventType.RUN_FINISHED),
  }),
  Schema.Struct({
    ...Timestamp,
    code: Schema.optionalKey(Schema.String),
    error: Schema.optionalKey(
      Schema.Struct({
        code: Schema.optional(Schema.String),
        message: Schema.String,
      })
    ),
    message: Schema.String,
    type: Schema.Literal(EventType.RUN_ERROR),
  }),
  Schema.Struct({
    ...Timestamp,
    name: Schema.Literal("run.accepted"),
    type: Schema.Literal(EventType.CUSTOM),
    value: Schema.Struct({}),
  }),
]);
type PrivateChatEvent = typeof PrivateChatEvent.Type;
const MAX_EVENT_BYTES = 32_768;
export const MAX_PRIVATE_CHAT_REPLAY_BYTES = 262_144;
const TERMINAL_EVENT_RESERVE_BYTES = 1024;
const READ_BATCH_SIZE = 64;

const parseMessage = (input: unknown) => {
  const checkedResult: CanonicalMessage = Option.getOrThrowWith(
    Schema.decodeUnknownOption(CanonicalMessage, { onExcessProperty: "error" })(
      input
    ),
    () => new PrivateChatStorageFailure({ reason: "invalid_message" })
  );
  return checkedResult;
};
const parseMessageJson = (input: unknown) => {
  const checkedResult: CanonicalMessage = Option.getOrThrowWith(
    Schema.decodeUnknownOption(Schema.fromJsonString(CanonicalMessage), {
      onExcessProperty: "error",
    })(input),
    () => new PrivateChatStorageFailure({ reason: "invalid_message" })
  );
  return checkedResult;
};
const parseReplyJson = (input: unknown) => {
  const checkedResult: PrivateChatReply = Option.getOrThrowWith(
    Schema.decodeUnknownOption(Schema.fromJsonString(PrivateChatReply), {
      onExcessProperty: "error",
    })(input),
    () => new PrivateChatStorageFailure({ reason: "invalid_message" })
  );
  return checkedResult;
};
const parseEvent = Schema.decodeUnknownSync(PrivateChatEvent, {
  onExcessProperty: "error",
});
const parseEventJson = (input: unknown) => {
  const checkedResult: PrivateChatEvent = Option.getOrThrowWith(
    Schema.decodeUnknownOption(Schema.fromJsonString(PrivateChatEvent), {
      onExcessProperty: "error",
    })(input),
    () => new PrivateChatStorageFailure({ reason: "invalid_event" })
  );
  return checkedResult;
};
const toNativeEvent = (event: PrivateChatEvent) => {
  if (event.type !== EventType.RUN_ERROR) {
    const checkedResult: StreamChunk = event;
    return checkedResult;
  }
  const { error, ...fields } = event;
  const result: Extract<StreamChunk, { type: "RUN_ERROR" }> = fields;
  if (error) {
    result.error = { message: error.message };
    if (error.code !== undefined) {
      result.error.code = error.code;
    }
  }
  {
    const checkedResult: StreamChunk = result;
    return checkedResult;
  }
};
const toModelMessage = (message: CanonicalMessage) => {
  const checkedResult: ModelMessage = {
    content: message.content,
    createdAt: new Date(message.createdAt),
    id: message.id,
    role: message.role,
  };
  return checkedResult;
};
const toHistory = (row: typeof privateMessages.$inferSelect) => {
  const message = parseMessageJson(row.messageJson);
  if (message.id !== row.id || message.createdAt !== row.createdAt) {
    throw new PrivateChatStorageFailure({ reason: "invalid_message" });
  }
  {
    const checkedResult: HistoryMessage = {
      createdAt: message.createdAt,
      id: message.id,
      ordinal: row.ordinal,
      role: message.role === "user" ? "participant" : "assistant",
      text: message.content,
    };
    return checkedResult;
  }
};

const parseDirectMessage = (
  message: ModelMessage,
  retained: ReadonlyMap<string, typeof privateMessages.$inferSelect>
) => {
  const checkedResult: CanonicalMessage = parseMessage({
    content: message.content,
    createdAt:
      message.createdAt?.getTime() ??
      (message.id ? retained.get(message.id)?.createdAt : undefined),
    id: message.id,
    role: message.role,
  });
  return checkedResult;
};

const projectMessages = (
  messages: readonly ModelMessage[],
  retained: ReadonlyMap<string, typeof privateMessages.$inferSelect>
) => {
  const result: CanonicalMessage[] = [];
  const toolCalls = new Set<string>();
  const ids = new Set<string>();
  for (const message of messages) {
    if (message.role === "assistant" && message.toolCalls?.length) {
      for (const call of message.toolCalls) {
        if (call.function.name !== "submitDiscoveryTurn") {
          throw new PrivateChatStorageFailure({ reason: "invalid_message" });
        }
        toolCalls.add(call.id);
      }
      continue;
    }
    let canonical: CanonicalMessage;
    if (message.role === "tool") {
      if (!message.toolCallId || !toolCalls.delete(message.toolCallId)) {
        throw new PrivateChatStorageFailure({ reason: "invalid_message" });
      }
      const reply = parseReplyJson(message.content);
      canonical = {
        content: reply.text,
        createdAt: reply.createdAt,
        id: reply.messageId,
        role: "assistant",
      };

      const accepted = retained.get(reply.messageId);
      if (!accepted || accepted.messageJson !== JSON.stringify(canonical)) {
        throw new PrivateChatStorageFailure({ reason: "run_not_accepted" });
      }
    } else {
      canonical = parseDirectMessage(message, retained);
      if (canonical.role === "assistant") {
        const accepted = retained.get(canonical.id);
        if (!accepted || accepted.messageJson !== JSON.stringify(canonical)) {
          throw new PrivateChatStorageFailure({ reason: "run_not_accepted" });
        }
      }
    }
    if (ids.has(canonical.id)) {
      throw new PrivateChatStorageFailure({ reason: "invalid_message" });
    }
    ids.add(canonical.id);
    result.push(canonical);
  }
  if (toolCalls.size !== 0) {
    throw new PrivateChatStorageFailure({ reason: "invalid_message" });
  }
  {
    const checkedResult: readonly CanonicalMessage[] = result;
    return checkedResult;
  }
};

const runStatus = (
  status: typeof privateAssistantTurns.$inferSelect.status
) => {
  switch (status) {
    case "queued":
    case "running": {
      const checkedResult: RunRecord["status"] = "running";
      return checkedResult;
    }
    case "succeeded": {
      const checkedResult: RunRecord["status"] = "completed";
      return checkedResult;
    }
    case "failed": {
      const checkedResult: RunRecord["status"] = "failed";
      return checkedResult;
    }
    case "cancelled":
    case "interrupted": {
      const checkedResult: RunRecord["status"] = "aborted";
      return checkedResult;
    }
    default: {
      const checkedResult: RunRecord["status"] = status satisfies never;
      return checkedResult;
    }
  }
};

/** SQLite stores for one private Agent. Authorization remains at its request boundary. */
export class PrivateChatPersistence<TRunResult = unknown> {
  readonly #database: SQLiteAsyncDatabase<"sync", TRunResult>;
  readonly #waiters = new Map<string, Set<() => void>>();

  constructor(database: SQLiteAsyncDatabase<"sync", TRunResult>) {
    this.#database = database;
  }

  #bind(threadId: string) {
    if (
      this.#database.select().from(privateSessionBinding).get()
        ?.sessionReference !== threadId
    ) {
      throw new PrivateChatStorageFailure({ reason: "binding_conflict" });
    }
  }

  history() {
    const checkedResult: readonly HistoryMessage[] = this.#database
      .select()
      .from(privateMessages)
      .orderBy(asc(privateMessages.ordinal))
      .all()
      .map(toHistory);
    return checkedResult;
  }

  historyPage(afterOrdinal: number, limit: number) {
    const rows = this.#database
      .select()
      .from(privateMessages)
      .where(gt(privateMessages.ordinal, afterOrdinal))
      .orderBy(asc(privateMessages.ordinal))
      .limit(limit + 1)
      .all();
    return {
      hasMore: rows.length > limit,
      messages: rows.slice(0, limit).map(toHistory),
    };
  }

  participant(id: string) {
    const row = this.#database
      .select()
      .from(privateMessages)
      .where(eq(privateMessages.id, id))
      .get();
    if (!row) {
      const checkedResult: HistoryMessage | undefined = undefined;
      return checkedResult;
    }
    const message = toHistory(row);
    {
      const checkedResult: HistoryMessage | undefined =
        message.role === "participant" ? message : undefined;
      return checkedResult;
    }
  }

  #append(input: MessageInput, role: CanonicalMessage["role"]) {
    const parsed = Option.getOrThrowWith(
      Schema.decodeUnknownOption(MessageInput, { onExcessProperty: "error" })(
        input
      ),
      () => new PrivateChatStorageFailure({ reason: "invalid_message" })
    );
    const message: CanonicalMessage = {
      content: parsed.text,
      createdAt: parsed.createdAt,
      id: parsed.id,
      role,
    };
    const existing = this.#database
      .select()
      .from(privateMessages)
      .where(eq(privateMessages.id, parsed.id))
      .get();
    if (existing) {
      if (existing.messageJson !== JSON.stringify(message)) {
        throw new PrivateChatStorageFailure({ reason: "invalid_message" });
      }
      {
        const checkedResult: HistoryMessage = toHistory(existing);
        return checkedResult;
      }
    }
    const row = this.#database
      .insert(privateMessages)
      .values({
        createdAt: parsed.createdAt,
        id: parsed.id,
        messageJson: JSON.stringify(message),
      })
      .returning()
      .get();
    {
      const checkedResult: HistoryMessage = toHistory(row);
      return checkedResult;
    }
  }

  appendParticipant(input: MessageInput) {
    const checkedResult: HistoryMessage = this.#append(input, "user");
    return checkedResult;
  }

  appendAssistant(input: MessageInput) {
    const checkedResult: HistoryMessage = this.#append(input, "assistant");
    return checkedResult;
  }

  #run(threadId: string, runId: string) {
    this.#bind(threadId);
    const row = this.#database
      .select()
      .from(privateAssistantTurns)
      .where(eq(privateAssistantTurns.id, runId))
      .get();
    if (!row) {
      const checkedResult: RunRecord | null = null;
      return checkedResult;
    }
    const result: RunRecord = {
      cancelRequested: row.cancelRequested,
      runId: row.id,
      startedAt: row.createdAt,
      status: runStatus(row.status),
      threadId,
    };
    if (row.completedAt !== null) {
      result.finishedAt = row.completedAt;
    }
    if (row.failure !== null) {
      result.error = { code: row.failure, message: row.failure };
    }
    {
      const checkedResult: RunRecord | null = result;
      return checkedResult;
    }
  }

  forThread(threadId: string) {
    this.#bind(threadId);
    const runs: RunStore = {
      createOrResume: async (input) => {
        if (input.threadId !== threadId) {
          throw new PrivateChatStorageFailure({ reason: "binding_conflict" });
        }
        const run = this.#run(threadId, input.runId);
        if (!run) {
          throw new PrivateChatStorageFailure({ reason: "run_not_admitted" });
        }
        return run;
      },
      findActiveRun: async (requestedThreadId) => {
        this.#bind(requestedThreadId);
        const row = this.#database
          .select()
          .from(privateAssistantTurns)
          .where(inArray(privateAssistantTurns.status, ["queued", "running"]))
          .orderBy(desc(privateAssistantTurns.ordinal))
          .get();
        return row ? this.#run(threadId, row.id) : null;
      },
      get: async (runId) => this.#run(threadId, runId),
      update: async (runId, patch) => {
        const current = this.#run(threadId, runId);
        if (!current) {
          return;
        }
        if (patch.status === "completed" && current.status !== "completed") {
          throw new PrivateChatStorageFailure({ reason: "run_not_accepted" });
        }

        if (patch.cancelRequested !== undefined) {
          this.#database
            .update(privateAssistantTurns)
            .set({ cancelRequested: patch.cancelRequested })
            .where(eq(privateAssistantTurns.id, runId))
            .run();
        }
      },
    };
    return defineAIPersistence({
      stores: {
        messages: {
          loadThread: async (requestedThreadId: string) => {
            this.#bind(requestedThreadId);
            return this.#database
              .select()
              .from(privateMessages)
              .orderBy(asc(privateMessages.ordinal))
              .all()
              .map((row) => toModelMessage(parseMessageJson(row.messageJson)));
          },
          saveThread: async (
            requestedThreadId: string,
            messages: ModelMessage[]
          ) => {
            this.#bind(requestedThreadId);
            this.#database.transaction(() => {
              const rows = this.#database
                .select()
                .from(privateMessages)
                .orderBy(asc(privateMessages.ordinal))
                .all();
              const retained = new Map(rows.map((row) => [row.id, row]));
              const canonical = projectMessages(messages, retained);
              if (canonical.length !== rows.length) {
                throw new PrivateChatStorageFailure({
                  reason: "stale_snapshot",
                });
              }
              for (const [index, message] of canonical.entries()) {
                const row = rows[index];
                if (row?.id !== message.id) {
                  throw new PrivateChatStorageFailure({
                    reason: "stale_snapshot",
                  });
                }
                if (row.messageJson !== JSON.stringify(message)) {
                  throw new PrivateChatStorageFailure({
                    reason: "invalid_message",
                  });
                }
              }
            });
          },
        },
        runs,
      },
    });
  }

  /** Recovery closes existing delivery logs; it never starts another inference. */
  closeInterruptedStreams() {
    const interrupted = this.#database
      .select({
        runId: privateChatStreams.runId,
        wireBytes: privateChatStreams.wireBytes,
      })
      .from(privateChatStreams)
      .innerJoin(
        privateAssistantTurns,
        eq(privateAssistantTurns.id, privateChatStreams.runId)
      )
      .where(
        and(
          eq(privateChatStreams.closed, false),
          inArray(privateAssistantTurns.status, [
            "failed",
            "interrupted",
            "cancelled",
            "succeeded",
          ])
        )
      )
      .all();
    for (const stream of interrupted) {
      this.#database.transaction(() => {
        const retained = this.#database
          .select()
          .from(privateChatEvents)
          .where(eq(privateChatEvents.runId, stream.runId))
          .orderBy(desc(privateChatEvents.sequence))
          .all();
        const [last] = retained;
        const hasTerminal = retained.some(({ eventJson }) => {
          const event = parseEventJson(eventJson);
          return (
            event.type === EventType.RUN_FINISHED ||
            event.type === EventType.RUN_ERROR
          );
        });
        let { wireBytes } = stream;
        if (!hasTerminal) {
          const event: PrivateChatEvent = {
            code: "interrupted",
            message: "This response was interrupted.",
            timestamp: Date.now(),
            type: EventType.RUN_ERROR,
          };
          const eventJson = JSON.stringify(event);
          wireBytes += new TextEncoder().encode(eventJson).byteLength;

          if (wireBytes > MAX_PRIVATE_CHAT_REPLAY_BYTES) {
            throw new PrivateChatStorageFailure({ reason: "replay_limit" });
          }
          this.#database
            .insert(privateChatEvents)
            .values({
              eventJson,
              runId: stream.runId,
              sequence: (last?.sequence ?? 0) + 1,
            })
            .run();
        }
        this.#database
          .update(privateChatStreams)
          .set({ closed: true, wireBytes })
          .where(eq(privateChatStreams.runId, stream.runId))
          .run();
      });
      this.#wake(stream.runId);
    }
  }

  #wake(runId: string) {
    const waiters = this.#waiters.get(runId);
    this.#waiters.delete(runId);
    for (const wake of waiters ?? []) {
      wake();
    }
  }

  #wait(runId: string, signal?: AbortSignal) {
    const completion = Promise.withResolvers<undefined>();
    const waiters = this.#waiters.get(runId) ?? new Set<() => void>();
    const wake = () => {
      waiters.delete(wake);
      if (waiters.size === 0) {
        this.#waiters.delete(runId);
      }
      signal?.removeEventListener("abort", wake);
      completion.resolve(undefined);
    };
    waiters.add(wake);
    this.#waiters.set(runId, waiters);
    signal?.addEventListener("abort", wake, { once: true });
    if (signal?.aborted) {
      wake();
    }
    return completion.promise;
  }

  stream(input: {
    readonly threadId: string;
    readonly runId: string;
    readonly offset: string | null;
  }) {
    const { threadId, runId, offset } = input;
    if (!this.#run(threadId, runId)) {
      throw new PrivateChatStorageFailure({ reason: "run_not_admitted" });
    }
    if (offset === null) {
      this.#database
        .insert(privateChatStreams)
        .values({ runId })
        .onConflictDoNothing()
        .run();
    }
    const streamState = () => {
      this.#bind(threadId);
      const row = this.#database
        .select()
        .from(privateChatStreams)
        .where(eq(privateChatStreams.runId, runId))
        .get();
      if (!row) {
        throw new PrivateChatStorageFailure({ reason: "stream_unavailable" });
      }
      return row;
    };
    streamState();
    const prefix = `private-chat:v1:${threadId}:${runId}:`;
    const tail = () =>
      this.#database
        .select()
        .from(privateChatEvents)
        .where(eq(privateChatEvents.runId, runId))
        .orderBy(desc(privateChatEvents.sequence))
        .get()?.sequence ?? 0;
    const sequenceFrom = (cursor: string) => {
      if (cursor === "-1") {
        const checkedResult = 0;
        return checkedResult;
      }
      if (cursor === "now") {
        const checkedResult: number = tail();
        return checkedResult;
      }
      const suffix = cursor.startsWith(prefix)
        ? cursor.slice(prefix.length)
        : "";
      const sequence = Number(suffix);
      if (
        !/^[1-9]\d*$/u.test(suffix) ||
        !Number.isSafeInteger(sequence) ||
        sequence > tail()
      ) {
        throw new PrivateChatStorageFailure({ reason: "invalid_cursor" });
      }
      {
        const checkedResult: number = sequence;
        return checkedResult;
      }
    };
    const entries = (after: number, limit?: number) => {
      const query = this.#database
        .select()
        .from(privateChatEvents)
        .where(
          and(
            eq(privateChatEvents.runId, runId),
            gt(privateChatEvents.sequence, after)
          )
        )
        .orderBy(asc(privateChatEvents.sequence))
        .$dynamic();
      return (limit === undefined ? query : query.limit(limit))
        .all()
        .map((row) => {
          if (!Number.isSafeInteger(row.sequence) || row.sequence <= after) {
            throw new PrivateChatStorageFailure({ reason: "invalid_cursor" });
          }
          return {
            chunk: toNativeEvent(parseEventJson(row.eventJson)),
            offset: `${prefix}${row.sequence}`,
          };
        });
    };
    const waitForAppend = (signal?: AbortSignal) => this.#wait(runId, signal);
    {
      const checkedResult: StreamDurability = {
        append: async (chunks) => {
          const parsed = chunks.map((chunk) => {
            let event: PrivateChatEvent;
            try {
              event = parseEvent(chunk);
            } catch {
              throw new PrivateChatStorageFailure({ reason: "invalid_event" });
            }
            if (
              "runId" in event &&
              (event.runId !== runId || event.threadId !== threadId)
            ) {
              throw new PrivateChatStorageFailure({
                reason: "binding_conflict",
              });
            }
            const json = JSON.stringify(event);
            const bytes = new TextEncoder().encode(json).byteLength;
            if (bytes > MAX_EVENT_BYTES) {
              throw new PrivateChatStorageFailure({ reason: "replay_limit" });
            }
            return {
              bytes,
              json,
              terminal:
                event.type === EventType.RUN_ERROR ||
                event.type === EventType.RUN_FINISHED,
            };
          });
          const offsets = this.#database.transaction(() => {
            const state = streamState();
            if (state.closed) {
              throw new PrivateChatStorageFailure({ reason: "stream_closed" });
            }
            const wireBytes =
              state.wireBytes +
              parsed.reduce((sum, event) => sum + event.bytes, 0);
            const limit = parsed.some((event) => event.terminal)
              ? MAX_PRIVATE_CHAT_REPLAY_BYTES
              : MAX_PRIVATE_CHAT_REPLAY_BYTES - TERMINAL_EVENT_RESERVE_BYTES;
            if (wireBytes > limit) {
              throw new PrivateChatStorageFailure({ reason: "replay_limit" });
            }
            const first = tail() + 1;
            const saved = parsed.map((event, index) => {
              const sequence = first + index;
              this.#database
                .insert(privateChatEvents)
                .values({ eventJson: event.json, runId, sequence })
                .run();
              return `${prefix}${sequence}`;
            });
            this.#database
              .update(privateChatStreams)
              .set({ wireBytes })
              .where(eq(privateChatStreams.runId, runId))
              .run();
            return saved;
          });
          this.#wake(runId);
          return offsets;
        },
        close: async () => {
          streamState();
          this.#database
            .update(privateChatStreams)
            .set({ closed: true })
            .where(eq(privateChatStreams.runId, runId))
            .run();
          this.#wake(runId);
        },
        async *read(cursor, signal) {
          let sequence = sequenceFrom(cursor);
          while (true) {
            if (signal?.aborted) {
              return;
            }
            const batch = entries(sequence, READ_BATCH_SIZE);
            for (const entry of batch) {
              if (signal?.aborted) {
                return;
              }
              sequence = Number(entry.offset.slice(prefix.length));
              yield entry;
            }

            if (batch.length > 0) {
              continue;
            }
            if (streamState().closed) {
              return;
            }
            // eslint-disable-next-line no-await-in-loop -- A tail waits sequentially for the next append; concurrent reads would break event ordering.
            await waitForAppend(signal);
          }
        },
        resumeFrom: () => offset,
        snapshot: async () => {
          streamState();
          return entries(0);
        },
      };
      return checkedResult;
    }
  }
}
