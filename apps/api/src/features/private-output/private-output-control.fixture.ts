/* eslint-disable max-classes-per-file -- Native fixture exports both independently stored private child kinds. */
import type * as NativeCloudflare from "@cloudflare/workers-types";
import { PersonProfile } from "@meal-planner/household-api";
import {
  ConfirmationOutcome,
  DirectoryCommand,
  ParticipantMessageText,
  PrivateDiscoveryScope,
  SessionCommand,
} from "@meal-planner/private-interview-api";
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
  #fixtureTime: number | undefined;
  protected override outputTime() {
    return this.#fixtureTime ?? super.outputTime();
  }

  #fixtureDatabase = drizzle(this.ctx.storage);
  #fixtureSocket = new PrivateOutputSocket(
    this.ctx,
    this.#fixtureDatabase,
    this.env,
    () => this.outputTime()
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
        websearch: unexpectedBindingMethod,
        gateway: unexpectedBindingMethod,
        models: unexpectedBindingMethod,

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
  readSocketCount() {
    return this.ctx.getWebSockets().length;
  }

  enqueueOutput(input: {
    readonly generation: string;
    readonly payload: string;
  }) {
    return this.#fixtureSocket.send(
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
    const previous = this.#fixtureTime;
    this.#fixtureTime = now;
    try {
      this.enqueueOutput(input);
    } finally {
      this.#fixtureTime = previous;
    }
  }

  commandAtTime(
    input: {
      readonly generation: string;
      readonly payload: string;
    },
    now: number
  ) {
    const previous = this.#fixtureTime;
    this.#fixtureTime = now;
    try {
      const socket = this.ctx.getWebSockets().find(
        (candidate) =>
          (
            candidate.deserializeAttachment() as {
              generation?: string;
            }
          ).generation === input.generation
      );
      if (socket !== undefined) {
        super.webSocketMessage(socket, input.payload);
      }
    } finally {
      this.#fixtureTime = previous;
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
      | "readSocketCount"
      | "beginConnection"
      | "authorizeConnection"
      | "beginRequest"
      | "authorizeRequest"
      | "executeSession"
      | "readSession"
      | "startTurn"
      | "cancelTurn"
      | "releaseConfirmation"
      | "settleConfirmation"
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
      readonly sql: {
        readonly exec: (query: string) => Promise<unknown>;
      };
    };
  };
};
export class PrivateInterviewDirectory extends ProductionDirectory {
  #fixtureTime: number | undefined;
  protected override outputTime() {
    return this.#fixtureTime ?? super.outputTime();
  }

  readSocketCount() {
    return this.ctx.getWebSockets().length;
  }
  commandAtTime(
    input: {
      readonly generation: string;
      readonly payload: string;
    },
    now: number
  ) {
    const previous = this.#fixtureTime;
    this.#fixtureTime = now;
    try {
      const socket = this.ctx.getWebSockets().find(
        (candidate) =>
          (
            candidate.deserializeAttachment() as {
              generation?: string;
            }
          ).generation === input.generation
      );
      if (socket !== undefined) {
        super.webSocketMessage(socket, input.payload);
      }
    } finally {
      this.#fixtureTime = previous;
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
      | "beginRequest"
      | "authorizeRequest"
      | "executeDirectory"
      | "readSocketCount"
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
  afterCardOrdinal: Schema.optional(Schema.Number),
  afterMessageOrdinal: Schema.optional(Schema.Number),
  binding: Schema.optional(PrivateSessionBinding),
  directoryCommand: Schema.optional(DirectoryCommand),
  directoryKey: Schema.optional(Schema.String),
  discoveryScope: Schema.optional(Schema.NullOr(PrivateDiscoveryScope)),
  expectedVersion: Schema.optional(Schema.Number),
  expiresAt: Schema.optional(Schema.Number),
  generation: Schema.optional(Schema.String),
  intentKey: Schema.optional(Schema.String),
  key: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.Number),
  mutationId: Schema.optional(Schema.String),
  now: Schema.optional(Schema.Number),
  operationId: Schema.optional(Schema.String),
  outcome: Schema.optional(ConfirmationOutcome),
  participant: Schema.optional(PrivateParticipantBinding),
  payload: Schema.optional(Schema.String),
  profile: Schema.optional(PersonProfile),
  scope: Schema.optional(Schema.Literals(["account", "household"])),
  sessionCommand: Schema.optional(SessionCommand),
  sessionReference: Schema.String,
  text: Schema.optional(ParticipantMessageText),
  turnId: Schema.optional(Schema.String),
});

