import type { ProfileFactValue } from "@meal-planner/household-api";
import {
  AssistantTurn,
  ProfileCard,
} from "@meal-planner/private-interview-api";
import type {
  ProfileCardChange,
  SessionFrame,
} from "@meal-planner/private-interview-api";
import { RUN_CANCEL_REASON } from "@tanstack/ai";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { SQLiteAsyncDatabase } from "drizzle-orm/sqlite-core";
import { Effect, Schema } from "effect";

import { PrivateChatPersistence } from "./private-chat-persistence.js";
import type { PrivateChatReply } from "./private-chat-reply.js";
import { PrivateDiscoveryClarificationFailure } from "./private-discovery-clarification.js";
import {
  applyPrivateDiscoveryContinuation,
  emptyPrivateDiscoveryContinuity,
  emptyPrivateDiscoveryContinuityUpdates,
  PrivateDiscoveryContinuationFailure,
  PrivateDiscoveryContinuityJson,
} from "./private-discovery-continuity.js";
import { PrivateDiscoveryCoverageFailure } from "./private-discovery-coverage.js";
import type { PrivateDiscoveryReviewedProposal } from "./private-discovery-message.js";
import {
  PRIVATE_DISCOVERY_CARD_LIMIT,
  PRIVATE_DISCOVERY_CONTEXT_BYTES,
  PRIVATE_DISCOVERY_MESSAGE_LIMIT,
  PrivateDiscoveryContext,
  PrivateDiscoveryFailure,
  PrivateDiscoveryUsage,
  SubmitDiscoveryTurn,
} from "./private-discovery-model.js";
import type {
  DiscoveryProfileCardChange,
  PrivateDiscoveryInvalidOutputStage,
  PrivateDiscoveryProfile,
  PrivateDiscoveryResult,
} from "./private-discovery-model.js";
import { PrivateDiscoveryNeedFailure } from "./private-discovery-needs.js";
import type { RunAssistantTurn } from "./private-discovery.contract.js";
import type { PrivateOutputSocket } from "./private-output-socket.js";
import { PrivateOutputUnavailable } from "./private-output.contract.js";
import {
  privateAssistantTurns,
  privatePendingConfirmation,
  privateProfileCards,
  privateSessionBinding,
  privateDiscoverySessionScopes,
} from "./private-output.database-schema.js";

type StoredTurn = typeof privateAssistantTurns.$inferSelect;
type QueuedTurn = Pick<
  StoredTurn,
  "id" | "generation" | "sourceMessageId" | "expectedSessionVersion"
>;
type CardProposal = Pick<
  ProfileCard,
  "change" | "expectedProfileVersion" | "reviewedFact"
>;
const active = inArray(privateAssistantTurns.status, ["queued", "running"]);
const publicTurn = (turn: StoredTurn): AssistantTurn =>
  Schema.decodeUnknownSync(AssistantTurn)({
    failure: turn.failure,
    id: turn.id,
    sourceMessageId: turn.sourceMessageId,
    status: turn.status,
  });
const invalidOutput = (stage: PrivateDiscoveryInvalidOutputStage) =>
  new PrivateDiscoveryFailure({
    provenance: null,
    reason: "invalid_output",
    stage,
    usage: null,
  });
const factKey = (value: ProfileFactValue): string => {
  if (value._tag === "NoKnownHardConstraints") {
    return value._tag;
  }
  const label = value.label.toLocaleLowerCase("en").replaceAll(/\s+/gu, " ");
  return value._tag === "FoodPreference"
    ? `${value._tag}:${value.targetKind}:${label}`
    : `${value._tag}:${value.category}:${label}`;
};
const proposalKey = (change: ProfileCardChange): string =>
  change._tag === "AddConfirmedProfileFact"
    ? `add:${factKey(change.fact)}`
    : `target:${change.factId}`;
