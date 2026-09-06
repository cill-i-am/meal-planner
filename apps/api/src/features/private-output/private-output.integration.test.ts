import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import type {
  DirectoryFrame,
  SessionFrame,
} from "@meal-planner/private-interview-api";
import {
  MAX_MESSAGE_LENGTH,
  MAX_PAGE_SIZE,
  MAX_PRIVATE_FRAME_BYTES,
} from "@meal-planner/private-interview-api";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bundleWorkerFixture } from "../../test/native-worker.test-fixture.js";
import type { PrivateOutputMutationPort } from "./private-output-binding.js";
import { runOutputFencedMutation } from "./private-output-mutation.js";
import {
  privateOutputControlWorker,
  privateOutputRuntimeWorker,
} from "./private-output-runtime.test-fixture.js";
import type { PrivateSessionBinding } from "./private-output.contract.js";
import {
  privateDirectoryKey,
  privateOutputKey,
} from "./private-output.contract.js";

let runtime: Miniflare;
let temporaryDirectory: string;
let manifest: Awaited<ReturnType<typeof bundleWorkerFixture>>;
let legacyManifest: typeof manifest;
const makeRuntime = (selectedManifest = manifest) =>
  new Miniflare({
    cf: false,
    resourcePersistencePath: `${temporaryDirectory}/storage`,
    workers: [privateOutputRuntimeWorker(selectedManifest)],
  });

beforeAll(async () => {
  temporaryDirectory = await mkdtemp(
    `${tmpdir()}/meal-planner-private-output-`
  );
  manifest = await bundleWorkerFixture(
    fileURLToPath(
      new URL("private-output-control.test-fixture.ts", import.meta.url)
    ),
    temporaryDirectory
  );
  legacyManifest = await bundleWorkerFixture(
    fileURLToPath(
      new URL("private-output-upgrade.test-fixture.ts", import.meta.url)
    ),
    temporaryDirectory
  );
  runtime = makeRuntime();
}, 60_000);
afterAll(async () => {
  await runtime.dispose();
  await rm(temporaryDirectory, { force: true, recursive: true });
});

const binding = async (): Promise<PrivateSessionBinding> => ({
  accountKey: await privateOutputKey("account", crypto.randomUUID()),
  householdKey: await privateOutputKey("household", crypto.randomUUID()),
  linkageSubject: "a".repeat(64),
  personId: `person_${crypto.randomUUID()}`,
  sessionReference: crypto.randomUUID(),
});
const command = (
  input: Record<string, unknown> & { readonly sessionReference: string }
) => {
  const headers: Record<string, string> = {
    "x-test-command": JSON.stringify(input),
  };
  if (
    input["action"] === "connect" ||
    input["action"] === "directory-connect"
  ) {
    headers["Upgrade"] = "websocket";
  }
  return runtime.dispatchFetch("https://private-output.test/control", {
    headers,
  });
};
const expectStatus = async (
  pending: Promise<{ readonly status: number }>,
  status: number
) => {
  const response = await pending;
  expect(response.status).toBe(status);
};
const successful = async <A>(
  input: Parameters<typeof command>[0]
): Promise<A> => {
  const response = await command(input);
  expect(response.status, await response.clone().text()).toBe(200);
  return ((await response.json()) as { readonly result: A }).result;
};
const begin = async (input: PrivateSessionBinding) => {
  await successful({
    action: "initialize",
    binding: input,
    sessionReference: input.sessionReference,
  });
  return successful<string>({
    action: "begin",
    binding: input,
    sessionReference: input.sessionReference,
  });
};
const open = async (
  input: PrivateSessionBinding,
  expiresAt = Date.now() + 60_000
) => {
  const generation = await begin(input);
  await successful({
    action: "authorize",
    binding: input,
    expiresAt,
    generation,
    sessionReference: input.sessionReference,
  });
  const response = await command({
    action: "connect",
    generation,
    sessionReference: input.sessionReference,
  });
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  if (socket === null) {
    throw new Error("Expected the child's physical WebSocket");
  }
  const frames: SessionFrame[] = [];
  socket.addEventListener("message", (event) =>
    frames.push(JSON.parse(String(event.data)) as SessionFrame)
  );
  socket.accept();
  await expect
    .poll(() => frames.some((frame) => frame.type === "SessionReady"))
    .toBe(true);
  return {
    frames,
    generation,
    get messages() {
      return frames.flatMap((frame) =>
        frame.type === "HistoryRead"
          ? frame.messages
              .filter((message) => message.role === "assistant")
              .map((message) => message.text)
          : []
      );
    },
    socket,
  };
};
type Connection = Awaited<ReturnType<typeof open>>;
const exchange = async (
  connection: {
    readonly frames: (SessionFrame | DirectoryFrame)[];
    readonly socket: Connection["socket"];
  },
  input: {
    readonly type: string;
    readonly mutationId?: string;
    readonly requestId?: string;
    readonly [key: string]: unknown;
  }
) => {
  const start = connection.frames.length;
  const id = input.mutationId ?? input.requestId;
  connection.socket.send(JSON.stringify(input));
  await expect
    .poll(() =>
      connection.frames
        .slice(start)
        .find(
          (frame) =>
            ("mutationId" in frame && frame.mutationId === id) ||
            ("requestId" in frame && frame.requestId === id) ||
            ("commandId" in frame && frame.commandId === id)
        )
    )
    .toBeDefined();
  const received = connection.frames
    .slice(start)
    .find(
      (frame) =>
        ("mutationId" in frame && frame.mutationId === id) ||
        ("requestId" in frame && frame.requestId === id) ||
        ("commandId" in frame && frame.commandId === id)
    );
  if (received === undefined) {
    throw new Error("Expected private command receipt");
  }
  return received;
};
const history = (
  connection: Connection,
  afterOrdinal = 0,
  limit = MAX_PAGE_SIZE
) =>
  exchange(connection, {
    afterOrdinal,
    limit,
    requestId: crypto.randomUUID(),
    type: "ReadHistory",
  });
