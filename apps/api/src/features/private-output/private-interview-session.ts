import type * as NativeCloudflare from "@cloudflare/workers-types";
import { DurableObject } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import { Schema } from "effect";

import migrations from "../../../private-output-migrations/migrations.js";
import {
  PrivateSessionBinding,
  privateOutputKey,
  PrivateOutputUnavailable,
} from "./private-output.contract.js";
import type { OutputLifecyclePort } from "./private-output.contract.js";
import {
  privateOutputGeneration,
  privateSessionBinding,
} from "./private-output.database-schema.js";

export interface PrivateInterviewEnvironment {
  readonly AccountOutputLifecycle: {
    readonly getByName: (name: string) => OutputLifecyclePort;
  };
  readonly HouseholdAgent: {
    readonly getByName: (name: string) => OutputLifecyclePort;
  };
}

declare const WebSocketPair: typeof NativeCloudflare.WebSocketPair;
declare const Response: typeof NativeCloudflare.Response;

const Generation = Schema.Struct({
  generation: Schema.String.pipe(Schema.check(Schema.isUUID())),
});
const Authorization = Schema.Struct({
  ...Generation.fields,
  binding: PrivateSessionBinding,
  expiresAt: Schema.Number,
});
const Output = Schema.Struct({ ...Generation.fields, payload: Schema.String });

/** Owns the physical WebSocket: no SDK virtual send queue or inherited private SQL RPC. */
export class PrivateInterviewSession extends DurableObject<PrivateInterviewEnvironment> {
  #database = drizzle(this.ctx.storage);

  constructor(
    context: NativeCloudflare.DurableObjectState,
    environment: PrivateInterviewEnvironment
  ) {
    super(context, environment);
    context.blockConcurrencyWhile(() => {
      migrate(this.#database, migrations);
      this.#database
        .update(privateOutputGeneration)
        .set({ status: "invalidated" })
        .run();
      for (const socket of context.getWebSockets()) {
        socket.close(1008, "Reauthentication required");
      }
      return Promise.resolve();
    });
  }

  initialize(untrusted: PrivateSessionBinding): void {
    const binding = Schema.decodeUnknownSync(PrivateSessionBinding, {
      onExcessProperty: "error",
    })(untrusted);
    const retained = this.#database.select().from(privateSessionBinding).get();
    if (retained !== undefined) {
      if (!PrivateInterviewSession.#sameBinding(retained, binding)) {
        throw new PrivateOutputUnavailable({ reason: "binding_conflict" });
      }
      return;
    }
    this.#database
      .insert(privateSessionBinding)
      .values({ ...binding, status: "open" })
      .run();
  }

  static #sameBinding(
    left: PrivateSessionBinding,
    right: PrivateSessionBinding
  ) {
    return (
      left.accountKey === right.accountKey &&
      left.householdKey === right.householdKey &&
      left.linkageSubject === right.linkageSubject &&
      left.personId === right.personId &&
      left.sessionReference === right.sessionReference
    );
  }

  async beginConnection(untrusted: PrivateSessionBinding): Promise<string> {
    const expected = Schema.decodeUnknownSync(PrivateSessionBinding)(untrusted);
    const binding = this.#database.select().from(privateSessionBinding).get();
    if (
      binding === undefined ||
      !PrivateInterviewSession.#sameBinding(binding, expected)
    ) {
      throw new PrivateOutputUnavailable({ reason: "binding_conflict" });
    }
    const generation = crypto.randomUUID();
    this.#database
      .insert(privateOutputGeneration)
      .values({ expiresAt: 0, generation, singleton: 1, status: "pending" })
      .onConflictDoUpdate({
        set: { expiresAt: 0, generation, status: "pending" },
        target: privateOutputGeneration.singleton,
      })
      .run();
    for (const socket of this.ctx.getWebSockets()) {
      socket.close(1008, "Reauthentication required");
    }
    try {
      const registration = {
        childName: await privateOutputKey("session", binding.sessionReference),
        generation,
      };
      const accountRegistered = await this.env.AccountOutputLifecycle.getByName(
        binding.accountKey
      ).register(registration);
      const householdRegistered = await this.env.HouseholdAgent.getByName(
        binding.householdKey
      ).register(registration);
      if (!accountRegistered || !householdRegistered) {
        throw new PrivateOutputUnavailable({ reason: "output_disabled" });
      }
      return generation;
    } catch (error) {
      this.invalidateOutput({ generation });
      throw error;
    }
  }