const reviewProposal = (
  intent: DiscoveryProfileCardChange,
  profile: PrivateDiscoveryProfile
): CardProposal => {
  if (intent._tag === "AddFact") {
    if (
      profile.facts.some((fact) => factKey(fact.value) === factKey(intent.fact))
    ) {
      throw invalidOutput("proposal_duplicate");
    }
    return {
      change: { _tag: "AddConfirmedProfileFact", fact: intent.fact },
      expectedProfileVersion: profile.version,
      reviewedFact: null,
    };
  }
  const before = profile.facts.find((fact) => fact.id === intent.factId);
  if (before === undefined) {
    throw invalidOutput("proposal_unknown_fact");
  }
  let change: ProfileCardChange;
  switch (intent._tag) {
    case "ConfirmFact": {
      if (
        before.standing._tag === "confirmed" &&
        before.standing.basis === "self"
      ) {
        throw invalidOutput("proposal_already_confirmed");
      }
      change = { _tag: "ConfirmProfileFact", factId: before.id };
      break;
    }
    case "RemoveFact": {
      change =
        before.value._tag === "FoodPreference"
          ? { _tag: "RemoveOrdinaryProfileFact", factId: before.id }
          : {
              _tag: "ConfirmHardConstraintReduction",
              factId: before.id,
              replacement: null,
            };
      break;
    }
    case "ReplaceFact": {
      if (before.value._tag === "FoodPreference") {
        if (intent.fact._tag !== "FoodPreference") {
          throw invalidOutput("proposal_fact_kind");
        }
        change = {
          _tag: "ReplaceOrdinaryProfileFact",
          fact: intent.fact,
          factId: before.id,
        };
      } else {
        change = {
          _tag: "ConfirmHardConstraintReduction",
          factId: before.id,
          replacement: intent.fact,
        };
      }
      break;
    }
    default: {
      return intent satisfies never;
    }
  }
  return {
    change,
    expectedProfileVersion: profile.version,
    reviewedFact: before.value,
  };
};
export const reviewPrivateDiscoveryProposals = (
  output: SubmitDiscoveryTurn,
  context: PrivateDiscoveryContext,
  storedCards: readonly ProfileCard[]
): readonly PrivateDiscoveryReviewedProposal[] => {
  if (output.intent._tag === "Stop") {
    return [];
  }
  const seen = new Set(
    storedCards
      .filter((card) => card.status === "proposed" || card.status === "pending")
      .map((card) => proposalKey(card.change))
  );
  const revised = new Set<string>();
  return output.intent.proposals.map((action) => {
    let card: ProfileCard | null = null;
    if (action._tag === "ReviseProposedProfileCard") {
      const observed = context.cards.find(
        (candidate) => candidate.id === action.cardId
      );
      const current = storedCards.find(
        (candidate) => candidate.id === action.cardId
      );
      if (
        observed?.status !== "proposed" ||
        current?.status !== "proposed" ||
        current.revision !== observed.revision
      ) {
        throw invalidOutput("proposal_revision_target");
      }
      if (revised.has(action.cardId)) {
        throw invalidOutput("proposal_duplicate");
      }
      revised.add(action.cardId);
      card = current;
      seen.delete(proposalKey(current.change));
    }
    const proposal = reviewProposal(action.change, context.profile);
    const key = proposalKey(proposal.change);
    if (seen.has(key)) {
      throw invalidOutput("proposal_duplicate");
    }
    seen.add(key);
    return { card, proposal };
  });
};

