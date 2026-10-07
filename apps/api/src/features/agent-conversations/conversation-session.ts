/* eslint-disable max-classes-per-file -- Typed session failure and native Agent are one boundary contract. */
import type * as NativeCloudflare from "@cloudflare/workers-types";
import {
  ConversationAction,
  ConversationActionId,
  ConversationBlock,
  ConversationBlockId,
  ConversationMessage,
  ConversationTurnRequest,
  ConversationView,
  SubmitConversationTurn,
} from "@meal-planner/agent-conversations-api";
import type { ConversationModelBlock } from "@meal-planner/agent-conversations-api";
import { HouseholdOrganizationId } from "@meal-planner/household-api";
import { EventType, toServerSentEventsResponse } from "@tanstack/ai";
import type { StreamChunk } from "@tanstack/ai";
import { Agent } from "agents";
import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import { Data, Schema } from "effect";

import migrations from "../../../agent-conversation-migrations/migrations.js";
import {
  ActionExecution,
  conversationActionState,
} from "./conversation-action.js";
import {
  ConversationModelFailure,
  streamConversationTurn,
} from "./conversation-model.js";
import type {
  ConversationModelEnvironment,
  ConversationModelReply,
} from "./conversation-model.js";
import { prepareConversationBlocks } from "./conversation-proposals.js";
import {
  matchesConfirmedRosterAction,
  prepareSetupConfirmation,
} from "./conversation-setup-confirmation.js";
import {
  ConversationAccess,
  ConversationCanonicalContext,
  ConversationChatInput,
} from "./conversation.contract.js";
import type { ConversationChatInput as ChatInput } from "./conversation.contract.js";
import {
  conversationActions,
  conversationBinding,
  conversationBlocks,
  conversationMessages,
  conversationTurns,
} from "./conversation.database-schema.js";
import { conversationScopeKey } from "./conversation.identity.js";

/** Leave headroom under Cloudflare SQLite's 2 MB string/row limit. */
const MAX_BLOCK_JSON_BYTES = 1_800_000;

declare const Response: typeof NativeCloudflare.Response;

export class ConversationSessionFailure extends Data.TaggedError(
  "ConversationSessionFailure"
)<{
  readonly reason:
    | "binding_conflict"
    | "stale_version"
    | "turn_conflict"
    | "action_conflict"
    | "stale_review"
    | "not_actionable"
    | "invalid_step";
}> {}

const fail = (reason: ConversationSessionFailure["reason"]): never => {
  throw new ConversationSessionFailure({ reason });
};

export const AdvanceConversationAction = Schema.Struct({
  access: ConversationAccess,
  actionId: ConversationActionId,
  completedStep: Schema.Int.pipe(
    Schema.check(Schema.isGreaterThanOrEqualTo(0))
  ),
  familyId: Schema.NullOr(HouseholdOrganizationId),
}).pipe(Schema.annotate({ parseOptions: { onExcessProperty: "error" } }));
export type AdvanceConversationAction = typeof AdvanceConversationAction.Type;

const StoredReply = Schema.Struct({
  messageId: Schema.String.pipe(Schema.check(Schema.isUUID())),
  text: SubmitConversationTurn.fields.reply,
});
const StoredSetupConfirmation = Schema.Struct({
  _tag: Schema.Literal("ConfirmDisplayedRoster"),
  actionId: ConversationActionId,
  blockId: ConversationBlockId,
  revision: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1))),
});
const parseBlockJson = Schema.decodeUnknownSync(
  Schema.fromJsonString(ConversationBlock),
  { onExcessProperty: "error" }
);
const parseActionJson = Schema.decodeUnknownSync(
  Schema.fromJsonString(ConversationAction),
  { onExcessProperty: "error" }
);
const parseReplyJson = Schema.decodeUnknownSync(
  Schema.fromJsonString(StoredReply),
  { onExcessProperty: "error" }
);
const parseSetupConfirmationJson = Schema.decodeUnknownSync(
  Schema.fromJsonString(StoredSetupConfirmation),
  { onExcessProperty: "error" }
);
const parseCommandIdsJson = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Array(Schema.String.pipe(Schema.check(Schema.isUUID())))
  ),
  { onExcessProperty: "error" }
);

