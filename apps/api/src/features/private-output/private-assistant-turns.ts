import type { ProfileFactValue } from "@meal-planner/household-api";
import {
  AssistantTurn,
  ProfileCard,
} from "@meal-planner/private-interview-api";
import type {
  ProfileCardChange,
  SessionFrame,
} from "@meal-planner/private-interview-api";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/durable-sqlite";
import { Cause, Effect, Exit, Option, Schema } from "effect";

import {
  applyPrivateDiscoveryContinuation,
  emptyPrivateDiscoveryContinuity,
  PrivateDiscoveryContinuationFailure,
  PrivateDiscoveryContinuityJson,
} from "./private-discovery-continuity.js";
import type { PrivateDiscoveryReviewedProposal } from "./private-discovery-message.js";
import {
  PRIVATE_DISCOVERY_CARD_LIMIT,
  PRIVATE_DISCOVERY_CONTEXT_BYTES,
  PRIVATE_DISCOVERY_MESSAGE_LIMIT,
  PrivateDiscoveryContext,
  PrivateDiscoveryFailure,
  PrivateDiscoveryUsage,
} from "./private-discovery-model.js";
import type {
  PrivateDiscoveryInvalidOutputStage,
  PrivateDiscoveryModel,
  PrivateDiscoveryOutput,
  PrivateDiscoveryProfile,
  PrivateDiscoveryResult,
} from "./private-discovery-model.js";
import { PrivateDiscoveryNeedFailure } from "./private-discovery-needs.js";
import type { RunAssistantTurn } from "./private-discovery.contract.js";
import type { PrivateOutputSocket } from "./private-output-socket.js";
import { PrivateOutputUnavailable } from "./private-output.contract.js";
import {
  privateAssistantTurns,
  privateMessages,
  privatePendingConfirmation,
  privateProfileCards,
  privateSessionBinding,
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
  change: ProfileCardChange,
  profile: PrivateDiscoveryProfile
): CardProposal => {
  if (change._tag === "AddConfirmedProfileFact") {
    if (
      profile.facts.some((fact) => factKey(fact.value) === factKey(change.fact))
    ) {
      throw invalidOutput("proposal_duplicate");
    }
    return {
      change,
      expectedProfileVersion: profile.version,
      reviewedFact: null,
    };
  }
  const before = profile.facts.find((fact) => fact.id === change.factId);
  if (before === undefined) {
    throw invalidOutput("proposal_unknown_fact");
  }
  switch (change._tag) {
    case "ConfirmProfileFact": {
      if (
        before.standing._tag === "confirmed" &&
        before.standing.basis === "self"
      ) {
        throw invalidOutput("proposal_already_confirmed");
      }
      break;
    }
    case "ReplaceOrdinaryProfileFact":
    case "RemoveOrdinaryProfileFact": {
      if (before.value._tag !== "FoodPreference") {
        throw invalidOutput("proposal_fact_kind");
      }
      break;
    }
    case "ConfirmHardConstraintReduction": {
      if (before.value._tag === "FoodPreference") {
        throw invalidOutput("proposal_fact_kind");
      }
      break;
    }
    default: {
      throw invalidOutput("proposal_review");
    }
  }
  return {
    change,
    expectedProfileVersion: profile.version,
    reviewedFact: before.value,
  };
};
export const reviewPrivateDiscoveryProposals = (
  output: PrivateDiscoveryOutput,
  context: PrivateDiscoveryContext,
  storedCards: readonly ProfileCard[]
): readonly PrivateDiscoveryReviewedProposal[] => {
  const seen = new Set(
    storedCards
      .filter((card) => card.status === "proposed" || card.status === "pending")
      .map((card) => proposalKey(card.change))
  );
  const revised = new Set<string>();
  return output.proposals.map((action) => {
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
        observed.revision !== action.expectedRevision ||
        current?.status !== "proposed" ||
        current.revision !== action.expectedRevision
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
    const key = proposalKey(action.change);
    if (seen.has(key)) {
      throw invalidOutput("proposal_duplicate");
    }
    seen.add(key);
    return { card, proposal: reviewProposal(action.change, context.profile) };
  });
};

