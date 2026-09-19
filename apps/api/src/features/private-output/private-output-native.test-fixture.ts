import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { PersonProfile } from "@meal-planner/household-api";
import {
  AssistantTurnId,
  ParticipantMessageText,
  SessionFrame,
} from "@meal-planner/private-interview-api";
import type {
  DirectoryFrame,
  PrivateDiscoveryScope,
} from "@meal-planner/private-interview-api";
import { Schema } from "effect";
import { Miniflare, Response as LocalResponse } from "miniflare";
import type { WorkerdStructuredLog } from "miniflare";
import { expect } from "vitest";

import { bundleWorkerFixture } from "../../test/native-worker.test-fixture.js";
import { privateOutputRuntimeWorker } from "./private-output-runtime.test-fixture.js";
import { privateOutputKey } from "./private-output.contract.js";
import type { PrivateSessionBinding } from "./private-output.contract.js";
import type { privateAssistantTurns } from "./private-output.database-schema.js";

export const syntheticPrivateDiscoveryConfiguration = JSON.stringify({
  gatewayId: "synthetic-local-only",
  inputUsdPerMillionTokens: 1,
  maxOutputTokens: 65_536,
  model: "@cf/moonshotai/kimi-k2.6",
  outputUsdPerMillionTokens: 2,
  timeoutMs: 30_000,
});
export const NativePrivateHistory = Schema.Struct({
  activeRun: Schema.NullOr(Schema.Struct({ runId: AssistantTurnId })),
  messages: Schema.Array(
    Schema.Struct({
      createdAt: Schema.optional(Schema.String),
      id: Schema.String,
      parts: Schema.Array(
        Schema.Struct({
          content: ParticipantMessageText,
          type: Schema.Literal("text"),
        })
      ),
      role: Schema.Literals(["user", "assistant"]),
    })
  ),
});
export type NativePrivateHistory = typeof NativePrivateHistory.Type;
export interface PrivateNativeConnection {
  readonly binding: PrivateSessionBinding;
  readonly frames: SessionFrame[];
  readonly generation: string;
  readonly probes: string[];
  readonly socket: NonNullable<
    Awaited<ReturnType<Miniflare["dispatchFetch"]>>["webSocket"]
  >;
}
type ControlInput = Record<string, unknown> & {
  readonly sessionReference: string;
};
export const nativePrivateChatInput = (
  connection: Pick<PrivateNativeConnection, "binding">,
  text: string,
  expectedVersion = 0,
  runId = `run-${crypto.randomUUID()}`
) => ({
  context: [],
  forwardedProps: { expectedVersion },
  messages: [{ content: text, id: crypto.randomUUID(), role: "user" }],
  runId,
  state: {},
  threadId: connection.binding.sessionReference,
  tools: [],
});
export const nativeMessageText = (
  message: NativePrivateHistory["messages"][number]
) => message.parts.map((part) => part.content).join("");

interface ChatRequestOptions {
  method: "GET" | "POST" | "DELETE";
  body?: unknown;
  query?: string;
  cursor?: string;
  profile?: PersonProfile;
  binding?: PrivateSessionBinding;
  generation?: string;
}
export const requestNativePrivateChat = (
  runtime: Miniflare,
  connection: Pick<PrivateNativeConnection, "binding" | "generation">,
  input: ChatRequestOptions
) => {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-test-command": JSON.stringify({
      action: "chat",
      binding: input.binding ?? connection.binding,
      generation: input.generation ?? connection.generation,
      profile: input.profile ?? {
        audit: null,
        facts: [],
        personId: connection.binding.personId,
        version: 0,
      },
      sessionReference: connection.binding.sessionReference,
    }),
  };
  if (input.cursor !== undefined) {
    headers["Last-Event-ID"] = input.cursor;
  }
  const init: NonNullable<Parameters<Miniflare["dispatchFetch"]>[1]> = {
    headers,
    method: input.method,
  };
  if (input.body !== undefined) {
    init.body = JSON.stringify(input.body);
  }
  return runtime.dispatchFetch(
    `https://private-output.test/control${input.query ?? ""}`,
    init
  );
};

const makeNativeBinding = async (): Promise<PrivateSessionBinding> => ({
  accountKey: await privateOutputKey("account", crypto.randomUUID()),
  householdKey: await privateOutputKey("household", crypto.randomUUID()),
  linkageSubject: "a".repeat(64),
  personId: `person_${crypto.randomUUID()}`,
  sessionReference: crypto.randomUUID(),
});

const exchangeNativeCommand = async (
  connection: Pick<PrivateNativeConnection, "socket"> & {
    readonly frames: (SessionFrame | DirectoryFrame)[];
  },
  input: Record<string, unknown> & {
    type: string;
    mutationId?: string;
    requestId?: string;
  }
) => {
  const start = connection.frames.length;
  const id = input.mutationId ?? input.requestId;
  const find = () =>
    connection.frames
      .slice(start)
      .find(
        (frame) =>
          ("mutationId" in frame && frame.mutationId === id) ||
          ("requestId" in frame && frame.requestId === id) ||
          ("commandId" in frame && frame.commandId === id)
      );
  connection.socket.send(JSON.stringify(input));
  await expect.poll(find).toBeDefined();
  const frame = find();
  if (frame === undefined) {
    throw new Error("Expected domain command receipt");
  }
  return frame;
};

const unavailableModelResponse = () => new LocalResponse(null, { status: 503 });

