import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import type {
  DirectoryFrame,
  PrivateDiscoveryScope,
} from "@meal-planner/private-interview-api";
import {
  MAX_MESSAGE_LENGTH,
  MAX_PAGE_SIZE,
  MAX_PRIVATE_FRAME_BYTES,
  SessionFrame,
} from "@meal-planner/private-interview-api";
import { Schema } from "effect";
import { Miniflare, Response as LocalResponse } from "miniflare";
import type { WorkerdStructuredLog } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bundleWorkerFixture } from "../../test/native-worker.test-fixture.js";
import { emptyPrivateDiscoveryContinuityUpdates } from "./private-discovery-continuity.js";
import { encodeKimiCompletion } from "./private-discovery-kimi-stream.test-fixtures.js";
import type { PrivateOutputMutationPort } from "./private-output-binding.js";
import { runOutputFencedMutation } from "./private-output-mutation.js";
import {
  NativePrivateHistory,
  nativePrivateChatInput as nativeChatInput,
  requestNativePrivateChat,
} from "./private-output-native.test-fixture.js";
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
  model: "@cf/openai/gpt-oss-120b",
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
const begin = async (
  input: PrivateSessionBinding,
  discoveryScope: PrivateDiscoveryScope | null = "ProfileEdit"
) => {
  await successful({
    action: "initialize",
    binding: input,
    discoveryScope,
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
  expiresAt = Date.now() + 60_000,
  scope: PrivateDiscoveryScope | null = "ProfileEdit"
) => {
  const generation = await begin(input, scope);
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
  const probes: string[] = [];
  const Probe = Schema.Struct({
    text: Schema.String,
    type: Schema.Literal("PrivateTransportProbe"),
  });
  socket.addEventListener("message", (event) => {
    const value: unknown = JSON.parse(String(event.data));
    if (Schema.is(Probe)(value)) {
      probes.push(value.text);
    } else {
      frames.push(Schema.decodeUnknownSync(SessionFrame)(value));
    }
  });
  socket.accept();
  await expect
    .poll(() => frames.some((frame) => frame.type === "SessionReady"))
    .toBe(true);
  return {
    binding: input,
    frames,
    generation,
    get messages() {
      return probes;
    },
    probes,
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
const chatRequest = (
  connection: Connection,
  input: Parameters<typeof requestNativePrivateChat>[2]
) => requestNativePrivateChat(runtime, connection, input);
const readChat = async (connection: Connection) => {
  const response = await chatRequest(connection, { method: "GET" });
  expect(response.status, await response.clone().text()).toBe(200);
  return Schema.decodeUnknownSync(NativePrivateHistory)(await response.json());
};
const readMetadata = async (connection: Connection) => {
  const row = await successful<{
    status: "open" | "completed";
    version: number;
  }>({
    action: "metadata",
    sessionReference: connection.binding.sessionReference,
  });
  return { status: row.status, version: row.version };
};
const snapshot = async (connection: Connection) => ({
  ...(await readChat(connection)),
  state: await readMetadata(connection),
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
  findPendingMutation: (input) =>
    successful({ ...input, action: "mutation-find-pending", sessionReference }),
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
    await expect
      .poll(() => connection.probes)
      .toEqual(["synthetic-owner-still-connected"]);
    expect(await snapshot(connection)).toMatchObject({
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

const completedNativeResponse = () =>
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
                      proposals: [],
                      updates: emptyPrivateDiscoveryContinuityUpdates(),
                    },
                  }),
                  name: "submitDiscoveryTurn",
                },
                id: "call",
                type: "function",
              },
            ],
          },
        },
      ],
    }),
    { headers: { "content-type": "text/event-stream" } }
  );