const assertAccess = (
  access: typeof ConversationAccess.Type,
  binding: typeof conversationBinding.$inferSelect
): void => {
  if (
    binding.scopeTag !== access.scope._tag ||
    binding.scopeKey !== conversationScopeKey(access) ||
    binding.familyId !==
      (access.scope._tag === "FamilyShared" ? access.scope.familyId : null)
  ) {
    fail("binding_conflict");
  }
};

export { conversationObjectName } from "./conversation.identity.js";

const safeStream = (
  runId: string,
  threadId: string,
  reply: Promise<ConversationModelReply>
): AsyncIterable<StreamChunk> => ({
  async *[Symbol.asyncIterator]() {
    yield { runId, threadId, type: EventType.RUN_STARTED };
    try {
      const value = await reply;
      yield {
        messageId: value.messageId,
        role: "assistant",
        type: EventType.TEXT_MESSAGE_START,
      };
      yield {
        delta: value.text,
        messageId: value.messageId,
        type: EventType.TEXT_MESSAGE_CONTENT,
      };
      yield { messageId: value.messageId, type: EventType.TEXT_MESSAGE_END };
      yield {
        outcome: { type: "success" },
        runId,
        threadId,
        type: EventType.RUN_FINISHED,
      };
    } catch {
      yield {
        code: "turn_failed",
        message:
          "This response could not be completed. Refresh the conversation to see its status.",
        type: EventType.RUN_ERROR,
      };
    }
  },
});

/** One durable conversation per account setup or family shared surface. */
export interface ConversationEnvironment
  extends Cloudflare.Env, ConversationModelEnvironment {}

export class AgentConversation extends Agent<ConversationEnvironment> {
  readonly #database = drizzle(this.ctx.storage);
  readonly #running = new Map<string, Promise<ConversationModelReply>>();

  #latestProposedRoster(): Extract<
    ConversationBlock,
    { _tag: "RosterProposal" }
  > | null {
    const row = this.#database
      .select({
        blockJson: conversationBlocks.blockJson,
        status: conversationBlocks.status,
      })
      .from(conversationBlocks)
      .innerJoin(
        conversationMessages,
        eq(conversationMessages.turnId, conversationBlocks.turnId)
      )
      .where(
        and(
          eq(conversationBlocks.tag, "RosterProposal"),
          eq(conversationMessages.role, "assistant")
        )
      )
      .orderBy(desc(conversationMessages.ordinal))
      .get();
    if (row === undefined || row.status !== "proposed") {
      return null;
    }
    const block = parseBlockJson(row.blockJson);
    if (block._tag !== "RosterProposal") {
      return fail("binding_conflict");
    }
    return block;
  }