/** Direct native transports and disposable storage for private-output integration tests. */
export const makePrivateOutputHarness = () => {
  let runtime: Miniflare;
  let temporaryDirectory: string;
  let manifest: Awaited<ReturnType<typeof bundleWorkerFixture>>;
  let configuration: string | undefined;
  let modelResponse: () => LocalResponse | Promise<LocalResponse> =
    unavailableModelResponse;
  const calls: unknown[] = [];
  const logs: WorkerdStructuredLog[] = [];
  const makeRuntime = () => {
    const worker = privateOutputRuntimeWorker(manifest);
    return new Miniflare({
      cf: false,
      handleStructuredLogs: (entry) => logs.push(entry),
      resourcePersistencePath: `${temporaryDirectory}/storage`,
      workers: [
        {
          config: {
            ...worker.config,
            env: {
              ...worker.config.env,
              PRIVATE_DISCOVERY_CONFIG: {
                type: "text",
                value: configuration ?? "",
              },
            },
          },
          dev: {
            outboundService: {
              handler: async (request) => {
                if (request.url !== "https://private-model.test/run") {
                  throw new Error(
                    "External network is forbidden in private model tests"
                  );
                }
                calls.push(await request.json());
                return modelResponse();
              },
              type: "fetcher",
            },
          },
        },
      ],
    });
  };
  const command = (input: ControlInput) => {
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
  const successful = async <A>(input: ControlInput): Promise<A> => {
    const response = await command(input);
    expect(response.status, await response.clone().text()).toBe(200);
    return ((await response.json()) as { result: A }).result;
  };
  const metadata = (binding: PrivateSessionBinding) =>
    successful<
      PrivateSessionBinding & { status: "open" | "completed"; version: number }
    >({ action: "metadata", sessionReference: binding.sessionReference });
  const turns = (binding: PrivateSessionBinding) =>
    successful<(typeof privateAssistantTurns.$inferSelect)[]>({
      action: "turns",
      sessionReference: binding.sessionReference,
    });
  const open = async (
    selected: PrivateSessionBinding,
    options: { scope?: PrivateDiscoveryScope | null; expiresAt?: number } = {}
  ): Promise<PrivateNativeConnection> => {
    await successful({
      action: "initialize",
      binding: selected,
      discoveryScope:
        options.scope === undefined ? "ProfileEdit" : options.scope,
      sessionReference: selected.sessionReference,
    });
    const generation = await successful<string>({
      action: "begin",
      binding: selected,
      sessionReference: selected.sessionReference,
    });
    await successful({
      action: "authorize",
      binding: selected,
      expiresAt: options.expiresAt ?? Date.now() + 60_000,
      generation,
      sessionReference: selected.sessionReference,
    });
    const response = await command({
      action: "connect",
      generation,
      sessionReference: selected.sessionReference,
    });
    expect(response.status).toBe(101);
    const socket = response.webSocket;
    if (socket === null) {
      throw new Error("Expected the native private WebSocket");
    }
    const frames: SessionFrame[] = [];
    const probes: string[] = [];
    const probe = Schema.Struct({
      text: Schema.String,
      type: Schema.Literal("PrivateTransportProbe"),
    });
    socket.addEventListener("message", (event) => {
      const value: unknown = JSON.parse(String(event.data));
      if (Schema.is(probe)(value)) {
        probes.push(value.text);
      } else {
        frames.push(Schema.decodeUnknownSync(SessionFrame)(value));
      }
    });
    socket.accept();
    await expect
      .poll(() => frames.some((frame) => frame.type === "SessionReady"))
      .toBe(true);
    return { binding: selected, frames, generation, probes, socket };
  };
  const chatRequest = (
    connection: PrivateNativeConnection,
    input: ChatRequestOptions
  ) => requestNativePrivateChat(runtime, connection, input);
  const hydrate = async (connection: PrivateNativeConnection) => {
    const response = await chatRequest(connection, { method: "GET" });
    expect(response.status, await response.clone().text()).toBe(200);
    return Schema.decodeUnknownSync(NativePrivateHistory)(
      await response.json()
    );
  };
  const startTurn = async (
    connection: PrivateNativeConnection,
    options: {
      text?: string;
      expectedVersion?: number;
      runId?: string;
      profile?: PersonProfile;
    } = {}
  ) => {
    const input = nativePrivateChatInput(
      connection,
      options.text ?? "I like tomatoes and want to discuss my own meals.",
      options.expectedVersion ?? 0,
      options.runId
    );
    const profile =
      options.profile ??
      Schema.decodeUnknownSync(PersonProfile)({
        audit: null,
        facts: [],
        personId: connection.binding.personId,
        version: 0,
      });
    const response = await chatRequest(connection, {
      body: input,
      method: "POST",
      profile,
    });
    return {
      binding: connection.binding,
      finished: response.text(),
      generation: connection.generation,
      input,
      profile,
      response,
      sessionReference: connection.binding.sessionReference,
      turnId: input.runId,
    };
  };
  return {
    binding: makeNativeBinding,
    calls,
    chatRequest,
    clearCalls: () => {
      calls.length = 0;
    },
    command,
    exchange: exchangeNativeCommand,
    getRuntime: () => runtime,
    hydrate,
    logs,
    metadata,
    open,
    restart: async () => {
      await runtime.dispose();
      runtime = makeRuntime();
    },
    setConfiguration: async (value: string | undefined) => {
      configuration = value;
      await runtime.dispose();
      runtime = makeRuntime();
    },
    setModelResponse: (response: typeof modelResponse) => {
      modelResponse = response;
    },
    start: async () => {
      temporaryDirectory = await mkdtemp(
        `${tmpdir()}/meal-planner-private-native-`
      );
      manifest = await bundleWorkerFixture(
        fileURLToPath(
          new URL("private-output-control.test-fixture.ts", import.meta.url)
        ),
        temporaryDirectory
      );
      runtime = makeRuntime();
    },
    startTurn,
    stop: async () => {
      await runtime.dispose();
      await rm(temporaryDirectory, { force: true, recursive: true });
    },
    successful,
    turns,
  };
};
