import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bundleWorkerFixture } from "../../test/native-worker.test-fixture.js";
import type { PrivateOutputMutationPort } from "./private-output-binding.js";
import { runOutputFencedMutation } from "./private-output-mutation.js";
import { privateOutputRuntimeWorker } from "./private-output-runtime.test-fixture.js";
import type { PrivateSessionBinding } from "./private-output.contract.js";
import { privateOutputKey } from "./private-output.contract.js";

let runtime: Miniflare;
let temporaryDirectory: string;
let manifest: Awaited<ReturnType<typeof bundleWorkerFixture>>;
const makeRuntime = () =>
  new Miniflare({
    cf: false,
    resourcePersistencePath: `${temporaryDirectory}/storage`,
    workers: [privateOutputRuntimeWorker(manifest)],
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
  runtime = makeRuntime();
}, 30_000);
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
  if (input["action"] === "connect") {
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
  const messages: unknown[] = [];
  socket.addEventListener("message", (event) => messages.push(event.data));
  socket.accept();
  return { generation, messages, socket };
};
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
    const connection = await open(session, Date.now() + 300);
    await emit(session, connection.generation, "synthetic-before-expiry");
    await delay(350);
    await emit(session, connection.generation, "synthetic-after-expiry");
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
    await successful({
      action: "complete",
      generation: connection.generation,
      sessionReference: session.sessionReference,
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
    ).toEqual({ ...session, status: "completed" });
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
    expect(connection.messages).toEqual(["synthetic-owner-still-connected"]);
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
    ).toEqual({ ...session, status: "open" });
  });

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
