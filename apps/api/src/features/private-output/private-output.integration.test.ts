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
import { Miniflare, Response as LocalResponse } from "miniflare";
import type { WorkerdStructuredLog } from "miniflare";
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
const syntheticModelConfig = JSON.stringify({
  gatewayId: "synthetic-local-only",
  inputUsdPerMillionTokens: 1,
  maxOutputTokens: 1000,
  model: "@cf/qwen/qwen3-30b-a3b-fp8",
  outputUsdPerMillionTokens: 2,
  timeoutMs: 5000,
});
let modelConfiguration: string | undefined;
let modelCalls: unknown[] = [];
const nativeLogs: WorkerdStructuredLog[] = [];
let modelResponse: () => Promise<LocalResponse> = () =>
  Promise.resolve(new LocalResponse(null, { status: 503 }));
const makeRuntime = (selectedManifest = manifest) => {
  const worker = privateOutputRuntimeWorker(selectedManifest);
  return new Miniflare({
    cf: false,
    handleStructuredLogs: (entry) => nativeLogs.push(entry),
    resourcePersistencePath: `${temporaryDirectory}/storage`,
    workers: [
      {
        config: {
          ...worker.config,
          env: {
            ...worker.config.env,
            PRIVATE_DISCOVERY_CONFIG: {
              type: "text" as const,
              value: modelConfiguration ?? "",
            },
          },
        },
        // Every fetch stays in this process. No network fallback, including unexpected URLs.
        dev: {
          outboundService: {
            handler: async (request) => {
              if (request.url !== "https://private-model.test/run") {
                throw new Error(
                  "External network is forbidden in private model tests"
                );
              }
              modelCalls.push(await request.json());
              return modelResponse();
            },
            type: "fetcher",
          },
        },
      },
    ],
  });
};

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
    await exchange(connection, {
      expectedVersion: 1,
      mutationId: crypto.randomUUID(),
      turnId: first.mutationId,
      type: "CancelAssistantTurn",
    });
    const competing = ["second", "competing"].map((text) => ({
      expectedVersion: 2,
      mutationId: crypto.randomUUID(),
      text,
      type: "AppendParticipantMessage",
    }));
    for (const input of competing) {
      connection.socket.send(JSON.stringify(input));
    }
    await expect.poll(() => connection.frames.length).toBe(6);
    expect(connection.frames.slice(4).map((frame) => frame.type)).toEqual([
      "MessageAppended",
      "Rejected",
    ]);
    expect(connection.frames[5]).toMatchObject({
      reason: "assistant_turn_pending",
      state: { version: 3 },
    });
    await exchange(connection, {
      expectedVersion: 3,
      mutationId: crypto.randomUUID(),
      turnId: competing[0]?.mutationId,
      type: "CancelAssistantTurn",
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
      state: { version: 5 },
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
          order === "append-first"
            ? "assistant_turn_pending"
            : "session_completed",
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
      expectedVersion: index * 2,
      mutationId: crypto.randomUUID(),
      text: "\u0000é".repeat(MAX_MESSAGE_LENGTH / 2),
      type: "AppendParticipantMessage",
    });
    if (reply.type !== "MessageAppended") {
      throw new Error("Expected append receipt");
    }
    // eslint-disable-next-line no-await-in-loop -- Explicit cancellation settles each queued model attempt before the next participant mutation.
    await exchange(connection, {
      expectedVersion: index * 2 + 1,
      mutationId: crypto.randomUUID(),
      turnId: reply.assistantTurn.id,
      type: "CancelAssistantTurn",
    });
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

