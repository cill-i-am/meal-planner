import type * as NativeCloudflare from "@cloudflare/workers-types";
import { and, eq, gt, or } from "drizzle-orm";
import type { SQLiteAsyncDatabase } from "drizzle-orm/sqlite-core";
import { Schema } from "effect";

import type { PrivateDiscoveryModelEnvironment } from "./private-discovery-workers-ai.js";
import {
  Generation,
  PrivateOutputUnavailable,
} from "./private-output.contract.js";
import type {
  OutputLifecyclePort,
  OutputRegistration,
  PrivateParticipantBinding,
} from "./private-output.contract.js";
import { privateOutputGeneration } from "./private-output.database-schema.js";

declare const WebSocketPair: typeof NativeCloudflare.WebSocketPair;
declare const Response: typeof NativeCloudflare.Response;
export interface PrivateInterviewEnvironment
  extends Cloudflare.Env, PrivateDiscoveryModelEnvironment {
  readonly AccountOutputLifecycle: {
    readonly getByName: (name: string) => OutputLifecyclePort;
  };
  readonly HouseholdAgent: {
    readonly getByName: (name: string) => OutputLifecyclePort;
  };
}
type OutputSocket = Pick<
  NativeCloudflare.WebSocket,
  "close" | "deserializeAttachment" | "readyState" | "send"
>;
interface OutputSocketContext {
  readonly acceptWebSocket: (socket: NativeCloudflare.WebSocket) => void;
  readonly getWebSockets: () => readonly OutputSocket[];
}
type OutputSocketEnvironment = Pick<
  PrivateInterviewEnvironment,
  "AccountOutputLifecycle" | "HouseholdAgent"
>;