type CommandInput = typeof Command.Type;
type CommandResult =
  | { readonly result: unknown }
  | {
      readonly response:
        | Response
        | Promise<Response | NativeCloudflare.Response>;
    };

const routeDirectoryRequest = async (
  directory: DirectoryPort,
  input: CommandInput,
  generation: { readonly generation: string }
) => {
  let result: unknown = null;
  if (input.action === "directory-begin-request" && input.participant) {
    result = await directory.beginRequest(input.participant);
  } else if (
    input.action === "directory-authorize-request" &&
    input.participant
  ) {
    result = await directory.authorizeRequest({
      ...generation,
      binding: input.participant,
      expiresAt: input.expiresAt ?? 0,
    });
  } else if (
    input.action === "directory-execute-request" &&
    input.participant &&
    input.directoryCommand
  ) {
    result = await directory.executeDirectory({
      ...generation,
      binding: input.participant,
      command: input.directoryCommand,
    });
  } else if (input.action === "directory-socket-count") {
    result = await directory.readSocketCount();
  } else {
    const checkedResult:
      | Awaited<Promise<CommandResult | undefined>>
      | Promise<CommandResult | undefined> = undefined;
    return checkedResult;
  }
  {
    const checkedResult:
      | Awaited<Promise<CommandResult | undefined>>
      | Promise<CommandResult | undefined> = { result };
    return checkedResult;
  }
};

const routeDirectoryCommand = async (
  request: Request,
  directory: DirectoryPort,
  input: CommandInput,
  generation: { readonly generation: string }
) => {
  let result: unknown = null;
  if (input.action === "directory-initialize" && input.participant) {
    result = await directory.initialize(input.participant);
  } else if (input.action === "directory-begin" && input.participant) {
    result = await directory.beginConnection(input.participant);
  } else if (input.action === "directory-authorize" && input.participant) {
    result = await directory.authorizeConnection({
      ...generation,
      binding: input.participant,
      expiresAt: input.expiresAt ?? 0,
    });
  } else if (input.action === "directory-private-http") {
    const checkedResult:
      | Awaited<Promise<CommandResult>>
      | Promise<CommandResult> = {
      response: directory.fetch(new Request(request.url)),
    };
    return checkedResult;
  } else if (input.action === "directory-sql") {
    result = await directory.sql("select * from private_directory_binding");
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
    const checkedResult:
      | Awaited<Promise<CommandResult>>
      | Promise<CommandResult> = {
      response: directory.fetch(
        new Request(request.url, {
          headers: {
            Upgrade: "websocket",
            "private-output-generation": generation.generation,
          },
        })
      ),
    };
    return checkedResult;
  } else {
    const checkedResult:
      | Awaited<Promise<CommandResult>>
      | Promise<CommandResult> = {
      response: new Response(null, { status: 404 }),
    };
    return checkedResult;
  }
  {
    const checkedResult:
      | Awaited<Promise<CommandResult>>
      | Promise<CommandResult> = { result };
    return checkedResult;
  }
};

const routeSessionChat = async (
  request: Request,
  child: SessionPort,
  binding: typeof PrivateSessionBinding.Type,
  profile: CommandInput["profile"],
  generation: { readonly generation: string }
) => {
  const url = new URL("https://private-output.internal/chat");
  url.search = new URL(request.url).search;
  const context = {
    binding,
    generation: generation.generation,
    profile: request.method === "POST" ? (profile ?? null) : null,
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
    {
      const checkedResult:
        | Awaited<Promise<CommandResult>>
        | Promise<CommandResult> = {
        response: child.fetch(
          new Request(url, {
            body: JSON.stringify({ ...body, privateChatContext: context }),
            headers,
            method: "POST",
          })
        ),
      };
      return checkedResult;
    }
  }
  headers.set(
    "private-chat-context",
    encodeURIComponent(JSON.stringify(context))
  );
  {
    const checkedResult:
      | Awaited<Promise<CommandResult>>
      | Promise<CommandResult> = {
      response: child.fetch(
        new Request(url, { headers, method: request.method })
      ),
    };
    return checkedResult;
  }
};

