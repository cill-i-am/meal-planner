import type * as NativeCloudflare from "@cloudflare/workers-types";
import { MutatePersonProfilePayload } from "@meal-planner/household-api";
import type { SessionState } from "@meal-planner/private-interview-api";
import {
  MAX_PRIVATE_FRAME_BYTES,
  ProfileCard,
  SessionCommand,
  SessionFrame,
} from "@meal-planner/private-interview-api";
import { DurableObject } from "cloudflare:workers";
import { eq, gt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import { Schema } from "effect";

import migrations from "../../../private-output-migrations/migrations.js";
import type { ReleasedConfirmation } from "./private-confirmation.contract.js";
import {
  ReleaseConfirmation,
  SettleConfirmation,
} from "./private-confirmation.contract.js";
import { Generation, PrivateOutputSocket } from "./private-output-socket.js";
import type { PrivateInterviewEnvironment } from "./private-output-socket.js";
import {
  PrivateSessionBinding,
  PrivateOutputUnavailable,
  privateOutputKey,
  privateDirectoryKey,
} from "./private-output.contract.js";
import {
  privateProfileCards,
  privatePendingConfirmation,
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
type CardMutation = Extract<SessionCommand, { readonly cardId: string }>;
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
        generation: request.headers.get("private-output-generation"),
        pendingConfirmation: this.#pending()?.mutationId ?? null,
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
  #cardRejection(
    command: CardMutation
  ): Extract<SessionFrame, { type: "Rejected" }>["reason"] | undefined {
    const card = this.#card(command.cardId);
    if (card === undefined) {
      return "card_not_found";
    }
    if (
      card.revision !== command.cardRevision ||
      (card.status !== "proposed" && card.status !== "conflict") ||
      (command.type === "ConfirmProfileCard" && card.status !== "proposed")
    ) {
      return "card_conflict";
    }
    if (
      command.type === "ConfirmProfileCard" &&
      card.change._tag === "ConfirmHardConstraintReduction" &&
      command.safetyConfirmation === null
    ) {
      return "safety_confirmation_required";
    }
    return undefined;
  }
  #mutateCard(
    command: CardMutation,
    state: typeof SessionState.Type
  ): SessionFrame {
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
      if (
        change._tag === "AddConfirmedProfileFact" ||
        change._tag === "ConfirmProfileFact"
      ) {
        closedCommand = { ...change, basis: "self" };
      } else if (change._tag === "ConfirmHardConstraintReduction") {
        closedCommand = { ...change, confirmation: command.safetyConfirmation };
      } else {
        closedCommand = change;
      }
      const payload = Schema.decodeUnknownSync(MutatePersonProfilePayload)({
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
    return {
      card: updated,
      mutationId: command.mutationId,
      state,
      type:
        command.type === "ConfirmProfileCard"
          ? "ConfirmationPending"
          : "CardUpdated",
    };
  }
  /** Releases only the already-confirmed closed command under fresh API admission. */
  releaseConfirmation(
    untrusted: typeof ReleaseConfirmation.Type
  ): ReleasedConfirmation {
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
      return {
        generation,
        payload: Schema.decodeUnknownSync(
          Schema.fromJsonString(MutatePersonProfilePayload)
        )(pending.payloadJson),
        type: "pending",
      };
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
        return { type: "settled" };
      }
    }
    throw new PrivateOutputUnavailable({ reason: "binding_conflict" });
  }
  /** Canonical results may settle after revocation, but may never emit through that old generation. */
  settleConfirmation(untrusted: typeof SettleConfirmation.Type): void {
    const input = Schema.decodeUnknownSync(SettleConfirmation, {
      onExcessProperty: "error",
    })(untrusted);
    this.#binding(input.binding);
    const frame = this.#database.transaction((): SessionFrame => {
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
        return recorded;
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
      return result;
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
          return result();
        }
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
        if (this.#pending() !== undefined) {
          return {
            commandId: command.mutationId,
            reason: "confirmation_pending",
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
        if ("cardId" in command) {
          const reason = this.#cardRejection(command);
          if (reason !== undefined) {
            return {
              commandId: command.mutationId,
              reason,
              state,
              type: "Rejected",
            };
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
        let result: SessionFrame;
        if (command.type === "CompleteSession") {
          result = {
            mutationId: command.mutationId,
            state: next,
            type: "SessionCompleted",
          };
        } else if (command.type === "AppendParticipantMessage") {
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
        } else {
          result = this.#mutateCard(command, next);
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
