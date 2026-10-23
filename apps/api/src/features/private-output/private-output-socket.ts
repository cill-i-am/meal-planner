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
// Keep the existing browser slot stable across upgrades; request leases own a
// separate bounded slot and never replace a connected browser's authority.
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
  restart(): void {
    const current = this.read();
    const sockets = this.#context.getWebSockets();
    const resumed = new Set<OutputSocket>();
    // Hibernation preserves native sockets and their server-written attachments.
    // Keep only an already-connected, unexpired grant with a matching OPEN socket.
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
  ): Promise<string> {
    return this.#begin(binding, target, "pending");
  }
  /** The owning child verifies its immutable binding before requesting a lease. */
  beginRequest(
    binding: PrivateParticipantBinding,
    target: Omit<OutputRegistration, "generation">
  ): Promise<string> {
    const current = this.readRequest();
    if (current?.status === "request" && Date.now() < current.expiresAt) {
      return Promise.resolve(current.generation);
    }
    return this.#begin(binding, target, "pending_request");
  }
  async #begin(
    binding: PrivateParticipantBinding,
    target: Omit<OutputRegistration, "generation">,
    status: "pending" | "pending_request"
  ): Promise<string> {
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
      return generation;
    } catch (error) {
      this.invalidate({ generation });
      throw error;
    }
  }
  authorize(generation: string, expiresAt: number): void {
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
  authorizeRequest(generation: string, expiresAt: number): void {
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
  accept(
    request: Request | NativeCloudflare.Request,
    ready: string
  ): NativeCloudflare.Response {
    if (
      request.method !== "GET" ||
      request.headers.get("Upgrade")?.toLowerCase() !== "websocket"
    ) {
      return new Response(null, { status: 404 });
    }
    const generation = request.headers.get("private-output-generation");
    const current = this.read();
    if (
      current?.status !== "authorized" ||
      current.generation !== generation ||
      Date.now() >= current.expiresAt
    ) {
      return new Response(null, { status: 403 });
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
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  admitted(socket: NativeCloudflare.WebSocket): string | undefined {
    const { generation } = Schema.decodeUnknownSync(Generation)(
      socket.deserializeAttachment()
    );
    return this.#isConnected(generation) ? generation : undefined;
  }
  isCurrent(generation: string): boolean {
    const current = this.read(generation);
    return (
      (current?.status === "connected" || current?.status === "request") &&
      current.generation === generation &&
      Date.now() < current.expiresAt
    );
  }
  isRequestCurrent(generation: string): boolean {
    const current = this.readRequest();
    return (
      current?.status === "request" &&
      current.generation === generation &&
      Date.now() < current.expiresAt
    );
  }
  #isConnected(generation: string): boolean {
    const current = this.read();
    return (
      current?.status === "connected" &&
      current.generation === generation &&
      Date.now() < current.expiresAt
    );
  }
  send(generation: string, payload: string): void {
    for (const socket of this.#context.getWebSockets()) {
      if (socket.readyState !== WebSocket.OPEN) {
        continue;
      }
      const attached = Schema.decodeUnknownSync(Generation)(
        socket.deserializeAttachment()
      );
      // No promise or forwarding emitter intervenes between this read and native physical send.
      if (attached.generation === generation && this.#isConnected(generation)) {
        socket.send(payload);
      }
    }
  }
  invalidate(untrusted: typeof Generation.Type): void {
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
