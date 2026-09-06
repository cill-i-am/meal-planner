/* eslint-disable max-classes-per-file -- Native fixture exports both independently stored private child kinds. */
import type * as NativeCloudflare from "@cloudflare/workers-types";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/durable-sqlite";
import { Schema } from "effect";

import { PrivateInterviewDirectory as ProductionDirectory } from "./private-interview-directory.js";
import { PrivateInterviewSession as ProductionSession } from "./private-interview-session.js";
import {
  PrivateSessionBinding,
  PrivateParticipantBinding,
  privateDirectoryKey,
  privateOutputKey,
} from "./private-output.contract.js";
import type { OutputLifecyclePort } from "./private-output.contract.js";
import {
  privateMessages,
  privateOutputGeneration,
  privateSessionBinding,
} from "./private-output.database-schema.js";

export {
  AccountOutputLifecycle,
  HouseholdAgent,
  PrivateOutputApi,
  PrivateOutputMutations,
} from "./private-output-worker.js";

/** Test-only acknowledgment faults and a synchronous clock around the production session. */
export class PrivateInterviewSession extends ProductionSession {
  #fixtureDatabase = drizzle(this.ctx.storage);

  enqueueOutput(input: {
    readonly generation: string;
    readonly payload: string;
  }) {
    const emitted = this.#fixtureDatabase.transaction((transaction) => {
      const generation = transaction
        .select()
        .from(privateOutputGeneration)
        .get();
      const session = transaction.select().from(privateSessionBinding).get();
      const socket = this.ctx.getWebSockets().find((candidate) => {
        const attachment = candidate.deserializeAttachment() as {
          generation?: string;
        };
        return attachment.generation === input.generation;
      });
      if (
        generation?.generation !== input.generation ||
        generation.status !== "connected" ||
        Date.now() >= generation.expiresAt ||
        session?.status !== "open" ||
        socket === undefined
      ) {
        return null;
      }
      const record = transaction
        .insert(privateMessages)
        .values({
          createdAt: Date.now(),
          id: crypto.randomUUID(),
          role: "assistant",
          text: input.payload,
        })
        .returning()
        .get();
      transaction
        .update(privateSessionBinding)
        .set({ version: session.version + 1 })
        .where(
          eq(privateSessionBinding.sessionReference, session.sessionReference)
        )
        .run();
      return { ordinal: record.ordinal, socket };
    });
    if (emitted !== null) {
      // Synthetic production exists only here. Physical emission uses the production history command and its final guard.
      super.webSocketMessage(
        emitted.socket,
        JSON.stringify({
          afterOrdinal: emitted.ordinal - 1,
          limit: 1,
          requestId: crypto.randomUUID(),
          type: "ReadHistory",
        })
      );
    }
  }

  enqueueOutputAtTime(
    input: Parameters<PrivateInterviewSession["enqueueOutput"]>[0],
    now: number
  ) {
    const nativeNow = Date.now;
    Date.now = () => now;
    try {
      // Production enqueue is synchronous: no other request observes the fixture clock.
      this.enqueueOutput(input);
    } finally {
      Date.now = nativeNow;
    }
  }

  commandAtTime(
    input: { readonly generation: string; readonly payload: string },
    now: number
  ) {
    const nativeNow = Date.now;
    Date.now = () => now;
    try {
      const socket = this.ctx
        .getWebSockets()
        .find(
          (candidate) =>
            (candidate.deserializeAttachment() as { generation?: string })
              .generation === input.generation
        );
      if (socket !== undefined) {
        super.webSocketMessage(socket, input.payload);
      }
    } finally {
      Date.now = nativeNow;
    }
  }
  async loseNextInvalidationAcknowledgement() {
    await this.ctx.storage.put("lose-invalidation", true);
  }
  override async invalidateOutput(input: { readonly generation: string }) {
    super.invalidateOutput(input);
    if (await this.ctx.storage.get("lose-invalidation")) {
      await this.ctx.storage.delete("lose-invalidation");
      throw new Error("Synthetic lost invalidation acknowledgement");
    }
  }
}