const socketSlot = 1;
const requestSlot = 2;
/** A private child owns this concrete native socket fence; it is never an RPC target. */
export class PrivateOutputSocket<TRunResult = unknown> {
  #context: OutputSocketContext;
  #database: SQLiteAsyncDatabase<"sync", TRunResult>;
  #environment: OutputSocketEnvironment;
  constructor(
    context: OutputSocketContext,
    database: SQLiteAsyncDatabase<"sync", TRunResult>,
    environment: OutputSocketEnvironment
  ) {
    this.#context = context;
    this.#database = database;
    this.#environment = environment;
  }
  restart() {
    const current = this.read();
    const sockets = this.#context.getWebSockets();
    const resumed = new Set<OutputSocket>();

    if (current?.status === "connected" && Date.now() < current.expiresAt) {
      for (const socket of sockets) {
        const attachment: unknown = socket.deserializeAttachment();
        if (
          socket.readyState === WebSocket.OPEN &&
          Schema.is(Generation)(attachment) &&
          attachment.generation === current.generation
        ) {
          resumed.add(socket);
        }
      }
    }
    if (resumed.size === 0) {
      this.#database
        .update(privateOutputGeneration)
        .set({ status: "invalidated" })
        .run();
    } else {
      this.#database
        .update(privateOutputGeneration)
        .set({ status: "invalidated" })
        .where(eq(privateOutputGeneration.singleton, requestSlot))
        .run();
    }
    for (const socket of sockets) {
      if (!resumed.has(socket)) {
        socket.close(1008, "Reauthentication required");
      }
    }
  }
  begin(
    binding: PrivateParticipantBinding,
    target: Omit<OutputRegistration, "generation">
  ) {
    const checkedResult: Promise<string> = this.#begin(
      binding,
      target,
      "pending"
    );
    return checkedResult;
  }
  /** The owning child verifies its immutable binding before requesting a lease. */
  beginRequest(
    binding: PrivateParticipantBinding,
    target: Omit<OutputRegistration, "generation">
  ) {
    const current = this.readRequest();
    if (current?.status === "request" && Date.now() < current.expiresAt) {
      const checkedResult: Promise<string> = Promise.resolve(
        current.generation
      );
      return checkedResult;
    }
    {
      const checkedResult: Promise<string> = this.#begin(
        binding,
        target,
        "pending_request"
      );
      return checkedResult;
    }
  }
  async #begin(
    binding: PrivateParticipantBinding,
    target: Omit<OutputRegistration, "generation">,
    status: "pending" | "pending_request"
  ) {
    const generation = crypto.randomUUID();
    const singleton = status === "pending" ? socketSlot : requestSlot;
    this.#database
      .insert(privateOutputGeneration)
      .values({ expiresAt: 0, generation, singleton, status })
      .onConflictDoUpdate({
        set: { expiresAt: 0, generation, status },
        target: privateOutputGeneration.singleton,
      })
      .run();
    if (status === "pending") {
      for (const socket of this.#context.getWebSockets()) {
        socket.close(1008, "Reauthentication required");
      }
    }
    try {
      const registration = { ...target, generation };
      const accountRegistered =
        await this.#environment.AccountOutputLifecycle.getByName(
          binding.accountKey
        ).register(registration);
      const householdRegistered =
        await this.#environment.HouseholdAgent.getByName(
          binding.householdKey
        ).register(registration);
      if (!accountRegistered || !householdRegistered) {
        throw new PrivateOutputUnavailable({ reason: "output_disabled" });
      }
      {
        const checkedResult: Awaited<Promise<string>> | Promise<string> =
          generation;
        return checkedResult;
      }
    } catch (error) {
      this.invalidate({ generation });
      throw error;
    }
  }
  authorize(generation: string, expiresAt: number) {
    if (expiresAt <= Date.now()) {
      throw new PrivateOutputUnavailable({ reason: "authority_unavailable" });
    }
    const updated = this.#database
      .update(privateOutputGeneration)
      .set({ expiresAt, status: "authorized" })
      .where(
        and(
          eq(privateOutputGeneration.generation, generation),
          eq(privateOutputGeneration.status, "pending")
        )
      )
      .returning()
      .get();
    if (updated === undefined) {
      throw new PrivateOutputUnavailable({ reason: "output_disabled" });
    }
  }
  /** Fresh authority may renew a live request lease, but cannot revive a stale grant. */
  authorizeRequest(generation: string, expiresAt: number) {
    const now = Date.now();
    if (expiresAt <= now) {
      throw new PrivateOutputUnavailable({ reason: "authority_unavailable" });
    }
    const updated = this.#database
      .update(privateOutputGeneration)
      .set({ expiresAt, status: "request" })
      .where(
        and(
          eq(privateOutputGeneration.generation, generation),
          or(
            eq(privateOutputGeneration.status, "pending_request"),
            and(
              eq(privateOutputGeneration.status, "request"),
              gt(privateOutputGeneration.expiresAt, now)
            )
          )
        )
      )
      .returning()
      .get();
    if (updated === undefined) {
      throw new PrivateOutputUnavailable({ reason: "output_disabled" });
    }
  }
  accept(request: Request | NativeCloudflare.Request, ready: string) {
    if (
      request.method !== "GET" ||
      request.headers.get("Upgrade")?.toLowerCase() !== "websocket"
    ) {
      const checkedResult: NativeCloudflare.Response = new Response(null, {
        status: 404,
      });
      return checkedResult;
    }
    const generation = request.headers.get("private-output-generation");
    const current = this.read();
    if (
      current?.status !== "authorized" ||
      current.generation !== generation ||
      Date.now() >= current.expiresAt
    ) {
      const checkedResult: NativeCloudflare.Response = new Response(null, {
        status: 403,
      });
      return checkedResult;
    }
    this.#database
      .update(privateOutputGeneration)
      .set({ status: "connected" })
      .where(eq(privateOutputGeneration.generation, generation))
      .run();
    const pair = new WebSocketPair();
    pair[1].serializeAttachment({ generation });
    this.#context.acceptWebSocket(pair[1]);
    this.send(generation, ready);
    {
      const checkedResult: NativeCloudflare.Response = new Response(null, {
        status: 101,
        webSocket: pair[0],
      });
      return checkedResult;
    }
  }
  admitted(socket: NativeCloudflare.WebSocket) {
    const { generation } = Schema.decodeUnknownSync(Generation)(
      socket.deserializeAttachment()
    );
    {
      const checkedResult: string | undefined = this.#isConnected(generation)
        ? generation
        : undefined;
      return checkedResult;
    }
  }
  isCurrent(generation: string) {
    const current = this.read(generation);
    {
      const checkedResult: boolean =
        (current?.status === "connected" || current?.status === "request") &&
        current.generation === generation &&
        Date.now() < current.expiresAt;
      return checkedResult;
    }
  }
  isRequestCurrent(generation: string) {
    const current = this.readRequest();
    {
      const checkedResult: boolean =
        current?.status === "request" &&
        current.generation === generation &&
        Date.now() < current.expiresAt;
      return checkedResult;
    }
  }
  #isConnected(generation: string) {
    const current = this.read();
    {
      const checkedResult: boolean =
        current?.status === "connected" &&
        current.generation === generation &&
        Date.now() < current.expiresAt;
      return checkedResult;
    }
  }
  send(generation: string, payload: string) {
    for (const socket of this.#context.getWebSockets()) {
      if (socket.readyState !== WebSocket.OPEN) {
        continue;
      }
      const attached = Schema.decodeUnknownSync(Generation)(
        socket.deserializeAttachment()
      );

      if (attached.generation === generation && this.#isConnected(generation)) {
        socket.send(payload);
      }
    }
  }
  invalidate(untrusted: typeof Generation.Type) {
    const { generation } = Schema.decodeUnknownSync(Generation, {
      onExcessProperty: "error",
    })(untrusted);
    this.#database
      .update(privateOutputGeneration)
      .set({ status: "invalidated" })
      .where(eq(privateOutputGeneration.generation, generation))
      .run();
    for (const socket of this.#context.getWebSockets()) {
      if (
        Schema.decodeUnknownSync(Generation)(socket.deserializeAttachment())
          .generation === generation
      ) {
        socket.close(1008, "Reauthentication required");
      }
    }
  }
  read(generation?: string) {
    return (
      this.#database
        .select()
        .from(privateOutputGeneration)
        .where(
          generation === undefined
            ? eq(privateOutputGeneration.singleton, socketSlot)
            : eq(privateOutputGeneration.generation, generation)
        )
        .get() ?? null
    );
  }
  readRequest() {
    return (
      this.#database
        .select()
        .from(privateOutputGeneration)
        .where(eq(privateOutputGeneration.singleton, requestSlot))
        .get() ?? null
    );
  }
}
