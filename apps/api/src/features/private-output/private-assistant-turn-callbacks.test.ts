import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { PersonProfile } from "@meal-planner/household-api";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-sqlite";
import { Schema } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { PrivateAssistantTurns } from "./private-assistant-turns.js";
import { PrivateChatPersistence } from "./private-chat-persistence.js";
import { emptyPrivateDiscoveryContinuityUpdates } from "./private-discovery-continuity.js";
import { PrivateDiscoveryFailure } from "./private-discovery-model.js";
import type { PrivateDiscoveryResult } from "./private-discovery-model.js";
import {
  privateAssistantTurns,
  privateDiscoverySessionScopes,
  privateProfileCards,
  privateSessionBinding,
} from "./private-output.database-schema.js";

const migrationRoot = new URL(
  "../../../private-output-migrations/",
  import.meta.url
);
const migrations = readdirSync(migrationRoot)
  .filter((name) => /^\d+_/u.test(name))
  .toSorted()
  .map((name) =>
    readFileSync(new URL(`${name}/migration.sql`, migrationRoot), "utf-8")
  );
const databases: DatabaseSync[] = [];
const disposals: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposals.splice(0)) {
    dispose();
  }
  for (const database of databases.splice(0)) {
    database.close();
  }
});
const provenance: PrivateDiscoveryResult["provenance"] = {
  model: "synthetic",
  policyVersion: "synthetic",
  promptVersion: "synthetic",
  provider: "cloudflare-workers-ai",
  toolVersion: "synthetic",
};
const result = (): PrivateDiscoveryResult => ({
  output: {
    intent: {
      _tag: "Continue",
      proposals: [
        {
          _tag: "ProposeProfileCard",
          change: {
            _tag: "AddFact",
            fact: {
              _tag: "FoodPreference",
              label: "tomatoes",
              sentiment: "like",
              targetKind: "ingredient",
            },
          },
        },
      ],
      updates: emptyPrivateDiscoveryContinuityUpdates(),
    },
  },
  provenance,
  usage: { estimatedCostUsd: null, inputTokens: null, outputTokens: null },
});
const setup = () => {
  const sqlite = new DatabaseSync(":memory:");
  databases.push(sqlite);
  for (const migration of migrations) {
    sqlite.exec(migration);
  }
  const database = drizzle({ client: sqlite });
  const binding = {
    accountKey: "synthetic-account",
    householdKey: "synthetic-household",
    linkageSubject: "synthetic-linkage",
    personId: `person_${crypto.randomUUID()}`,
    sessionReference: crypto.randomUUID(),
  };
  const generation = crypto.randomUUID();
  database
    .insert(privateSessionBinding)
    .values({ ...binding, status: "open", version: 1 })
    .run();
  database
    .insert(privateDiscoverySessionScopes)
    .values({
      scope: "ProfileEdit",
      sessionReference: binding.sessionReference,
    })
    .run();
  const chat = new PrivateChatPersistence(database);
  const participant = chat.appendParticipant({
    createdAt: Date.now(),
    id: crypto.randomUUID(),
    text: "I like tomatoes.",
  });
  const frames: string[] = [];
  const turns = new PrivateAssistantTurns(database, {
    isCurrent: (selected) => selected === generation,
    read: () => ({
      expiresAt: Date.now() + 60_000,
      generation,
      singleton: 1,
      status: "connected",
    }),
    send: (_generation, frame) => {
      frames.push(frame);
    },
  });
  const turnId = "run-fixture-callback";
  turns.queue({
    expectedSessionVersion: 1,
    generation,
    id: turnId,
    sourceMessageId: participant.id,
  });
  const input = {
    binding,
    generation,
    profile: Schema.decodeUnknownSync(PersonProfile)({
      audit: null,
      facts: [],
      personId: binding.personId,
      version: 0,
    }),
    turnId,
  };
  const prepare = async (id = turnId) => {
    const prepared = await turns.prepare({ ...input, turnId: id });
    disposals.push(prepared.dispose);
    return prepared;
  };
  const retained = () =>
    database
      .select()
      .from(privateAssistantTurns)
      .where(eq(privateAssistantTurns.id, turnId))
      .get();
  return { chat, database, frames, prepare, retained, turnId, turns };
};