  authorizeConnection(untrusted: typeof Authorization.Type): void {
    const input = Schema.decodeUnknownSync(Authorization, {
      onExcessProperty: "error",
    })(untrusted);
    const binding = this.#database.select().from(privateSessionBinding).get();
    if (
      binding === undefined ||
      !PrivateInterviewSession.#sameBinding(binding, input.binding) ||
      input.expiresAt <= Date.now()
    ) {
      throw new PrivateOutputUnavailable({ reason: "authority_unavailable" });
    }
    const authorized = this.#database
      .update(privateOutputGeneration)
      .set({ expiresAt: input.expiresAt, status: "authorized" })
      .where(
        and(
          eq(privateOutputGeneration.generation, input.generation),
          eq(privateOutputGeneration.status, "pending")
        )
      )
      .returning()
      .get();
    if (authorized === undefined) {
      throw new PrivateOutputUnavailable({ reason: "output_disabled" });
    }
  }

  override fetch(
    request: Request | NativeCloudflare.Request
  ): NativeCloudflare.Response {
    if (
      request.method !== "GET" ||
      request.headers.get("Upgrade")?.toLowerCase() !== "websocket"
    ) {
      return new Response(null, { status: 404 });
    }
    const generation = request.headers.get("private-output-generation");
    const current = this.#database.select().from(privateOutputGeneration).get();
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
    this.ctx.acceptWebSocket(pair[1]);
    const upgrade = { status: 101, webSocket: pair[0] };
    return new Response(null, upgrade);
  }

  invalidateOutput(untrusted: typeof Generation.Type): void {
    const { generation } = Schema.decodeUnknownSync(Generation)(untrusted);
    this.#database
      .update(privateOutputGeneration)
      .set({ status: "invalidated" })
      .where(eq(privateOutputGeneration.generation, generation))
      .run();
    for (const socket of this.ctx.getWebSockets()) {
      const attached = Schema.decodeUnknownSync(Generation)(
        socket.deserializeAttachment()
      );
      if (attached.generation === generation) {
        socket.close(1008, "Reauthentication required");
      }
    }
  }

  enqueueOutput(untrusted: typeof Output.Type): void {
    const input = Schema.decodeUnknownSync(Output, {
      onExcessProperty: "error",
    })(untrusted);
    for (const socket of this.ctx.getWebSockets()) {
      const attached = Schema.decodeUnknownSync(Generation)(
        socket.deserializeAttachment()
      );
      const current = this.#database
        .select()
        .from(privateOutputGeneration)
        .get();
      // No await or second owner between this durable-generation/deadline check and native enqueue.
      if (
        current?.status === "connected" &&
        current.generation === input.generation &&
        attached.generation === input.generation &&
        Date.now() < current.expiresAt
      ) {
        socket.send(input.payload);
      }
    }
  }

  override webSocketMessage(socket: NativeCloudflare.WebSocket): void {
    this.invalidateOutput(
      Schema.decodeUnknownSync(Generation)(socket.deserializeAttachment())
    );
  }

  readMetadata() {
    return this.#database.select().from(privateSessionBinding).get() ?? null;
  }

  readOutputLifecycle() {
    return this.#database.select().from(privateOutputGeneration).get() ?? null;
  }

  completeSession(untrusted: typeof Generation.Type): void {
    const input = Schema.decodeUnknownSync(Generation)(untrusted);
    const current = this.#database.select().from(privateOutputGeneration).get();
    if (
      current?.status !== "connected" ||
      current.generation !== input.generation ||
      Date.now() >= current.expiresAt
    ) {
      throw new PrivateOutputUnavailable({ reason: "output_disabled" });
    }
    this.#database
      .update(privateSessionBinding)
      .set({ status: "completed" })
      .run();
  }
}
