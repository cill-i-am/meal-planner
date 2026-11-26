import type * as NativeCloudflare from "@cloudflare/workers-types";
import {
  DirectoryCommand,
  DirectoryFrame,
} from "@meal-planner/private-interview-api";
import { instrumentDrizzle } from "cloudflare-drizzle-tracing";
import { DurableObject } from "cloudflare:workers";
import { eq, gt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import { Schema } from "effect";

import migrations from "../../../private-output-migrations/migrations.js";
import {
  PrivateOutputSocket,
  privateCommandDecoder,
} from "./private-output-socket.js";
import type { PrivateInterviewEnvironment } from "./private-output-socket.js";
import {
  Generation,
  PrivateParticipantBinding,
  PrivateSessionBinding,
  PrivateOutputUnavailable,
  privateDirectoryKey,
} from "./private-output.contract.js";
import {
  privateDirectoryBinding,
  privateDiscoverySessionScopes,
  privateReservations,
  privateReceipts,
} from "./private-output.database-schema.js";
import { PrivateDirectoryRequest } from "./private-request.contract.js";

const decodeDirectoryCommand = privateCommandDecoder(DirectoryCommand);

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
  #database = instrumentDrizzle(drizzle(this.ctx.storage), {
    attributes: { "db.namespace": "private-output" },
  });
  #socket = new PrivateOutputSocket(this.ctx, this.#database, this.env, () =>
    this.outputTime()
  );

  readonly #clock = Date;

  protected outputTime() {
    return this.#clock.now();
  }
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
  async initialize(untrusted: PrivateParticipantBinding) {
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
  beginConnection(untrusted: PrivateParticipantBinding) {
    const binding = this.#binding(decodeBinding(untrusted));
    {
      const checkedResult: Promise<string> = this.#socket.begin(binding, {
        childName: binding.bindingKey,
        targetKind: "directory",
      });
      return checkedResult;
    }
  }
  beginRequest(untrusted: PrivateParticipantBinding) {
    const binding = this.#binding(decodeBinding(untrusted));
    {
      const checkedResult: Promise<string> = this.#socket.beginRequest(
        binding,
        {
          childName: binding.bindingKey,
          targetKind: "directory",
        }
      );
      return checkedResult;
    }
  }
  authorizeRequest(untrusted: typeof Authorization.Type) {
    const input = Schema.decodeUnknownSync(Authorization, {
      onExcessProperty: "error",
    })(untrusted);
    this.#binding(input.binding);
    this.#socket.authorizeRequest(input.generation, input.expiresAt);
  }
  executeDirectory(untrusted: typeof PrivateDirectoryRequest.Type) {
    const input = Schema.decodeUnknownSync(PrivateDirectoryRequest, {
      onExcessProperty: "error",
    })(untrusted);
    this.#binding(input.binding);
    if (!this.#socket.isRequestCurrent(input.generation)) {
      throw new PrivateOutputUnavailable({ reason: "output_disabled" });
    }
    {
      const checkedResult: DirectoryFrame = this.#execute(
        input.command,
        input.generation
      );
      return checkedResult;
    }
  }
  authorizeConnection(untrusted: typeof Authorization.Type) {
    const input = Schema.decodeUnknownSync(Authorization, {
      onExcessProperty: "error",
    })(untrusted);
    this.#binding(input.binding);
    this.#socket.authorize(input.generation, input.expiresAt);
  }
  readReservation(untrusted: PrivateSessionBinding) {
    const binding = Schema.decodeUnknownSync(PrivateSessionBinding, {
      onExcessProperty: "error",
    })(untrusted);
    this.#binding(binding);
    const reservation = this.#database
      .select()
      .from(privateReservations)
      .where(eq(privateReservations.sessionReference, binding.sessionReference))
      .get();
    return reservation === undefined
      ? null
      : { ...reservation, scope: this.#scope(reservation.sessionReference) };
  }
  #scope(sessionReference: string) {
    return (
      this.#database
        .select()
        .from(privateDiscoverySessionScopes)
        .where(
          eq(privateDiscoverySessionScopes.sessionReference, sessionReference)
        )
        .get()?.scope ?? null
    );
  }
  override fetch(request: Request | NativeCloudflare.Request) {
    const binding = this.#database.select().from(privateDirectoryBinding).get();
    if (binding === undefined) {
      const checkedResult: NativeCloudflare.Response = new Response(null, {
        status: 403,
      });
      return checkedResult;
    }
    {
      const checkedResult: NativeCloudflare.Response = this.#socket.accept(
        request,
        JSON.stringify({
          bindingKey: binding.bindingKey,
          type: "DirectoryReady",
        })
      );
      return checkedResult;
    }
  }
  override webSocketMessage(
    socket: NativeCloudflare.WebSocket,
    message: string | ArrayBuffer
  ) {
    const generation = this.#socket.admitted(socket);
    if (generation === undefined) {
      socket.close(1008, "Reauthentication required");
      return;
    }
    const decoded = decodeDirectoryCommand(message);
    if (decoded._tag === "Rejected") {
      socket.close(decoded.closeCode, "Invalid private command");
      return;
    }
    const frame = this.#execute(decoded.command, generation);
    this.#socket.send(generation, JSON.stringify(frame));
  }
  #execute(command: DirectoryCommand, generation: string) {
    const checkedResult: DirectoryFrame = this.#database.transaction(
      (transaction) => {
        if (!this.#socket.isCurrent(generation)) {
          throw new PrivateOutputUnavailable({ reason: "output_disabled" });
        }
        if (command.type === "ListSessions") {
          const reservations = transaction
            .select()
            .from(privateReservations)
            .where(gt(privateReservations.ordinal, command.afterOrdinal))
            .orderBy(privateReservations.ordinal)
            .limit(command.limit + 1)
            .all();
          {
            const nestedResult: DirectoryFrame = {
              hasMore: reservations.length > command.limit,
              requestId: command.requestId,
              reservations: reservations
                .slice(0, command.limit)
                .map((reservation) => ({
                  ...reservation,
                  scope: this.#scope(reservation.sessionReference),
                })),
              type: "SessionsListed",
            };
            return nestedResult;
          }
        }
        const intent = JSON.stringify(command);
        const receipt = transaction
          .select()
          .from(privateReceipts)
          .where(eq(privateReceipts.mutationId, command.mutationId))
          .get();
        if (receipt !== undefined) {
          if (receipt.intent !== intent) {
            const nestedResult2: DirectoryFrame = {
              commandId: command.mutationId,
              reason: "mutation_collision",
              state: null,
              type: "Rejected",
            };
            return nestedResult2;
          }
          {
            const nestedResult3: DirectoryFrame = Schema.decodeUnknownSync(
              DirectoryFrame
            )(JSON.parse(receipt.frame));
            return nestedResult3;
          }
        }
        const reservation = transaction
          .insert(privateReservations)
          .values({
            createdAt: this.outputTime(),
            sessionReference: crypto.randomUUID(),
          })
          .returning()
          .get();
        transaction
          .insert(privateDiscoverySessionScopes)
          .values({
            scope: command.scope,
            sessionReference: reservation.sessionReference,
          })
          .run();
        const result: DirectoryFrame = {
          mutationId: command.mutationId,
          reservation: { ...reservation, scope: command.scope },
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
        {
          const nestedResult4: DirectoryFrame = result;
          return nestedResult4;
        }
      }
    );
    return checkedResult;
  }
  invalidateOutput(untrusted: typeof Generation.Type) {
    this.#socket.invalidate(untrusted);
  }
  readMetadata() {
    return this.#database.select().from(privateDirectoryBinding).get() ?? null;
  }
  readOutputLifecycle() {
    return this.#socket.read();
  }
}