describe("private application callbacks for native chat", () => {
  it("commits accepted reply, proposed card, coverage and turn together", async () => {
    const fixture = setup();
    const prepared = await fixture.prepare();
    prepared.beforeDispatch(provenance);
    const reply = prepared.accept(result());
    expect(reply.text).toContain("tomatoes");
    expect(fixture.chat.history().map((message) => message.role)).toEqual([
      "participant",
      "assistant",
    ]);
    expect(fixture.chat.history()[1]?.id).toBe(reply.messageId);
    expect(fixture.retained()).toMatchObject({
      failure: null,
      status: "succeeded",
    });
    expect(fixture.retained()?.summary).toBeTypeOf("string");
    expect(fixture.retained()?.usageJson).toBe(JSON.stringify(result().usage));
    expect(
      fixture.database.select().from(privateSessionBinding).get()?.version
    ).toBe(2);
    const card = fixture.database.select().from(privateProfileCards).get();
    expect(JSON.parse(card?.cardJson ?? "null")).toMatchObject({
      outcome: null,
      status: "proposed",
    });
  });

  it("rejects an omitted coverage field without retaining generated state", async () => {
    const fixture = setup();
    const prepared = await fixture.prepare();
    prepared.beforeDispatch(provenance);
    const untrusted = structuredClone(result());
    Reflect.deleteProperty(
      untrusted.output.intent._tag === "Continue"
        ? untrusted.output.intent.updates.coverage
        : {},
      "foodRestrictions"
    );
    let rejected: unknown;
    try {
      prepared.accept(untrusted);
    } catch (error) {
      rejected = error;
    }
    expect(rejected).toBeInstanceOf(PrivateDiscoveryFailure);
    if (!(rejected instanceof PrivateDiscoveryFailure)) {
      throw new Error("Expected schema failure");
    }
    await prepared.fail(rejected);
    expect(fixture.retained()).toMatchObject({
      failure: "invalid_output",
      status: "failed",
      summary: null,
    });
    expect(fixture.chat.history()).toHaveLength(1);
    expect(fixture.database.select().from(privateProfileCards).all()).toEqual(
      []
    );
    expect(
      fixture.database.select().from(privateSessionBinding).get()?.version
    ).toBe(1);
  });

  it("keeps explicit cancellation authoritative over a late proposal", async () => {
    const fixture = setup();
    const prepared = await fixture.prepare();
    prepared.beforeDispatch(provenance);
    fixture.turns.cancel(fixture.turnId);
    expect(prepared.signal.aborted).toBe(true);
    await expect(prepared.done).resolves.toBeNull();
    expect(() => prepared.accept(result())).toThrow();
    expect(fixture.retained()).toMatchObject({
      status: "cancelled",
      summary: null,
    });
    expect(fixture.chat.history()).toHaveLength(1);
    expect(fixture.database.select().from(privateProfileCards).all()).toEqual(
      []
    );
  });

  it("allows only one dispatch claim for duplicate prepared callbacks", async () => {
    const fixture = setup();
    const first = await fixture.prepare();
    const duplicate = await fixture.prepare();
    first.beforeDispatch(provenance);
    expect(() => duplicate.beforeDispatch(provenance)).toThrow();
    await duplicate.fail(
      new PrivateDiscoveryFailure({
        provenance: null,
        reason: "provider_unavailable",
        stage: null,
        usage: null,
      })
    );
    duplicate.dispose();
    await expect(duplicate.done).resolves.toBeNull();
    expect(await Promise.race([first.done, Promise.resolve("running")])).toBe(
      "running"
    );
    expect(fixture.retained()?.status).toBe("running");
    first.accept(result());
    expect(fixture.retained()?.status).toBe("succeeded");
    expect(fixture.chat.history()).toHaveLength(2);
  });

  it("does not revive a revoked attempt when a fresh generation is authorized", async () => {
    const fixture = setup();
    const prepared = await fixture.prepare();
    prepared.beforeDispatch(provenance);
    const generation = fixture.retained()?.generation;
    if (generation === undefined) {
      throw new Error("Expected admitted generation");
    }
    fixture.turns.interrupt("connection_lost", generation);
    await expect(prepared.done).resolves.toBeNull();
    fixture.turns.reauthorize(generation, crypto.randomUUID());
    expect(fixture.retained()).toMatchObject({
      failure: "connection_lost",
      generation,
      status: "interrupted",
    });
    expect(() => prepared.accept(result())).toThrow();
    expect(fixture.chat.history()).toHaveLength(1);
    expect(fixture.database.select().from(privateProfileCards).all()).toEqual(
      []
    );
  });

  it("does not release a later run when an old SDK cleanup arrives", async () => {
    const fixture = setup();
    const first = await fixture.prepare();
    first.beforeDispatch(provenance);
    fixture.turns.cancel(fixture.turnId);
    await expect(first.done).resolves.toBeNull();
    const previous = fixture.retained();
    if (previous === undefined) {
      throw new Error("Expected cancelled attempt");
    }
    const nextId = "run-fixture-next";
    fixture.turns.queue({
      expectedSessionVersion: previous.expectedSessionVersion,
      generation: previous.generation,
      id: nextId,
      sourceMessageId: previous.sourceMessageId,
    });
    const next = await fixture.prepare(nextId);
    next.beforeDispatch(provenance);
    first.dispose();
    first.dispose();
    expect(next.signal.aborted).toBe(false);
    expect(await Promise.race([next.done, Promise.resolve("running")])).toBe(
      "running"
    );
    fixture.turns.cancel(nextId);
    await expect(next.done).resolves.toBeNull();
    expect(fixture.chat.history()).toHaveLength(1);
  });
});