/** Owns durable model attempts and their local abort lifetime; never exposed as a native RPC target. */
export class PrivateAssistantTurns<TRunResult = unknown> {
  #database: SQLiteAsyncDatabase<"sync", TRunResult>;
  #socket: Pick<PrivateOutputSocket, "isCurrent" | "read" | "send">;
  #chat: PrivateChatPersistence<TRunResult>;
  #resources = new Map<
    string,
    {
      controller: AbortController;
      release: () => void;
    }
  >();
  #expiryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  constructor(
    database: SQLiteAsyncDatabase<"sync", TRunResult>,
    socket: Pick<PrivateOutputSocket, "isCurrent" | "read" | "send">
  ) {
    this.#database = database;
    this.#socket = socket;
    this.#chat = new PrivateChatPersistence(database);
  }
  latest(): AssistantTurn | null {
    const row = this.#database
      .select()
      .from(privateAssistantTurns)
      .orderBy(desc(privateAssistantTurns.ordinal))
      .get();
    return row === undefined ? null : publicTurn(row);
  }
  pending(): AssistantTurn | undefined {
    const row = this.#database
      .select()
      .from(privateAssistantTurns)
      .where(active)
      .get();
    return row === undefined ? undefined : publicTurn(row);
  }
  pendingGeneration(): string | undefined {
    return this.#database
      .select({ generation: privateAssistantTurns.generation })
      .from(privateAssistantTurns)
      .where(active)
      .get()?.generation;
  }
  queue(input: QueuedTurn): AssistantTurn {
    const row = this.#database
      .insert(privateAssistantTurns)
      .values({ ...input, createdAt: Date.now(), status: "queued" })
      .returning()
      .get();
    return publicTurn(row);
  }
  canCancel(turnId: string): boolean {
    return this.pending()?.id === turnId;
  }
  cancel(turnId: string): AssistantTurn {
    const row = this.#database
      .update(privateAssistantTurns)
      .set({ completedAt: Date.now(), failure: null, status: "cancelled" })
      .where(and(eq(privateAssistantTurns.id, turnId), active))
      .returning()
      .get();
    if (row === undefined) {
      throw new Error(
        "Assistant turn cancellation requires its active attempt"
      );
    }
    const resources = this.#resources.get(turnId);
    resources?.controller.abort(RUN_CANCEL_REASON);
    resources?.release();
    this.#clearExpiry(turnId);
    return publicTurn(row);
  }
  reauthorize(previousGeneration: string, generation: string): void {
    const rebound = this.#database
      .update(privateAssistantTurns)
      .set({ generation })
      .where(
        and(active, eq(privateAssistantTurns.generation, previousGeneration))
      )
      .returning()
      .all();
    for (const turn of rebound) {
      this.#armExpiry(turn.id);
    }
  }
  #clearExpiry(turnId: string): void {
    const timer = this.#expiryTimers.get(turnId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.#expiryTimers.delete(turnId);
    }
  }
  #armExpiry(turnId: string): void {
    this.#clearExpiry(turnId);
    const lifecycle = this.#socket.read();
    if (lifecycle === null || lifecycle === undefined) {
      return;
    }
    const timer = setTimeout(
      () => {
        this.interrupt("connection_lost", lifecycle.generation);
      },
      Math.max(0, lifecycle.expiresAt - Date.now())
    );
    this.#expiryTimers.set(turnId, timer);
  }
  interrupt(
    failure: "connection_lost" | "runtime_restarted",
    generation?: string
  ): void {
    const interrupted = this.#database
      .update(privateAssistantTurns)
      .set({ completedAt: Date.now(), failure, status: "interrupted" })
      .where(
        generation === undefined
          ? active
          : and(active, eq(privateAssistantTurns.generation, generation))
      )
      .returning()
      .all();
    for (const turn of interrupted) {
      const resources = this.#resources.get(turn.id);
      resources?.controller.abort();
      resources?.release();
      this.#clearExpiry(turn.id);
    }
  }
  #eligible(turn: StoredTurn, status: "queued" | "running"): boolean {
    const current = this.#database
      .select()
      .from(privateAssistantTurns)
      .where(eq(privateAssistantTurns.id, turn.id))
      .get();
    const session = this.#database.select().from(privateSessionBinding).get();
    return (
      current?.status === status &&
      this.#socket.isCurrent(current.generation) &&
      session?.status === "open" &&
      session.version === turn.expectedSessionVersion &&
      this.#database.select().from(privatePendingConfirmation).get() ===
        undefined
    );
  }
  #context(
    profile: (typeof RunAssistantTurn.Type)["profile"]
  ): PrivateDiscoveryContext {
    const messages = this.#chat
      .history()
      .slice(-PRIVATE_DISCOVERY_MESSAGE_LIMIT)
      .map(({ id, role, text }) => ({ id, role, text }));
    const cards = this.#database
      .select()
      .from(privateProfileCards)
      .orderBy(desc(privateProfileCards.ordinal))
      .limit(PRIVATE_DISCOVERY_CARD_LIMIT)
      .all()
      .toReversed()
      .map(({ cardJson }) => {
        const { id, change, reviewedFact, revision, status } =
          Schema.decodeUnknownSync(Schema.fromJsonString(ProfileCard))(
            cardJson
          );
        return { change, id, reviewedFact, revision, status };
      });
    const previous = this.#database
      .select({ summary: privateAssistantTurns.summary })
      .from(privateAssistantTurns)
      .where(eq(privateAssistantTurns.status, "succeeded"))
      .orderBy(desc(privateAssistantTurns.ordinal))
      .get();
    const continuity =
      previous === undefined
        ? emptyPrivateDiscoveryContinuity()
        : Schema.decodeUnknownSync(PrivateDiscoveryContinuityJson)(
            previous.summary
          );
    const scope = this.#database
      .select()
      .from(privateDiscoverySessionScopes)
      .get()?.scope;
    if (scope === undefined) {
      throw invalidOutput("context_preparation");
    }
    const context = {
      cards,
      continuity,
      messages,
      profile: {
        facts: profile.facts.map(({ id, standing, value }) => ({
          id,
          standing,
          value,
        })),
        version: profile.version,
      },
      scope,
    };
    const bytes = () =>
      new TextEncoder().encode(JSON.stringify(context)).byteLength;
    while (
      bytes() > PRIVATE_DISCOVERY_CONTEXT_BYTES &&
      context.messages.length > 1
    ) {
      context.messages.shift();
    }
    while (
      bytes() > PRIVATE_DISCOVERY_CONTEXT_BYTES &&
      context.cards.length > 0
    ) {
      context.cards.shift();
    }
    if (bytes() > PRIVATE_DISCOVERY_CONTEXT_BYTES) {
      throw new PrivateDiscoveryFailure({
        provenance: null,
        reason: "context_limit",
        stage: null,
        usage: null,
      });
    }
    return Schema.decodeUnknownSync(PrivateDiscoveryContext)(context);
  }
  #notify(turn: StoredTurn): void {
    const session = this.#database.select().from(privateSessionBinding).get();
    if (session === undefined) {
      return;
    }
    const frame: SessionFrame = {
      state: { status: session.status, version: session.version },
      turn: publicTurn(turn),
      type: "AssistantTurnUpdated",
    };
    const current = this.#database
      .select()
      .from(privateAssistantTurns)
      .where(eq(privateAssistantTurns.id, turn.id))
      .get();
    this.#socket.send(
      current?.generation ?? turn.generation,
      JSON.stringify(frame)
    );
  }
  #recordMeasurements(
    turn: StoredTurn,
    measurements: Pick<PrivateDiscoveryFailure, "provenance" | "usage">
  ): void {
    const current = this.#database
      .select()
      .from(privateAssistantTurns)
      .where(eq(privateAssistantTurns.id, turn.id))
      .get();
    if (current === undefined) {
      return;
    }
    const usage =
      current.usageJson === null
        ? null
        : Schema.decodeUnknownSync(
            Schema.fromJsonString(PrivateDiscoveryUsage)
          )(current.usageJson);
    const definitive =
      usage !== null &&
      (usage.inputTokens !== null ||
        usage.outputTokens !== null ||
        usage.estimatedCostUsd !== null);
    this.#database
      .update(privateAssistantTurns)
      .set({
        provenanceJson:
          current.provenanceJson ??
          (measurements.provenance === null
            ? null
            : JSON.stringify(measurements.provenance)),
        usageJson:
          definitive || measurements.usage === null
            ? current.usageJson
            : JSON.stringify(measurements.usage),
      })
      .where(eq(privateAssistantTurns.id, turn.id))
      .run();
  }
  #fail(
    turn: StoredTurn,
    expectedStatus: "queued" | "running",
    failure: PrivateDiscoveryFailure
  ): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* recordPrivateFailure() {
      const row = this.#database.transaction(() => {
        const current = this.#database
          .select()
          .from(privateAssistantTurns)
          .where(eq(privateAssistantTurns.id, turn.id))
          .get();
        // Failure metadata may settle after a delivery generation detached.
        if (current?.status !== expectedStatus) {
          return;
        }
        this.#recordMeasurements(turn, failure);
        return this.#database
          .update(privateAssistantTurns)
          .set({
            completedAt: Date.now(),
            failure: failure.reason,
            status:
              failure.reason === "outcome_unknown" ? "interrupted" : "failed",
          })
          .where(eq(privateAssistantTurns.id, turn.id))
          .returning()
          .get();
      });
      if (row !== undefined) {
        this.#notify(row);
        if (failure.reason === "invalid_output" && failure.stage !== null) {
          yield* Effect.logWarning("private_discovery.invalid_output").pipe(
            Effect.annotateLogs({ stage: failure.stage })
          );
        }
      }
    });
  }
  #succeed(
    turn: StoredTurn,
    result: PrivateDiscoveryResult,
    context: PrivateDiscoveryContext
  ): PrivateChatReply {
    let reply: PrivateChatReply | undefined;
    const row = this.#database.transaction(() => {
      if (!this.#eligible(turn, "running")) {
        throw new PrivateOutputUnavailable({ reason: "output_disabled" });
      }
      const storedCards = this.#database
        .select()
        .from(privateProfileCards)
        .all()
        .map(({ cardJson }) =>
          Schema.decodeUnknownSync(Schema.fromJsonString(ProfileCard))(cardJson)
        );
      let submission: SubmitDiscoveryTurn;
      try {
        submission = Schema.decodeUnknownSync(SubmitDiscoveryTurn, {
          onExcessProperty: "error",
        })(result.output);
      } catch {
        throw invalidOutput("output_schema");
      }
      const proposals = reviewPrivateDiscoveryProposals(
        submission,
        context,
        storedCards
      );
      const participant = this.#chat.participant(turn.sourceMessageId);
      if (participant === undefined) {
        throw invalidOutput("need_evidence");
      }
      let continuation: ReturnType<typeof applyPrivateDiscoveryContinuation>;
      try {
        continuation = applyPrivateDiscoveryContinuation(
          context.continuity,
          submission.intent._tag === "Stop"
            ? emptyPrivateDiscoveryContinuityUpdates()
            : submission.intent.updates,
          submission.intent,
          participant,
          proposals,
          { profileFacts: context.profile.facts, scope: context.scope }
        );
      } catch (error) {
        if (
          error instanceof PrivateDiscoveryContinuationFailure ||
          error instanceof PrivateDiscoveryNeedFailure ||
          error instanceof PrivateDiscoveryCoverageFailure ||
          error instanceof PrivateDiscoveryClarificationFailure
        ) {
          throw invalidOutput(error.stage);
        }
        throw error;
      }
      reply = {
        createdAt: Date.now(),
        messageId: crypto.randomUUID(),
        text: continuation.message,
        type: "PrivateDiscoveryReply",
      };
      this.#chat.appendAssistant({
        createdAt: reply.createdAt,
        id: reply.messageId,
        text: reply.text,
      });
      for (const { card: existing, proposal } of proposals) {
        let card: ProfileCard;
        if (existing === null) {
          const id = crypto.randomUUID();
          const inserted = this.#database
            .insert(privateProfileCards)
            .values({ cardJson: "", id })
            .returning()
            .get();
          card = Schema.decodeUnknownSync(ProfileCard)({
            ...proposal,
            id,
            ordinal: inserted.ordinal,
            outcome: null,
            revision: 0,
            status: "proposed",
          });
        } else {
          card = {
            ...existing,
            ...proposal,
            outcome: null,
            revision: existing.revision + 1,
            status: "proposed",
          };
        }
        this.#database
          .update(privateProfileCards)
          .set({ cardJson: JSON.stringify(card) })
          .where(eq(privateProfileCards.id, card.id))
          .run();
      }
      this.#database
        .update(privateSessionBinding)
        .set({ version: turn.expectedSessionVersion + 1 })
        .run();
      return this.#database
        .update(privateAssistantTurns)
        .set({
          completedAt: Date.now(),
          failure: null,
          provenanceJson: JSON.stringify(result.provenance),
          status: "succeeded",
          summary: Schema.encodeSync(PrivateDiscoveryContinuityJson)(
            continuation.continuity
          ),
          usageJson: JSON.stringify(result.usage),
        })
        .where(eq(privateAssistantTurns.id, turn.id))
        .returning()
        .get();
    });
    if (row !== undefined) {
      this.#notify(row);
    }
    if (reply === undefined) {
      throw new PrivateOutputUnavailable({ reason: "output_disabled" });
    }
    return reply;
  }
  /** Application callbacks for the library-owned chat run; this class does not iterate a model. */
  async prepare(input: typeof RunAssistantTurn.Type) {
    const turn = this.#database
      .select()
      .from(privateAssistantTurns)
      .where(eq(privateAssistantTurns.id, input.turnId))
      .get();
    if (
      turn === undefined ||
      turn.generation !== input.generation ||
      !this.#eligible(turn, "queued")
    ) {
      throw new PrivateOutputUnavailable({ reason: "output_disabled" });
    }
    let context: PrivateDiscoveryContext;
    try {
      context = this.#context(input.profile);
    } catch (error) {
      const failure =
        error instanceof PrivateDiscoveryFailure
          ? error
          : invalidOutput("context_preparation");
      await Effect.runPromise(this.#fail(turn, "queued", failure));
      throw failure;
    }
    let claimed = false;
    const controller = new AbortController();
    const completion = Promise.withResolvers<null>();
    const release = () => {
      if (this.#resources.get(turn.id)?.controller === controller) {
        this.#resources.delete(turn.id);
        this.#clearExpiry(turn.id);
      }
      completion.resolve(null);
    };
    const beforeDispatch = (
      provenance: PrivateDiscoveryResult["provenance"]
    ) => {
      this.#database.transaction(() => {
        if (claimed || !this.#eligible(turn, "queued")) {
          throw new PrivateOutputUnavailable({ reason: "output_disabled" });
        }
        this.#database
          .update(privateAssistantTurns)
          .set({
            provenanceJson: JSON.stringify(provenance),
            status: "running",
          })
          .where(eq(privateAssistantTurns.id, turn.id))
          .run();
        claimed = true;
        this.#resources.set(turn.id, { controller, release });
        this.#armExpiry(turn.id);
      });
      this.#notify({ ...turn, status: "running" });
    };
    return {
      abortController: controller,
      accept: (result: PrivateDiscoveryResult): PrivateChatReply => {
        if (!claimed || controller.signal.aborted) {
          throw new PrivateOutputUnavailable({ reason: "output_disabled" });
        }
        this.#recordMeasurements(turn, result);
        return this.#succeed(turn, result, context);
      },
      beforeDispatch,
      context,
      dispose: release,
      done: completion.promise,
      fail: async (failure: PrivateDiscoveryFailure) => {
        if (claimed) {
          this.#recordMeasurements(turn, failure);
        }
        await Effect.runPromise(
          this.#fail(turn, claimed ? "running" : "queued", failure)
        );
      },
      signal: controller.signal,
    };
  }
}