const output = {
  message: "Which foods do you prefer?",
  proposals: [] as unknown[],
  summary: "The participant started their own discovery.",
};
type SyntheticOutput = Record<string, unknown>;
interface SyntheticUsage {
  completion_tokens: number;
  prompt_tokens: number;
}
const defaultUsage = { completion_tokens: 20, prompt_tokens: 100 };
const response = (
  result: SyntheticOutput = output,
  usage: SyntheticUsage | null = defaultUsage
) => {
  const completion = {
    choices: [
      {
        finish_reason: "stop",
        message: { content: JSON.stringify(result), role: "assistant" },
      },
    ],
  };
  return new LocalResponse(
    JSON.stringify(usage === null ? completion : { ...completion, usage }),
    { headers: { "content-type": "application/json" } }
  );
};
const emptyProfile = (session: PrivateSessionBinding) => ({
  audit: null,
  facts: [],
  personId: session.personId,
  version: 0,
});
describe("native adaptive assistant attempts through the production model adapter", () => {
  const queue = async (
    session: PrivateSessionBinding,
    connection: Connection,
    expectedVersion = 0
  ) => {
    const result = await exchange(connection, {
      expectedVersion,
      mutationId: crypto.randomUUID(),
      text: "I like tomatoes and want to discuss my own meals.",
      type: "AppendParticipantMessage",
    });
    if (result.type !== "MessageAppended") {
      throw new Error("Expected queued participant turn");
    }
    return {
      action: "run-turn",
      binding: session,
      generation: connection.generation,
      profile: emptyProfile(session),
      sessionReference: session.sessionReference,
      turnId: result.assistantTurn.id,
    };
  };
  const readTurn = (connection: Connection) =>
    exchange(connection, {
      requestId: crypto.randomUUID(),
      type: "ReadAssistantTurn",
    });
  const cards = (connection: Connection) =>
    exchange(connection, {
      afterOrdinal: 0,
      limit: 25,
      requestId: crypto.randomUUID(),
      type: "ReadCards",
    });
  const audit = (session: PrivateSessionBinding) =>
    successful<
      readonly {
        status: string;
        failure: string | null;
        usageJson: string | null;
        provenanceJson: string | null;
        summary: string | null;
      }[]
    >({ action: "turns", sessionReference: session.sessionReference });

  beforeAll(async () => {
    await runtime.dispose();
    modelConfiguration = syntheticModelConfig;
    runtime = makeRuntime();
  });
  afterAll(async () => {
    await runtime.dispose();
    modelConfiguration = undefined;
    runtime = makeRuntime();
  });

  const diagnosticsSince = (start: number) =>
    nativeLogs
      .slice(start)
      .filter((entry) =>
        entry.message.includes("private_discovery.invalid_output")
      );

  const expectDiagnostic = async (
    start: number,
    stage: string,
    privateValues: readonly string[] = []
  ) => {
    await expect.poll(() => diagnosticsSince(start)).toHaveLength(1);
    const logs = diagnosticsSince(start);
    expect(logs[0]?.level).toBe("log");
    expect(logs[0]?.message).toMatch(
      new RegExp(
        `^\\[\\d{2}:\\d{2}:\\d{2}\\.\\d{3}\\] WARN \\(#\\d+\\): private_discovery\\.invalid_output \\{ stage: '${stage}' \\}$`,
        "u"
      )
    );
    for (const value of privateValues) {
      expect(JSON.stringify(logs)).not.toContain(value);
    }
  };

  it.each([
    "response_envelope",
    "incomplete_completion",
    "output_json",
    "output_schema",
  ] as const)(
    "emits one safe %s diagnostic through the native adapter and keeps public failure unchanged",
    async (stage) => {
      modelCalls = [];
      const privateValue = `synthetic-private-${crypto.randomUUID()}`;
      modelResponse = () => {
        const content =
          stage === "output_json"
            ? `{${privateValue}`
            : JSON.stringify({
                ...output,
                message: privateValue,
                proposals: [{ _tag: privateValue }],
              });
        return Promise.resolve(
          new LocalResponse(
            JSON.stringify(
              stage === "response_envelope"
                ? { choices: privateValue }
                : {
                    choices: [
                      {
                        finish_reason:
                          stage === "incomplete_completion"
                            ? privateValue
                            : "stop",
                        message: { content, role: "assistant" },
                      },
                    ],
                    usage: defaultUsage,
                  }
            )
          )
        );
      };
      const session = await binding();
      const connection = await open(session);
      const attempt = await queue(session, connection);
      const start = nativeLogs.length;
      await successful(attempt);
      await expectDiagnostic(start, stage, [
        privateValue,
        session.personId,
        session.sessionReference,
        attempt.turnId,
      ]);
      const current = await readTurn(connection);
      expect(current).toMatchObject({
        turn: { failure: "invalid_output", status: "failed" },
      });
      if (current.type !== "AssistantTurnRead" || current.turn === null) {
        throw new Error("Expected failed assistant turn");
      }
      expect(Object.keys(current.turn).toSorted()).toEqual([
        "failure",
        "id",
        "sourceMessageId",
        "status",
      ]);
      expect(await cards(connection)).toMatchObject({ cards: [] });
      expect(await history(connection)).toMatchObject({
        messages: [expect.objectContaining({ role: "participant" })],
      });
      // Replaying the same terminal continuation emits neither another call nor another diagnostic.
      await successful(attempt);
      expect(modelCalls).toHaveLength(1);
      expect(diagnosticsSince(start)).toHaveLength(1);
      connection.socket.close();
    }
  );

  it("claims duplicate continuations once and atomically stores private output, summary and reviewed proposal", async () => {
    modelCalls = [];
    const release = Promise.withResolvers<LocalResponse>();
    modelResponse = () => release.promise;
    const session = await binding();
    const connection = await open(session);
    const attempt = await queue(session, connection);
    const first = successful(attempt);
    await expect.poll(() => modelCalls.length).toBe(1);
    const second = successful(attempt);
    await second;
    expect(await readTurn(connection)).toMatchObject({
      state: { version: 1 },
      turn: { id: attempt.turnId, status: "running" },
    });
    expect(
      await exchange(connection, {
        expectedVersion: 1,
        mutationId: crypto.randomUUID(),
        type: "CompleteSession",
      })
    ).toMatchObject({ reason: "assistant_turn_pending" });
    release.resolve(
      response({
        ...output,
        proposals: [
          {
            _tag: "ProposeProfileCard",
            change: {
              _tag: "AddConfirmedProfileFact",
              fact: {
                _tag: "FoodPreference",
                label: "tomatoes",
                sentiment: "like",
                targetKind: "ingredient",
              },
            },
          },
        ],
      })
    );
    await first;
    expect(modelCalls).toHaveLength(1);
    expect(await readTurn(connection)).toMatchObject({
      state: { version: 2 },
      turn: { failure: null, id: attempt.turnId, status: "succeeded" },
    });
    expect(await history(connection)).toMatchObject({
      messages: [
        expect.objectContaining({ role: "participant" }),
        expect.objectContaining({ role: "assistant", text: output.message }),
      ],
    });
    expect(await cards(connection)).toMatchObject({
      cards: [
        expect.objectContaining({
          expectedProfileVersion: 0,
          id: expect.any(String),
          ordinal: 1,
          reviewedFact: null,
          revision: 0,
          status: "proposed",
        }),
      ],
    });
    const retained = await audit(session);
    expect(retained).toHaveLength(1);
    expect(retained[0]).toMatchObject({
      status: "succeeded",
      summary: output.summary,
    });
    expect(JSON.parse(retained[0]?.usageJson ?? "null")).toMatchObject({
      inputTokens: 100,
      outputTokens: 20,
    });
    expect(JSON.parse(retained[0]?.provenanceJson ?? "null")).toMatchObject({
      provider: "cloudflare-workers-ai",
    });
    expect(
      JSON.stringify(
        await successful({
          action: "metadata",
          sessionReference: session.sessionReference,
        })
      )
    ).not.toContain(output.summary);
    const request = modelCalls[0] as {
      body: { messages: readonly { content: string }[] };
      gateway: unknown;
      extraHeaders: unknown;
    };
    expect(request.extraHeaders).toEqual({ "cf-aig-max-attempts": "1" });
    expect(request.gateway).toEqual({
      collectLog: false,
      id: "synthetic-local-only",
      skipCache: true,
    });
    const context = JSON.parse(request.body.messages[1]?.content ?? "null") as {
      profile: unknown;
      messages: readonly unknown[];
    };
    expect(context.profile).toEqual({ facts: [], version: 0 });
    expect(context.messages).toHaveLength(1);
    connection.socket.close();
  });

  it("cancels a running attempt and requires an explicit new retry before dispatching again", async () => {
    modelCalls = [];
    const release = Promise.withResolvers<LocalResponse>();
    modelResponse = () => release.promise;
    const session = await binding();
    const connection = await open(session);
    const attempt = await queue(session, connection);
    const running = successful(attempt);
    await expect.poll(() => modelCalls.length).toBe(1);
    const cancellation = {
      expectedVersion: 1,
      mutationId: crypto.randomUUID(),
      turnId: attempt.turnId,
      type: "CancelAssistantTurn",
    };
    const cancelled = await exchange(connection, cancellation);
    expect(cancelled).toMatchObject({
      state: { version: 2 },
      turn: { status: "cancelled" },
    });
    expect(await exchange(connection, cancellation)).toEqual(cancelled);
    release.resolve(response());
    await running;
    expect(await history(connection)).toMatchObject({
      messages: [expect.objectContaining({ role: "participant" })],
    });
    const retry = {
      expectedVersion: 2,
      mutationId: crypto.randomUUID(),
      turnId: attempt.turnId,
      type: "RetryAssistantTurn",
    };
    const retried = await exchange(connection, retry);
    expect(retried).toMatchObject({
      state: { version: 3 },
      turn: { id: retry.mutationId, status: "queued" },
    });
    expect(await exchange(connection, retry)).toEqual(retried);
    expect(modelCalls).toHaveLength(1);
    modelResponse = () => Promise.resolve(response(output, null));
    await successful({ ...attempt, turnId: retry.mutationId });
    expect(modelCalls).toHaveLength(2);
    expect(await readTurn(connection)).toMatchObject({
      state: { version: 4 },
      turn: { status: "succeeded" },
    });
    const attempts = await audit(session);
    // Stop precedes response headers, so cancellation discards the unread body and its unknown usage.
    expect(attempts[0]?.usageJson).toBeNull();
    expect(attempts[0]?.summary).toBeNull();
    expect(attempts.map((item) => item.status)).toEqual([
      "cancelled",
      "succeeded",
    ]);
    expect(JSON.parse(attempts[1]?.usageJson ?? "null")).toEqual({
      estimatedCostUsd: null,
      inputTokens: null,
      outputTokens: null,
    });
    connection.socket.close();
  });

  it.each(["account", "household"] as const)(
    "fences a late provider response during %s revocation",
    async (scope) => {
      modelCalls = [];
      const release = Promise.withResolvers<LocalResponse>();
      modelResponse = () => release.promise;
      const session = await binding();
      const connection = await open(session);
      const attempt = await queue(session, connection);
      const running = successful(attempt);
      await expect.poll(() => modelCalls.length).toBe(1);
      const key =
        scope === "account" ? session.accountKey : session.householdKey;
      const operation = await successful<{ operationId: string }>({
        action: "mutation-begin",
        intentKey: "a".repeat(64),
        key,
        scope,
        sessionReference: session.sessionReference,
      });
      await successful({
        action: "mutation-prepare",
        key,
        operationId: operation.operationId,
        scope,
        sessionReference: session.sessionReference,
      });
      release.resolve(response());
      await running;
      const retained = await audit(session);
      expect(retained[0]).toMatchObject({
        failure: "connection_lost",
        status: "interrupted",
      });
      expect(
        connection.frames
          .filter((frame) => frame.type === "AssistantTurnUpdated")
          .map((frame) => frame.turn.status)
      ).not.toContain("succeeded");
      expect(
        await successful({
          action: "metadata",
          sessionReference: session.sessionReference,
        })
      ).toMatchObject({ version: 1 });
      await successful({
        action: "mutation-complete",
        key,
        operationId: operation.operationId,
        scope,
        sessionReference: session.sessionReference,
      });
      const resumed = await open(session);
      expect(await history(resumed)).toMatchObject({
        messages: [expect.objectContaining({ role: "participant" })],
      });
      expect(await cards(resumed)).toMatchObject({ cards: [] });
      resumed.socket.close();
    }
  );

  it("does not dispatch a queued old-generation continuation after replacement", async () => {
    modelCalls = [];
    modelResponse = () => Promise.resolve(response());
    const session = await binding();
    const old = await open(session);
    const attempt = await queue(session, old);
    const current = await open(session);
    await successful(attempt);
    expect(modelCalls).toHaveLength(0);
    expect(await readTurn(current)).toMatchObject({
      turn: { failure: "connection_lost", status: "interrupted" },
    });
    current.socket.close();
  });

  it("interrupts queued work across restart and never silently resumes model activity", async () => {
    modelCalls = [];
    const session = await binding();
    const connection = await open(session);
    const attempt = await queue(session, connection);
    await runtime.dispose();
    runtime = makeRuntime();
    const resumed = await open(session);
    await successful(attempt);
    expect(await readTurn(resumed)).toMatchObject({
      state: { version: 1 },
      turn: { failure: "runtime_restarted", status: "interrupted" },
    });
    expect(modelCalls).toHaveLength(0);
    resumed.socket.close();
  });

  it.each([
    {
      result: {
        ...output,
        proposals: [
          {
            _tag: "ReviseProposedProfileCard",
            cardId: "00000000-0000-0000-0000-000000000000",
            change: {
              _tag: "AddConfirmedProfileFact",
              fact: { _tag: "NoKnownHardConstraints" },
            },
            expectedRevision: 0,
          },
        ],
      },
      stage: "proposal_revision_target",
      title: "a revision when no proposed card exists",
    },
    {
      result: {
        ...output,
        proposals: [
          {
            _tag: "ProposeProfileCard",
            change: {
              _tag: "RemoveOrdinaryProfileFact",
              factId: `fact_${crypto.randomUUID()}`,
            },
          },
        ],
      },
      stage: "proposal_unknown_fact",
      title: "unknown fact references",
    },
    {
      result: { ...output, actorId: "untrusted-model-actor" },
      stage: "output_schema",
      title: "untrusted authority fields",
    },
    {
      result: {
        ...output,
        proposals: [
          {
            _tag: "ProposeProfileCard",
            change: {
              _tag: "AddConfirmedProfileFact",
              fact: { _tag: "NoKnownHardConstraints" },
            },
          },
          {
            _tag: "ProposeProfileCard",
            change: {
              _tag: "AddConfirmedProfileFact",
              fact: { _tag: "NoKnownHardConstraints" },
            },
          },
        ],
      },
      stage: "proposal_duplicate",
      title: "duplicate proposals",
    },
  ])(
    "rejects $title without persisting partial output",
    async ({ result, stage }) => {
      const start = nativeLogs.length;
      modelCalls = [];
      const privateValue = `synthetic-private-${crypto.randomUUID()}`;
      modelResponse = () =>
        Promise.resolve(
          response({ ...result, message: privateValue, summary: privateValue })
        );
      const session = await binding();
      const connection = await open(session);
      await successful(await queue(session, connection));
      expect(await readTurn(connection)).toMatchObject({
        state: { version: 1 },
        turn: { failure: "invalid_output", status: "failed" },
      });
      expect(await cards(connection)).toMatchObject({ cards: [] });
      expect(await history(connection)).toMatchObject({
        messages: [expect.objectContaining({ role: "participant" })],
      });
      const retained = await audit(session);
      expect(JSON.parse(retained[0]?.usageJson ?? "null")).toMatchObject({
        inputTokens: 100,
        outputTokens: 20,
      });
      await expectDiagnostic(start, stage, [
        privateValue,
        session.personId,
        session.sessionReference,
      ]);
      connection.socket.close();
    }
  );
  it.each(["correct", "stale", "rejected", "duplicate"] as const)(
    "handles a model card revision with a %s target",
    async (target) => {
      modelCalls = [];
      const initialChange = {
        _tag: "AddConfirmedProfileFact",
        fact: {
          _tag: "FoodPreference",
          label: "tomatoes",
          sentiment: "like",
          targetKind: "ingredient",
        },
      };
      modelResponse = () =>
        Promise.resolve(
          response({
            ...output,
            proposals: [{ _tag: "ProposeProfileCard", change: initialChange }],
          })
        );
      const session = await binding();
      const connection = await open(session);
      await successful(await queue(session, connection));
      const initial = await cards(connection);
      if (initial.type !== "CardsRead" || initial.cards[0] === undefined) {
        throw new Error("Expected generated private card");
      }
      const [card] = initial.cards;
      let version = 2;
      if (target === "rejected") {
        await exchange(connection, {
          cardId: card.id,
          cardRevision: card.revision,
          expectedVersion: version,
          mutationId: crypto.randomUUID(),
          type: "RejectProfileCard",
        });
        version += 1;
      }
      const correctedChange = {
        ...initialChange,
        fact: { ...initialChange.fact, sentiment: "strong_dislike" },
      };
      modelResponse = () =>
        Promise.resolve(
          response({
            ...output,
            message: "I have corrected the proposal for your review.",
            proposals: Array.from(
              { length: target === "duplicate" ? 2 : 1 },
              () => ({
                _tag: "ReviseProposedProfileCard",
                cardId: card.id,
                change: correctedChange,
                expectedRevision:
                  target === "stale" ? card.revision + 1 : card.revision,
              })
            ),
          })
        );
      const diagnosticStart = nativeLogs.length;
      await successful(await queue(session, connection, version));
      if (target === "correct") {
        expect(diagnosticsSince(diagnosticStart)).toHaveLength(0);
      } else {
        await expectDiagnostic(
          diagnosticStart,
          target === "duplicate"
            ? "proposal_duplicate"
            : "proposal_revision_target",
          [card.id, session.personId]
        );
      }
      const retained = await cards(connection);
      if (retained.type !== "CardsRead") {
        throw new Error("Expected private cards");
      }
      expect(retained.cards).toHaveLength(1);
      expect(retained.cards[0]).toMatchObject({
        change: target === "correct" ? correctedChange : initialChange,
        id: card.id,
        ordinal: card.ordinal,
        revision: target === "correct" ? card.revision + 1 : card.revision,
        status: target === "rejected" ? "rejected" : "proposed",
      });
      expect(await readTurn(connection)).toMatchObject({
        turn: {
          failure: target === "correct" ? null : "invalid_output",
          status: target === "correct" ? "succeeded" : "failed",
        },
      });
      const request = modelCalls[1] as {
        body: { messages: readonly { content: string }[] };
      };
      const context = JSON.parse(
        request.body.messages[1]?.content ?? "null"
      ) as { cards: readonly unknown[]; summary: string };
      expect(context.cards).toEqual([
        expect.objectContaining({ id: card.id, revision: card.revision }),
      ]);
      expect(context.summary).toBe(output.summary);
      connection.socket.close();
    }
  );

  it("interrupts a running attempt when its actual WebSocket closes", async () => {
    modelCalls = [];
    const release = Promise.withResolvers<LocalResponse>();
    modelResponse = () => release.promise;
    const session = await binding();
    const connection = await open(session);
    const attempt = await queue(session, connection);
    const running = successful(attempt);
    await expect.poll(() => modelCalls.length).toBe(1);
    connection.socket.close();
    await expect
      .poll(async () => {
        const turns = await audit(session);
        return turns[0]?.status;
      })
      .toBe("interrupted");
    release.resolve(response());
    await running;
    const resumed = await open(session);
    expect(await history(resumed)).toMatchObject({
      messages: [expect.objectContaining({ role: "participant" })],
      state: { version: 1 },
    });
    resumed.socket.close();
  });

  it("keeps a huge own profile intact and fails before dispatch when context cannot fit", async () => {
    modelCalls = [];
    modelResponse = () => Promise.resolve(response());
    const session = await binding();
    const connection = await open(session);
    const attempt = await queue(session, connection);
    const facts = Array.from({ length: 200 }, (_, index) => ({
      createdAtEpochMs: 0,
      createdBy: "a".repeat(64),
      createdInVersion: 1,
      id: `fact_${crypto.randomUUID()}`,
      source: "manual_ui",
      standing: { _tag: "confirmed", basis: "self" },
      updatedAtEpochMs: 0,
      updatedBy: "a".repeat(64),
      updatedInVersion: 1,
      value: {
        _tag: "HardConstraint",
        category: "allergen",
        handling: "exclude",
        label: `synthetic allergen ${index} ${"x".repeat(90)}`,
      },
    }));
    await successful({
      ...attempt,
      profile: { ...attempt.profile, facts, version: 1 },
    });
    expect(modelCalls).toHaveLength(0);
    expect(await readTurn(connection)).toMatchObject({
      turn: { failure: "context_limit", status: "failed" },
    });
    connection.socket.close();
  });
  it.each([
    "ordinary-safety-removal",
    "reviewed-safety-reduction",
    "ordinary-strong-dislike",
    "redundant-confirmation",
  ] as const)("matches canonical profile policy for %s", async (scenario) => {
    modelCalls = [];
    const session = await binding();
    const connection = await open(session);
    const attempt = await queue(session, connection);
    const value =
      scenario === "ordinary-strong-dislike"
        ? {
            _tag: "FoodPreference",
            label: "tomatoes",
            sentiment: "strong_dislike",
            targetKind: "ingredient",
          }
        : {
            _tag: "HardConstraint",
            category: "allergen",
            handling: "exclude",
            label: "peanuts",
          };
    const fact = {
      createdAtEpochMs: 0,
      createdBy: "a".repeat(64),
      createdInVersion: 1,
      id: `fact_${crypto.randomUUID()}`,
      source: "manual_ui",
      standing: { _tag: "confirmed", basis: "self" },
      updatedAtEpochMs: 0,
      updatedBy: "a".repeat(64),
      updatedInVersion: 1,
      value,
    };
    const changes = {
      "ordinary-safety-removal": {
        _tag: "RemoveOrdinaryProfileFact",
        factId: fact.id,
      },
      "ordinary-strong-dislike": {
        _tag: "RemoveOrdinaryProfileFact",
        factId: fact.id,
      },
      "redundant-confirmation": { _tag: "ConfirmProfileFact", factId: fact.id },
      "reviewed-safety-reduction": {
        _tag: "ConfirmHardConstraintReduction",
        factId: fact.id,
        replacement: null,
      },
    };
    const change = changes[scenario];
    modelResponse = () =>
      Promise.resolve(
        response({
          ...output,
          proposals: [{ _tag: "ProposeProfileCard", change }],
        })
      );
    const diagnosticStart = nativeLogs.length;
    await successful({
      ...attempt,
      profile: { ...attempt.profile, facts: [fact], version: 1 },
    });
    const rejected =
      scenario === "ordinary-safety-removal" ||
      scenario === "redundant-confirmation";
    if (rejected) {
      await expectDiagnostic(
        diagnosticStart,
        scenario === "redundant-confirmation"
          ? "proposal_already_confirmed"
          : "proposal_fact_kind",
        [fact.id, session.personId]
      );
    } else {
      expect(diagnosticsSince(diagnosticStart)).toHaveLength(0);
    }
    expect(await readTurn(connection)).toMatchObject({
      turn: {
        failure: rejected ? "invalid_output" : null,
        status: rejected ? "failed" : "succeeded",
      },
    });
    expect(await cards(connection)).toMatchObject({
      cards: rejected
        ? []
        : [
            expect.objectContaining({
              change,
              expectedProfileVersion: 1,
              reviewedFact: value,
              status: "proposed",
            }),
          ],
    });
    connection.socket.close();
  });

  it.each(["refused", "provider_unavailable"] as const)(
    "retains a %s attempt without implicit provider retry",
    async (failure) => {
      modelCalls = [];
      modelResponse = () =>
        Promise.resolve(
          failure === "provider_unavailable"
            ? new LocalResponse(null, { status: 503 })
            : new LocalResponse(
                JSON.stringify({
                  choices: [
                    {
                      finish_reason: "stop",
                      message: {
                        content: null,
                        refusal: "Synthetic refusal",
                        role: "assistant",
                      },
                    },
                  ],
                  usage: defaultUsage,
                })
              )
        );
      const session = await binding();
      const connection = await open(session);
      const attempt = await queue(session, connection);
      await successful(attempt);
      await successful(attempt);
      expect(modelCalls).toHaveLength(1);
      expect(await readTurn(connection)).toMatchObject({
        turn: { failure, status: "failed" },
      });
      const retained = await audit(session);
      expect(JSON.parse(retained[0]?.provenanceJson ?? "null")).toMatchObject({
        model: "@cf/qwen/qwen3-30b-a3b-fp8",
        provider: "cloudflare-workers-ai",
      });
      expect(await history(connection)).toMatchObject({
        messages: [expect.objectContaining({ role: "participant" })],
      });
      connection.socket.close();
    }
  );

  it("rejects a foreign profile before any model call and preserves the rightful queued attempt", async () => {
    modelCalls = [];
    modelResponse = () => Promise.resolve(response());
    const session = await binding();
    const connection = await open(session);
    const attempt = await queue(session, connection);
    await expectStatus(
      command({
        ...attempt,
        profile: {
          ...attempt.profile,
          personId: `person_${crypto.randomUUID()}`,
        },
      }),
      409
    );
    expect(modelCalls).toHaveLength(0);
    expect(await readTurn(connection)).toMatchObject({
      turn: { status: "queued" },
    });
    await successful(attempt);
    expect(modelCalls).toHaveLength(1);
    expect(await readTurn(connection)).toMatchObject({
      turn: { status: "succeeded" },
    });
    connection.socket.close();
  });
  it("retains dispatch provenance when a running attempt loses its runtime", async () => {
    modelCalls = [];
    const release = Promise.withResolvers<LocalResponse>();
    modelResponse = () => release.promise;
    const session = await binding();
    const connection = await open(session);
    const attempt = await queue(session, connection);
    const running = command(attempt).then(
      () => "finished",
      () => "runtime-stopped"
    );
    await expect.poll(() => modelCalls.length).toBe(1);
    const dispatched = await audit(session);
    expect(dispatched[0]?.status).toBe("running");
    expect(JSON.parse(dispatched[0]?.provenanceJson ?? "null")).toMatchObject({
      model: "@cf/qwen/qwen3-30b-a3b-fp8",
    });
    await runtime.dispose();
    release.resolve(response());
    await running;
    runtime = makeRuntime();
    const resumed = await open(session);
    const retained = await audit(session);
    expect(retained[0]).toMatchObject({
      failure: "runtime_restarted",
      status: "interrupted",
      summary: null,
      usageJson: null,
    });
    expect(retained[0]?.provenanceJson).toBe(dispatched[0]?.provenanceJson);
    expect(modelCalls).toHaveLength(1);
    expect(await history(resumed)).toMatchObject({
      messages: [expect.objectContaining({ role: "participant" })],
      state: { version: 1 },
    });
    resumed.socket.close();
  });
});
