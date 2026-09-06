import type * as NativeCloudflare from "@cloudflare/workers-types";
import {
  DirectoryCommand,
  DirectoryFrame,
  MAX_PRIVATE_FRAME_BYTES,
} from "@meal-planner/private-interview-api";
import { DurableObject } from "cloudflare:workers";
import { eq, gt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import { Schema } from "effect";

import migrations from "../../../private-output-migrations/migrations.js";
import { Generation, PrivateOutputSocket } from "./private-output-socket.js";
import type { PrivateInterviewEnvironment } from "./private-output-socket.js";
import {
  PrivateParticipantBinding,
  PrivateSessionBinding,
  PrivateOutputUnavailable,
  privateDirectoryKey,
} from "./private-output.contract.js";
import {
  privateDirectoryBinding,
  privateReservations,
  privateReceipts,
} from "./private-output.database-schema.js";

declare const Response: typeof NativeCloudflare.Response;
const Authorization = Schema.Struct({
  ...Generation.fields,
  binding: PrivateParticipantBinding,
  expiresAt: Schema.Number,
});
const decodeBinding = Schema.decodeUnknownSync(PrivateParticipantBinding, {
  onExcessProperty: "error",
});
const sameBinding = (
  left: PrivateParticipantBinding,
  right: PrivateParticipantBinding
) =>
  left.accountKey === right.accountKey &&
  left.householdKey === right.householdKey &&
  left.linkageSubject === right.linkageSubject &&
  left.personId === right.personId;
/** Participant-private discovery metadata; no transcript or cached session lifecycle. */
export class PrivateInterviewDirectory extends DurableObject<PrivateInterviewEnvironment> {
  #database = drizzle(this.ctx.storage);
  #socket = new PrivateOutputSocket(this.ctx, this.#database, this.env);
  constructor(
    context: NativeCloudflare.DurableObjectState,
    environment: PrivateInterviewEnvironment
  ) {
    super(context, environment);
    context.blockConcurrencyWhile(() => {
      migrate(this.#database, migrations);
      this.#socket.restart();
      return Promise.resolve();
    });
  }
  async initialize(untrusted: PrivateParticipantBinding): Promise<void> {
    const binding = decodeBinding(untrusted);
    const bindingKey = await privateDirectoryKey(binding);
    const retained = this.#database
      .select()
      .from(privateDirectoryBinding)
      .get();
    if (retained !== undefined) {
      if (!sameBinding(retained, binding)) {
        throw new PrivateOutputUnavailable({ reason: "binding_conflict" });
      }
      return;
    }
    this.#database
      .insert(privateDirectoryBinding)
      .values({ ...binding, bindingKey, singleton: 1 })
      .run();
  }
  #binding(expected: PrivateParticipantBinding) {
    const retained = this.#database
      .select()
      .from(privateDirectoryBinding)
      .get();
    if (retained === undefined || !sameBinding(retained, expected)) {
      throw new PrivateOutputUnavailable({ reason: "binding_conflict" });
    }
    return retained;
  }
  beginConnection(untrusted: PrivateParticipantBinding): Promise<string> {
    const binding = this.#binding(decodeBinding(untrusted));
    return this.#socket.begin(binding, {
      childName: binding.bindingKey,
      targetKind: "directory",
    });
  }
  authorizeConnection(untrusted: typeof Authorization.Type): void {
    const input = Schema.decodeUnknownSync(Authorization, {
      onExcessProperty: "error",
    })(untrusted);
    this.#binding(input.binding);
    this.#socket.authorize(input.generation, input.expiresAt);
  }
  hasReservation(untrusted: PrivateSessionBinding): boolean {
    const binding = Schema.decodeUnknownSync(PrivateSessionBinding, {
      onExcessProperty: "error",
    })(untrusted);
    this.#binding(binding);
    return (
      this.#database
        .select()
        .from(privateReservations)
        .where(
          eq(privateReservations.sessionReference, binding.sessionReference)
        )
        .get() !== undefined
    );
  }
  override fetch(
    request: Request | NativeCloudflare.Request
  ): NativeCloudflare.Response {
    const binding = this.#database.select().from(privateDirectoryBinding).get();
    if (binding === undefined) {
      return new Response(null, { status: 403 });
    }
    return this.#socket.accept(
      request,
      JSON.stringify({ bindingKey: binding.bindingKey, type: "DirectoryReady" })
    );
  }
  override webSocketMessage(
    socket: NativeCloudflare.WebSocket,
    message: string | ArrayBuffer
  ): void {
    const generation = this.#socket.admitted(socket);
    if (generation === undefined) {
      socket.close(1008, "Reauthentication required");
      return;
    }
    let command: DirectoryCommand;
    try {
      const text = Schema.decodeUnknownSync(Schema.String)(message);
      if (new TextEncoder().encode(text).byteLength > MAX_PRIVATE_FRAME_BYTES) {
        socket.close(1009, "Invalid private command");
        return;
      }
      command = Schema.decodeUnknownSync(DirectoryCommand, {
        onExcessProperty: "error",
      })(JSON.parse(text));
    } catch {
      socket.close(1008, "Invalid private command");
      return;
    }
    const frame = this.#database.transaction(
      (transaction): DirectoryFrame | undefined => {
        if (!this.#socket.isCurrent(generation)) {
          return;
        }
        if (command.type === "ListSessions") {
          const reservations = transaction
            .select()
            .from(privateReservations)
            .where(gt(privateReservations.ordinal, command.afterOrdinal))
            .orderBy(privateReservations.ordinal)
            .limit(command.limit + 1)
            .all();
          return {
            hasMore: reservations.length > command.limit,
            requestId: command.requestId,
            reservations: reservations.slice(0, command.limit),
            type: "SessionsListed",
          };
        }
        const intent = JSON.stringify(command);
        const receipt = transaction
          .select()
          .from(privateReceipts)
          .where(eq(privateReceipts.mutationId, command.mutationId))
          .get();
        if (receipt !== undefined) {
          if (receipt.intent !== intent) {
            return {
              commandId: command.mutationId,
              reason: "mutation_collision",
              state: null,
              type: "Rejected",
            };
          }
          return Schema.decodeUnknownSync(DirectoryFrame)(
            JSON.parse(receipt.frame)
          );
        }
        const reservation = transaction
          .insert(privateReservations)
          .values({
            createdAt: Date.now(),
            sessionReference: crypto.randomUUID(),
          })
          .returning()
          .get();
        const result: DirectoryFrame = {
          mutationId: command.mutationId,
          reservation,
          type: "SessionStarted",
        };
        transaction
          .insert(privateReceipts)
          .values({
            frame: JSON.stringify(result),
            intent,
            mutationId: command.mutationId,
          })
          .run();
        return result;
      }
    );
    if (frame !== undefined) {
      this.#socket.send(generation, JSON.stringify(frame));
    }
  }
  invalidateOutput(untrusted: typeof Generation.Type): void {
    this.#socket.invalidate(untrusted);
  }
  readMetadata() {
    return this.#database.select().from(privateDirectoryBinding).get() ?? null;
  }
  readOutputLifecycle() {
    return this.#socket.read();
  }
}
