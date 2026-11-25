import type * as NativeCloudflare from "@cloudflare/workers-types";
import {
  MutatePersonProfilePayload,
  readStoredProfilePayload,
} from "@meal-planner/household-api";
import type {
  PrivateRequestSessionSnapshot,
  SessionState,
} from "@meal-planner/private-interview-api";
import {
  AssistantTurn,
  AssistantTurnId,
  MAX_PRIVATE_FRAME_BYTES,
  ParticipantMessageText,
  ProfileCard,
  SessionCommand,
  SessionFrame,
} from "@meal-planner/private-interview-api";
import {
  chatParamsFromRequestBody,
  convertMessagesToModelMessages,
  requestRunCancel,
  resumeServerSentEventsResponse,
  toServerSentEventsResponse,
} from "@tanstack/ai";
import { reconstructChat, withPersistence } from "@tanstack/ai-persistence";
import { Agent } from "agents";
import { instrumentDrizzle } from "cloudflare-drizzle-tracing";
import { eq, gt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import { Schema } from "effect";

import migrations from "../../../private-output-migrations/migrations.js";
import { PrivateAssistantTurns } from "./private-assistant-turns.js";
import { fencePrivateChatResponse } from "./private-chat-delivery.js";
import { PrivateChatPersistence } from "./private-chat-persistence.js";
import {
  PrivateChatContext,
  PrivateChatMetadata,
} from "./private-chat.contract.js";
import type { ReleasedConfirmation } from "./private-confirmation.contract.js";
import {
  ReleaseConfirmation,
  SettleConfirmation,
} from "./private-confirmation.contract.js";
import { PrivateDiscoveryFailure } from "./private-discovery-model.js";
import { makePrivateDiscoveryModel } from "./private-discovery-workers-ai.js";
import { PrivateOutputSocket } from "./private-output-socket.js";
import type { PrivateInterviewEnvironment } from "./private-output-socket.js";
import {
  Generation,
  PrivateSessionBinding,
  InitializePrivateSession,
  PrivateOutputUnavailable,
  privateOutputKey,
  privateDirectoryKey,
} from "./private-output.contract.js";
import {
  privateProfileCards,
  privatePendingConfirmation,
  privateReceipts,
  privateSessionBinding,
  privateDiscoverySessionScopes,
  privateAssistantTurns,
} from "./private-output.database-schema.js";
import {
  PrivateRequestCancel,
  PrivateRequestTurn,
  PrivateSessionRead,
  PrivateSessionRequest,
} from "./private-request.contract.js";

declare const Response: typeof NativeCloudflare.Response;

const agentResponse = (response: NativeCloudflare.Response) => {
  const checkedResult: globalThis.Response =
    response as unknown as globalThis.Response;
  return checkedResult;
};
const Authorization = Schema.Struct({
  ...Generation.fields,
  binding: PrivateSessionBinding,
  expiresAt: Schema.Number,
});
const decodeBinding = Schema.decodeUnknownSync(PrivateSessionBinding, {
  onExcessProperty: "error",
});
type CardMutation = Extract<
  SessionCommand,
  {
    readonly cardId: string;
  }
>;
type ThreadPersistence = ReturnType<PrivateChatPersistence["forThread"]>;
type ParsedChatParameters = Awaited<
  ReturnType<typeof chatParamsFromRequestBody>
>;
interface PrivateChatPostContext extends PrivateChatContext {
  readonly profile: NonNullable<PrivateChatContext["profile"]>;
}
interface PendingAuthorization {
  previousGeneration: string;
  generation: string | null;
  ready: ReturnType<typeof Promise.withResolvers<null>>;
}
const sameBinding = (
  left: PrivateSessionBinding,
  right: PrivateSessionBinding
) =>
  left.accountKey === right.accountKey &&
  left.householdKey === right.householdKey &&
  left.linkageSubject === right.linkageSubject &&
  left.personId === right.personId &&
  left.sessionReference === right.sessionReference;
/** Owns canonical private history, model turns and their socket or request output lease. */
export class PrivateInterviewSession extends Agent<PrivateInterviewEnvironment> {
  #database = instrumentDrizzle(drizzle(this.ctx.storage), {
    attributes: { "db.namespace": "private-output" },
  });
  #socket = new PrivateOutputSocket(this.ctx, this.#database, this.env);
  #turns = new PrivateAssistantTurns(this.#database, this.#socket);
  #chat = new PrivateChatPersistence(this.#database);
  #deliveries = new Map<string, Map<AbortController, string | null>>();
  #reauthorization: PendingAuthorization | null = null;
  constructor(
    context: NativeCloudflare.DurableObjectState,
    environment: PrivateInterviewEnvironment
  ) {
    super(context, environment);
    context.blockConcurrencyWhile(() => {
      migrate(this.#database, migrations);
      this.#socket.restart();
      this.#turns.interrupt("runtime_restarted");
      this.#chat.closeInterruptedStreams();
      return Promise.resolve();
    });
  }
  initialize(untrusted: typeof InitializePrivateSession.Type) {
    const { binding, scope } = Schema.decodeUnknownSync(
      InitializePrivateSession,
      {
        onExcessProperty: "error",
      }
    )(untrusted);
    this.#database.transaction(() => {
      const retained = this.#database
        .select()
        .from(privateSessionBinding)
        .get();
      const retainedScope =
        this.#database
          .select()
          .from(privateDiscoverySessionScopes)
          .where(
            eq(
              privateDiscoverySessionScopes.sessionReference,
              binding.sessionReference
            )
          )
          .get()?.scope ?? null;
      if (retained !== undefined) {
        if (!sameBinding(retained, binding) || retainedScope !== scope) {
          throw new PrivateOutputUnavailable({ reason: "binding_conflict" });
        }
        return;
      }
      this.#database
        .insert(privateSessionBinding)
        .values({ ...binding, status: "open", version: 0 })
        .run();
      if (scope !== null) {
        this.#database
          .insert(privateDiscoverySessionScopes)
          .values({ scope, sessionReference: binding.sessionReference })
          .run();
      }
    });
  }
  beginConnection(untrusted: PrivateSessionBinding) {
    const checkedResult: Promise<string> = this.#beginConnection(
      decodeBinding(untrusted)
    );
    return checkedResult;
  }
  async beginRequest(untrusted: PrivateSessionBinding) {
    const binding = decodeBinding(untrusted);
    const childName = await privateOutputKey(
      "session",
      binding.sessionReference
    );
    this.#binding(binding);
    const current = this.#socket.readRequest();
    if (
      current !== null &&
      !this.#socket.isRequestCurrent(current.generation)
    ) {
      this.#turns.interrupt("connection_lost", current.generation);
      this.#detachDeliveries(current.generation);
    }
    {
      const checkedResult: Awaited<Promise<string>> | Promise<string> =
        this.#socket.beginRequest(binding, {
          childName,
          targetKind: "session",
        });
      return checkedResult;
    }
  }
  async #beginConnection(binding: PrivateSessionBinding) {
    const childName = await privateOutputKey(
      "session",
      binding.sessionReference
    );
    this.#binding(binding);
    const previous = this.#socket.read();
    const ongoing = this.#reauthorization;
    const turnGeneration = this.#turns.pendingGeneration();
    let previousGeneration =
      ongoing?.previousGeneration ?? previous?.generation;
    if (
      turnGeneration !== undefined &&
      (turnGeneration === previous?.generation ||
        turnGeneration === ongoing?.previousGeneration)
    ) {
      previousGeneration = turnGeneration;
    }
    const pending: PendingAuthorization | null =
      previousGeneration === undefined
        ? null
        : {
            generation: null,
            previousGeneration,
            ready: ongoing?.ready ?? Promise.withResolvers<null>(),
          };
    this.#reauthorization = pending;
    if (previous !== null) {
      this.#detachDeliveries(previous.generation);
    }
    try {
      const generation = await this.#socket.begin(binding, {
        childName,
        targetKind: "session",
      });
      if (pending !== null) {
        pending.generation = generation;
      }
      {
        const checkedResult: Awaited<Promise<string>> | Promise<string> =
          generation;
        return checkedResult;
      }
    } catch (error) {
      if (this.#reauthorization === pending) {
        if (pending !== null) {
          this.#turns.interrupt("connection_lost", pending.previousGeneration);
          pending.ready.resolve(null);
        }
        this.#reauthorization = null;
      }
      throw error;
    }
  }
  authorizeConnection(untrusted: typeof Authorization.Type) {
    const input = Schema.decodeUnknownSync(Authorization, {
      onExcessProperty: "error",
    })(untrusted);
    this.#binding(input.binding);
    this.#socket.authorize(input.generation, input.expiresAt);
    if (this.#reauthorization?.generation === input.generation) {
      this.#turns.reauthorize(
        this.#reauthorization.previousGeneration,
        input.generation
      );
    }
  }
  authorizeRequest(untrusted: typeof Authorization.Type) {
    const input = Schema.decodeUnknownSync(Authorization, {
      onExcessProperty: "error",
    })(untrusted);
    this.#binding(input.binding);
    this.#socket.authorizeRequest(input.generation, input.expiresAt);
    this.#turns.reauthorize(input.generation, input.generation);
  }
  #assertRequest(binding: PrivateSessionBinding, generation: string) {
    this.#binding(binding);
    if (!this.#socket.isRequestCurrent(generation)) {
      throw new PrivateOutputUnavailable({ reason: "output_disabled" });
    }
  }
  executeSession(untrusted: typeof PrivateSessionRequest.Type) {
    const input = Schema.decodeUnknownSync(PrivateSessionRequest, {
      onExcessProperty: "error",
    })(untrusted);
    this.#assertRequest(input.binding, input.generation);
    {
      const checkedResult: SessionFrame = this.#execute(
        input.command,
        input.generation
      );
      return checkedResult;
    }
  }
  readSession(untrusted: typeof PrivateSessionRead.Type) {
    const input = Schema.decodeUnknownSync(PrivateSessionRead, {
      onExcessProperty: "error",
    })(untrusted);
    this.#assertRequest(input.binding, input.generation);
    const cards = this.#execute(
      {
        afterOrdinal: input.afterCardOrdinal,
        limit: input.limit,
        requestId: crypto.randomUUID(),
        type: "ReadCards",
      },
      input.generation
    );
    if (cards.type !== "CardsRead") {
      throw new PrivateOutputUnavailable({ reason: "binding_conflict" });
    }
    const history = this.#chat.historyPage(
      input.afterMessageOrdinal,
      input.limit
    );
    {
      const checkedResult: PrivateRequestSessionSnapshot = {
        assistantTurn: this.#turns.latest(),
        cards: cards.cards,
        hasMoreCards: cards.hasMore,
        hasMoreMessages: history.hasMore,
        messages: history.messages,
        pendingConfirmation: cards.pendingConfirmation,
        state: cards.state,
      };
      return checkedResult;
    }
  }
  #readTurn(turnId: string) {
    const turn = this.#database
      .select()
      .from(privateAssistantTurns)
      .where(eq(privateAssistantTurns.id, turnId))
      .get();
    if (turn === undefined) {
      throw new PrivateOutputUnavailable({ reason: "binding_conflict" });
    }
    {
      const checkedResult: AssistantTurn =
        Schema.decodeUnknownSync(AssistantTurn)(turn);
      return checkedResult;
    }
  }
  async startTurn(untrusted: typeof PrivateRequestTurn.Type) {
    const input = Schema.decodeUnknownSync(PrivateRequestTurn, {
      onExcessProperty: "error",
    })(untrusted);
    this.#assertRequest(input.binding, input.generation);
    const response = await this.#chatRequest(
      new Request("https://private-output.internal/chat", {
        body: JSON.stringify({
          context: [],
          forwardedProps: { expectedVersion: input.expectedVersion },
          messages: [
            { content: input.text, id: crypto.randomUUID(), role: "user" },
          ],
          privateChatContext: {
            binding: input.binding,
            generation: input.generation,
            profile: input.profile,
          },
          runId: input.turnId,
          state: {},
          threadId: input.binding.sessionReference,
          tools: [],
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );
    if (!response.ok) {
      throw new PrivateOutputUnavailable({ reason: "operation_conflict" });
    }
    if (response.body !== null) {
      const { body } = response;
      const drain = async () => {
        try {
          await body.pipeTo(new WritableStream());
        } catch {}
      };
      this.ctx.waitUntil(drain());
    }
    this.#assertRequest(input.binding, input.generation);
    {
      const checkedResult:
        | Awaited<Promise<AssistantTurn>>
        | Promise<AssistantTurn> = this.#readTurn(input.turnId);
      return checkedResult;
    }
  }
  async cancelTurn(untrusted: typeof PrivateRequestCancel.Type) {
    const input = Schema.decodeUnknownSync(PrivateRequestCancel, {
      onExcessProperty: "error",
    })(untrusted);
    this.#assertRequest(input.binding, input.generation);
    const previous = this.#readTurn(input.turnId);
    if (previous.status === "cancelled") {
      const checkedResult:
        | Awaited<Promise<AssistantTurn>>
        | Promise<AssistantTurn> = previous;
      return checkedResult;
    }
    const url = new URL("https://private-output.internal/chat");
    url.searchParams.set("runId", input.turnId);
    const response = await this.#cancelChat(
      { ...input, profile: null },
      url,
      this.#chat.forThread(input.binding.sessionReference)
    );
    if (!response.ok) {
      throw new PrivateOutputUnavailable({ reason: "operation_conflict" });
    }
    this.#assertRequest(input.binding, input.generation);
    {
      const checkedResult:
        | Awaited<Promise<AssistantTurn>>
        | Promise<AssistantTurn> = this.#readTurn(input.turnId);
      return checkedResult;
    }
  }
  override async fetch(request: Request | NativeCloudflare.Request) {
    const { pathname } = new URL(request.url);
    if (pathname === "/chat") {
      const checkedResult:
        | Awaited<Promise<globalThis.Response>>
        | Promise<globalThis.Response> = agentResponse(
        await this.#chatRequest(request)
      );
      return checkedResult;
    }
    if (pathname !== "/" && pathname !== "/upgrade") {
      const checkedResult:
        | Awaited<Promise<globalThis.Response>>
        | Promise<globalThis.Response> = agentResponse(
        new Response(null, { status: 404 })
      );
      return checkedResult;
    }
    const binding = this.#database.select().from(privateSessionBinding).get();
    if (binding === undefined) {
      const checkedResult:
        | Awaited<Promise<globalThis.Response>>
        | Promise<globalThis.Response> = agentResponse(
        new Response(null, { status: 403 })
      );
      return checkedResult;
    }
    const bindingKey = await privateDirectoryKey(binding);
    const response = this.#socket.accept(
      request,
      JSON.stringify({
        assistantTurn: this.#turns.latest(),
        bindingKey,
        generation: request.headers.get("private-output-generation"),
        pendingConfirmation: this.#pending()?.mutationId ?? null,
        sessionReference: binding.sessionReference,
        state: this.#state(),
        type: "SessionReady",
      })
    );
    if (
      response.status === 101 &&
      this.#reauthorization?.generation ===
        request.headers.get("private-output-generation")
    ) {
      this.#reauthorization.ready.resolve(null);
      this.#reauthorization = null;
    }
    {
      const checkedResult:
        | Awaited<Promise<globalThis.Response>>
        | Promise<globalThis.Response> = agentResponse(response);
      return checkedResult;
    }
  }
  #detachDeliveries(generation: string, runId?: string) {
    const deliveries = this.#deliveries.get(generation);
    if (deliveries === undefined) {
      return;
    }
    for (const [controller, deliveryRun] of deliveries) {
      if (runId === undefined || deliveryRun === runId) {
        deliveries.delete(controller);
        controller.abort();
      }
    }
    if (deliveries.size === 0) {
      this.#deliveries.delete(generation);
    }
  }
  async #waitForAuthorization(signal: AbortSignal) {
    const pending = this.#reauthorization;
    if (pending === null || signal.aborted) {
      return;
    }
    const cancelled = Promise.withResolvers<null>();
    const abort = () => cancelled.resolve(null);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
    }
    try {
      await Promise.race([pending.ready.promise, cancelled.promise]);
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }
  #turnAwaitingAuthorization() {
    const pending = this.#reauthorization;
    const generation = this.#turns.pendingGeneration();
    {
      const checkedResult: boolean =
        pending !== null &&
        (generation === pending.previousGeneration ||
          generation === pending.generation);
      return checkedResult;
    }
  }
  #deliver(
    response: globalThis.Response,
    generation: string,
    runId: string | null = null
  ) {
    const controller = new AbortController();
    const deliveries =
      this.#deliveries.get(generation) ??
      new Map<AbortController, string | null>();
    deliveries.set(controller, runId);
    this.#deliveries.set(generation, deliveries);
    const guarded = fencePrivateChatResponse(
      response,
      () => this.#socket.isCurrent(generation),
      controller.signal,
      () => {
        deliveries.delete(controller);
        if (deliveries.size === 0) {
          this.#deliveries.delete(generation);
        }
      }
    );
    {
      const checkedResult: NativeCloudflare.Response = new Response(
        guarded.body,
        {
          headers: guarded.headers,
          status: guarded.status,
        }
      );
      return checkedResult;
    }
  }
  async #chatRequest(request: Request | NativeCloudflare.Request) {
    if (!["GET", "POST", "DELETE"].includes(request.method)) {
      const checkedResult:
        | Awaited<Promise<NativeCloudflare.Response>>
        | Promise<NativeCloudflare.Response> = new Response(null, {
        status: 404,
      });
      return checkedResult;
    }
    let body: unknown;
    let input: PrivateChatContext;
    try {
      if (request.method === "POST") {
        body = await request.json();
        const envelope = Schema.decodeUnknownSync(
          Schema.Struct({ privateChatContext: Schema.Unknown })
        )(body);
        input = Schema.decodeUnknownSync(PrivateChatContext, {
          onExcessProperty: "error",
        })(envelope.privateChatContext);
      } else {
        input = Schema.decodeUnknownSync(PrivateChatContext, {
          onExcessProperty: "error",
        })(
          JSON.parse(
            decodeURIComponent(
              request.headers.get("private-chat-context") ?? ""
            )
          )
        );
      }
      this.#binding(input.binding);
      if (!this.#socket.isCurrent(input.generation)) {
        const checkedResult:
          | Awaited<Promise<NativeCloudflare.Response>>
          | Promise<NativeCloudflare.Response> = new Response(null, {
          status: 403,
        });
        return checkedResult;
      }
    } catch {
      const checkedResult:
        | Awaited<Promise<NativeCloudflare.Response>>
        | Promise<NativeCloudflare.Response> = new Response(null, {
        status: 403,
      });
      return checkedResult;
    }
    const threadId = input.binding.sessionReference;
    const url = new URL(request.url);
    if (
      url.searchParams.has("threadId") &&
      url.searchParams.get("threadId") !== threadId
    ) {
      const checkedResult:
        | Awaited<Promise<NativeCloudflare.Response>>
        | Promise<NativeCloudflare.Response> = new Response(null, {
        status: 403,
      });
      return checkedResult;
    }
    const persistence = this.#chat.forThread(threadId);
    if (request.method === "GET") {
      const checkedResult:
        | Awaited<Promise<NativeCloudflare.Response>>
        | Promise<NativeCloudflare.Response> = this.#readChat(
        request,
        input,
        url,
        persistence
      );
      return checkedResult;
    }
    if (request.method === "DELETE") {
      const checkedResult:
        | Awaited<Promise<NativeCloudflare.Response>>
        | Promise<NativeCloudflare.Response> = this.#cancelChat(
        input,
        url,
        persistence
      );
      return checkedResult;
    }
    if (
      input.profile === null ||
      input.profile.personId !== input.binding.personId
    ) {
      const checkedResult:
        | Awaited<Promise<NativeCloudflare.Response>>
        | Promise<NativeCloudflare.Response> = new Response(null, {
        status: 403,
      });
      return checkedResult;
    }
    try {
      const params = await chatParamsFromRequestBody(body);
      {
        const checkedResult:
          | Awaited<Promise<NativeCloudflare.Response>>
          | Promise<NativeCloudflare.Response> = this.#postChat(
          request,
          { ...input, profile: input.profile },
          params,
          persistence
        );
        return checkedResult;
      }
    } catch {
      const checkedResult:
        | Awaited<Promise<NativeCloudflare.Response>>
        | Promise<NativeCloudflare.Response> = new Response(null, {
        status: 400,
      });
      return checkedResult;
    }
  }
  #replayChat(input: PrivateChatContext, runId: string, offset: string) {
    return this.#deliver(
      resumeServerSentEventsResponse({
        adapter: this.#chat.stream({
          offset,
          runId,
          threadId: input.binding.sessionReference,
        }),
      }),
      input.generation,
      runId
    );
  }
  async #readChat(
    request: Request | NativeCloudflare.Request,
    input: PrivateChatContext,
    url: URL,
    persistence: ThreadPersistence
  ) {
    const threadId = input.binding.sessionReference;
    try {
      const runId = url.searchParams.get("runId");
      if (runId !== null) {
        Schema.decodeUnknownSync(AssistantTurnId)(runId);
        {
          const checkedResult:
            | Awaited<Promise<NativeCloudflare.Response>>
            | Promise<NativeCloudflare.Response> = this.#replayChat(
            input,
            runId,
            request.headers.get("Last-Event-ID") ??
              url.searchParams.get("offset") ??
              "-1"
          );
          return checkedResult;
        }
      }
      url.searchParams.set("threadId", threadId);
      {
        const checkedResult:
          | Awaited<Promise<NativeCloudflare.Response>>
          | Promise<NativeCloudflare.Response> = this.#deliver(
          await reconstructChat(persistence, new globalThis.Request(url), {
            authorize: (requested) =>
              requested === threadId &&
              this.#socket.isCurrent(input.generation),
          }),
          input.generation
        );
        return checkedResult;
      }
    } catch {
      const checkedResult:
        | Awaited<Promise<NativeCloudflare.Response>>
        | Promise<NativeCloudflare.Response> = new Response(null, {
        status: 400,
      });
      return checkedResult;
    }
  }
  async #cancelChat(
    input: PrivateChatContext,
    url: URL,
    persistence: ThreadPersistence
  ) {
    try {
      const runId = Schema.decodeUnknownSync(AssistantTurnId)(
        url.searchParams.get("runId")
      );
      if (!this.#turns.canCancel(runId)) {
        const checkedResult:
          | Awaited<Promise<NativeCloudflare.Response>>
          | Promise<NativeCloudflare.Response> = new Response(null, {
          status: 409,
        });
        return checkedResult;
      }
      await requestRunCancel(persistence.stores.runs, runId);
      if (!this.#socket.isCurrent(input.generation)) {
        const checkedResult:
          | Awaited<Promise<NativeCloudflare.Response>>
          | Promise<NativeCloudflare.Response> = new Response(null, {
          status: 403,
        });
        return checkedResult;
      }
      const turn = this.#turns.cancel(runId);
      this.#chat.closeInterruptedStreams();
      this.#detachDeliveries(input.generation, runId);
      this.#socket.send(
        input.generation,
        JSON.stringify({
          state: this.#state(),
          turn,
          type: "AssistantTurnUpdated",
        })
      );
      {
        const checkedResult:
          | Awaited<Promise<NativeCloudflare.Response>>
          | Promise<NativeCloudflare.Response> = new Response(null, {
          status: 204,
        });
        return checkedResult;
      }
    } catch {
      const checkedResult:
        | Awaited<Promise<NativeCloudflare.Response>>
        | Promise<NativeCloudflare.Response> = new Response(null, {
        status: 400,
      });
      return checkedResult;
    }
  }
  async #postChat(
    request: Request | NativeCloudflare.Request,
    input: PrivateChatPostContext,
    params: ParsedChatParameters,
    persistence: ThreadPersistence
  ) {
    const threadId = input.binding.sessionReference;
    try {
      const runId = Schema.decodeUnknownSync(AssistantTurnId)(params.runId);
      const { expectedVersion } = Schema.decodeUnknownSync(PrivateChatMetadata)(
        params.forwardedProps
      );
      if (
        params.threadId !== threadId ||
        !this.#socket.isCurrent(input.generation)
      ) {
        const checkedResult:
          | Awaited<Promise<NativeCloudflare.Response>>
          | Promise<NativeCloudflare.Response> = new Response(null, {
          status: 403,
        });
        return checkedResult;
      }
      const latest = convertMessagesToModelMessages(params.messages).at(-1);
      if (latest?.role !== "user") {
        const checkedResult:
          | Awaited<Promise<NativeCloudflare.Response>>
          | Promise<NativeCloudflare.Response> = new Response(null, {
          status: 400,
        });
        return checkedResult;
      }
      const text = Schema.decodeUnknownSync(ParticipantMessageText)(
        latest.content
      );
      const existing = this.#database
        .select()
        .from(privateAssistantTurns)
        .where(eq(privateAssistantTurns.id, runId))
        .get();
      if (existing !== undefined) {
        if (
          existing.expectedSessionVersion !== expectedVersion + 1 ||
          this.#chat.participant(existing.sourceMessageId)?.text !== text
        ) {
          const checkedResult:
            | Awaited<Promise<NativeCloudflare.Response>>
            | Promise<NativeCloudflare.Response> = new Response(null, {
            status: 409,
          });
          return checkedResult;
        }
        {
          const checkedResult:
            | Awaited<Promise<NativeCloudflare.Response>>
            | Promise<NativeCloudflare.Response> = this.#replayChat(
            input,
            runId,
            request.headers.get("Last-Event-ID") ?? "-1"
          );
          return checkedResult;
        }
      }
      if (request.headers.has("Last-Event-ID")) {
        const checkedResult:
          | Awaited<Promise<NativeCloudflare.Response>>
          | Promise<NativeCloudflare.Response> = new Response(null, {
          status: 409,
        });
        return checkedResult;
      }
      const state = this.#state();
      if (
        state.status !== "open" ||
        state.version !== expectedVersion ||
        this.#pending() !== undefined ||
        this.#turns.pending() !== undefined
      ) {
        const checkedResult:
          | Awaited<Promise<NativeCloudflare.Response>>
          | Promise<NativeCloudflare.Response> = new Response(null, {
          status: 409,
        });
        return checkedResult;
      }
      const turn = this.#database.transaction(() => {
        const participant = this.#chat.appendParticipant({
          createdAt: Date.now(),
          id: crypto.randomUUID(),
          text,
        });
        this.#database
          .update(privateSessionBinding)
          .set({ version: expectedVersion + 1 })
          .run();
        return this.#turns.queue({
          expectedSessionVersion: expectedVersion + 1,
          generation: input.generation,
          id: runId,
          sourceMessageId: participant.id,
        });
      });
      this.#socket.send(
        input.generation,
        JSON.stringify({
          state: this.#state(),
          turn,
          type: "AssistantTurnUpdated",
        })
      );
      const messages = await persistence.stores.messages.loadThread(threadId);
      const prepared = await this.#turns.prepare({
        binding: input.binding,
        generation: input.generation,
        profile: input.profile,
        turnId: runId,
      });
      try {
        const stream = makePrivateDiscoveryModel(this.env).stream({
          abortController: prepared.abortController,
          beforeDispatch: prepared.beforeDispatch,
          chat: {
            accept: async (result) => {
              while (
                this.#turnAwaitingAuthorization() &&
                !prepared.signal.aborted
              ) {
                // eslint-disable-next-line no-await-in-loop
                await this.#waitForAuthorization(prepared.signal);
              }
              return prepared.accept(result);
            },
            dispose: prepared.dispose,
            fail: prepared.fail,
            messages,
            middleware: [
              withPersistence(persistence, { snapshotStreaming: false }),
            ],
            runId,
            threadId,
          },
          context: prepared.context,
        });
        this.ctx.waitUntil(this.keepAliveWhile(() => prepared.done));
        {
          const checkedResult:
            | Awaited<Promise<NativeCloudflare.Response>>
            | Promise<NativeCloudflare.Response> = this.#deliver(
            toServerSentEventsResponse(stream, {
              abortController: prepared.abortController,
              durability: {
                adapter: this.#chat.stream({ offset: null, runId, threadId }),
                batch: 1,
              },
              headers: { "Cache-Control": "no-store" },
            }),
            input.generation,
            runId
          );
          return checkedResult;
        }
      } catch (error) {
        await prepared.fail(
          error instanceof PrivateDiscoveryFailure
            ? error
            : new PrivateDiscoveryFailure({
                provenance: null,
                reason: "provider_unavailable",
                stage: null,
                usage: null,
              })
        );
        prepared.dispose();
        {
          const checkedResult:
            | Awaited<Promise<NativeCloudflare.Response>>
            | Promise<NativeCloudflare.Response> = new Response(null, {
            status: 400,
          });
          return checkedResult;
        }
      }
    } catch {
      const checkedResult:
        | Awaited<Promise<NativeCloudflare.Response>>
        | Promise<NativeCloudflare.Response> = new Response(null, {
        status: 400,
      });
      return checkedResult;
    }
  }
  #binding(expected: PrivateSessionBinding) {
    const binding = this.#database.select().from(privateSessionBinding).get();
    if (binding === undefined || !sameBinding(binding, expected)) {
      throw new PrivateOutputUnavailable({ reason: "binding_conflict" });
    }
    return binding;
  }
  #pending() {
    return this.#database.select().from(privatePendingConfirmation).get();
  }
  #card(cardId: string) {
    const row = this.#database
      .select()
      .from(privateProfileCards)
      .where(eq(privateProfileCards.id, cardId))
      .get();
    return row === undefined
      ? undefined
      : Schema.decodeUnknownSync(Schema.fromJsonString(ProfileCard))(
          row.cardJson
        );
  }
  #saveCard(card: ProfileCard) {
    this.#database
      .update(privateProfileCards)
      .set({ cardJson: JSON.stringify(card) })
      .where(eq(privateProfileCards.id, card.id))
      .run();
  }
  #cardRejection(command: CardMutation) {
    const card = this.#card(command.cardId);
    if (card === undefined) {
      const checkedResult:
        | Extract<
            SessionFrame,
            {
              type: "Rejected";
            }
          >["reason"]
        | undefined = "card_not_found";
      return checkedResult;
    }
    if (
      card.revision !== command.cardRevision ||
      (card.status !== "proposed" && card.status !== "conflict") ||
      (command.type === "ConfirmProfileCard" && card.status !== "proposed")
    ) {
      const checkedResult:
        | Extract<
            SessionFrame,
            {
              type: "Rejected";
            }
          >["reason"]
        | undefined = "card_conflict";
      return checkedResult;
    }
    if (
      command.type === "ConfirmProfileCard" &&
      card.change._tag === "ConfirmHardConstraintReduction" &&
      command.safetyConfirmation === null
    ) {
      const checkedResult:
        | Extract<
            SessionFrame,
            {
              type: "Rejected";
            }
          >["reason"]
        | undefined = "safety_confirmation_required";
      return checkedResult;
    }
    {
      const checkedResult:
        | Extract<
            SessionFrame,
            {
              type: "Rejected";
            }
          >["reason"]
        | undefined = undefined;
      return checkedResult;
    }
  }
  #mutateCard(command: CardMutation, state: typeof SessionState.Type) {
    const card = this.#card(command.cardId);
    if (card === undefined) {
      throw new PrivateOutputUnavailable({ reason: "binding_conflict" });
    }
    let updated: ProfileCard;
    if (command.type === "ReviseProfileCard") {
      updated = {
        ...card,
        change: command.change,
        expectedProfileVersion: command.expectedProfileVersion,
        outcome: null,
        reviewedFact: command.reviewedFact,
        revision: card.revision + 1,
        status: "proposed",
      };
    } else if (command.type === "RejectProfileCard") {
      updated = { ...card, status: "rejected" };
    } else {
      updated = { ...card, status: "pending" };
      const { change } = card;
      let closedCommand;
      if (change._tag === "AddConfirmedProfileFact") {
        closedCommand = { _tag: "AddProfileFact", fact: change.fact };
      } else if (change._tag === "ConfirmHardConstraintReduction") {
        closedCommand = { ...change, confirmation: command.safetyConfirmation };
      } else {
        closedCommand = change;
      }
      const payload = Schema.decodeUnknownSync(MutatePersonProfilePayload, {
        onExcessProperty: "error",
      })({
        command: closedCommand,
        expectedProfileVersion: card.expectedProfileVersion,
        mutationId: command.mutationId,
      });
      this.#database
        .insert(privatePendingConfirmation)
        .values({
          cardId: card.id,
          mutationId: command.mutationId,
          payloadJson: JSON.stringify(payload),
          singleton: 1,
        })
        .run();
    }
    this.#saveCard(updated);
    {
      const checkedResult: SessionFrame = {
        card: updated,
        mutationId: command.mutationId,
        state,
        type:
          command.type === "ConfirmProfileCard"
            ? "ConfirmationPending"
            : "CardUpdated",
      };
      return checkedResult;
    }
  }
  /** Releases only the already-confirmed closed command under fresh API admission. */
  releaseConfirmation(untrusted: typeof ReleaseConfirmation.Type) {
    const input = Schema.decodeUnknownSync(ReleaseConfirmation, {
      onExcessProperty: "error",
    })(untrusted);
    this.#binding(input.binding);
    const { generation } = input;
    if (!this.#socket.isCurrent(generation)) {
      throw new PrivateOutputUnavailable({ reason: "output_disabled" });
    }
    const pending = this.#pending();
    if (
      pending?.mutationId === input.mutationId &&
      this.#state().status === "open"
    ) {
      const checkedResult: ReleasedConfirmation = {
        generation,
        payload: readStoredProfilePayload(JSON.parse(pending.payloadJson)),
        type: "pending",
      };
      return checkedResult;
    }
    const receipt = this.#database
      .select()
      .from(privateReceipts)
      .where(eq(privateReceipts.mutationId, input.mutationId))
      .get();
    if (receipt !== undefined) {
      const frame = Schema.decodeUnknownSync(
        Schema.fromJsonString(SessionFrame)
      )(receipt.frame);
      if (frame.type === "ConfirmationSettled") {
        this.#socket.send(generation, JSON.stringify(frame));
        {
          const checkedResult: ReleasedConfirmation = { type: "settled" };
          return checkedResult;
        }
      }
    }
    throw new PrivateOutputUnavailable({ reason: "binding_conflict" });
  }
  /** Canonical results may settle after revocation, but may never emit through that old generation. */
  settleConfirmation(untrusted: typeof SettleConfirmation.Type) {
    const input = Schema.decodeUnknownSync(SettleConfirmation, {
      onExcessProperty: "error",
    })(untrusted);
    this.#binding(input.binding);
    const frame = this.#database.transaction(() => {
      const receipt = this.#database
        .select()
        .from(privateReceipts)
        .where(eq(privateReceipts.mutationId, input.mutationId))
        .get();
      if (receipt === undefined) {
        throw new PrivateOutputUnavailable({ reason: "binding_conflict" });
      }
      const recorded = Schema.decodeUnknownSync(
        Schema.fromJsonString(SessionFrame)
      )(receipt.frame);
      if (recorded.type === "ConfirmationSettled") {
        if (
          JSON.stringify(recorded.outcome) !== JSON.stringify(input.outcome)
        ) {
          throw new PrivateOutputUnavailable({ reason: "binding_conflict" });
        }
        {
          const checkedResult: SessionFrame = recorded;
          return checkedResult;
        }
      }
      const pending = this.#pending();
      const card =
        pending === undefined ? undefined : this.#card(pending.cardId);
      if (
        pending?.mutationId !== input.mutationId ||
        card?.status !== "pending" ||
        this.#state().status !== "open"
      ) {
        throw new PrivateOutputUnavailable({ reason: "binding_conflict" });
      }
      const next: ProfileCard = {
        ...card,
        outcome: input.outcome,
        status: input.outcome.type === "committed" ? "confirmed" : "conflict",
      };
      this.#saveCard(next);
      this.#database.delete(privatePendingConfirmation).run();
      const state = {
        status: "open" as const,
        version: this.#state().version + 1,
      };
      this.#database.update(privateSessionBinding).set(state).run();
      const result: SessionFrame = {
        card: next,
        mutationId: input.mutationId,
        outcome: input.outcome,
        state,
        type: "ConfirmationSettled",
      };
      this.#database
        .update(privateReceipts)
        .set({ frame: JSON.stringify(result) })
        .where(eq(privateReceipts.mutationId, input.mutationId))
        .run();
      {
        const checkedResult: SessionFrame = result;
        return checkedResult;
      }
    });
    this.#socket.send(input.generation, JSON.stringify(frame));
  }
  #state() {
    const binding = this.#database.select().from(privateSessionBinding).get();
    if (binding === undefined) {
      throw new PrivateOutputUnavailable({ reason: "binding_conflict" });
    }
    return { status: binding.status, version: binding.version };
  }
  #turnRejection() {
    const checkedResult:
      | Extract<
          SessionFrame,
          {
            type: "Rejected";
          }
        >["reason"]
      | undefined =
      this.#turns.pending() === undefined
        ? undefined
        : "assistant_turn_pending";
    return checkedResult;
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
    const frame = this.#execute(command, generation);
    this.#socket.send(generation, JSON.stringify(frame));
  }
  #execute(command: SessionCommand, generation: string) {
    const checkedResult: SessionFrame = this.#database.transaction(
      (transaction) => {
        if (!this.#socket.isCurrent(generation)) {
          throw new PrivateOutputUnavailable({ reason: "output_disabled" });
        }
        const state = this.#state();
        if (command.type === "ReadCards") {
          const records = transaction
            .select()
            .from(privateProfileCards)
            .where(gt(privateProfileCards.ordinal, command.afterOrdinal))
            .orderBy(privateProfileCards.ordinal)
            .limit(command.limit + 1)
            .all();
          const cards = records
            .slice(0, command.limit)
            .map((record) =>
              Schema.decodeUnknownSync(Schema.fromJsonString(ProfileCard))(
                record.cardJson
              )
            );
          const result = () => ({
            cards,
            hasMore: records.length > cards.length,
            pendingConfirmation: this.#pending()?.mutationId ?? null,
            requestId: command.requestId,
            state,
            type: "CardsRead" as const,
          });
          while (
            new TextEncoder().encode(JSON.stringify(result())).byteLength >
            MAX_PRIVATE_FRAME_BYTES
          ) {
            cards.pop();
          }
          {
            const nestedResult: SessionFrame = result();
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
            const nestedResult2: SessionFrame = {
              commandId: command.mutationId,
              reason: "mutation_collision",
              state,
              type: "Rejected",
            };
            return nestedResult2;
          }
          {
            const nestedResult3: SessionFrame = Schema.decodeUnknownSync(
              SessionFrame
            )(JSON.parse(receipt.frame));
            return nestedResult3;
          }
        }
        if (state.status === "completed") {
          const nestedResult4: SessionFrame = {
            commandId: command.mutationId,
            reason: "session_completed",
            state,
            type: "Rejected",
          };
          return nestedResult4;
        }
        if (this.#pending() !== undefined) {
          const nestedResult5: SessionFrame = {
            commandId: command.mutationId,
            reason: "confirmation_pending",
            state,
            type: "Rejected",
          };
          return nestedResult5;
        }
        const turnRejection = this.#turnRejection();
        if (turnRejection !== undefined) {
          const nestedResult6: SessionFrame = {
            commandId: command.mutationId,
            reason: turnRejection,
            state,
            type: "Rejected",
          };
          return nestedResult6;
        }
        if (command.expectedVersion !== state.version) {
          const nestedResult7: SessionFrame = {
            commandId: command.mutationId,
            reason: "version_conflict",
            state,
            type: "Rejected",
          };
          return nestedResult7;
        }
        if ("cardId" in command) {
          const reason = this.#cardRejection(command);
          if (reason !== undefined) {
            const nestedResult8: SessionFrame = {
              commandId: command.mutationId,
              reason,
              state,
              type: "Rejected",
            };
            return nestedResult8;
          }
        }
        const next = {
          status:
            command.type === "CompleteSession"
              ? ("completed" as const)
              : ("open" as const),
          version: state.version + 1,
        };
        transaction.update(privateSessionBinding).set(next).run();
        const result: SessionFrame =
          command.type === "CompleteSession"
            ? {
                mutationId: command.mutationId,
                state: next,
                type: "SessionCompleted",
              }
            : this.#mutateCard(command, next);
        transaction
          .insert(privateReceipts)
          .values({
            frame: JSON.stringify(result),
            intent,
            mutationId: command.mutationId,
          })
          .run();
        {
          const nestedResult9: SessionFrame = result;
          return nestedResult9;
        }
      }
    );
    return checkedResult;
  }
  override webSocketClose(socket: NativeCloudflare.WebSocket) {
    this.#detachDeliveries(
      Schema.decodeUnknownSync(Generation)(socket.deserializeAttachment())
        .generation
    );
  }
  override webSocketError(socket: NativeCloudflare.WebSocket) {
    this.webSocketClose(socket);
  }
  invalidateOutput(untrusted: typeof Generation.Type) {
    const input = Schema.decodeUnknownSync(Generation, {
      onExcessProperty: "error",
    })(untrusted);
    this.#socket.invalidate(input);
    this.#detachDeliveries(input.generation);
    this.#turns.interrupt("connection_lost", input.generation);
    if (
      this.#reauthorization?.previousGeneration === input.generation ||
      this.#reauthorization?.generation === input.generation
    ) {
      if (this.#reauthorization.generation !== null) {
        this.#turns.interrupt(
          "connection_lost",
          this.#reauthorization.generation
        );
      }
      this.#reauthorization.ready.resolve(null);
      this.#reauthorization = null;
    }
    this.#chat.closeInterruptedStreams();
  }
  readMetadata() {
    return this.#database.select().from(privateSessionBinding).get() ?? null;
  }
  readOutputLifecycle() {
    return this.#socket.read();
  }
}
