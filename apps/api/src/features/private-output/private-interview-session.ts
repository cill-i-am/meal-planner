import type * as NativeCloudflare from "@cloudflare/workers-types";
import {
  MAX_PRIVATE_FRAME_BYTES,
  SessionCommand,
  SessionFrame,
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
  PrivateSessionBinding,
  PrivateOutputUnavailable,
  privateOutputKey,
  privateDirectoryKey,
} from "./private-output.contract.js";
import {
  privateMessages,
  privateReceipts,
  privateSessionBinding,
} from "./private-output.database-schema.js";

declare const Response: typeof NativeCloudflare.Response;
const Authorization = Schema.Struct({
  ...Generation.fields,
  binding: PrivateSessionBinding,
  expiresAt: Schema.Number,
});
const decodeBinding = Schema.decodeUnknownSync(PrivateSessionBinding, {
  onExcessProperty: "error",
});
const sameBinding = (
  left: PrivateSessionBinding,
  right: PrivateSessionBinding
) =>
  left.accountKey === right.accountKey &&
  left.householdKey === right.householdKey &&
  left.linkageSubject === right.linkageSubject &&
  left.personId === right.personId &&
  left.sessionReference === right.sessionReference;
/** Owns private history and physical WebSockets. No transcript RPC or production assistant producer. */
export class PrivateInterviewSession extends DurableObject<PrivateInterviewEnvironment> {
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
  initialize(untrusted: PrivateSessionBinding): void {
    const binding = decodeBinding(untrusted);
    const retained = this.#database.select().from(privateSessionBinding).get();
    if (retained !== undefined) {
      if (!sameBinding(retained, binding)) {
        throw new PrivateOutputUnavailable({ reason: "binding_conflict" });
      }
      return;
    }
    this.#database
      .insert(privateSessionBinding)
      .values({ ...binding, status: "open", version: 0 })
      .run();
  }
  async beginConnection(untrusted: PrivateSessionBinding): Promise<string> {
    const binding = decodeBinding(untrusted);
    const childName = await privateOutputKey(
      "session",
      binding.sessionReference
    );
    this.#binding(binding);
    return this.#socket.begin(binding, { childName, targetKind: "session" });
  }
  authorizeConnection(untrusted: typeof Authorization.Type): void {
    const input = Schema.decodeUnknownSync(Authorization, {
      onExcessProperty: "error",
    })(untrusted);
    this.#binding(input.binding);
    this.#socket.authorize(input.generation, input.expiresAt);
  }
  override async fetch(
    request: Request | NativeCloudflare.Request
  ): Promise<NativeCloudflare.Response> {
    const binding = this.#database.select().from(privateSessionBinding).get();
    if (binding === undefined) {
      return new Response(null, { status: 403 });
    }
    const bindingKey = await privateDirectoryKey(binding);
    return this.#socket.accept(
      request,
      JSON.stringify({
        bindingKey,
        sessionReference: binding.sessionReference,
        state: this.#state(),
        type: "SessionReady",
      })
    );
  }
  #binding(expected: PrivateSessionBinding) {
    const binding = this.#database.select().from(privateSessionBinding).get();
    if (binding === undefined || !sameBinding(binding, expected)) {
      throw new PrivateOutputUnavailable({ reason: "binding_conflict" });
    }
    return binding;
  }
  #state() {
    const binding = this.#database.select().from(privateSessionBinding).get();
    if (binding === undefined) {
      throw new PrivateOutputUnavailable({ reason: "binding_conflict" });
    }
    return { status: binding.status, version: binding.version };
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
    let command: SessionCommand;
    try {
      const text = Schema.decodeUnknownSync(Schema.String)(message);
      if (new TextEncoder().encode(text).byteLength > MAX_PRIVATE_FRAME_BYTES) {
        socket.close(1009, "Invalid private command");
        return;
      }
      command = Schema.decodeUnknownSync(SessionCommand, {
        onExcessProperty: "error",
      })(JSON.parse(text));
    } catch {
      socket.close(1008, "Invalid private command");
      return;
    }
    const frame = this.#database.transaction(
      (transaction): SessionFrame | undefined => {
        if (!this.#socket.isCurrent(generation)) {
          return;
        }
        const state = this.#state();
        if (command.type === "ReadHistory") {
          const records = transaction
            .select()
            .from(privateMessages)
            .where(gt(privateMessages.ordinal, command.afterOrdinal))
            .orderBy(privateMessages.ordinal)
            .limit(command.limit + 1)
            .all();
          const messages = records.slice(0, command.limit);
          const history = () => ({
            hasMore: records.length > messages.length,
            messages,
            requestId: command.requestId,
            state,
            type: "HistoryRead" as const,
          });
          while (
            new TextEncoder().encode(JSON.stringify(history())).byteLength >
            MAX_PRIVATE_FRAME_BYTES
          ) {
            messages.pop();
          }
          return history();
        }
        // Exact canonical command JSON avoids an asynchronous digest between admission and commit.
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
              state,
              type: "Rejected",
            };
          }
          return Schema.decodeUnknownSync(SessionFrame)(
            JSON.parse(receipt.frame)
          );
        }
        if (state.status === "completed") {
          return {
            commandId: command.mutationId,
            reason: "session_completed",
            state,
            type: "Rejected",
          };
        }
        if (command.expectedVersion !== state.version) {
          return {
            commandId: command.mutationId,
            reason: "version_conflict",
            state,
            type: "Rejected",
          };
        }
        const next = {
          status:
            command.type === "CompleteSession"
              ? ("completed" as const)
              : ("open" as const),
          version: state.version + 1,
        };
        transaction.update(privateSessionBinding).set(next).run();
        let result: SessionFrame;
        if (command.type === "CompleteSession") {
          result = {
            mutationId: command.mutationId,
            state: next,
            type: "SessionCompleted",
          };
        } else {
          const record = transaction
            .insert(privateMessages)
            .values({
              createdAt: Date.now(),
              id: crypto.randomUUID(),
              role: "participant",
              text: command.text,
            })
            .returning()
            .get();
          result = {
            message: record,
            mutationId: command.mutationId,
            state: next,
            type: "MessageAppended",
          };
        }
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
    // Receipts and retained history remain permitted after completion.
    if (frame !== undefined) {
      this.#socket.send(generation, JSON.stringify(frame));
    }
  }
  invalidateOutput(untrusted: typeof Generation.Type): void {
    this.#socket.invalidate(untrusted);
  }
  readMetadata() {
    return this.#database.select().from(privateSessionBinding).get() ?? null;
  }
  readOutputLifecycle() {
    return this.#socket.read();
  }
}