const readSessionCommand = async (
  request: Request,
  child: SessionPort,
  input: CommandInput
) => {
  let result: unknown = null;
  if (input.action === "turns") {
    result = await child.readTurns();
  } else if (input.action === "keep-alive-references") {
    result = await child.readKeepAliveReferences();
  } else if (input.action === "socket-count") {
    result = await child.readSocketCount();
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
    const checkedResult:
      | Awaited<Promise<CommandResult | undefined>>
      | Promise<CommandResult | undefined> = {
      response: child.fetch(new Request(request.url)),
    };
    return checkedResult;
  } else {
    const checkedResult:
      | Awaited<Promise<CommandResult | undefined>>
      | Promise<CommandResult | undefined> = undefined;
    return checkedResult;
  }
  {
    const checkedResult:
      | Awaited<Promise<CommandResult | undefined>>
      | Promise<CommandResult | undefined> = { result };
    return checkedResult;
  }
};

const routeSessionRequest = async (
  child: SessionPort,
  input: CommandInput,
  generation: { readonly generation: string }
) => {
  if (!input.binding) {
    const checkedResult:
      | Awaited<Promise<CommandResult | undefined>>
      | Promise<CommandResult | undefined> = undefined;
    return checkedResult;
  }
  const context = { ...generation, binding: input.binding };
  let result: unknown;
  if (input.action === "begin-request") {
    result = await child.beginRequest(input.binding);
  } else if (input.action === "authorize-request") {
    result = await child.authorizeRequest({
      ...context,
      expiresAt: input.expiresAt ?? 0,
    });
  } else if (input.action === "execute-request" && input.sessionCommand) {
    result = await child.executeSession({
      ...context,
      command: input.sessionCommand,
    });
  } else if (input.action === "read-request") {
    result = await child.readSession({
      ...context,
      afterCardOrdinal: input.afterCardOrdinal ?? 0,
      afterMessageOrdinal: input.afterMessageOrdinal ?? 0,
      limit: input.limit ?? 25,
    });
  } else if (
    input.action === "start-request-turn" &&
    input.profile &&
    input.text &&
    input.turnId
  ) {
    result = await child.startTurn({
      ...context,
      expectedVersion: input.expectedVersion ?? 0,
      profile: input.profile,
      text: input.text,
      turnId: input.turnId,
    });
  } else if (input.action === "cancel-request-turn" && input.turnId) {
    result = await child.cancelTurn({ ...context, turnId: input.turnId });
  } else {
    const checkedResult:
      | Awaited<Promise<CommandResult | undefined>>
      | Promise<CommandResult | undefined> = undefined;
    return checkedResult;
  }
  {
    const checkedResult:
      | Awaited<Promise<CommandResult | undefined>>
      | Promise<CommandResult | undefined> = { result };
    return checkedResult;
  }
};

const routeSessionCommand = async (
  request: Request,
  child: SessionPort,
  input: CommandInput,
  generation: { readonly generation: string }
) => {
  let result: unknown = null;
  if (input.action === "initialize" && input.binding) {
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
    const checkedResult:
      | Awaited<Promise<CommandResult | undefined>>
      | Promise<CommandResult | undefined> = {
      response: child.fetch(
        new Request("https://private-output.internal/upgrade", {
          headers: {
            Upgrade: "websocket",
            "private-output-generation": generation.generation,
          },
        })
      ),
    };
    return checkedResult;
  } else if (input.action === "command-at-time" && input.now !== undefined) {
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
    const checkedResult:
      | Awaited<Promise<CommandResult | undefined>>
      | Promise<CommandResult | undefined> = routeSessionChat(
      request,
      child,
      input.binding,
      input.profile,
      generation
    );
    return checkedResult;
  } else {
    const checkedResult:
      | Awaited<Promise<CommandResult | undefined>>
      | Promise<CommandResult | undefined> = readSessionCommand(
      request,
      child,
      input
    );
    return checkedResult;
  }
  {
    const checkedResult:
      | Awaited<Promise<CommandResult | undefined>>
      | Promise<CommandResult | undefined> = { result };
    return checkedResult;
  }
};

