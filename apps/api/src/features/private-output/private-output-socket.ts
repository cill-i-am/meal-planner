import type * as NativeCloudflare from "@cloudflare/workers-types";
import { and, eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/durable-sqlite";
import { Schema } from "effect";

import { PrivateOutputUnavailable } from "./private-output.contract.js";
import type {
  OutputLifecyclePort,
  OutputRegistration,
  PrivateParticipantBinding,
} from "./private-output.contract.js";
import { privateOutputGeneration } from "./private-output.database-schema.js";

declare const WebSocketPair: typeof NativeCloudflare.WebSocketPair;
declare const Response: typeof NativeCloudflare.Response;
export const Generation = Schema.Struct({
  generation: Schema.String.pipe(Schema.check(Schema.isUUID())),
});
export interface PrivateInterviewEnvironment {
  readonly AccountOutputLifecycle: {
    readonly getByName: (name: string) => OutputLifecyclePort;
  };
  readonly HouseholdAgent: {
    readonly getByName: (name: string) => OutputLifecyclePort;
  };
}
/** A private child owns this concrete native socket fence; it is never an RPC target. */
export class PrivateOutputSocket {
  #context: NativeCloudflare.DurableObjectState;
  #database: ReturnType<typeof drizzle>;
  #environment: PrivateInterviewEnvironment;
  constructor(
    context: NativeCloudflare.DurableObjectState,
    database: ReturnType<typeof drizzle>,
    environment: PrivateInterviewEnvironment
  ) {
    this.#context = context;
    this.#database = database;
    this.#environment = environment;
  }
  restart(): void {
    this.#database
      .update(privateOutputGeneration)
      .set({ status: "invalidated" })
      .run();
    for (const socket of this.#context.getWebSockets()) {
      socket.close(1008, "Reauthentication required");
    }
  }
  async begin(
    binding: PrivateParticipantBinding,
    target: Omit<OutputRegistration, "generation">
  ): Promise<string> {
    const generation = crypto.randomUUID();
    this.#database
      .insert(privateOutputGeneration)
      .values({ expiresAt: 0, generation, singleton: 1, status: "pending" })
      .onConflictDoUpdate({
        set: { expiresAt: 0, generation, status: "pending" },
        target: privateOutputGeneration.singleton,
      })
      .run();
    for (const socket of this.#context.getWebSockets()) {
      socket.close(1008, "Reauthentication required");
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
    return this.isCurrent(generation) ? generation : undefined;
  }
  isCurrent(generation: string): boolean {
    const current = this.read();
    return (
      current?.status === "connected" &&
      current.generation === generation &&
      Date.now() < current.expiresAt
    );
  }
  send(generation: string, payload: string): void {
    for (const socket of this.#context.getWebSockets()) {
      const attached = Schema.decodeUnknownSync(Generation)(
        socket.deserializeAttachment()
      );
      // No promise or forwarding emitter intervenes between this read and native physical send.
      if (attached.generation === generation && this.isCurrent(generation)) {
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
  read() {
    return this.#database.select().from(privateOutputGeneration).get() ?? null;
  }
}