describe("durable native private conversation", () => {
  let previousModelConfiguration: string | undefined;
  beforeAll(async () => {
    previousModelConfiguration = modelConfiguration;
    await runtime.dispose();
    modelConfiguration = syntheticModelConfig;
    runtime = makeRuntime();
  });
  afterAll(async () => {
    await runtime.dispose();
    modelConfiguration = previousModelConfiguration;
    runtime = makeRuntime();
  });

  it("replays an exact native run and completion receipt across restart without duplicate messages", async () => {
    modelCalls = [];
    modelResponse = () => Promise.resolve(completedNativeResponse());
    const session = await binding();
    const first = await open(session);
    const runId = `run-${crypto.randomUUID()}`;
    const text = "synthetic-retained-participant";
    const input = nativeChatInput(first, text, 0, runId);
    const initial = await chatRequest(first, { body: input, method: "POST" });
    expect(initial.status).toBe(200);
    expect(await initial.text()).toContain("RUN_FINISHED");
    const accepted = await readChat(first);
    expect(accepted).toMatchObject({
      activeRun: null,
      messages: [
        { parts: [{ content: text, type: "text" }], role: "user" },
        { role: "assistant" },
      ],
    });
    expect(await readMetadata(first)).toMatchObject({
      status: "open",
      version: 2,
    });

    // The caller loses its acknowledgement, then redelivers the same native run.
    await runtime.dispose();
    runtime = makeRuntime();
    const resumed = await open(session);
    expect(resumed.generation).not.toBe(first.generation);
    const replay = await chatRequest(resumed, { body: input, method: "POST" });
    expect(replay.status).toBe(200);
    expect(await replay.text()).toContain("RUN_FINISHED");
    expect(modelCalls).toHaveLength(1);
    expect(await readChat(resumed)).toEqual(accepted);
    await expectStatus(
      chatRequest(resumed, {
        body: nativeChatInput(resumed, "changed intent", 0, runId),
        method: "POST",
      }),
      409
    );

    const complete = {
      expectedVersion: 2,
      mutationId: crypto.randomUUID(),
      type: "CompleteSession",
    };
    const completed = await exchange(resumed, complete);
    expect(completed).toMatchObject({
      state: { status: "completed", version: 3 },
      type: "SessionCompleted",
    });
    await runtime.dispose();
    runtime = makeRuntime();
    const retained = await open(session);
    expect(await exchange(retained, complete)).toEqual(completed);
    expect(
      await exchange(retained, { ...complete, expectedVersion: 3 })
    ).toMatchObject({ reason: "mutation_collision", type: "Rejected" });
    const retainedReplay = await chatRequest(retained, {
      body: input,
      method: "POST",
    });
    expect(retainedReplay.status).toBe(200);
    await retainedReplay.text();
    await expectStatus(
      chatRequest(retained, {
        body: nativeChatInput(retained, "new completed-session message", 3),
        method: "POST",
      }),
      409
    );
    expect(await readChat(retained)).toEqual(accepted);
    expect(await readMetadata(retained)).toMatchObject({
      status: "completed",
      version: 3,
    });
    expect(modelCalls).toHaveLength(1);
    retained.socket.close();
  });

  it("shares a duplicate live run and admits only one competing next run with stable native history", async () => {
    modelCalls = [];
    const firstRelease = Promise.withResolvers<LocalResponse>();
    modelResponse = () => firstRelease.promise;
    const session = await binding();
    const connection = await open(session);
    const firstInput = nativeChatInput(connection, "first");
    const first = await chatRequest(connection, {
      body: firstInput,
      method: "POST",
    });
    expect(first.status).toBe(200);
    const firstBody = first.text();
    await expect.poll(() => modelCalls.length).toBe(1);
    const duplicate = await chatRequest(connection, {
      body: firstInput,
      method: "POST",
    });
    expect(duplicate.status).toBe(200);
    const duplicateBody = duplicate.text();
    expect(await readChat(connection)).toMatchObject({
      activeRun: { runId: firstInput.runId },
      messages: [{ parts: [{ content: "first", type: "text" }], role: "user" }],
    });
    expect(modelCalls).toHaveLength(1);
    firstRelease.resolve(completedNativeResponse());
    await Promise.all([firstBody, duplicateBody]);

    const secondRelease = Promise.withResolvers<LocalResponse>();
    modelResponse = () => secondRelease.promise;
    const competing = ["second", "competing"].map((text) =>
      nativeChatInput(connection, text, 2)
    );
    const responses = await Promise.all(
      competing.map((body) => chatRequest(connection, { body, method: "POST" }))
    );
    expect(responses.map((item) => item.status).toSorted()).toEqual([200, 409]);
    const winnerIndex = responses.findIndex((item) => item.status === 200);
    const winner = responses[winnerIndex];
    const winnerInput = competing[winnerIndex];
    if (winner === undefined || winnerInput === undefined) {
      throw new Error("Expected one admitted next native run");
    }
    const winnerBody = winner.text();
    await expect.poll(() => modelCalls.length).toBe(2);
    secondRelease.resolve(completedNativeResponse());
    await winnerBody;
    const beforeReconnect = await readChat(connection);
    expect(beforeReconnect.activeRun).toBeNull();
    expect(beforeReconnect.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    expect(beforeReconnect.messages[0]).toMatchObject({
      parts: [{ content: "first", type: "text" }],
    });
    expect(beforeReconnect.messages[2]).toMatchObject({
      parts: [
        { content: winnerIndex === 0 ? "second" : "competing", type: "text" },
      ],
    });
    expect(
      new Set(beforeReconnect.messages.map((message) => message.id)).size
    ).toBe(4);
    expect(await readMetadata(connection)).toMatchObject({
      status: "open",
      version: 4,
    });
    connection.socket.close();
    const resumed = await open(session);
    expect(await readChat(resumed)).toEqual(beforeReconnect);
    expect(modelCalls).toHaveLength(2);
    resumed.socket.close();
  });

  it("rejects a delayed old-generation POST and new messages after completion without retaining output", async () => {
    modelCalls = [];
    modelResponse = () => Promise.resolve(completedNativeResponse());
    const session = await binding();
    const first = await open(session);
    const release = Promise.withResolvers<null>();
    const delayed = release.promise.then(() =>
      chatRequest(first, {
        body: nativeChatInput(first, "must-never-persist"),
        method: "POST",
      })
    );
    expect(
      await exchange(first, {
        expectedVersion: 0,
        mutationId: crypto.randomUUID(),
        type: "CompleteSession",
      })
    ).toMatchObject({
      state: { status: "completed", version: 1 },
      type: "SessionCompleted",
    });
    const replacement = await open(session);
    release.resolve(null);
    const delayedResponse = await delayed;
    expect(delayedResponse.status).toBe(403);
    await expectStatus(
      chatRequest(replacement, {
        body: nativeChatInput(
          replacement,
          "completed-session-must-not-question",
          1
        ),
        method: "POST",
      }),
      409
    );
    expect(await readChat(replacement)).toMatchObject({
      activeRun: null,
      messages: [],
    });
    expect(await readMetadata(replacement)).toMatchObject({
      status: "completed",
      version: 1,
    });
    expect(modelCalls).toHaveLength(0);
    replacement.socket.close();
  });

  it.each(["post-first", "complete-first"] as const)(
    "commits only the valid completion admission order: %s",
    async (order) => {
      modelCalls = [];
      const release = Promise.withResolvers<LocalResponse>();
      modelResponse = () => release.promise;
      const session = await binding();
      const connection = await open(session);
      const body = nativeChatInput(connection, "racing participant");
      const complete = {
        expectedVersion: 0,
        mutationId: crypto.randomUUID(),
        type: "CompleteSession",
      };
      if (order === "post-first") {
        const admitted = await chatRequest(connection, {
          body,
          method: "POST",
        });
        expect(admitted.status).toBe(200);
        const settled = admitted.text();
        await expect.poll(() => modelCalls.length).toBe(1);
        expect(await exchange(connection, complete)).toMatchObject({
          reason: "assistant_turn_pending",
          type: "Rejected",
        });
        expect(await readMetadata(connection)).toMatchObject({
          status: "open",
          version: 1,
        });
        expect(await readChat(connection)).toMatchObject({
          activeRun: { runId: body.runId },
          messages: [
            {
              parts: [{ content: "racing participant", type: "text" }],
              role: "user",
            },
          ],
        });
        release.resolve(completedNativeResponse());
        await settled;
      } else {
        expect(await exchange(connection, complete)).toMatchObject({
          state: { status: "completed", version: 1 },
          type: "SessionCompleted",
        });
        await expectStatus(
          chatRequest(connection, { body, method: "POST" }),
          409
        );
        expect(await readChat(connection)).toMatchObject({
          activeRun: null,
          messages: [],
        });
        expect(await readMetadata(connection)).toMatchObject({
          status: "completed",
          version: 1,
        });
        expect(modelCalls).toHaveLength(0);
        release.resolve(completedNativeResponse());
      }
      connection.socket.close();
    }
  );

  it.each([
    "oversized text",
    "empty text",
    "assistant role",
    "negative version",
    "oversized run ID",
  ] as const)(
    "rejects native POST with %s before participant persistence",
    async (scenario) => {
      modelCalls = [];
      modelResponse = () => Promise.resolve(completedNativeResponse());
      const session = await binding();
      const connection = await open(session);
      const input = nativeChatInput(connection, "synthetic participant");
      const malformed = {
        "assistant role": {
          ...input,
          messages: input.messages.map((message) => ({
            ...message,
            role: "assistant",
          })),
        },
        "empty text": nativeChatInput(connection, ""),
        "negative version": nativeChatInput(
          connection,
          "synthetic participant",
          -1
        ),
        "oversized run ID": nativeChatInput(
          connection,
          "synthetic participant",
          0,
          "r".repeat(129)
        ),
        "oversized text": nativeChatInput(
          connection,
          "x".repeat(MAX_MESSAGE_LENGTH + 1)
        ),
      };
      await expectStatus(
        chatRequest(connection, { body: malformed[scenario], method: "POST" }),
        400
      );
      expect(await readChat(connection)).toMatchObject({
        activeRun: null,
        messages: [],
      });
      expect(await readMetadata(connection)).toMatchObject({
        status: "open",
        version: 0,
      });
      expect(modelCalls).toHaveLength(0);
      connection.socket.close();
    }
  );

  it("rejects foreign bindings, threads and generations without exposing or closing the owner's conversation", async () => {
    modelCalls = [];
    modelResponse = () => Promise.resolve(completedNativeResponse());
    const owner = await binding();
    const foreign = await binding();
    const connection = await open(owner);
    const text = `synthetic-private-${crypto.randomUUID()}`;
    const body = nativeChatInput(connection, text);
    const admitted = await chatRequest(connection, { body, method: "POST" });
    expect(admitted.status).toBe(200);
    await admitted.text();
    const retained = await readChat(connection);
    const denied = await Promise.all([
      chatRequest(connection, { binding: foreign, method: "GET" }),
      chatRequest(connection, {
        method: "GET",
        query: `?threadId=${foreign.sessionReference}`,
      }),
      chatRequest(connection, {
        generation: crypto.randomUUID(),
        method: "GET",
      }),
      chatRequest(connection, {
        body: {
          ...nativeChatInput(connection, "spoofed thread", 2),
          threadId: foreign.sessionReference,
        },
        method: "POST",
      }),
      chatRequest(connection, {
        body: nativeChatInput(connection, "stale generation", 2),
        generation: crypto.randomUUID(),
        method: "POST",
      }),
      chatRequest(connection, {
        generation: crypto.randomUUID(),
        method: "DELETE",
        query: `?runId=${body.runId}`,
      }),
    ]);
    expect(denied.map((item) => item.status)).toEqual([
      403, 403, 403, 403, 403, 403,
    ]);
    const deniedBodies = await Promise.all(denied.map((item) => item.text()));
    expect(deniedBodies.join("")).not.toContain(text);
    expect(await readChat(connection)).toEqual(retained);
    expect(await readMetadata(connection)).toMatchObject({
      status: "open",
      version: 2,
    });
    expect(modelCalls).toHaveLength(1);
    connection.socket.close();
  });

  it("rejects a malformed completion command before changing native history", async () => {
    const session = await binding();
    const connection = await open(session);
    const closed = Promise.withResolvers<number>();
    connection.socket.addEventListener("close", (event) =>
      closed.resolve(event.code)
    );
    connection.socket.send(
      JSON.stringify({
        expectedVersion: -1,
        mutationId: crypto.randomUUID(),
        type: "CompleteSession",
      })
    );
    expect(await closed.promise).toBe(1008);
    const fresh = await open(session);
    expect(await readChat(fresh)).toMatchObject({
      activeRun: null,
      messages: [],
    });
    expect(await readMetadata(fresh)).toMatchObject({
      status: "open",
      version: 0,
    });
    fresh.socket.close();
  });

  it("rejects oversized UTF-8 control frames before changing native history", async () => {
    const session = await binding();
    const connection = await open(session);
    const closed = Promise.withResolvers<number>();
    connection.socket.addEventListener("close", (event) =>
      closed.resolve(event.code)
    );
    connection.socket.send("é".repeat(MAX_PRIVATE_FRAME_BYTES));
    expect(await closed.promise).toBe(1009);
    const fresh = await open(session);
    expect(await readChat(fresh)).toMatchObject({
      activeRun: null,
      messages: [],
    });
    expect(await readMetadata(fresh)).toMatchObject({
      status: "open",
      version: 0,
    });
    fresh.socket.close();
  });

  it.each([
    "AppendParticipantMessage",
    "ReadHistory",
    "ReadAssistantTurn",
    "CancelAssistantTurn",
    "RetryAssistantTurn",
  ])(
    "rejects retired WebSocket chat command %s without changing canonical history",
    async (type) => {
      const selected = await binding();
      const connection = await open(selected);
      const closed = Promise.withResolvers<number>();
      connection.socket.addEventListener("close", (event) =>
        closed.resolve(event.code)
      );
      connection.socket.send(
        JSON.stringify({
          afterOrdinal: 0,
          expectedVersion: 0,
          limit: 25,
          mutationId: crypto.randomUUID(),
          requestId: crypto.randomUUID(),
          text: "Synthetic retired command",
          turnId: "run-retired",
          type,
        })
      );
      expect(await closed.promise).toBe(1008);
      const fresh = await open(selected);
      expect(await readChat(fresh)).toMatchObject({
        activeRun: null,
        messages: [],
      });
      expect(await readMetadata(fresh)).toEqual({ status: "open", version: 0 });
      fresh.socket.close();
    }
  );
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
    const start = {
      mutationId: crypto.randomUUID(),
      scope: "ProfileEdit",
      type: "StartSession",
    };
    const receipt = await exchange(first, start);
    expect(receipt).toMatchObject({
      reservation: {
        createdAt: expect.any(Number),
        ordinal: 1,
        scope: "ProfileEdit",
        sessionReference: expect.any(String),
      },
      type: "SessionStarted",
    });
    await runtime.dispose();
    runtime = makeRuntime();
    const resumed = await openDirectory(owner);
    expect(await exchange(resumed, start)).toEqual(receipt);
    expect(
      await exchange(resumed, { ...start, scope: "InitialDiscovery" })
    ).toMatchObject({ reason: "mutation_collision", type: "Rejected" });
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
      "scope",
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
        scope: "ProfileEdit",
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
      expect(await snapshot(freshSession)).toMatchObject({
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
      const reopened = await open(session, Date.now() + 60_000, null);
      expect(await snapshot(reopened)).toMatchObject({
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
      type: "ReadCards",
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
        scope: "ProfileEdit",
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
      type: "CompleteSession",
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
  expect(await snapshot(freshSession)).toMatchObject({
    messages: [],
    state: { status: "open", version: 0 },
  });
  freshDirectory.socket.close();
  freshSession.socket.close();
});

it("reconstructs every long multibyte and escaped native message with stable identities across restart", async () => {
  expect(modelConfiguration).toBeUndefined();
  modelCalls = [];
  const session = await binding();
  const connection = await open(session);
  const texts = Array.from(
    { length: MAX_PAGE_SIZE },
    (_, index) =>
      `${String(index).padStart(4, "0")}\u0000${"\u0000é".repeat((MAX_MESSAGE_LENGTH - 6) / 2)}`
  );
  for (const [index, text] of texts.entries()) {
    // eslint-disable-next-line no-await-in-loop -- Each admitted participant advances the next expected version.
    const failed = await chatRequest(connection, {
      body: nativeChatInput(connection, text, index),
      method: "POST",
    });
    // No model is configured: the participant remains canonical and the attempt settles as failed.
    expect(failed.status).toBe(400);
    // eslint-disable-next-line no-await-in-loop -- Release this response before the next durable admission.
    await failed.text();
  }
  const beforeRestart = await readChat(connection);
  expect(beforeRestart.activeRun).toBeNull();
  expect(beforeRestart.messages).toHaveLength(MAX_PAGE_SIZE);
  expect(beforeRestart.messages.map((message) => message.role)).toEqual(
    texts.map(() => "user")
  );
  expect(beforeRestart.messages.map((message) => message.parts)).toEqual(
    texts.map((content) => [{ content, type: "text" }])
  );
  const ids = beforeRestart.messages.map((message) => message.id);
  expect(new Set(ids).size).toBe(MAX_PAGE_SIZE);
  expect(
    new TextEncoder().encode(JSON.stringify(beforeRestart)).byteLength
  ).toBeGreaterThan(MAX_PRIVATE_FRAME_BYTES);
  expect(await readMetadata(connection)).toMatchObject({
    status: "open",
    version: MAX_PAGE_SIZE,
  });
  expect(modelCalls).toHaveLength(0);
  await runtime.dispose();
  runtime = makeRuntime();
  const resumed = await open(session);
  expect(await readChat(resumed)).toEqual(beforeRestart);
  expect(await readMetadata(resumed)).toMatchObject({
    status: "open",
    version: MAX_PAGE_SIZE,
  });
  expect(modelCalls).toHaveLength(0);
  resumed.socket.close();
}, 15_000);

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
                scope: "ProfileEdit",
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
    expect(await snapshot(session)).toMatchObject({
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
        scope: "ProfileEdit",
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
    expect(await snapshot(session)).toMatchObject({
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