  #setupConfirmationForActionId(actionId: ConversationActionId) {
    const rows = this.#database
      .select({
        setupConfirmationJson: conversationTurns.setupConfirmationJson,
      })
      .from(conversationTurns)
      .where(isNotNull(conversationTurns.setupConfirmationJson))
      .all();
    for (const row of rows) {
      if (row.setupConfirmationJson === null) {
        continue;
      }
      const confirmation = parseSetupConfirmationJson(
        row.setupConfirmationJson
      );
      if (confirmation.actionId === actionId) {
        return confirmation;
      }
    }
    return null;
  }

  constructor(
    context: NativeCloudflare.DurableObjectState,
    environment: ConversationEnvironment
  ) {
    super(context, environment);
    context.blockConcurrencyWhile(() => {
      migrate(this.#database, migrations);
      this.#database
        .update(conversationTurns)
        .set({
          failure: "runtime_interrupted",
          finishedAt: Date.now(),
          status: "interrupted",
        })
        .where(eq(conversationTurns.status, "running"))
        .run();
      return Promise.resolve();
    });
  }

  /** Idempotently bind a newly addressed object to one visibility scope. */
  initialize(untrusted: typeof ConversationAccess.Type): ConversationView {
    const access = Schema.decodeUnknownSync(ConversationAccess, {
      onExcessProperty: "error",
    })(untrusted);
    this.#database.transaction(() => {
      const existing = this.#database.select().from(conversationBinding).get();
      if (existing !== undefined) {
        assertAccess(access, existing);
        return;
      }
      this.#database
        .insert(conversationBinding)
        .values({
          conversationId: crypto.randomUUID(),
          familyId:
            access.scope._tag === "FamilyShared" ? access.scope.familyId : null,
          id: "current",
          scopeKey: conversationScopeKey(access),
          scopeTag: access.scope._tag,
          version: 0,
        })
        .run();
    });
    return this.read(access);
  }

  #binding(access: typeof ConversationAccess.Type) {
    const binding = this.#database.select().from(conversationBinding).get();
    if (binding === undefined) {
      return fail("binding_conflict");
    }
    assertAccess(access, binding);
    return binding;
  }

  /** Return saved messages and proposals after the API host admits the caller. */
  read(untrusted: typeof ConversationAccess.Type): ConversationView {
    const access = Schema.decodeUnknownSync(ConversationAccess, {
      onExcessProperty: "error",
    })(untrusted);
    const binding = this.#binding(access);
    const messages = this.#database
      .select()
      .from(conversationMessages)
      .orderBy(asc(conversationMessages.ordinal))
      .all()
      .map((message) =>
        Schema.decodeUnknownSync(ConversationMessage)({
          id: message.id,
          ordinal: message.ordinal,
          role: message.role,
          text: message.text,
          turnId: message.turnId,
        })
      );
    const blocks = this.#database
      .select()
      .from(conversationBlocks)
      .all()
      .map((row) =>
        Schema.decodeUnknownSync(ConversationBlock)({
          ...parseBlockJson(row.blockJson),
          status: row.status,
        })
      );
    const actions = this.#database
      .select()
      .from(conversationActions)
      .all()
      .map((row) => {
        const execution = this.#execution(row);
        return {
          action: execution.action,
          state: conversationActionState(execution),
        };
      });
    const turns = this.#database
      .select()
      .from(conversationTurns)
      .all()
      .map((row) => ({
        failure: row.failure,
        id: row.id,
        setupConfirmation:
          row.setupConfirmationJson === null
            ? null
            : parseSetupConfirmationJson(row.setupConfirmationJson),
        status: row.status,
      }));
    return Schema.decodeUnknownSync(ConversationView)({
      actions,
      blocks,
      id: binding.conversationId,
      messages,
      scope:
        binding.scopeTag === "FamilyShared"
          ? { _tag: "FamilyShared", familyId: binding.familyId }
          : { _tag: "AccountPrivateSetup" },
      turns,
      version: binding.version,
    });
  }

  override async fetch(
    request: Request | NativeCloudflare.Request
  ): Promise<globalThis.Response> {
    if (
      new URL(request.url).pathname !== "/chat" ||
      request.method !== "POST"
    ) {
      return new Response(null, {
        status: 404,
      }) as unknown as globalThis.Response;
    }
    try {
      const input = Schema.decodeUnknownSync(ConversationChatInput, {
        onExcessProperty: "error",
      })(await request.json());
      const response = this.#post(input);
      return response as unknown as globalThis.Response;
    } catch (error) {
      let status = 400;
      if (error instanceof ConversationSessionFailure) {
        status = error.reason === "binding_conflict" ? 403 : 409;
      }
      return new Response(null, { status }) as unknown as globalThis.Response;
    }
  }

  #recentMessages(): {
    readonly content: string;
    readonly role: "user" | "assistant";
  }[] {
    const rows = this.#database
      .select()
      .from(conversationMessages)
      .orderBy(desc(conversationMessages.ordinal))
      .limit(16)
      .all()
      .toReversed();
    return rows.map((row) => ({
      content: row.text,
      role: row.role === "adult" ? "user" : "assistant",
    }));
  }

  // eslint-disable-next-line complexity -- Keep turn replay, admission and producer ownership in one native request boundary.
  #post(input: ChatInput): NativeCloudflare.Response {
    const access = Schema.decodeUnknownSync(ConversationAccess)(input.access);
    const binding = this.#binding(access);
    const request = Schema.decodeUnknownSync(ConversationTurnRequest)({
      answerToBlockId: input.metadata.answerToBlockId,
      displayedRoster: input.metadata.displayedRoster,
      expectedVersion: input.metadata.expectedVersion,
      focusPersonId: input.focusPersonId,
      foodAnswer: input.metadata.foodAnswer,
      planId: input.planId,
      text: input.text,
      turnId: input.turnId,
    });
    const serialized = JSON.stringify(request);
    const previous = this.#database
      .select()
      .from(conversationTurns)
      .where(eq(conversationTurns.id, input.turnId))
      .get();
    if (previous !== undefined) {
      if (previous.requestJson !== serialized) {
        fail("turn_conflict");
      }
      if (previous.status === "succeeded" && previous.replyJson !== null) {
        const reply = parseReplyJson(previous.replyJson);
        return toServerSentEventsResponse(
          safeStream(
            input.turnId,
            binding.conversationId,
            Promise.resolve(reply)
          ),
          { headers: { "Cache-Control": "no-store" } }
        ) as unknown as NativeCloudflare.Response;
      }
      const running = this.#running.get(input.turnId);
      if (previous.status === "running" && running !== undefined) {
        return toServerSentEventsResponse(
          safeStream(input.turnId, binding.conversationId, running),
          { headers: { "Cache-Control": "no-store" } }
        ) as unknown as NativeCloudflare.Response;
      }
      fail("turn_conflict");
    }
    if (
      binding.version !== request.expectedVersion ||
      this.#database
        .select()
        .from(conversationTurns)
        .where(eq(conversationTurns.status, "running"))
        .get() !== undefined ||
      this.#database
        .select()
        .from(conversationActions)
        .where(inArray(conversationActions.status, ["pending", "unknown"]))
        .get() !== undefined
    ) {
      fail("stale_version");
    }
    const context = Schema.decodeUnknownSync(ConversationCanonicalContext, {
      onExcessProperty: "error",
    })(input.context);
    const setupRoster =
      access.scope._tag === "AccountPrivateSetup"
        ? this.#latestProposedRoster()
        : null;
    if (
      (access.scope._tag !== "AccountPrivateSetup" &&
        request.displayedRoster !== null) ||
      (request.displayedRoster !== null &&
        (setupRoster?.id !== request.displayedRoster.blockId ||
          setupRoster.revision !== request.displayedRoster.revision))
    ) {
      fail("stale_version");
    }
    if (
      input.focusPersonId !== input.metadata.focusPersonId ||
      input.planId !== input.metadata.planId ||
      (access.scope._tag === "AccountPrivateSetup" &&
        input.focusPersonId !== null) ||
      (access.scope._tag === "AccountPrivateSetup" && input.planId !== null) ||
      (input.planId !== null && context.plan?.planId !== input.planId) ||
      (input.focusPersonId !== null &&
        !context.people.some(
          (person) =>
            person.id === input.focusPersonId && person.lifecycle === "active"
        ))
    ) {
      fail("binding_conflict");
    }
    prepareConversationBlocks({
      blocks: [],
      context,
      focusPersonId: input.focusPersonId,
      scope: access.scope,
      turnId: request.turnId,
    });
    if ((request.answerToBlockId === null) !== (request.foodAnswer === null)) {
      fail("binding_conflict");
    }
    if (request.answerToBlockId !== null) {
      const question = this.#database
        .select()
        .from(conversationBlocks)
        .where(eq(conversationBlocks.id, request.answerToBlockId))
        .get();
      if (question === undefined || question.status !== "proposed") {
        return fail("stale_version");
      }
      const block = parseBlockJson(question.blockJson);
      if (
        block._tag !== "Question" ||
        block.foodTopic === null ||
        block.targetPersonId !== request.focusPersonId
      ) {
        fail("binding_conflict");
      }
    }
    this.#database.transaction(() => {
      this.#database
        .insert(conversationMessages)
        .values({
          id: crypto.randomUUID(),
          role: "adult",
          text: request.text,
          turnId: request.turnId,
        })
        .run();
      this.#database
        .insert(conversationTurns)
        .values({
          id: request.turnId,
          requestJson: serialized,
          startedAt: Date.now(),
          status: "running",
        })
        .run();
      this.#database
        .update(conversationBinding)
        .set({ version: binding.version + 1 })
        .run();
    });
    const messages = this.#recentMessages();
    const outcome = Promise.withResolvers<ConversationModelReply>();
    this.#running.set(request.turnId, outcome.promise);
    const controller = new AbortController();
    const accept = (value: typeof SubmitConversationTurn.Type) => {
      if (
        value.blocks.filter((block) => block._tag === "RosterProposal").length >
        1
      ) {
        throw new ConversationModelFailure({ reason: "invalid_output" });
      }
      const setupConfirmation = prepareSetupConfirmation({
        displayedRoster: request.displayedRoster,
        latestRoster: setupRoster,
        modelTurn: value,
        newActionId: () => crypto.randomUUID(),
        scope: access.scope,
      });
      const blocks = prepareConversationBlocks({
        blocks: value.blocks as readonly ConversationModelBlock[],
        context,
        focusPersonId: request.focusPersonId,
        previousRoster: setupRoster ?? undefined,
        scope: access.scope,
        turnId: request.turnId,
      });
      const storedBlocks = blocks.map((block) => ({
        block,
        json: JSON.stringify(block),
      }));
      if (
        storedBlocks.some(
          ({ json }) =>
            new TextEncoder().encode(json).byteLength > MAX_BLOCK_JSON_BYTES
        )
      ) {
        throw new ConversationModelFailure({ reason: "context_limit" });
      }
      const reply: ConversationModelReply = {
        messageId: crypto.randomUUID(),
        text: value.reply,
      };
      this.#database.transaction(() => {
        const current = this.#database
          .select()
          .from(conversationTurns)
          .where(eq(conversationTurns.id, request.turnId))
          .get();
        if (current?.status !== "running") {
          fail("turn_conflict");
        }
        if (setupConfirmation !== null) {
          const latest = this.#latestProposedRoster();
          if (
            latest?.id !== setupRoster?.id ||
            latest?.revision !== setupRoster?.revision
          ) {
            throw new ConversationModelFailure({ reason: "invalid_output" });
          }
        }
        if (request.answerToBlockId !== null) {
          const question = this.#database
            .select()
            .from(conversationBlocks)
            .where(eq(conversationBlocks.id, request.answerToBlockId))
            .get();
          if (question?.status !== "proposed") {
            fail("stale_version");
          }
          this.#database
            .update(conversationBlocks)
            .set({ status: "answered" })
            .where(eq(conversationBlocks.id, request.answerToBlockId))
            .run();
        }
        for (const { block, json } of storedBlocks) {
          if (block._tag === "RosterProposal") {
            this.#database
              .update(conversationBlocks)
              .set({ status: "dismissed" })
              .where(
                and(
                  eq(conversationBlocks.tag, "RosterProposal"),
                  eq(conversationBlocks.status, "proposed")
                )
              )
              .run();
          }
          this.#database
            .insert(conversationBlocks)
            .values({
              blockJson: json,
              id: block.id,
              revision: block.revision,
              status: "proposed",
              tag: block._tag,
              turnId: request.turnId,
            })
            .run();
        }
        this.#database
          .insert(conversationMessages)
          .values({
            id: reply.messageId,
            role: "assistant",
            text: reply.text,
            turnId: request.turnId,
          })
          .run();
        this.#database
          .update(conversationTurns)
          .set({
            finishedAt: Date.now(),
            replyJson: JSON.stringify(reply),
            setupConfirmationJson:
              setupConfirmation === null
                ? null
                : JSON.stringify(setupConfirmation),
            status: "succeeded",
          })
          .where(eq(conversationTurns.id, request.turnId))
          .run();
        this.#database
          .update(conversationBinding)
          .set({ version: binding.version + 2 })
          .run();
      });
      outcome.resolve(reply);
      return reply;
    };
    const onFailure = (problem: ConversationModelFailure) => {
      this.#database.transaction(() => {
        const current = this.#database
          .select()
          .from(conversationTurns)
          .where(eq(conversationTurns.id, request.turnId))
          .get();
        if (current?.status === "running") {
          this.#database
            .update(conversationTurns)
            .set({
              failure: problem.reason,
              finishedAt: Date.now(),
              status: "failed",
            })
            .where(eq(conversationTurns.id, request.turnId))
            .run();
        }
      });
      this.#running.delete(request.turnId);
      outcome.reject(problem);
    };
    try {
      const stream = streamConversationTurn({
        accept,
        context,
        controller,
        environment: this.env,
        fail: onFailure,
        focusPersonId: request.focusPersonId,
        foodAnswer: request.foodAnswer,
        messages,
        runId: request.turnId,
        scope: access.scope,
        setupRoster,
        threadId: binding.conversationId,
      });
      const producer = (async () => {
        try {
          for await (const _chunk of stream) {
            // Consume SDK events to run its tool callback; only accepted replies reach the caller.
          }
        } catch (error) {
          onFailure(
            error instanceof ConversationModelFailure
              ? error
              : new ConversationModelFailure({ reason: "provider_unavailable" })
          );
        } finally {
          this.#running.delete(request.turnId);
        }
      })();
      const settled = (async () => {
        try {
          await outcome.promise;
        } catch {
          // The failed turn is already recorded; its settlement ends this local lifetime.
        }
      })();
      // The binding adapter may keep Ai.run pending after cancellation. The
      // application settles and releases its lifetime at the accepted/failed
      // outcome; the late producer has its own catch and cannot commit.
      this.ctx.waitUntil(
        this.keepAliveWhile(() => Promise.race([producer, settled]))
      );
    } catch (error) {
      onFailure(
        error instanceof ConversationModelFailure
          ? error
          : new ConversationModelFailure({ reason: "provider_unavailable" })
      );
      this.#running.delete(request.turnId);
    }
    return toServerSentEventsResponse(
      safeStream(request.turnId, binding.conversationId, outcome.promise),
      { headers: { "Cache-Control": "no-store" } }
    ) as unknown as NativeCloudflare.Response;
  }

  #assertActionReview(
    access: typeof ConversationAccess.Type,
    action: typeof ConversationAction.Type,
    parsed: ConversationBlock
  ): void {
    const confirmation =
      access.scope._tag === "AccountPrivateSetup"
        ? this.#setupConfirmationForActionId(action.actionId)
        : null;
    if (
      access.scope._tag === "AccountPrivateSetup" &&
      parsed._tag === "RosterProposal" &&
      action.decision === "accept" &&
      !matchesConfirmedRosterAction(action, parsed, confirmation)
    ) {
      fail("stale_review");
    }
    if (
      confirmation !== null &&
      (parsed._tag !== "RosterProposal" || action.decision !== "accept")
    ) {
      fail("stale_review");
    }
    if (parsed._tag === "RosterProposal" && action.decision === "accept") {
      const latest = this.#latestProposedRoster();
      if (latest?.id !== parsed.id || latest.revision !== parsed.revision) {
        fail("stale_review");
      }
    }
    if (
      action.decision === "accept" &&
      (parsed._tag === "Question" ||
        parsed._tag === "RecipeDetails" ||
        (parsed._tag === "RosterProposal") !==
          (action.reviewedRoster !== null) ||
        (parsed._tag === "PersonFactProposal" &&
          parsed.requiresSafetyConfirmation) !==
          (action.safetyConfirmation !== null))
    ) {
      fail("not_actionable");
    }
  }

  /** Reserve the exact reviewed action before any cross-resource write begins. */
  beginAction(untrusted: {
    readonly access: typeof ConversationAccess.Type;
    readonly action: typeof ConversationAction.Type;
  }): ActionExecution {
    const access = Schema.decodeUnknownSync(ConversationAccess)(
      untrusted.access
    );
    const action = Schema.decodeUnknownSync(ConversationAction, {
      onExcessProperty: "error",
    })(untrusted.action);
    this.#binding(access);
    return this.#database.transaction(() => {
      const existing = this.#database
        .select()
        .from(conversationActions)
        .where(eq(conversationActions.id, action.actionId))
        .get();
      if (existing !== undefined) {
        if (existing.decisionJson !== JSON.stringify(action)) {
          fail("action_conflict");
        }
        return this.#execution(existing);
      }
      const block = this.#database
        .select()
        .from(conversationBlocks)
        .where(eq(conversationBlocks.id, action.blockId))
        .get();
      if (block === undefined) {
        return fail("stale_review");
      }
      if (
        block.revision !== action.expectedRevision ||
        block.status !== "proposed"
      ) {
        return fail("stale_review");
      }
      const parsed = parseBlockJson(block.blockJson);
      this.#assertActionReview(access, action, parsed);
      let commandCount = 0;
      if (action.decision === "accept") {
        commandCount =
          parsed._tag === "RosterProposal" && action.reviewedRoster !== null
            ? 1 + action.reviewedRoster.people.length
            : 1;
      }
      const commandIds = Array.from({ length: commandCount }, () =>
        crypto.randomUUID()
      );
      this.#database
        .insert(conversationActions)
        .values({
          blockId: action.blockId,
          commandIdsJson: JSON.stringify(commandIds),
          decisionJson: JSON.stringify(action),
          id: action.actionId,
          status: action.decision === "dismiss" ? "committed" : "pending",
        })
        .run();
      this.#database
        .update(conversationBlocks)
        .set({
          status: action.decision === "dismiss" ? "dismissed" : "pending",
        })
        .where(eq(conversationBlocks.id, action.blockId))
        .run();
      const saved = this.#database
        .select()
        .from(conversationActions)
        .where(eq(conversationActions.id, action.actionId))
        .get();
      if (saved === undefined) {
        return fail("action_conflict");
      }
      return this.#execution(saved);
    });
  }

  #execution(row: typeof conversationActions.$inferSelect): ActionExecution {
    const block = this.#database
      .select()
      .from(conversationBlocks)
      .where(eq(conversationBlocks.id, row.blockId))
      .get();
    if (block === undefined) {
      return fail("action_conflict");
    }
    return Schema.decodeUnknownSync(ActionExecution)({
      action: parseActionJson(row.decisionJson),
      block: parseBlockJson(block.blockJson),
      commandIds: parseCommandIdsJson(row.commandIdsJson),
      familyId: row.familyId,
      nextStep: row.nextStep,
      rejectionReason: row.rejectionReason,
      status: row.status,
    });
  }

  /** Mark one canonical command settled, advancing only its stored step. */
  advanceAction(untrusted: AdvanceConversationAction): ActionExecution {
    const input = Schema.decodeUnknownSync(AdvanceConversationAction, {
      onExcessProperty: "error",
    })(untrusted);
    this.#binding(input.access);
    return this.#database.transaction(() => {
      const row = this.#database
        .select()
        .from(conversationActions)
        .where(eq(conversationActions.id, input.actionId))
        .get();
      if (row === undefined) {
        return fail("action_conflict");
      }
      const current = this.#execution(row);
      if (row.status === "committed" && input.completedStep < row.nextStep) {
        return current;
      }
      if (
        !["pending", "unknown"].includes(row.status) ||
        row.nextStep !== input.completedStep ||
        input.completedStep >= current.commandIds.length ||
        (current.block._tag === "RosterProposal" &&
          input.completedStep === 0 &&
          input.familyId === null) ||
        (current.block._tag !== "RosterProposal" && input.familyId !== null)
      ) {
        return fail("invalid_step");
      }
      const nextStep = row.nextStep + 1;
      const status =
        nextStep === current.commandIds.length ? "committed" : "pending";
      this.#database
        .update(conversationActions)
        .set({
          familyId: input.familyId ?? row.familyId,
          nextStep,
          status,
        })
        .where(eq(conversationActions.id, input.actionId))
        .run();
      if (status === "committed") {
        this.#database
          .update(conversationBlocks)
          .set({ status: "accepted" })
          .where(eq(conversationBlocks.id, row.blockId))
          .run();
      }
      const advanced = this.#database
        .select()
        .from(conversationActions)
        .where(eq(conversationActions.id, input.actionId))
        .get();
      if (advanced === undefined) {
        return fail("action_conflict");
      }
      return this.#execution(advanced);
    });
  }

  /** Preserve the exact in-flight command when its external result is unknown. */
  markActionUnknown(untrusted: {
    readonly access: typeof ConversationAccess.Type;
    readonly actionId: typeof ConversationActionId.Type;
  }): ActionExecution {
    const access = Schema.decodeUnknownSync(ConversationAccess)(
      untrusted.access
    );
    const actionId = Schema.decodeUnknownSync(ConversationActionId)(
      untrusted.actionId
    );
    this.#binding(access);
    const row = this.#database
      .select()
      .from(conversationActions)
      .where(eq(conversationActions.id, actionId))
      .get();
    if (row === undefined) {
      return fail("action_conflict");
    }
    if (row.status === "committed" || row.status === "rejected") {
      return this.#execution(row);
    }
    this.#database
      .update(conversationActions)
      .set({ status: "unknown" })
      .where(eq(conversationActions.id, actionId))
      .run();
    const updated = this.#database
      .select()
      .from(conversationActions)
      .where(eq(conversationActions.id, actionId))
      .get();
    if (updated === undefined) {
      return fail("action_conflict");
    }
    return this.#execution(updated);
  }

  /** Settle a deterministic canonical rejection without losing its reviewed action. */
  rejectAction(untrusted: {
    readonly access: typeof ConversationAccess.Type;
    readonly actionId: typeof ConversationActionId.Type;
    readonly reason: "stale_review" | "not_actionable" | "permission_denied";
  }): ActionExecution {
    const access = Schema.decodeUnknownSync(ConversationAccess)(
      untrusted.access
    );
    const actionId = Schema.decodeUnknownSync(ConversationActionId)(
      untrusted.actionId
    );
    this.#binding(access);
    return this.#database.transaction(() => {
      const row = this.#database
        .select()
        .from(conversationActions)
        .where(eq(conversationActions.id, actionId))
        .get();
      if (row === undefined) {
        return fail("action_conflict");
      }
      if (row.status === "committed") {
        return fail("action_conflict");
      }
      if (row.status === "rejected") {
        if (row.rejectionReason !== untrusted.reason) {
          return fail("action_conflict");
        }
        return this.#execution(row);
      }
      this.#database
        .update(conversationActions)
        .set({ rejectionReason: untrusted.reason, status: "rejected" })
        .where(eq(conversationActions.id, actionId))
        .run();
      this.#database
        .update(conversationBlocks)
        .set({ status: "dismissed" })
        .where(eq(conversationBlocks.id, row.blockId))
        .run();
      const updated = this.#database
        .select()
        .from(conversationActions)
        .where(eq(conversationActions.id, actionId))
        .get();
      if (updated === undefined) {
        return fail("action_conflict");
      }
      return this.#execution(updated);
    });
  }
}