const emit = (
  input: PrivateSessionBinding,
  generation: string,
  payload: string
) =>
  successful({
    action: "emit",
    generation,
    payload,
    sessionReference: input.sessionReference,
  });
const mutationPort = (sessionReference: string): PrivateOutputMutationPort => ({
  beginMutation: (input) =>
    successful({ ...input, action: "mutation-begin", sessionReference }),
  completeMutation: (input) =>
    successful({ ...input, action: "mutation-complete", sessionReference }),
  markDispatched: (input) =>
    successful({ ...input, action: "mutation-dispatch", sessionReference }),
  prepareMutation: (input) =>
    successful({ ...input, action: "mutation-prepare", sessionReference }),
  readMutation: (input) =>
    successful({ ...input, action: "mutation-read", sessionReference }),
});

describe("private output on physical native WebSockets", () => {
  it("emits only from the physical child and suppresses passive and already-running output after revocation", async () => {
    const session = await binding();
    const connection = await open(session);
    await emit(session, connection.generation, "synthetic-private-before");
    await delay(10);
    expect(connection.messages).toEqual(["synthetic-private-before"]);
    const stalledProducer = Promise.withResolvers<null>();
    const delayedOutput = stalledProducer.promise.then(() =>
      emit(session, connection.generation, "synthetic-private-after")
    );
    let canonicalCommitted = false;
    await runOutputFencedMutation(
      mutationPort(session.sessionReference),
      {
        intentKey: "1".repeat(64),
        key: session.accountKey,
        scope: "account",
      },
      () => {
        canonicalCommitted = true;
        return Promise.resolve();
      }
    );
    expect(canonicalCommitted).toBe(true);
    stalledProducer.resolve(null);
    await delayedOutput;
    await emit(session, connection.generation, "synthetic-passive-after");
    await delay(10);
    expect(connection.messages).toEqual(["synthetic-private-before"]);
    const fresh = await open(session);
    expect(fresh.generation).not.toBe(connection.generation);
    await emit(session, connection.generation, "synthetic-old-generation");
    await emit(session, fresh.generation, "synthetic-fresh-authorized");
    await delay(10);
    expect(fresh.messages).toEqual(["synthetic-fresh-authorized"]);
    fresh.socket.close();
  });

  it("cannot activate a generation revoked after its successful authority read", async () => {
    const session = await binding();
    const generation = await begin(session);
    const previouslyReadAuthority = {
      action: "authorize",
      binding: session,
      expiresAt: Date.now() + 60_000,
      generation,
      sessionReference: session.sessionReference,
    };
    await runOutputFencedMutation(
      mutationPort(session.sessionReference),
      {
        intentKey: "2".repeat(64),
        key: session.householdKey,
        scope: "household",
      },
      () => Promise.resolve()
    );
    await expectStatus(command(previouslyReadAuthority), 409);
    await expectStatus(
      command({
        action: "connect",
        generation,
        sessionReference: session.sessionReference,
      }),
      403
    );
  });

  it("checks the captured canonical session deadline immediately before native enqueue", async () => {
    const session = await binding();
    const expiresAt = Date.now() + 60_000;
    const connection = await open(session, expiresAt);
    const enqueueAt = (now: number, payload: string) =>
      successful({
        action: "emit-at-time",
        generation: connection.generation,
        now,
        payload,
        sessionReference: session.sessionReference,
      });
    await enqueueAt(expiresAt - 1, "synthetic-before-expiry");
    await enqueueAt(expiresAt, "synthetic-at-expiry");
    await enqueueAt(expiresAt + 1, "synthetic-after-expiry");
    await delay(10);
    expect(connection.messages).toEqual(["synthetic-before-expiry"]);
    connection.socket.close();
  });

  it.each([
    { state: { transcript: "synthetic-private" }, type: "cf_agent_state" },
    {
      args: ["synthetic-private"],
      id: "probe",
      method: "enqueueOutput",
      type: "rpc",
    },
    { type: "cf_agent_mcp_servers" },
    {
      messages: [{ content: "probe", role: "user" }],
      type: "cf_agent_chat_message",
    },
  ])(
    "rejects client state/RPC/tool frames, private HTTP and inherited SQL/state RPC: %j",
    async (message) => {
      const session = await binding();
      const connection = await open(session);
      connection.socket.send(JSON.stringify(message));
      await delay(20);
      expect(connection.messages).toEqual([]);
      connection.socket.close();
      await expectStatus(
        command({
          action: "private-http",
          sessionReference: session.sessionReference,
        }),
        404
      );
      await expectStatus(
        command({ action: "sql", sessionReference: session.sessionReference }),
        409
      );
      await expectStatus(
        command({
          action: "state",
          sessionReference: session.sessionReference,
        }),
        409
      );
      await expectStatus(
        command({
          action: "context-sql",
          sessionReference: session.sessionReference,
        }),
        409
      );
    }
  );

  it("retains immutable completed-session metadata and refuses copied references without closing the owner", async () => {
    const session = await binding();
    const connection = await open(session);
    await exchange(connection, {
      expectedVersion: 0,
      mutationId: crypto.randomUUID(),
      type: "CompleteSession",
    });
    await successful({
      action: "initialize",
      binding: session,
      sessionReference: session.sessionReference,
    });
    expect(
      await successful({
        action: "metadata",
        sessionReference: session.sessionReference,
      })
    ).toMatchObject({ ...session, status: "completed", version: 1 });
    const copied = {
      ...(await binding()),
      sessionReference: session.sessionReference,
    };
    await expectStatus(
      command({
        action: "initialize",
        binding: copied,
        sessionReference: session.sessionReference,
      }),
      409
    );
    await expectStatus(
      command({
        action: "begin",
        binding: copied,
        sessionReference: session.sessionReference,
      }),
      409
    );
    await emit(
      session,
      connection.generation,
      "synthetic-owner-still-connected"
    );
    await delay(10);
    expect(connection.messages).toEqual([]);
    expect(await history(connection)).toMatchObject({
      messages: [],
      state: { status: "completed", version: 1 },
    });
    connection.socket.close();
  });

  it("retries a lost invalidation acknowledgement with the retained operation before any canonical mutation", async () => {
    const session = await binding();
    const connection = await open(session);
    await successful({
      action: "lose-ack",
      sessionReference: session.sessionReference,
    });
    const port = mutationPort(session.sessionReference);
    const input = {
      intentKey: "3".repeat(64),
      key: session.accountKey,
      scope: "account" as const,
    };
    let writes = 0;
    await expect(
      runOutputFencedMutation(port, input, () => {
        writes += 1;
        return Promise.resolve(writes);
      })
    ).rejects.toThrow();
    expect(writes).toBe(0);
    const retained = await port.beginMutation(input);
    expect(retained.phase).toBe("fencing");
    await runOutputFencedMutation(port, input, () => {
      writes += 1;
      return Promise.resolve(writes);
    });
    expect(writes).toBe(1);
    expect(
      await port.readMutation({ ...input, operationId: retained.operationId })
    ).toEqual({ phase: "settled" });
    await emit(session, connection.generation, "synthetic-after-lost-ack");
    await delay(10);
    expect(connection.messages).toEqual([]);
  });

  it("gives concurrent identical writers a single durable dispatch claim", async () => {
    const session = await binding();
    const port = mutationPort(session.sessionReference);
    const input = {
      intentKey: "4".repeat(64),
      key: session.accountKey,
      scope: "account" as const,
    };
    const claimed = Promise.withResolvers<null>();
    const release = Promise.withResolvers<null>();
    let writes = 0;
    const canonical = async () => {
      writes += 1;
      claimed.resolve(null);
      await release.promise;
    };
    const first = runOutputFencedMutation(port, input, canonical);
    const second = runOutputFencedMutation(port, input, canonical);
    const outcomes = Promise.allSettled([first, second]);
    await claimed.promise;
    await delay(20);
    expect(writes).toBe(1);
    await successful({
      action: "initialize",
      binding: session,
      sessionReference: session.sessionReference,
    });
    await expectStatus(
      command({
        action: "begin",
        binding: session,
        sessionReference: session.sessionReference,
      }),
      409
    );
    release.resolve(null);
    const completed = await outcomes;
    expect(completed.map((result) => result.status).toSorted()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    expect(writes).toBe(1);
    expect(await begin(session)).toEqual(expect.any(String));
  });

  it("keeps ambiguous and lost-dispatch-ack operations fenced across restart", async () => {
    const session = await binding();
    const connection = await open(session);
    const port = mutationPort(session.sessionReference);
    const input = {
      intentKey: "5".repeat(64),
      key: session.accountKey,
      scope: "account" as const,
    };
    const retained = await port.beginMutation(input);
    const operation = { ...input, operationId: retained.operationId };
    await port.prepareMutation(operation);
    // The durable dispatch commits, but its caller loses the acknowledgement before canonical dispatch.
    await port.markDispatched(operation);
    await runtime.dispose();
    runtime = makeRuntime();
    expect(await port.readMutation(operation)).toEqual({ phase: "dispatched" });
    let writes = 0;
    await expect(
      runOutputFencedMutation(port, input, () => {
        writes += 1;
        return Promise.resolve(writes);
      })
    ).rejects.toThrow();
    expect(writes).toBe(0);
    await expectStatus(
      command({
        action: "begin",
        binding: session,
        sessionReference: session.sessionReference,
      }),
      409
    );
    await emit(session, connection.generation, "synthetic-after-restart");
    expect(
      await successful({
        action: "metadata",
        sessionReference: session.sessionReference,
      })
    ).toMatchObject({ ...session, status: "open" });
  });

  it.each(["fencing", "dispatched"] as const)(
    "allows a distinct canonical intent while a retained %s operation keeps output closed",
    async (phase) => {
      const session = await binding();
      await open(session);
      const port = mutationPort(session.sessionReference);
      const first = {
        intentKey: "7".repeat(64),
        key: session.accountKey,
        scope: "account" as const,
      };
      const retained = await port.beginMutation(first);
      const operation = { ...first, operationId: retained.operationId };
      if (phase === "fencing") {
        await successful({
          action: "lose-ack",
          sessionReference: session.sessionReference,
        });
        await expect(port.prepareMutation(operation)).rejects.toThrow();
      } else {
        await port.prepareMutation(operation);
        await port.markDispatched(operation);
      }
      await runtime.dispose();
      runtime = makeRuntime();
      const expectClosed = () =>
        expectStatus(
          command({
            action: "begin",
            binding: session,
            sessionReference: session.sessionReference,
          }),
          409
        );
      await expectClosed();
      const entered = Promise.withResolvers<null>();
      const release = Promise.withResolvers<null>();
      let writes = 0;
      const second = runOutputFencedMutation(
        port,
        { ...first, intentKey: "8".repeat(64) },
        async () => {
          writes += 1;
          entered.resolve(null);
          await release.promise;
        }
      );
      await entered.promise;
      await expectClosed();
      release.resolve(null);
      await second;
      expect(writes).toBe(1);
      expect(await port.readMutation(operation)).toEqual({ phase });
      await expectClosed();
      await runtime.dispose();
      runtime = makeRuntime();
      expect(await port.readMutation(operation)).toEqual({ phase });
      await expectClosed();
      if (phase === "dispatched") {
        await expect(
          runOutputFencedMutation(port, first, () => {
            writes += 1;
            return Promise.resolve();
          })
        ).rejects.toThrow();
        expect(writes).toBe(1);
      }
    }
  );

  it("recovers a lost completion acknowledgement from the exact durable result", async () => {
    const session = await binding();
    const port = mutationPort(session.sessionReference);
    let completionCalls = 0;
    const losingPort: PrivateOutputMutationPort = {
      ...port,
      completeMutation: async (input) => {
        await port.completeMutation(input);
        completionCalls += 1;
        throw new Error("Synthetic lost completion acknowledgement");
      },
    };
    let writes = 0;
    await runOutputFencedMutation(
      losingPort,
      { intentKey: "6".repeat(64), key: session.accountKey, scope: "account" },
      () => {
        writes += 1;
        return Promise.resolve(writes);
      }
    );
    expect(writes).toBe(1);
    expect(completionCalls).toBe(1);
    expect(await begin(session)).toEqual(expect.any(String));
  });
});

describe("durable private conversation protocol", () => {
  it("recovers exact append and completion receipts across restart without duplicate records", async () => {
    const session = await binding();
    const first = await open(session);
    const append = {
      expectedVersion: 0,
      mutationId: crypto.randomUUID(),
      text: "synthetic-retained-participant",
      type: "AppendParticipantMessage",
    };
    // Receipt is deliberately discarded by the caller before the runtime is restarted.
    const appended = await exchange(first, append);
    expect(appended).toMatchObject({
      state: { status: "open", version: 1 },
      type: "MessageAppended",
    });
    await runtime.dispose();
    runtime = makeRuntime();
    const resumed = await open(session);
    expect(resumed.generation).not.toBe(first.generation);
    expect(await exchange(resumed, append)).toEqual(appended);
    expect(
      await exchange(resumed, { ...append, text: "changed intent" })
    ).toMatchObject({ reason: "mutation_collision", type: "Rejected" });
    expect(await history(resumed)).toMatchObject({
      messages: [
        expect.objectContaining({
          ordinal: 1,
          role: "participant",
          text: append.text,
        }),
      ],
      state: { status: "open", version: 1 },
      type: "HistoryRead",
    });
    const complete = {
      expectedVersion: 1,
      mutationId: crypto.randomUUID(),
      type: "CompleteSession",
    };
    const completed = await exchange(resumed, complete);
    expect(completed).toMatchObject({
      state: { status: "completed", version: 2 },
      type: "SessionCompleted",
    });
    await runtime.dispose();
    runtime = makeRuntime();
    const retained = await open(session);
    expect(await exchange(retained, complete)).toEqual(completed);
    expect(await exchange(retained, append)).toEqual(appended);
    expect(
      await exchange(retained, { ...complete, expectedVersion: 2 })
    ).toMatchObject({ reason: "mutation_collision", type: "Rejected" });
    expect(
      await exchange(retained, {
        ...append,
        expectedVersion: 2,
        mutationId: crypto.randomUUID(),
      })
    ).toMatchObject({ reason: "session_completed", type: "Rejected" });
    expect(await history(retained)).toMatchObject({
      messages: [expect.objectContaining({ text: append.text })],
      state: { status: "completed", version: 2 },
    });
    retained.socket.close();
  });

  it("serializes identical and competing commands with stable bounded history ordering", async () => {
    const session = await binding();
    const connection = await open(session);
    const first = {
      expectedVersion: 0,
      mutationId: crypto.randomUUID(),
      text: "first",
      type: "AppendParticipantMessage",
    };
    connection.socket.send(JSON.stringify(first));
    connection.socket.send(JSON.stringify(first));
    await expect
      .poll(
        () =>
          connection.frames.filter((frame) => frame.type === "MessageAppended")
            .length
      )
      .toBe(2);
    expect(connection.frames[1]).toEqual(connection.frames[2]);
    const competing = ["second", "competing"].map((text) => ({
      expectedVersion: 1,
      mutationId: crypto.randomUUID(),
      text,
      type: "AppendParticipantMessage",
    }));
    for (const input of competing) {
      connection.socket.send(JSON.stringify(input));
    }
    await expect.poll(() => connection.frames.length).toBe(5);
    expect(connection.frames.slice(3).map((frame) => frame.type)).toEqual([
      "MessageAppended",
      "Rejected",
    ]);
    expect(connection.frames[4]).toMatchObject({
      reason: "version_conflict",
      state: { version: 2 },
    });
    await emit(session, connection.generation, "synthetic-assistant-third");
    const firstPage = await history(connection, 0, 2);
    expect(firstPage).toMatchObject({
      hasMore: true,
      messages: [
        expect.objectContaining({
          ordinal: 1,
          role: "participant",
          text: "first",
        }),
        expect.objectContaining({
          ordinal: 2,
          role: "participant",
          text: "second",
        }),
      ],
      state: { version: 3 },
      type: "HistoryRead",
    });
    const lastPage = await history(connection, 2, 2);
    expect(lastPage).toMatchObject({
      hasMore: false,
      messages: [
        expect.objectContaining({
          ordinal: 3,
          role: "assistant",
          text: "synthetic-assistant-third",
        }),
      ],
      type: "HistoryRead",
    });
    const beforeReconnect = await history(connection);
    connection.socket.close();
    const resumed = await open(session);
    const afterReconnect = await history(resumed);
    if (
      beforeReconnect.type !== "HistoryRead" ||
      afterReconnect.type !== "HistoryRead"
    ) {
      throw new Error("History expected");
    }
    expect(afterReconnect.messages).toEqual(beforeReconnect.messages);
    expect(
      new Set(afterReconnect.messages.map((message) => message.id)).size
    ).toBe(3);
    resumed.socket.close();
  });

  it("completion suppresses queued assistant records and old generations cannot adopt a replacement socket", async () => {
    const session = await binding();
    const first = await open(session);
    const producer = Promise.withResolvers<null>();
    const delayed = producer.promise.then(() =>
      emit(session, first.generation, "must-never-persist")
    );
    const completed = await exchange(first, {
      expectedVersion: 0,
      mutationId: crypto.randomUUID(),
      type: "CompleteSession",
    });
    expect(completed).toMatchObject({
      state: { status: "completed", version: 1 },
      type: "SessionCompleted",
    });
    const replacement = await open(session);
    producer.resolve(null);
    await delayed;
    await emit(
      session,
      replacement.generation,
      "completed-session-must-not-question"
    );
    expect(await history(replacement)).toMatchObject({
      messages: [],
      state: { status: "completed", version: 1 },
    });
    expect(replacement.messages).toEqual([]);
    replacement.socket.close();
  });

  it.each(["append-first", "complete-first"] as const)(
    "commits only the valid serialized completion race: %s",
    async (order) => {
      const session = await binding();
      const connection = await open(session);
      const append = {
        expectedVersion: 0,
        mutationId: crypto.randomUUID(),
        text: "racing participant",
        type: "AppendParticipantMessage",
      };
      const complete = {
        expectedVersion: 0,
        mutationId: crypto.randomUUID(),
        type: "CompleteSession",
      };
      for (const input of order === "append-first"
        ? [append, complete]
        : [complete, append]) {
        connection.socket.send(JSON.stringify(input));
      }
      await expect.poll(() => connection.frames.length).toBe(3);
      expect(connection.frames[2]).toMatchObject({
        reason:
          order === "append-first" ? "version_conflict" : "session_completed",
        type: "Rejected",
      });
      expect(await history(connection)).toMatchObject({
        messages:
          order === "append-first"
            ? [expect.objectContaining({ text: append.text })]
            : [],
        state: {
          status: order === "append-first" ? "open" : "completed",
          version: 1,
        },
      });
      connection.socket.close();
    }
  );

  it.each([
    {
      expectedVersion: 0,
      mutationId: crypto.randomUUID(),
      text: "x".repeat(MAX_MESSAGE_LENGTH + 1),
      type: "AppendParticipantMessage",
    },
    {
      expectedVersion: 0,
      mutationId: crypto.randomUUID(),
      text: "",
      type: "AppendParticipantMessage",
    },
    {
      expectedVersion: 0,
      mutationId: crypto.randomUUID(),
      role: "assistant",
      text: "actor spoof",
      type: "AppendParticipantMessage",
    },
    {
      expectedVersion: 0,
      mutationId: crypto.randomUUID(),
      personId: "another-person",
      text: "identity spoof",
      type: "AppendParticipantMessage",
    },
    {
      expectedVersion: -1,
      mutationId: crypto.randomUUID(),
      type: "CompleteSession",
    },
    {
      afterOrdinal: 0,
      limit: MAX_PAGE_SIZE + 1,
      requestId: crypto.randomUUID(),
      type: "ReadHistory",
    },
    {
      afterOrdinal: 0.5,
      limit: 1,
      requestId: crypto.randomUUID(),
      type: "ReadHistory",
    },
  ])(
    "rejects malformed or unbounded commands before persistence: $type",
    async (input) => {
      const session = await binding();
      const connection = await open(session);
      const closed = Promise.withResolvers<number>();
      connection.socket.addEventListener("close", (event) =>
        closed.resolve(event.code)
      );
      connection.socket.send(JSON.stringify(input));
      expect(await closed.promise).toBe(1008);
      expect(connection.frames).toHaveLength(1);
      const fresh = await open(session);
      expect(await history(fresh)).toMatchObject({
        messages: [],
        state: { status: "open", version: 0 },
      });
      fresh.socket.close();
    }
  );

  it("rejects oversized UTF-8 frames before persistence", async () => {
    const session = await binding();
    const connection = await open(session);
    const closed = Promise.withResolvers<number>();
    connection.socket.addEventListener("close", (event) =>
      closed.resolve(event.code)
    );
    connection.socket.send("é".repeat(MAX_PRIVATE_FRAME_BYTES));
    expect(await closed.promise).toBe(1009);
    const fresh = await open(session);
    expect(await history(fresh)).toMatchObject({
      messages: [],
      state: { version: 0 },
    });
    fresh.socket.close();
  });
});

const directoryCommand = (
  session: PrivateSessionBinding,
  input: Record<string, unknown>
) => {
  const { sessionReference, ...participant } = session;
  return { ...input, participant, sessionReference };
};
const openDirectory = async (
  session: PrivateSessionBinding,
  expiresAt = Date.now() + 60_000
) => {
  await successful(
    directoryCommand(session, { action: "directory-initialize" })
  );
  const generation = await successful<string>(
    directoryCommand(session, { action: "directory-begin" })
  );
  await successful(
    directoryCommand(session, {
      action: "directory-authorize",
      expiresAt,
      generation,
    })
  );
  const response = await command(
    directoryCommand(session, { action: "directory-connect", generation })
  );
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  if (socket === null) {
    throw new Error("Expected directory physical socket");
  }
  const frames: DirectoryFrame[] = [];
  socket.addEventListener("message", (event) =>
    frames.push(JSON.parse(String(event.data)) as DirectoryFrame)
  );
  socket.accept();
  await expect
    .poll(() => frames.some((frame) => frame.type === "DirectoryReady"))
    .toBe(true);
  return { frames, generation, socket };
};
const listSessions = (
  connection: Awaited<ReturnType<typeof openDirectory>>,
  afterOrdinal = 0,
  limit = MAX_PAGE_SIZE
) =>
  exchange(connection, {
    afterOrdinal,
    limit,
    requestId: crypto.randomUUID(),
    type: "ListSessions",
  });

describe("participant directory reservations and shared output fences", () => {
  it("recovers one exact reservation after a lost reply and restart, with private stable pages", async () => {
    const owner = await binding();
    const first = await openDirectory(owner);
    const start = { mutationId: crypto.randomUUID(), type: "StartSession" };
    const receipt = await exchange(first, start);
    expect(receipt).toMatchObject({
      reservation: {
        createdAt: expect.any(Number),
        ordinal: 1,
        sessionReference: expect.any(String),
      },
      type: "SessionStarted",
    });
    await runtime.dispose();
    runtime = makeRuntime();
    const resumed = await openDirectory(owner);
    expect(await exchange(resumed, start)).toEqual(receipt);
    const second = await exchange(resumed, {
      ...start,
      mutationId: crypto.randomUUID(),
    });
    if (receipt.type !== "SessionStarted" || second.type !== "SessionStarted") {
      throw new Error("Reservation expected");
    }
    expect(second.reservation.sessionReference).not.toBe(
      receipt.reservation.sessionReference
    );
    expect(await listSessions(resumed, 0, 1)).toMatchObject({
      hasMore: true,
      reservations: [receipt.reservation],
    });
    expect(await listSessions(resumed, 1, 1)).toMatchObject({
      hasMore: false,
      reservations: [second.reservation],
    });
    expect(Object.keys(receipt.reservation).toSorted()).toEqual([
      "createdAt",
      "ordinal",
      "sessionReference",
    ]);
    const retainedBinding = {
      ...owner,
      sessionReference: receipt.reservation.sessionReference,
    };
    expect(
      await successful(
        directoryCommand(owner, {
          action: "directory-reserved",
          binding: retainedBinding,
        })
      )
    ).toBe(true);
    expect(
      await successful(
        directoryCommand(owner, {
          action: "directory-reserved",
          binding: {
            ...retainedBinding,
            sessionReference: crypto.randomUUID(),
          },
        })
      )
    ).toBe(false);
    const other = { ...(await binding()), householdKey: owner.householdKey };
    const otherDirectory = await openDirectory(other);
    expect(await listSessions(otherDirectory)).toMatchObject({
      hasMore: false,
      reservations: [],
    });
    await expectStatus(
      command(
        directoryCommand(other, {
          action: "directory-reserved",
          binding: retainedBinding,
        })
      ),
      409
    );
    const copiedIdReceipt = await exchange(otherDirectory, start);
    expect(copiedIdReceipt).toMatchObject({ type: "SessionStarted" });
    if (copiedIdReceipt.type !== "SessionStarted") {
      throw new Error("Reservation expected");
    }
    expect(copiedIdReceipt.reservation.sessionReference).not.toBe(
      receipt.reservation.sessionReference
    );
    const selected = await open(retainedBinding);
    await exchange(selected, {
      expectedVersion: 0,
      mutationId: crypto.randomUUID(),
      type: "CompleteSession",
    });
    expect(await listSessions(resumed, 0, 1)).toMatchObject({
      reservations: [receipt.reservation],
    });
    await expectStatus(
      command(
        directoryCommand(
          { ...owner, linkageSubject: "repaired-link" },
          {
            action: "directory-initialize",
            directoryKey: await privateDirectoryKey(owner),
          }
        )
      ),
      409
    );
    selected.socket.close();
    otherDirectory.socket.close();
    resumed.socket.close();
  });

  it.each(["account", "household"] as const)(
    "invalidates both child kinds before a %s canonical write and retries a directory lost ACK",
    async (scope) => {
      const owner = await binding();
      const directory = await openDirectory(owner);
      const session = await open(owner);
      await exchange(directory, {
        mutationId: crypto.randomUUID(),
        type: "StartSession",
      });
      await successful(
        directoryCommand(owner, { action: "directory-lose-ack" })
      );
      const port = mutationPort(owner.sessionReference);
      const input = {
        intentKey: "c".repeat(64),
        key: scope === "account" ? owner.accountKey : owner.householdKey,
        scope,
      };
      let writes = 0;
      await expect(
        runOutputFencedMutation(port, input, () => {
          writes += 1;
          return Promise.resolve();
        })
      ).rejects.toThrow();
      expect(writes).toBe(0);
      expect(
        await successful(
          directoryCommand(owner, { action: "directory-lifecycle" })
        )
      ).toMatchObject({
        generation: directory.generation,
        status: "invalidated",
      });
      expect(
        await successful({
          action: "lifecycle",
          sessionReference: owner.sessionReference,
        })
      ).toMatchObject({
        generation: session.generation,
        status: "invalidated",
      });
      const retained = await port.beginMutation(input);
      await runtime.dispose();
      runtime = makeRuntime();
      expect(
        await port.readMutation({ ...input, operationId: retained.operationId })
      ).toEqual({ phase: "fencing" });
      await expectStatus(
        command(directoryCommand(owner, { action: "directory-begin" })),
        409
      );
      await runOutputFencedMutation(port, input, () => {
        writes += 1;
        return Promise.resolve();
      });
      expect(writes).toBe(1);
      const freshDirectory = await openDirectory(owner);
      expect(await listSessions(freshDirectory)).toMatchObject({
        reservations: [expect.objectContaining({ ordinal: 1 })],
      });
      const freshSession = await open(owner);
      expect(await history(freshSession)).toMatchObject({
        messages: [],
        state: { status: "open", version: 0 },
      });
      freshDirectory.socket.close();
      freshSession.socket.close();
    }
  );
});

describe("ordered native storage upgrade", () => {
  it.each(["fencing", "ready", "dispatched"] as const)(
    "preserves a baseline session registration and %s fence across migration and restart",
    async (phase) => {
      const session = await binding();
      const generation = crypto.randomUUID();
      const operationId = crypto.randomUUID();
      const intentKey = "d".repeat(64);
      await runtime.dispose();
      runtime = makeRuntime(legacyManifest);
      await successful({
        action: "seed",
        binding: session,
        generation,
        intentKey,
        operationId,
        phase,
        sessionReference: session.sessionReference,
      });
      await runtime.dispose();
      runtime = makeRuntime();
      const port = mutationPort(session.sessionReference);
      const operation = {
        key: session.accountKey,
        operationId,
        scope: "account" as const,
      };
      expect(await port.readMutation(operation)).toEqual({ phase });
      expect(
        await successful({
          action: "metadata",
          sessionReference: session.sessionReference,
        })
      ).toMatchObject({ ...session, status: "open", version: 0 });
      const intent = {
        intentKey,
        key: session.accountKey,
        scope: "account" as const,
      };
      expect(await port.beginMutation(intent)).toEqual({ operationId, phase });
      if (phase === "dispatched") {
        let writes = 0;
        await expect(
          runOutputFencedMutation(port, intent, () => {
            writes += 1;
            return Promise.resolve();
          })
        ).rejects.toThrow();
        expect(writes).toBe(0);
        await runOutputFencedMutation(
          port,
          { ...intent, intentKey: "f".repeat(64) },
          () => {
            writes += 1;
            return Promise.resolve();
          }
        );
        expect(writes).toBe(1);
        await runtime.dispose();
        runtime = makeRuntime();
        expect(await port.readMutation(operation)).toEqual({ phase });
        await expectStatus(
          command({
            action: "begin",
            binding: session,
            sessionReference: session.sessionReference,
          }),
          409
        );
        await successful(
          directoryCommand(session, { action: "directory-initialize" })
        );
        await expectStatus(
          command(directoryCommand(session, { action: "directory-begin" })),
          409
        );
        return;
      }
      await successful({
        action: "lose-ack",
        sessionReference: session.sessionReference,
      });
      // Failing the migrated session's ACK proves the old registration retained its session target.
      await expect(port.prepareMutation(operation)).rejects.toThrow();
      expect(await port.readMutation(operation)).toEqual({ phase });
      await expectStatus(
        command({
          action: "begin",
          binding: session,
          sessionReference: session.sessionReference,
        }),
        409
      );
      await runtime.dispose();
      runtime = makeRuntime();
      expect(await port.readMutation(operation)).toEqual({ phase });
      await port.prepareMutation(operation);
      await port.markDispatched(operation);
      await port.completeMutation(operation);
      const reopened = await open(session);
      expect(await history(reopened)).toMatchObject({
        messages: [],
        state: { status: "open", version: 0 },
      });
      const directory = await openDirectory(session);
      let writes = 0;
      await runOutputFencedMutation(
        port,
        {
          intentKey: "e".repeat(64),
          key: session.accountKey,
          scope: "account",
        },
        () => {
          writes += 1;
          return Promise.resolve();
        }
      );
      expect(writes).toBe(1);
      expect(
        await successful(
          directoryCommand(session, { action: "directory-lifecycle" })
        )
      ).toMatchObject({
        generation: directory.generation,
        status: "invalidated",
      });
      expect(
        await successful({
          action: "lifecycle",
          sessionReference: session.sessionReference,
        })
      ).toMatchObject({
        generation: reopened.generation,
        status: "invalidated",
      });
    }
  );
});

it("rejects expired directory and session reads or mutations without another client message", async () => {
  const owner = await binding();
  const expiresAt = Date.now() + 60_000;
  const directory = await openDirectory(owner, expiresAt);
  const session = await open(owner, expiresAt);
  await successful(
    directoryCommand(owner, {
      action: "directory-command-at-time",
      generation: directory.generation,
      now: expiresAt - 1,
      payload: JSON.stringify({
        afterOrdinal: 0,
        limit: 1,
        requestId: crypto.randomUUID(),
        type: "ListSessions",
      }),
    })
  );
  await expect.poll(() => directory.frames.length).toBe(2);
  await successful({
    action: "command-at-time",
    generation: session.generation,
    now: expiresAt - 1,
    payload: JSON.stringify({
      afterOrdinal: 0,
      limit: 1,
      requestId: crypto.randomUUID(),
      type: "ReadHistory",
    }),
    sessionReference: owner.sessionReference,
  });
  await expect.poll(() => session.frames.length).toBe(2);
  await successful(
    directoryCommand(owner, {
      action: "directory-command-at-time",
      generation: directory.generation,
      now: expiresAt,
      payload: JSON.stringify({
        mutationId: crypto.randomUUID(),
        type: "StartSession",
      }),
    })
  );
  await successful({
    action: "command-at-time",
    generation: session.generation,
    now: expiresAt,
    payload: JSON.stringify({
      expectedVersion: 0,
      mutationId: crypto.randomUUID(),
      text: "must-not-persist-after-expiry",
      type: "AppendParticipantMessage",
    }),
    sessionReference: owner.sessionReference,
  });
  expect(directory.frames).toHaveLength(2);
  expect(session.frames).toHaveLength(2);
  const freshDirectory = await openDirectory(owner);
  const freshSession = await open(owner);
  expect(await listSessions(freshDirectory)).toMatchObject({
    reservations: [],
  });
  expect(await history(freshSession)).toMatchObject({
    messages: [],
    state: { status: "open", version: 0 },
  });
  freshDirectory.socket.close();
  freshSession.socket.close();
});

it("bounds encoded history frames while retaining every long multibyte and escaped record", async () => {
  const session = await binding();
  const connection = await open(session);
  const ids: string[] = [];
  for (let index = 0; index < MAX_PAGE_SIZE; index += 1) {
    // eslint-disable-next-line no-await-in-loop -- Each optimistic version depends on the preceding committed receipt.
    const reply = await exchange(connection, {
      expectedVersion: index,
      mutationId: crypto.randomUUID(),
      text: "\u0000é".repeat(MAX_MESSAGE_LENGTH / 2),
      type: "AppendParticipantMessage",
    });
    if (reply.type !== "MessageAppended") {
      throw new Error("Expected append receipt");
    }
    ids.push(reply.message.id);
    expect(
      new TextEncoder().encode(JSON.stringify(reply)).byteLength
    ).toBeLessThanOrEqual(MAX_PRIVATE_FRAME_BYTES);
  }
  const retainedIds: string[] = [];
  let afterOrdinal = 0;
  let hasMore = true;
  while (hasMore) {
    // eslint-disable-next-line no-await-in-loop -- Each cursor comes from the preceding bounded physical frame.
    const page = await history(connection, afterOrdinal, MAX_PAGE_SIZE);
    if (page.type !== "HistoryRead") {
      throw new Error("Expected history page");
    }
    expect(page.messages.length).toBeGreaterThan(0);
    expect(
      new TextEncoder().encode(JSON.stringify(page)).byteLength
    ).toBeLessThanOrEqual(MAX_PRIVATE_FRAME_BYTES);
    retainedIds.push(...page.messages.map((message) => message.id));
    const last = page.messages.at(-1);
    if (last === undefined) {
      throw new Error("Expected nonempty history page");
    }
    afterOrdinal = last.ordinal;
    ({ hasMore } = page);
    expect(retainedIds.length).toBeLessThanOrEqual(MAX_PAGE_SIZE);
  }
  expect(retainedIds).toEqual(ids);
  connection.socket.close();
});

it("keeps fixture producers and directory HTTP, SDK, and storage capabilities absent from the production bundle", async () => {
  const productionManifest = await bundleWorkerFixture(
    fileURLToPath(new URL("private-output-worker.ts", import.meta.url)),
    temporaryDirectory
  );
  const fixtureRuntime = runtime;
  runtime = new Miniflare({
    cf: false,
    resourcePersistencePath: `${temporaryDirectory}/production-storage`,
    workers: [
      privateOutputControlWorker(manifest),
      privateOutputRuntimeWorker(productionManifest),
    ],
  });
  try {
    const owner = await binding();
    const session = await open(owner);
    const directory = await openDirectory(owner);
    await Promise.all(
      ["emit", "emit-at-time", "command-at-time", "lose-ack"].map((action) =>
        expectStatus(
          command({
            action,
            generation: session.generation,
            now: Date.now(),
            payload: "synthetic-producer-must-be-unavailable",
            sessionReference: owner.sessionReference,
          }),
          409
        )
      )
    );
    await Promise.all(
      [
        "directory-command-at-time",
        "directory-lose-ack",
        "directory-sql",
        "directory-state",
        "directory-context-sql",
      ].map((action) =>
        expectStatus(
          command(
            directoryCommand(owner, {
              action,
              generation: directory.generation,
              now: Date.now(),
              payload: JSON.stringify({
                mutationId: crypto.randomUUID(),
                type: "StartSession",
              }),
            })
          ),
          409
        )
      )
    );
    await expectStatus(
      command(directoryCommand(owner, { action: "directory-private-http" })),
      404
    );
    expect(await history(session)).toMatchObject({
      messages: [],
      state: { status: "open", version: 0 },
    });
    expect(await listSessions(directory)).toMatchObject({ reservations: [] });
    directory.socket.close();
    const forbiddenFrames = [
      { state: { private: "synthetic-private-state" }, type: "cf_agent_state" },
      { args: [], id: "private-probe", method: "commandAtTime", type: "rpc" },
      { type: "cf_agent_mcp_servers" },
      {
        messages: [{ content: "synthetic-private", role: "user" }],
        type: "cf_agent_chat_message",
      },
      {
        mutationId: crypto.randomUUID(),
        personId: "caller-supplied-person",
        type: "StartSession",
      },
    ];
    for (const forbidden of forbiddenFrames) {
      // eslint-disable-next-line no-await-in-loop -- Every probe needs a separately admitted physical generation after the prior close.
      const probe = await openDirectory(owner);
      const closed = Promise.withResolvers<number>();
      probe.socket.addEventListener("close", (event) =>
        closed.resolve(event.code)
      );
      probe.socket.send(JSON.stringify(forbidden));
      // eslint-disable-next-line no-await-in-loop -- Verify this exact generation closes before the next admission.
      expect(await closed.promise).toBe(1008);
      expect(probe.frames).toHaveLength(1);
    }
    const recovered = await openDirectory(owner);
    expect(await listSessions(recovered)).toMatchObject({ reservations: [] });
    expect(await history(session)).toMatchObject({
      messages: [],
      state: { status: "open", version: 0 },
    });
    recovered.socket.close();
    session.socket.close();
  } finally {
    await runtime.dispose();
    runtime = fixtureRuntime;
  }
}, 30_000);