/** Owns durable model attempts and their local abort lifetime; never exposed as a native RPC target. */
export class PrivateAssistantTurns {
  #database: ReturnType<typeof drizzle>;
  #socket: PrivateOutputSocket;
  #controllers = new Map<string, AbortController>();
  constructor(
    database: ReturnType<typeof drizzle>,
    socket: PrivateOutputSocket
  ) {
    this.#database = database;
    this.#socket = socket;
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
  canRetry(turnId: string): boolean {
    const latest = this.latest();
    return (
      latest?.id === turnId &&
      (latest.status === "failed" ||
        latest.status === "interrupted" ||
        latest.status === "cancelled")
    );
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
    this.#controllers.get(turnId)?.abort();
    return publicTurn(row);
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
      this.#controllers.get(turn.id)?.abort();
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
      this.#socket.isCurrent(turn.generation) &&
      session?.status === "open" &&
      session.version === turn.expectedSessionVersion &&
      this.#database.select().from(privatePendingConfirmation).get() ===
        undefined
    );
  }
  #context(
    profile: (typeof RunAssistantTurn.Type)["profile"]
  ): PrivateDiscoveryContext {
    const messages = this.#database
      .select()
      .from(privateMessages)
      .orderBy(desc(privateMessages.ordinal))
      .limit(PRIVATE_DISCOVERY_MESSAGE_LIMIT)
      .all()
      .toReversed()
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
    this.#socket.send(turn.generation, JSON.stringify(frame));
  }
  #recordMeasurements(
    turn: StoredTurn,
    measurements: Pick<PrivateDiscoveryFailure, "provenance" | "usage">
  ): void {
    const current = this.#database
      .select()
      .from(privateAssistantTurns)
      .where(
        and(
          eq(privateAssistantTurns.id, turn.id),
          eq(privateAssistantTurns.generation, turn.generation)
        )
      )
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
        if (!this.#eligible(turn, expectedStatus)) {
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
  ): void {
    const row = this.#database.transaction(() => {
      if (!this.#eligible(turn, "running")) {
        return;
      }
      const storedCards = this.#database
        .select()
        .from(privateProfileCards)
        .all()
        .map(({ cardJson }) =>
          Schema.decodeUnknownSync(Schema.fromJsonString(ProfileCard))(cardJson)
        );
      const proposals = reviewPrivateDiscoveryProposals(
        result.output,
        context,
        storedCards
      );
      const participant = this.#database
        .select({
          id: privateMessages.id,
          role: privateMessages.role,
          text: privateMessages.text,
        })
        .from(privateMessages)
        .where(eq(privateMessages.id, turn.sourceMessageId))
        .get();
      if (participant === undefined) {
        throw invalidOutput("need_evidence");
      }
      let continuation: ReturnType<typeof applyPrivateDiscoveryContinuation>;
      try {
        continuation = applyPrivateDiscoveryContinuation(
          context.continuity,
          result.output.continuity,
          result.output.reply,
          participant,
          proposals
        );
      } catch (error) {
        if (
          error instanceof PrivateDiscoveryContinuationFailure ||
          error instanceof PrivateDiscoveryNeedFailure
        ) {
          throw invalidOutput(error.stage);
        }
        throw error;
      }
      this.#database
        .insert(privateMessages)
        .values({
          createdAt: Date.now(),
          id: crypto.randomUUID(),
          role: "assistant",
          text: continuation.message,
        })
        .run();
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
  }
  run(
    input: typeof RunAssistantTurn.Type,
    model: PrivateDiscoveryModel
  ): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* runPrivateAttempt() {
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
        return;
      }
      const prepared = yield* Effect.exit(
        Effect.try({
          catch: (error) =>
            error instanceof PrivateDiscoveryFailure
              ? error
              : invalidOutput("context_preparation"),
          try: () => this.#context(input.profile),
        })
      );
      if (Exit.isFailure(prepared)) {
        yield* this.#fail(
          turn,
          "queued",
          Option.getOrElse(Cause.findErrorOption(prepared.cause), () =>
            invalidOutput("context_preparation")
          )
        );
        return;
      }
      const context = prepared.value;
      let claimed = false;
      const controller = new AbortController();
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
          this.#controllers.set(turn.id, controller);
        });
        this.#notify({ ...turn, status: "running" });
      };
      const outcome = yield* Effect.exit(
        model.generate({ beforeDispatch, context, signal: controller.signal })
      ).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            if (this.#controllers.get(turn.id) === controller) {
              this.#controllers.delete(turn.id);
            }
          })
        )
      );
      // A duplicate continuation that lost dispatch may never settle the winner.
      if (!claimed) {
        if (Exit.isFailure(outcome)) {
          yield* this.#fail(
            turn,
            "queued",
            Option.getOrElse(
              Cause.findErrorOption(outcome.cause),
              () =>
                new PrivateDiscoveryFailure({
                  provenance: null,
                  reason: "provider_unavailable",
                  stage: null,
                  usage: null,
                })
            )
          );
        }
        return;
      }
      // Only this invocation's successful claim permits metadata-only late cost settlement.
      // Terminal lifecycle decisions remain authoritative and no private content is retained here.
      if (Exit.isSuccess(outcome)) {
        this.#recordMeasurements(turn, outcome.value);
      } else {
        const failure = Cause.findErrorOption(outcome.cause);
        if (Option.isSome(failure)) {
          this.#recordMeasurements(turn, failure.value);
        }
      }
      if (!this.#socket.isCurrent(turn.generation)) {
        this.interrupt("connection_lost", turn.generation);
        return;
      }
      if (Exit.isFailure(outcome)) {
        yield* this.#fail(
          turn,
          "running",
          Option.getOrElse(
            Cause.findErrorOption(outcome.cause),
            () =>
              new PrivateDiscoveryFailure({
                provenance: null,
                reason: "outcome_unknown",
                stage: null,
                usage: null,
              })
          )
        );
        return;
      }
      const persisted = yield* Effect.exit(
        Effect.try({
          catch: (error) => {
            if (error instanceof PrivateDiscoveryFailure) {
              return new PrivateDiscoveryFailure({
                provenance: outcome.value.provenance,
                reason: error.reason,
                stage: error.stage,
                usage: outcome.value.usage,
              });
            }
            throw error;
          },
          try: () => this.#succeed(turn, outcome.value, context),
        })
      );
      if (Exit.isFailure(persisted)) {
        yield* this.#fail(
          turn,
          "running",
          Option.getOrElse(
            Cause.findErrorOption(persisted.cause),
            () =>
              new PrivateDiscoveryFailure({
                provenance: outcome.value.provenance,
                reason: "outcome_unknown",
                stage: null,
                usage: outcome.value.usage,
              })
          )
        );
      }
    });
  }
}