type SessionPort = {
  [
    Key in
      | "initialize"
      | "beginConnection"
      | "authorizeConnection"
      | "invalidateOutput"
      | "enqueueOutput"
      | "enqueueOutputAtTime"
      | "commandAtTime"
      | "readMetadata"
      | "readOutputLifecycle"
      | "fetch"
  ]: (
    ...args: Parameters<PrivateInterviewSession[Key]>
  ) => Promise<Awaited<ReturnType<PrivateInterviewSession[Key]>>>;
} & {
  loseNextInvalidationAcknowledgement: () => Promise<void>;
  sql: (query: string) => Promise<unknown>;
  readonly state: Promise<unknown>;
  readonly ctx: {
    readonly storage: {
      readonly sql: { readonly exec: (query: string) => Promise<unknown> };
    };
  };
};
export class PrivateInterviewDirectory extends ProductionDirectory {
  commandAtTime(
    input: { readonly generation: string; readonly payload: string },
    now: number
  ) {
    const nativeNow = Date.now;
    Date.now = () => now;
    try {
      const socket = this.ctx
        .getWebSockets()
        .find(
          (candidate) =>
            (candidate.deserializeAttachment() as { generation?: string })
              .generation === input.generation
        );
      if (socket !== undefined) {
        super.webSocketMessage(socket, input.payload);
      }
    } finally {
      Date.now = nativeNow;
    }
  }
  async loseNextInvalidationAcknowledgement() {
    await this.ctx.storage.put("lose-invalidation", true);
  }
  override async invalidateOutput(input: { readonly generation: string }) {
    super.invalidateOutput(input);
    if (await this.ctx.storage.get("lose-invalidation")) {
      await this.ctx.storage.delete("lose-invalidation");
      throw new Error("Synthetic lost invalidation acknowledgement");
    }
  }
}
type DirectoryPort = {
  [
    Key in
      | "initialize"
      | "beginConnection"
      | "authorizeConnection"
      | "invalidateOutput"
      | "hasReservation"
      | "readOutputLifecycle"
      | "fetch"
      | "commandAtTime"
      | "loseNextInvalidationAcknowledgement"
  ]: (
    ...args: Parameters<PrivateInterviewDirectory[Key]>
  ) => Promise<Awaited<ReturnType<PrivateInterviewDirectory[Key]>>>;
} & Pick<SessionPort, "sql" | "state" | "ctx">;
interface Environment {
  readonly PrivateInterviewDirectory: {
    readonly getByName: (name: string) => DirectoryPort;
  };
  readonly PrivateInterviewSession: {
    readonly getByName: (name: string) => SessionPort;
  };
  readonly AccountOutputLifecycle: {
    readonly getByName: (name: string) => OutputLifecyclePort;
  };
  readonly HouseholdAgent: {
    readonly getByName: (name: string) => OutputLifecyclePort;
  };
}

const Command = Schema.Struct({
  action: Schema.String,
  binding: Schema.optional(PrivateSessionBinding),
  directoryKey: Schema.optional(Schema.String),
  expiresAt: Schema.optional(Schema.Number),
  generation: Schema.optional(Schema.String),
  intentKey: Schema.optional(Schema.String),
  key: Schema.optional(Schema.String),
  now: Schema.optional(Schema.Number),
  operationId: Schema.optional(Schema.String),
  participant: Schema.optional(PrivateParticipantBinding),
  payload: Schema.optional(Schema.String),
  scope: Schema.optional(Schema.Literals(["account", "household"])),
  sessionReference: Schema.String,
});