const routeSessionConfirmation = async (
  child: SessionPort,
  input: CommandInput,
  generation: { readonly generation: string }
) => {
  if (!input.binding || !input.mutationId) {
    const checkedResult:
      | Awaited<Promise<CommandResult | undefined>>
      | Promise<CommandResult | undefined> = undefined;
    return checkedResult;
  }
  const context = {
    ...generation,
    binding: input.binding,
    mutationId: input.mutationId,
  };
  if (input.action === "release-confirmation") {
    const checkedResult:
      | Awaited<Promise<CommandResult | undefined>>
      | Promise<CommandResult | undefined> = {
      result: await child.releaseConfirmation(context),
    };
    return checkedResult;
  }
  if (input.action === "settle-confirmation" && input.outcome) {
    const checkedResult:
      | Awaited<Promise<CommandResult | undefined>>
      | Promise<CommandResult | undefined> = {
      result: await child.settleConfirmation({
        ...context,
        outcome: input.outcome,
      }),
    };
    return checkedResult;
  }
  {
    const checkedResult:
      | Awaited<Promise<CommandResult | undefined>>
      | Promise<CommandResult | undefined> = undefined;
    return checkedResult;
  }
};

const routeLifecycleCommand = async (
  coordinator: OutputLifecyclePort,
  input: CommandInput
) => {
  const operation = { operationId: input.operationId ?? "" };
  let result: unknown = null;
  if (input.action === "mutation-find-pending") {
    result = await coordinator.findPendingMutation({
      intentKey: input.intentKey ?? "",
    });
  } else if (input.action === "mutation-begin") {
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
    const checkedResult:
      | Awaited<Promise<CommandResult>>
      | Promise<CommandResult> = {
      response: new Response(null, { status: 404 }),
    };
    return checkedResult;
  }

  {
    const checkedResult:
      | Awaited<Promise<CommandResult>>
      | Promise<CommandResult> = { result };
    return checkedResult;
  }
};

/** Test-only direct capabilities; this shell is never referenced by the production worker resource. */
export default {
  async fetch(request: Request, env: Environment) {
    const input = Schema.decodeUnknownSync(Command, {
      onExcessProperty: "error",
    })(JSON.parse(request.headers.get("x-test-command") ?? "null"));
    const child = env.PrivateInterviewSession.getByName(
      await privateOutputKey("session", input.sessionReference)
    );
    const generation = { generation: input.generation ?? "" };
    try {
      let outcome: CommandResult | undefined;
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
        outcome =
          (await routeDirectoryRequest(directory, input, generation)) ??
          (await routeDirectoryCommand(request, directory, input, generation));
      } else {
        outcome =
          (await routeSessionRequest(child, input, generation)) ??
          (await routeSessionConfirmation(child, input, generation)) ??
          (await routeSessionCommand(request, child, input, generation));
        if (outcome === undefined && input.key) {
          const coordinator = (
            input.scope === "household"
              ? env.HouseholdAgent
              : env.AccountOutputLifecycle
          ).getByName(input.key);
          outcome = await routeLifecycleCommand(coordinator, input);
        }
      }
      if (outcome === undefined) {
        const checkedResult:
          | Awaited<Promise<Response | NativeCloudflare.Response>>
          | Promise<Response | NativeCloudflare.Response> = new Response(null, {
          status: 404,
        });
        return checkedResult;
      }
      if ("response" in outcome) {
        const checkedResult:
          | Awaited<Promise<Response | NativeCloudflare.Response>>
          | Promise<Response | NativeCloudflare.Response> = outcome.response;
        return checkedResult;
      }
      {
        const checkedResult:
          | Awaited<Promise<Response | NativeCloudflare.Response>>
          | Promise<Response | NativeCloudflare.Response> = Response.json({
          result: outcome.result ?? null,
        });
        return checkedResult;
      }
    } catch (error) {
      const checkedResult:
        | Awaited<Promise<Response | NativeCloudflare.Response>>
        | Promise<Response | NativeCloudflare.Response> = Response.json(
        { error: error instanceof Error ? error.message : "Rejected" },
        { status: 409 }
      );
      return checkedResult;
    }
  },
};
