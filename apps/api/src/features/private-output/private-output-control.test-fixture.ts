/* eslint-disable max-classes-per-file -- Native fixture exports both independently stored private child kinds. */
import type * as NativeCloudflare from "@cloudflare/workers-types";
import { PersonProfile } from "@meal-planner/household-api";
import { PrivateDiscoveryScope } from "@meal-planner/private-interview-api";
import type { CloudflareBindingConfig } from "@tanstack/ai-cloudflare";
import { drizzle } from "drizzle-orm/durable-sqlite";
import { Schema } from "effect";

import { PrivateInterviewDirectory as ProductionDirectory } from "./private-interview-directory.js";
import { PrivateInterviewSession as ProductionSession } from "./private-interview-session.js";
import type { PrivateInterviewEnvironment } from "./private-output-socket.js";
import { PrivateOutputSocket } from "./private-output-socket.js";
import {
  PrivateSessionBinding,
  PrivateParticipantBinding,
  privateDirectoryKey,
  privateOutputKey,
} from "./private-output.contract.js";
import type { OutputLifecyclePort } from "./private-output.contract.js";
import { privateAssistantTurns } from "./private-output.database-schema.js";

export {
  AccountOutputLifecycle,
  HouseholdAgent,
  PrivateOutputApi,
  PrivateOutputMutations,
} from "./private-output-worker.js";

type SyntheticModelBody = Readonly<Record<string, unknown>>;

const unexpectedBindingMethod = (): never => {
  throw new Error("Unexpected Workers AI binding method");
};

/** Test-only acknowledgment faults and a synchronous clock around the production session. */
export class PrivateInterviewSession extends ProductionSession {
  #fixtureDatabase = drizzle(this.ctx.storage);
  #fixtureSocket = new PrivateOutputSocket(
    this.ctx,
    this.#fixtureDatabase,
    this.env
  );

  constructor(
    context: NativeCloudflare.DurableObjectState,
    environment: PrivateInterviewEnvironment
  ) {
    super(context, {
      ...environment,
      PrivateDiscoveryAI: {
        aiGatewayLogId: null,
        aiSearch: unexpectedBindingMethod,
        autorag: unexpectedBindingMethod,
        gateway: unexpectedBindingMethod,
        models: unexpectedBindingMethod,
        // Native Ai.run is overloaded across every provider model. This test adapter replaces only its external transport.
        run: ((
          model: string,
          body: SyntheticModelBody,
          options: {
            signal?: AbortSignal;
            gateway?: unknown;
          }
        ) =>
          fetch("https://private-model.test/run", {
            body: JSON.stringify({
              body,
              gateway: options.gateway,
              model,
            }),
            method: "POST",
            // The synthetic provider deliberately ignores cancellation to prove the durable late-output fence.
          })) as CloudflareBindingConfig["binding"]["run"],
        toMarkdown: unexpectedBindingMethod,
      },
    });
  }
  readTurns() {
    return this.#fixtureDatabase.select().from(privateAssistantTurns).all();
  }
  readKeepAliveReferences() {
    return this._keepAliveRefs;
  }

  enqueueOutput(input: {
    readonly generation: string;
    readonly payload: string;
  }) {
    this.#fixtureSocket.send(
      input.generation,
      JSON.stringify({
        text: input.payload,
        type: "PrivateTransportProbe",
      })
    );
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
      | "readTurns"
      | "readKeepAliveReferences"
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
      | "readReservation"
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
  discoveryScope: Schema.optional(Schema.NullOr(PrivateDiscoveryScope)),
  expiresAt: Schema.optional(Schema.Number),
  generation: Schema.optional(Schema.String),
  intentKey: Schema.optional(Schema.String),
  key: Schema.optional(Schema.String),
  now: Schema.optional(Schema.Number),
  operationId: Schema.optional(Schema.String),
  participant: Schema.optional(PrivateParticipantBinding),
  payload: Schema.optional(Schema.String),
  profile: Schema.optional(PersonProfile),
  scope: Schema.optional(Schema.Literals(["account", "household"])),
  sessionReference: Schema.String,
  turnId: Schema.optional(Schema.String),
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
          result = (await directory.readReservation(input.binding)) !== null;
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
        result = await child.initialize({
          binding: input.binding,
          scope:
            input.discoveryScope === undefined
              ? "ProfileEdit"
              : input.discoveryScope,
        });
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
          new Request("https://private-output.internal/upgrade", {
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
      } else if (input.action === "chat" && input.binding) {
        const url = new URL("https://private-output.internal/chat");
        url.search = new URL(request.url).search;
        const context = {
          binding: input.binding,
          generation: generation.generation,
          profile: request.method === "POST" ? (input.profile ?? null) : null,
        };
        const headers = new Headers();
        const cursor = request.headers.get("Last-Event-ID");
        if (cursor !== null) {
          headers.set("Last-Event-ID", cursor);
        }
        if (request.method === "POST") {
          const body = Schema.decodeUnknownSync(
            Schema.Record(Schema.String, Schema.Unknown)
          )(await request.json());
          headers.set("content-type", "application/json");
          return child.fetch(
            new Request(url, {
              body: JSON.stringify({ ...body, privateChatContext: context }),
              headers,
              method: "POST",
            })
          );
        }
        headers.set(
          "private-chat-context",
          encodeURIComponent(JSON.stringify(context))
        );
        return child.fetch(
          new Request(url, { headers, method: request.method })
        );
      } else if (input.action === "turns") {
        result = await child.readTurns();
      } else if (input.action === "keep-alive-references") {
        result = await child.readKeepAliveReferences();
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