/** Test-only direct capabilities; this shell is never referenced by the production worker resource. */
export default {
  // eslint-disable-next-line complexity -- Test-only command router keeps the production capabilities directly observable.
  async fetch(
    request: Request,
    env: Environment
  ): Promise<Response | NativeCloudflare.Response> {
    const input = Schema.decodeUnknownSync(Command)(
      JSON.parse(request.headers.get("x-test-command") ?? "null")
    );
    const child = env.PrivateInterviewSession.getByName(
      await privateOutputKey("session", input.sessionReference)
    );
    const generation = { generation: input.generation ?? "" };
    try {
      let result: unknown = null;
      if (
        input.action.startsWith("directory-") &&
        (input.participant || input.directoryKey)
      ) {
        const directory = env.PrivateInterviewDirectory.getByName(
          input.directoryKey ??
            (input.participant
              ? await privateDirectoryKey(input.participant)
              : "")
        );
        if (input.action === "directory-initialize" && input.participant) {
          result = await directory.initialize(input.participant);
        } else if (input.action === "directory-begin" && input.participant) {
          result = await directory.beginConnection(input.participant);
        } else if (
          input.action === "directory-authorize" &&
          input.participant
        ) {
          result = await directory.authorizeConnection({
            ...generation,
            binding: input.participant,
            expiresAt: input.expiresAt ?? 0,
          });
        } else if (input.action === "directory-private-http") {
          return directory.fetch(new Request(request.url));
        } else if (input.action === "directory-sql") {
          result = await directory.sql(
            "select * from private_directory_binding"
          );
        } else if (input.action === "directory-state") {
          result = await directory.state;
        } else if (input.action === "directory-context-sql") {
          result = await directory.ctx.storage.sql.exec(
            "select * from private_directory_binding"
          );
        } else if (input.action === "directory-lifecycle") {
          result = await directory.readOutputLifecycle();
        } else if (
          input.action === "directory-command-at-time" &&
          input.now !== undefined
        ) {
          result = await directory.commandAtTime(
            { ...generation, payload: input.payload ?? "" },
            input.now
          );
        } else if (input.action === "directory-lose-ack") {
          result = await directory.loseNextInvalidationAcknowledgement();
        } else if (input.action === "directory-reserved" && input.binding) {
          result = await directory.hasReservation(input.binding);
        } else if (input.action === "directory-connect") {
          return directory.fetch(
            new Request(request.url, {
              headers: {
                Upgrade: "websocket",
                "private-output-generation": generation.generation,
              },
            })
          );
        } else {
          return new Response(null, { status: 404 });
        }
      } else if (input.action === "initialize" && input.binding) {
        result = await child.initialize(input.binding);
      } else if (input.action === "begin" && input.binding) {
        result = await child.beginConnection(input.binding);
      } else if (input.action === "authorize" && input.binding) {
        result = await child.authorizeConnection({
          ...generation,
          binding: input.binding,
          expiresAt: input.expiresAt ?? 0,
        });
      } else if (input.action === "connect") {
        return child.fetch(
          new Request(request.url, {
            headers: {
              Upgrade: "websocket",
              "private-output-generation": generation.generation,
            },
          })
        );
      } else if (
        input.action === "command-at-time" &&
        input.now !== undefined
      ) {
        result = await child.commandAtTime(
          { ...generation, payload: input.payload ?? "" },
          input.now
        );
      } else if (input.action === "emit-at-time" && input.now !== undefined) {
        result = await child.enqueueOutputAtTime(
          { ...generation, payload: input.payload ?? "" },
          input.now
        );
      } else if (input.action === "emit") {
        result = await child.enqueueOutput({
          ...generation,
          payload: input.payload ?? "",
        });
      } else if (input.action === "metadata") {
        result = await child.readMetadata();
      } else if (input.action === "lifecycle") {
        result = await child.readOutputLifecycle();
      } else if (input.action === "lose-ack") {
        result = await child.loseNextInvalidationAcknowledgement();
      } else if (input.action === "sql") {
        result = await child.sql("select * from private_session_binding");
      } else if (input.action === "state") {
        result = await child.state;
      } else if (input.action === "context-sql") {
        result = await child.ctx.storage.sql.exec(
          "select * from private_session_binding"
        );
      } else if (input.action === "private-http") {
        return child.fetch(new Request(request.url));
      } else if (input.key) {
        const coordinator = (
          input.scope === "household"
            ? env.HouseholdAgent
            : env.AccountOutputLifecycle
        ).getByName(input.key);
        const operation = { operationId: input.operationId ?? "" };
        if (input.action === "mutation-begin") {
          result = await coordinator.beginMutation({
            intentKey: input.intentKey ?? "",
          });
        } else if (input.action === "mutation-prepare") {
          result = await coordinator.prepareMutation(operation);
        } else if (input.action === "mutation-dispatch") {
          result = await coordinator.markDispatched(operation);
        } else if (input.action === "mutation-complete") {
          result = await coordinator.completeMutation(operation);
        } else if (input.action === "mutation-read") {
          result = await coordinator.readMutation(operation);
        } else {
          return new Response(null, { status: 404 });
        }
      } else {
        return new Response(null, { status: 404 });
      }
      return Response.json({ result: result ?? null });
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "Rejected" },
        { status: 409 }
      );
    }
  },
};
